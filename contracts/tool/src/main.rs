//! Operator tool for the Kasman prize pool covenant (`contracts/KasmanPool.sil`).
//!
//!   kasman-pool keygen                                                                   (secret key, pubkey, addresses)
//!   kasman-pool pools   <oracle-pubkey-hex> <mainnet|testnet> <first YYYY-MM> <months>   > worker/pools.json
//!   kasman-pool payout  <mainnet|testnet> <api-url> <settlement.json>                     (env ORACLE_KEY)
//!   kasman-pool deploy  <mainnet|testnet> <api-url> <oracle-pubkey> <treasury-owner-pubkey> [--dry-run]
//!                       > src/lib/onchain.json                                            (env DEPLOY_KEY)
//!   kasman-pool treasury <mainnet|testnet> <api-url> <to-address>                         (env TREASURY_KEY)
//!
//! `deploy` and `treasury` write signed transactions (Safe JSON) that `node scripts/broadcast.mjs`
//! sends: Kaspa's REST API cannot submit covenant / version-1 transactions on every network.
//!
//! `payout` reads the settlement the Worker publishes (`GET /api/month/:m/settlement`),
//! signs it with the oracle key, spends every pool UTXO of that month to the winner,
//! runs each input through the script engine locally and only then broadcasts.
//! The oracle key never leaves the operator's machine.

// Some builders are only used by the tests.
#[allow(dead_code)]
mod collection;
mod deploy;

use kaspa_addresses::{Address, Prefix};
use kaspa_consensus_core::config::params::{MAINNET_PARAMS, Params, TESTNET_PARAMS};
use kaspa_consensus_core::hashing::sighash::SigHashReusedValuesUnsync;
use kaspa_consensus_core::mass::MassCalculator;
use kaspa_consensus_core::subnets::SUBNETWORK_ID_NATIVE;
use kaspa_consensus_core::tx::{
    MutableTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput, TransactionOutpoint, TransactionOutput,
    UtxoEntry, VerifiableTransaction,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::script_builder::ScriptBuilder;
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine, pay_to_address_script, pay_to_script_hash_script};
use secp256k1::{Keypair, Message, SecretKey};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use silverscript_abi::{ArtifactValue, SilAbiArtifact, encode_contract_entry_sig_script};
use silverscript_lang::compiler::{CompileOptions, compile_to_sil_abi_artifact_with_options};

const SOURCE: &str = include_str!("../../KasmanPool.sil");
/// Inputs per payout transaction, keeps each one well under the standard mass limit.
const MAX_INPUTS: usize = 40;
const COMPUTE_BUDGET: u16 = 20;

type Res<T> = Result<T, String>;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let run = || -> Res<()> {
        match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
            ["keygen"] => {
                let kp = Keypair::new_global(&mut secp256k1::rand::thread_rng());
                let pubkey = kp.x_only_public_key().0.serialize();
                println!("secret key (ORACLE_KEY / DEPLOY_KEY / TREASURY_KEY)={}", hex(&kp.secret_bytes()));
                println!("pubkey={}", hex(&pubkey));
                println!("testnet address={}", Address::new(Prefix::Testnet, kaspa_addresses::Version::PubKey, &pubkey));
                println!("mainnet address={}", Address::new(Prefix::Mainnet, kaspa_addresses::Version::PubKey, &pubkey));
                Ok(())
            }
            ["pools", oracle, net, first, months] => {
                let oracle = unhex32(oracle)?;
                let (prefix, _) = network(net)?;
                let months: u32 = months.parse().map_err(|_| "months must be a number")?;
                let (mut y, mut m) = parse_month(first)?;
                let mut pools = serde_json::Map::new();
                for _ in 0..months {
                    let month = format!("{y:04}-{m:02}");
                    pools.insert(month.clone(), json!(pool_address(&oracle, month_id(&month)?, prefix)?.to_string()));
                    (y, m) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
                }
                let out = json!({ "network": net, "oracle": hex(&oracle), "pools": pools });
                println!("{}", serde_json::to_string_pretty(&out).unwrap());
                Ok(())
            }
            ["payout", net, api, settlement] => payout(net, api, settlement),
            ["treasury", net, api, to] => treasury_cmd(net, api, to),
            ["deploy", net, api, oracle, treasury_owner] => deploy_cmd(net, api, oracle, treasury_owner, false),
            ["deploy", net, api, oracle, treasury_owner, "--dry-run"] => deploy_cmd(net, api, oracle, treasury_owner, true),
            _ => Err("usage: see the comment at the top of contracts/tool/src/main.rs".into()),
        }
    };
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn network(name: &str) -> Res<(Prefix, &'static Params)> {
    match name {
        "mainnet" => Ok((Prefix::Mainnet, &MAINNET_PARAMS)),
        "testnet" => Ok((Prefix::Testnet, &TESTNET_PARAMS)),
        _ => Err(format!("unknown network {name}")),
    }
}

fn parse_month(month: &str) -> Res<(i32, u32)> {
    let (y, m) = month.split_once('-').ok_or("month must be YYYY-MM")?;
    let (y, m) = (y.parse().map_err(|_| "bad year")?, m.parse().map_err(|_| "bad month")?);
    if !(1..=12).contains(&m) {
        return Err("bad month".into());
    }
    Ok((y, m))
}

/// Month id baked into the contract, e.g. "2026-10" -> 202610.
fn month_id(month: &str) -> Res<i64> {
    let (y, m) = parse_month(month)?;
    Ok(y as i64 * 100 + m as i64)
}

fn pool_artifact(oracle: &[u8; 32], month: i64) -> Res<SilAbiArtifact> {
    let args = [ArtifactValue::Bytes(oracle.to_vec()), ArtifactValue::Int(month)];
    compile_to_sil_abi_artifact_with_options(SOURCE, &args, CompileOptions::default()).map_err(|e| e.to_string())
}

fn redeem_script(artifact: &SilAbiArtifact) -> Vec<u8> {
    artifact.contracts["KasmanPool"].compiled.bytecode.clone()
}

fn pool_address(oracle: &[u8; 32], month: i64, prefix: Prefix) -> Res<Address> {
    let spk = pay_to_script_hash_script(&redeem_script(&pool_artifact(oracle, month)?));
    kaspa_txscript::extract_script_pub_key_address(&spk, prefix).map_err(|e| e.to_string())
}

/// Script public key as `tx.outputs[i].scriptPubKey` sees it: version (big endian) + script.
fn spk_bytes(spk: &ScriptPublicKey) -> Vec<u8> {
    spk.version().to_be_bytes().into_iter().chain(spk.script().iter().copied()).collect()
}

/// What the oracle signs; must match `message` in KasmanPool.sil.
fn payout_digest(month: i64, root: &[u8; 32], winner: &ScriptPublicKey) -> [u8; 32] {
    let mut m = b"kasman-payout".to_vec();
    m.extend_from_slice(&month.to_le_bytes());
    m.extend_from_slice(root);
    m.extend_from_slice(&spk_bytes(winner));
    Sha256::digest(&m).into()
}

/// Sigscript for `payout(oracleSig, winner, root)` followed by the P2SH redeem script.
fn payout_sig_script(artifact: &SilAbiArtifact, sig: &[u8], winner: &ScriptPublicKey, root: &[u8; 32]) -> Res<Vec<u8>> {
    let args = [ArtifactValue::Bytes(sig.to_vec()), ArtifactValue::Bytes(spk_bytes(winner)), ArtifactValue::Bytes(root.to_vec())];
    let mut script = encode_contract_entry_sig_script(artifact, "KasmanPool", "payout", &args).map_err(|e| e.to_string())?;
    script.extend(ScriptBuilder::new().add_data(&redeem_script(artifact)).map_err(|e| e.to_string())?.drain());
    Ok(script)
}

/// Builds one payout transaction over `utxos` (all at the pool address of `month`).
/// `fee` is subtracted from the winner's output.
fn build_payout(
    artifact: &SilAbiArtifact,
    sig: &[u8],
    winner: &ScriptPublicKey,
    root: &[u8; 32],
    utxos: &[(TransactionOutpoint, UtxoEntry)],
    fee: u64,
) -> Res<MutableTransaction<Transaction>> {
    let sig_script = payout_sig_script(artifact, sig, winner, root)?;
    let inputs = utxos
        .iter()
        .map(|(outpoint, _)| TransactionInput::new_with_compute_budget(*outpoint, sig_script.clone(), 0, COMPUTE_BUDGET))
        .collect();
    let total: u64 = utxos.iter().map(|(_, e)| e.amount).sum();
    let value = total.checked_sub(fee).ok_or("pool too small to pay the fee")?;
    let output = TransactionOutput::new(value, winner.clone());
    let tx = Transaction::new(1, inputs, vec![output], 0, SUBNETWORK_ID_NATIVE, 0, vec![]);
    Ok(MutableTransaction::with_entries(tx, utxos.iter().map(|(_, e)| e.clone()).collect()))
}

/// Runs every input through the script engine, like a node would.
fn verify(tx: &MutableTransaction<Transaction>) -> Res<()> {
    let tx = tx.as_verifiable();
    let cache = Cache::new(1_000);
    let reused = SigHashReusedValuesUnsync::new();
    for (i, (input, entry)) in tx.populated_inputs().enumerate() {
        let mut vm = TxScriptEngine::from_transaction_input(
            &tx,
            input,
            i,
            entry,
            EngineCtx::new(&cache).with_reused(&reused),
            EngineFlags { covenants_enabled: true, ..Default::default() },
        );
        vm.execute().map_err(|e| format!("input {i}: {e}"))?;
    }
    Ok(())
}

fn fee_for(tx: &MutableTransaction<Transaction>, params: &Params) -> Res<u64> {
    let calc = MassCalculator::new_with_consensus_params(params);
    let nc = calc.calc_non_contextual_masses(&tx.tx);
    let c = calc.calc_contextual_masses(&tx.as_verifiable()).ok_or("mass overflow")?;
    // 1 sompi per gram is the minimum relay fee rate; pay double so it is not stuck.
    Ok(2 * nc.compute_mass.max(nc.transient_mass).max(c.storage_mass).max(1))
}

fn payout(net: &str, api: &str, settlement_path: &str) -> Res<()> {
    let (prefix, params) = network(net)?;
    let key = SecretKey::from_slice(&unhex(&std::env::var("ORACLE_KEY").map_err(|_| "set ORACLE_KEY")?)?).map_err(|e| e.to_string())?;
    let kp = Keypair::from_secret_key(secp256k1::SECP256K1, &key);
    let oracle = kp.x_only_public_key().0.serialize();

    let s: Value = serde_json::from_str(&std::fs::read_to_string(settlement_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let month = s["month"].as_str().ok_or("settlement.month")?;
    let root = unhex32(s["root"].as_str().ok_or("settlement.root")?)?;
    let winner_addr = Address::try_from(s["winner"].as_str().ok_or("settlement.winner")?).map_err(|e| e.to_string())?;
    if winner_addr.prefix != prefix {
        return Err("winner address is on another network".into());
    }
    let winner = pay_to_address_script(&winner_addr);
    let month = month_id(month)?;
    let artifact = pool_artifact(&oracle, month)?;
    let pool = pool_address(&oracle, month, prefix)?;
    let digest = payout_digest(month, &root, &winner);
    let sig = kp.sign_schnorr(Message::from_digest(digest)).serialize();

    let utxos = ureq::get(&format!("{api}/addresses/{pool}/utxos")).call().map_err(|e| e.to_string())?.into_json::<Value>().map_err(|e| e.to_string())?;
    let utxos: Vec<(TransactionOutpoint, UtxoEntry)> = utxos
        .as_array()
        .ok_or("bad utxo response")?
        .iter()
        .map(|u| -> Res<_> {
            let txid: TransactionId = u["outpoint"]["transactionId"].as_str().ok_or("txid")?.parse().map_err(|_| "txid")?;
            let index = u["outpoint"]["index"].as_u64().ok_or("index")? as u32;
            let e = &u["utxoEntry"];
            let amount = e["amount"].as_str().and_then(|a| a.parse().ok()).ok_or("amount")?;
            let daa = e["blockDaaScore"].as_str().and_then(|a| a.parse().ok()).unwrap_or(0);
            let spk = pay_to_script_hash_script(&redeem_script(&artifact));
            Ok((TransactionOutpoint::new(txid, index), UtxoEntry::new(amount, spk, daa, false, None)))
        })
        .collect::<Res<_>>()?;
    println!("pool {pool}: {} UTXOs, {} sompi, winner {winner_addr}", utxos.len(), utxos.iter().map(|u| u.1.amount).sum::<u64>());

    let mut unsent = vec![];
    for chunk in utxos.chunks(MAX_INPUTS) {
        let draft = build_payout(&artifact, &sig, &winner, &root, chunk, 0)?;
        let tx = build_payout(&artifact, &sig, &winner, &root, chunk, fee_for(&draft, params)?)?;
        verify(&tx)?;
        let body = json!({ "transaction": rest_tx(&tx.tx), "allowOrphan": false });
        match ureq::post(&format!("{api}/transactions")).send_json(body) {
            Ok(res) => println!("sent: {}", res.into_string().unwrap_or_default()),
            Err(e) => {
                let why = match e {
                    ureq::Error::Status(code, r) => format!("{code}: {}", r.into_string().unwrap_or_default()),
                    e => e.to_string(),
                };
                eprintln!("REST API refused the transaction ({why})");
                let entries = tx.entries.iter().map(|e| e.clone().ok_or_else(|| "missing UTXO entry".to_string())).collect::<Res<Vec<_>>>()?;
                unsent.push(deploy::Built { tx: tx.tx.clone(), entries }.safe_json());
            }
        }
    }
    if !unsent.is_empty() {
        // Some REST APIs (testnet-10) do not take version-1 fields: send through a node instead.
        std::fs::write("payout-txs.json", serde_json::to_string_pretty(&unsent).unwrap()).map_err(|e| e.to_string())?;
        let sdk_network = if net == "mainnet" { "mainnet" } else { "testnet-10" };
        println!("wrote payout-txs.json ({} transactions). Broadcast: node scripts/broadcast.mjs contracts/tool/payout-txs.json {sdk_network}", unsent.len());
    }
    Ok(())
}

/// Genesis of the NFT collection, rewards ledger and token (see deploy.rs). `--dry-run` uses a
/// throwaway key and a made-up funding UTXO: same templates, other covenant IDs, nothing to send.
fn deploy_cmd(net: &str, api: &str, oracle: &str, treasury_owner: &str, dry_run: bool) -> Res<()> {
    let (prefix, params) = network(net)?;
    let (oracle, treasury_owner) = (unhex32(oracle)?, unhex32(treasury_owner)?);
    let deployer = if dry_run {
        Keypair::new_global(&mut secp256k1::rand::thread_rng())
    } else {
        let key = SecretKey::from_slice(&unhex(&std::env::var("DEPLOY_KEY").map_err(|_| "set DEPLOY_KEY")?)?).map_err(|e| e.to_string())?;
        Keypair::from_secret_key(secp256k1::SECP256K1, &key)
    };
    let address = Address::new(prefix, kaspa_addresses::Version::PubKey, &deployer.x_only_public_key().0.serialize());
    let spk = pay_to_address_script(&address);
    let funding = if dry_run {
        (TransactionOutpoint::new(TransactionId::from_bytes([1; 32]), 0), UtxoEntry::new(100 * collection::SOMPI_PER_KAS as u64, spk, 0, false, None))
    } else {
        let utxos = ureq::get(&format!("{api}/addresses/{address}/utxos")).call().map_err(|e| e.to_string())?.into_json::<Value>().map_err(|e| e.to_string())?;
        let best = utxos
            .as_array()
            .ok_or("bad utxo response")?
            .iter()
            .filter_map(|u| {
                let amount: u64 = u["utxoEntry"]["amount"].as_str()?.parse().ok()?;
                let txid: TransactionId = u["outpoint"]["transactionId"].as_str()?.parse().ok()?;
                Some((TransactionOutpoint::new(txid, u["outpoint"]["index"].as_u64()? as u32), amount))
            })
            .max_by_key(|u| u.1)
            .ok_or_else(|| format!("no UTXOs at the deploy address {address}"))?;
        (best.0, UtxoEntry::new(best.1, spk, 0, false, None))
    };
    let sdk_network = if net == "mainnet" { "mainnet" } else { "testnet-10" };
    let d = deploy::deploy(sdk_network, prefix, params, &deployer, funding, treasury_owner, oracle)?;
    let mut config = d.config;
    config["deployed"] = json!(!dry_run);
    println!("{}", serde_json::to_string_pretty(&config).unwrap());
    if dry_run {
        let txs: Vec<Value> = d.txs.iter().map(|t| t.safe_json()).collect();
        std::fs::write("deploy-txs.dry-run.json", serde_json::to_string_pretty(&txs).unwrap()).map_err(|e| e.to_string())?;
        eprintln!("dry run: {} genesis transactions verified, written to deploy-txs.dry-run.json (not signed by a funded key: do not send)", d.txs.len());
    } else {
        let txs: Vec<Value> = d.txs.iter().map(|t| t.safe_json()).collect();
        std::fs::write("deploy-txs.json", serde_json::to_string_pretty(&txs).unwrap()).map_err(|e| e.to_string())?;
        eprintln!("deployer {address}: wrote deploy-txs.json ({} transactions). Broadcast: node scripts/broadcast.mjs deploy-txs.json {sdk_network}", txs.len());
    }
    Ok(())
}

/// Withdraws everything the Treasury holds (NFT mints, royalties) to `to`.
fn treasury_cmd(net: &str, api: &str, to: &str) -> Res<()> {
    let (prefix, params) = network(net)?;
    let key = SecretKey::from_slice(&unhex(&std::env::var("TREASURY_KEY").map_err(|_| "set TREASURY_KEY")?)?).map_err(|e| e.to_string())?;
    let owner = Keypair::from_secret_key(secp256k1::SECP256K1, &key);
    let to = Address::try_from(to).map_err(|e| e.to_string())?;
    if to.prefix != prefix {
        return Err("destination address is on another network".into());
    }
    let redeem = collection::bytecode(&collection::treasury(owner.x_only_public_key().0.serialize())?);
    let treasury = kaspa_txscript::extract_script_pub_key_address(&pay_to_script_hash_script(&redeem), prefix).map_err(|e| e.to_string())?;
    let utxos = ureq::get(&format!("{api}/addresses/{treasury}/utxos")).call().map_err(|e| e.to_string())?.into_json::<Value>().map_err(|e| e.to_string())?;
    let utxos: Vec<(TransactionOutpoint, u64)> = utxos
        .as_array()
        .ok_or("bad utxo response")?
        .iter()
        .filter_map(|u| {
            let txid: TransactionId = u["outpoint"]["transactionId"].as_str()?.parse().ok()?;
            Some((TransactionOutpoint::new(txid, u["outpoint"]["index"].as_u64()? as u32), u["utxoEntry"]["amount"].as_str()?.parse().ok()?))
        })
        .collect();
    if utxos.is_empty() {
        return Err(format!("the treasury {treasury} is empty"));
    }
    let total: u64 = utxos.iter().map(|u| u.1).sum();
    let txs = deploy::treasury_withdraw(params, &owner, &utxos, pay_to_address_script(&to))?;
    let json: Vec<Value> = txs.iter().map(|t| t.safe_json()).collect();
    std::fs::write("treasury-txs.json", serde_json::to_string_pretty(&json).unwrap()).map_err(|e| e.to_string())?;
    let sdk_network = if net == "mainnet" { "mainnet" } else { "testnet-10" };
    println!("treasury {treasury}: {} UTXOs, {total} sompi to {to}. Wrote treasury-txs.json ({} transactions). Broadcast: node scripts/broadcast.mjs contracts/tool/treasury-txs.json {sdk_network}", utxos.len(), txs.len());
    Ok(())
}

/// Transaction in the api.kaspa.org `SubmitTxModel` shape.
fn rest_tx(tx: &Transaction) -> Value {
    json!({
        "version": tx.version,
        "inputs": tx.inputs.iter().map(|i| json!({
            "previousOutpoint": { "transactionId": i.previous_outpoint.transaction_id.to_string(), "index": i.previous_outpoint.index },
            "signatureScript": hex(&i.signature_script),
            "sequence": i.sequence,
            "sigOpCount": 0,
            "computeBudget": COMPUTE_BUDGET,
        })).collect::<Vec<_>>(),
        "outputs": tx.outputs.iter().map(|o| json!({
            "amount": o.value,
            "scriptPublicKey": { "version": o.script_public_key.version(), "scriptPublicKey": hex(o.script_public_key.script()) },
        })).collect::<Vec<_>>(),
        "lockTime": tx.lock_time,
        "subnetworkId": tx.subnetwork_id.to_string(),
        "gas": 0,
        "payload": "",
    })
}

fn hex(b: &[u8]) -> String {
    faster_hex::hex_string(b)
}
fn unhex(s: &str) -> Res<Vec<u8>> {
    let mut out = vec![0; s.len() / 2];
    faster_hex::hex_decode(s.trim().as_bytes(), &mut out).map_err(|_| format!("bad hex {s}"))?;
    Ok(out)
}
fn unhex32(s: &str) -> Res<[u8; 32]> {
    unhex(s)?.try_into().map_err(|_| "expected 32 bytes".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (Keypair, i64, SilAbiArtifact, ScriptPublicKey, [u8; 32], Vec<(TransactionOutpoint, UtxoEntry)>) {
        let kp = Keypair::new_global(&mut secp256k1::rand::thread_rng());
        let month = month_id("2026-10").unwrap();
        let artifact = pool_artifact(&kp.x_only_public_key().0.serialize(), month).unwrap();
        let winner = pay_to_address_script(&Address::new(Prefix::Mainnet, kaspa_addresses::Version::PubKey, &[7u8; 32]));
        let spk = pay_to_script_hash_script(&redeem_script(&artifact));
        let utxos = (0..3)
            .map(|i| (TransactionOutpoint::new(TransactionId::from_bytes([i; 32]), 0), UtxoEntry::new(10_000_000_000, spk.clone(), 0, false, None)))
            .collect();
        (kp, month, artifact, winner, [9u8; 32], utxos)
    }

    fn sign(kp: &Keypair, month: i64, root: &[u8; 32], winner: &ScriptPublicKey) -> [u8; 64] {
        kp.sign_schnorr(Message::from_digest(payout_digest(month, root, winner))).serialize()
    }

    #[test]
    fn month_id_is_yyyymm() {
        assert_eq!(month_id("2026-10").unwrap(), 202610);
        assert!(month_id("2026-13").is_err());
    }

    #[test]
    fn signed_payout_to_winner_verifies() {
        let (kp, month, artifact, winner, root, utxos) = setup();
        let tx = build_payout(&artifact, &sign(&kp, month, &root, &winner), &winner, &root, &utxos, 10_000).unwrap();
        verify(&tx).unwrap();
        assert!(fee_for(&tx, &MAINNET_PARAMS).unwrap() > 0);
    }

    #[test]
    fn rejects_other_destination_bad_sig_and_extra_output() {
        let (kp, month, artifact, winner, root, utxos) = setup();
        let sig = sign(&kp, month, &root, &winner);

        let thief = pay_to_address_script(&Address::new(Prefix::Mainnet, kaspa_addresses::Version::PubKey, &[8u8; 32]));
        let mut tx = build_payout(&artifact, &sig, &winner, &root, &utxos, 10_000).unwrap();
        tx.tx.outputs[0].script_public_key = thief.clone();
        assert!(verify(&tx).is_err(), "output to an address the oracle did not sign");

        let tx = build_payout(&artifact, &sign(&kp, month, &root, &thief), &winner, &root, &utxos, 10_000).unwrap();
        assert!(verify(&tx).is_err(), "signature for another winner");

        let other = Keypair::new_global(&mut secp256k1::rand::thread_rng());
        let tx = build_payout(&artifact, &sign(&other, month, &root, &winner), &winner, &root, &utxos, 10_000).unwrap();
        assert!(verify(&tx).is_err(), "signature from another key");

        let mut tx = build_payout(&artifact, &sig, &winner, &root, &utxos, 10_000).unwrap();
        tx.tx.outputs.push(TransactionOutput::new(1, thief));
        assert!(verify(&tx).is_err(), "second output");
    }

    #[test]
    fn each_month_has_its_own_address() {
        let oracle = [2u8; 32];
        let a = pool_address(&oracle, month_id("2026-10").unwrap(), Prefix::Mainnet).unwrap();
        let b = pool_address(&oracle, month_id("2026-11").unwrap(), Prefix::Mainnet).unwrap();
        assert_ne!(a, b);
        assert!(a.to_string().starts_with("kaspa:p"));
    }
}
