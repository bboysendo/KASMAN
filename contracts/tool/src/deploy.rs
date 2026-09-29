//! `kasman-pool deploy`: genesis of the NFT collection, the rewards ledger and the KASMAN token
//! (minter + KCC20), once per network. It only creates the covenants: nothing here can mint
//! tokens or move players' funds afterwards.
//!
//! Output:
//! - `src/lib/onchain.json`: covenant IDs, templates and entry selectors for the web and the Worker.
//! - `deploy-txs.json`: the signed genesis transactions (Safe JSON), broadcast in order by
//!   `node scripts/broadcast.mjs deploy-txs.json` (Kaspa's REST API cannot submit covenant transactions).
//!
//! Every transaction runs through the script engine before it is written.

use kaspa_addresses::{Address, Prefix, Version};
use kaspa_consensus_core::Hash;
use kaspa_consensus_core::config::params::Params;
use kaspa_consensus_core::hashing::covenant_id::covenant_id;
use kaspa_consensus_core::hashing::sighash::{SigHashReusedValuesUnsync, calc_schnorr_signature_hash};
use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
use kaspa_consensus_core::mass::MassCalculator;
use kaspa_consensus_core::subnets::SUBNETWORK_ID_NATIVE;
use kaspa_consensus_core::tx::{
    CovenantBinding, MutableTransaction, PopulatedTransaction, ScriptPublicKey, Transaction, TransactionInput, TransactionOutpoint,
    TransactionOutput, UtxoEntry, VerifiableTransaction,
};
use kaspa_txscript::caches::Cache;
use kaspa_txscript::covenants::CovenantsContext;
use kaspa_txscript::script_builder::ScriptBuilder;
use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine, pay_to_address_script, pay_to_script_hash_script};
use secp256k1::{Keypair, Message};
use serde_json::{Value, json};
use silverscript_abi::{ArtifactValue, SilAbiArtifact, encode_contract_covenant_decl_sig_script, encode_contract_entry_sig_script};

use crate::collection::*;
use crate::{Res, hex};

/// Sompi kept in the game-wide covenant UTXOs (roots, minter, KCC20 branch) and in each player's
/// record, NFT and token UTXO. Covenant outputs weigh 4 storage units each (KIP-9 storage mass),
/// so smaller values push the claim transaction over the standard mass limit.
pub const GLOBAL_VALUE: u64 = 500_000_000;
pub const PLAYER_VALUE: u64 = 200_000_000;
/// Compute budget of each input (units of 10,000 script units). Measured needs:
/// covenant inputs ≤ 10 (`compute_budgets` test), a P2PK signature 10.
pub const COVENANT_BUDGET: u16 = 20;
pub const WALLET_BUDGET: u16 = 10;

/// A transaction with the UTXO entries it spends.
pub struct Built {
    pub tx: Transaction,
    pub entries: Vec<UtxoEntry>,
}

impl Built {
    fn new(inputs: Vec<TransactionInput>, outputs: Vec<TransactionOutput>, entries: Vec<UtxoEntry>) -> Self {
        Built { tx: Transaction::new(1, inputs, outputs, 0, SUBNETWORK_ID_NATIVE, 0, vec![]), entries }
    }

    fn sighash(&self, i: usize) -> Message {
        let tx = MutableTransaction::with_entries(self.tx.clone(), self.entries.clone());
        let hash = calc_schnorr_signature_hash(&tx.as_verifiable(), i, SIG_HASH_ALL, &SigHashReusedValuesUnsync::new());
        Message::from_digest_slice(hash.as_bytes().as_slice()).unwrap()
    }

    /// Schnorr signature of input `i` with SIGHASH_ALL, as a 65-byte `sig` value.
    fn sig(&self, i: usize, k: &Keypair) -> Vec<u8> {
        let mut sig = k.sign_schnorr(self.sighash(i)).as_ref().to_vec();
        sig.push(SIG_HASH_ALL.to_u8());
        sig
    }

    fn sign_p2pk(&mut self, i: usize, k: &Keypair) {
        let sig = self.sig(i, k);
        self.tx.inputs[i].signature_script = ScriptBuilder::new().add_data(&sig).unwrap().drain();
    }

    fn out(&self, i: u32) -> TransactionOutpoint {
        TransactionOutpoint::new(self.tx.id(), i)
    }

    fn utxo(&self, i: u32) -> UtxoEntry {
        let o = &self.tx.outputs[i as usize];
        UtxoEntry::new(o.value, o.script_public_key.clone(), 0, false, o.covenant.map(|c| c.covenant_id))
    }

    /// Runs every input through the script engine, like a node would.
    pub fn verify(&self) -> Res<()> {
        let populated = PopulatedTransaction::new(&self.tx, self.entries.clone());
        let cov = CovenantsContext::from_tx(&populated).map_err(|e| format!("{e:?}"))?;
        let cache = Cache::new(100);
        let reused = SigHashReusedValuesUnsync::new();
        for i in 0..self.tx.inputs.len() {
            let mut vm = TxScriptEngine::from_transaction_input(
                &populated,
                &self.tx.inputs[i],
                i,
                populated.utxo(i).unwrap(),
                EngineCtx::new(&cache).with_reused(&reused).with_covenants_ctx(&cov),
                EngineFlags { covenants_enabled: true, ..Default::default() },
            );
            vm.execute().map_err(|e| format!("input {i}: {e:?}"))?;
        }
        Ok(())
    }

    /// Fee: 100 sompi per gram of the largest mass, the rate the Kaspa SDK charges.
    fn fee(&self, params: &Params) -> Res<u64> {
        let calc = MassCalculator::new_with_consensus_params(params);
        let nc = calc.calc_non_contextual_masses(&self.tx);
        let c = calc.calc_contextual_masses(&PopulatedTransaction::new(&self.tx, self.entries.clone())).ok_or("mass overflow")?;
        let mass = nc.compute_mass.max(nc.transient_mass).max(c.storage_mass);
        if mass > 100_000 {
            return Err(format!("transaction mass {mass} over the standard limit"));
        }
        Ok(100 * mass.max(1))
    }

    /// Safe JSON (bigints as strings), as rusty-kaspa's `Transaction.deserializeFromSafeJSON` reads it.
    pub fn safe_json(&self) -> Value {
        let spk = |s: &ScriptPublicKey| format!("{:04x}{}", s.version(), hex(s.script()));
        json!({
            "id": self.tx.id().to_string(),
            "version": self.tx.version,
            "inputs": self.tx.inputs.iter().zip(&self.entries).map(|(i, e)| json!({
                "transactionId": i.previous_outpoint.transaction_id.to_string(),
                "index": i.previous_outpoint.index,
                "sequence": i.sequence.to_string(),
                "sigOpCount": 0,
                "computeBudget": i.compute_commit.compute_budget().unwrap_or(0),
                "signatureScript": hex(&i.signature_script),
                "utxo": {
                    "amount": e.amount.to_string(),
                    "scriptPublicKey": spk(&e.script_public_key),
                    "blockDaaScore": e.block_daa_score.to_string(),
                    "isCoinbase": e.is_coinbase,
                    "covenantId": e.covenant_id.map(|c| c.to_string()),
                },
            })).collect::<Vec<_>>(),
            "outputs": self.tx.outputs.iter().map(|o| json!({
                "value": o.value.to_string(),
                "scriptPublicKey": spk(&o.script_public_key),
                "covenant": o.covenant.map(|c| json!({ "authorizingInput": c.authorizing_input, "covenantId": c.covenant_id.to_string() })),
            })).collect::<Vec<_>>(),
            "subnetworkId": self.tx.subnetwork_id.to_string(),
            "lockTime": self.tx.lock_time.to_string(),
            "gas": "0",
            "storageMass": "0",
            "payload": hex(&self.tx.payload),
        })
    }
}

fn wallet_input(outpoint: TransactionOutpoint) -> TransactionInput {
    TransactionInput::new_with_compute_budget(outpoint, vec![], 0, WALLET_BUDGET)
}

fn covenant_input(outpoint: TransactionOutpoint) -> TransactionInput {
    TransactionInput::new_with_compute_budget(outpoint, vec![], 0, COVENANT_BUDGET)
}

/// A new covenant output at genesis: its ID derives from `genesis` and this output alone.
fn genesis_output(artifact: &SilAbiArtifact, genesis: TransactionOutpoint) -> (TransactionOutput, Hash) {
    let plain = TransactionOutput::new(GLOBAL_VALUE, pay_to_script_hash_script(&bytecode(artifact)));
    let id = covenant_id(genesis, std::iter::once((0, &plain)));
    (TransactionOutput { covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: id }), ..plain }, id)
}

/// Push of the 4-byte selector an entry's sigscript ends with (before the redeem script).
fn selector(encoded: Vec<u8>) -> String {
    hex(&encoded[encoded.len() - 4..])
}

fn entry_selector(artifact: &SilAbiArtifact, entry: &str, args: &[ArtifactValue]) -> Res<String> {
    let name = artifact.contracts.keys().next().expect("one contract");
    Ok(selector(encode_contract_entry_sig_script(artifact, name, entry, args).map_err(|e| e.to_string())?))
}

fn decl_selector(artifact: &SilAbiArtifact, function: &str, args: &[ArtifactValue]) -> Res<String> {
    let name = artifact.contracts.keys().next().expect("one contract");
    Ok(selector(encode_contract_covenant_decl_sig_script(artifact, name, function, true, args).map_err(|e| e.to_string())?))
}

fn template_json(artifact: &SilAbiArtifact) -> Value {
    let (prefix, suffix, _) = template(artifact);
    json!({ "prefix": hex(&prefix), "suffix": hex(&suffix) })
}

pub struct Deployment {
    pub config: Value,
    pub txs: Vec<Built>,
}

/// Builds and verifies the genesis transactions from one funding UTXO of `deployer`.
pub fn deploy(
    network: &str,
    prefix: Prefix,
    params: &Params,
    deployer: &Keypair,
    funding: (TransactionOutpoint, UtxoEntry),
    treasury_owner: [u8; 32],
    oracle: [u8; 32],
) -> Res<Deployment> {
    let me = deployer.x_only_public_key().0.serialize();
    let change_spk = pay_to_address_script(&Address::new(prefix, Version::PubKey, &me));
    let collection = Collection { treasury_hash: treasury_hash(treasury_owner)?, mint_price: MINT_PRICE, max_supply: MAX_NFTS, daa_per_day: DAA_PER_DAY };

    // Each genesis spends the previous transaction's change; the fee comes out of the change.
    let with_fee = |mut b: Built, change: usize, sign: &[usize], deployer: &Keypair| -> Res<Built> {
        for &i in sign {
            b.sign_p2pk(i, deployer);
        }
        let fee = b.fee(params)?;
        b.tx.outputs[change].value = b.tx.outputs[change].value.checked_sub(fee).ok_or("deploy address has too little KAS")?;
        b.tx.finalize();
        for &i in sign {
            b.sign_p2pk(i, deployer);
        }
        Ok(b)
    };
    let change = |input_total: u64, used: u64| -> Res<TransactionOutput> {
        Ok(TransactionOutput::new(input_total.checked_sub(used).ok_or("deploy address has too little KAS")?, change_spk.clone()))
    };

    // 1. NFT collection root: next id 1.
    let root_nft = Nft { token_id: 1, owner: me, mode: ROOT, price: 0 };
    let nft_artifact = collection.compile(root_nft)?;
    let (root_out, nft_covid) = genesis_output(&nft_artifact, funding.0);
    let tx1 = Built::new(vec![wallet_input(funding.0)], vec![root_out, change(funding.1.amount, GLOBAL_VALUE)?], vec![funding.1.clone()]);
    let tx1 = with_fee(tx1, 1, &[0], deployer)?;

    // 2. Rewards ledger root.
    let rewards = Rewards::new(oracle, collection, nft_covid)?;
    let root_record = Record { root: true, owner: [0; 32], points: 0, last_claim_daa: 0 };
    let rewards_artifact = rewards.compile(root_record)?;
    let (rewards_out, rewards_covid) = genesis_output(&rewards_artifact, tx1.out(1));
    let tx2 = Built::new(vec![wallet_input(tx1.out(1))], vec![rewards_out, change(tx1.tx.outputs[1].value, GLOBAL_VALUE)?], vec![tx1.utxo(1)]);
    let tx2 = with_fee(tx2, 1, &[0], deployer)?;

    // 3. DailyMinter before init (its own covenant), then 4. init + KCC20 genesis.
    let config = MinterConfig { admin: me, rewards_covid, rewards: rewards.clone() };
    let placeholder = Hash::from_bytes([0; 32]);
    let pre_init = config.compile(placeholder, MAX_TOKEN_SUPPLY, false)?;
    let (pre_out, minter_covid) = genesis_output(&pre_init, tx2.out(1));
    let tx3 = Built::new(vec![wallet_input(tx2.out(1))], vec![pre_out, change(tx2.tx.outputs[1].value, GLOBAL_VALUE)?], vec![tx2.utxo(1)]);
    let tx3 = with_fee(tx3, 1, &[0], deployer)?;

    let branch = kcc20(minter_covid.as_bytes().to_vec(), 0, IDENTIFIER_COVENANT_ID, true)?;
    let (branch_out, kcc20_covid) = genesis_output(&branch, tx3.out(0));
    let initialized = config.compile(kcc20_covid, MAX_TOKEN_SUPPLY, true)?;
    let mut tx4 = Built::new(
        vec![covenant_input(tx3.out(0)), wallet_input(tx3.out(1))],
        vec![
            branch_out,
            covenant_output(&initialized, GLOBAL_VALUE, 0, minter_covid),
            change(tx3.tx.outputs[1].value, GLOBAL_VALUE)?,
        ],
        vec![tx3.utxo(0), tx3.utxo(1)],
    );
    let init_script = |b: &Built| -> Res<Vec<u8>> {
        decl_sigscript(&pre_init, "init", &[minter_state(kcc20_covid, MAX_TOKEN_SUPPLY, true), b.sig(0, deployer).into()], true)
    };
    let fee = { tx4.tx.inputs[0].signature_script = init_script(&tx4)?; tx4.sign_p2pk(1, deployer); tx4.fee(params)? };
    tx4.tx.outputs[2].value = tx4.tx.outputs[2].value.checked_sub(fee).ok_or("deploy address has too little KAS")?;
    tx4.tx.finalize();
    tx4.tx.inputs[0].signature_script = init_script(&tx4)?;
    tx4.sign_p2pk(1, deployer);

    let txs = vec![tx1, tx2, tx3, tx4];
    for (i, t) in txs.iter().enumerate() {
        t.verify().map_err(|e| format!("genesis transaction {}: {e}", i + 1))?;
    }

    // Selectors, taken from real encodings with dummy arguments.
    let zero32 = || ArtifactValue::from(vec![0u8; 32]);
    let int = |v: i64| ArtifactValue::from(v);
    let nft_entries = json!({
        "mint": entry_selector(&nft_artifact, "mint", &[zero32(), int(0)])?,
        "transfer": entry_selector(&nft_artifact, "transfer", &[int(0), zero32()])?,
        "lock": entry_selector(&nft_artifact, "lock", &[int(0)])?,
        "stakeUse": entry_selector(&nft_artifact, "stakeUse", &[int(0)])?,
        "unlock": entry_selector(&nft_artifact, "unlock", &[int(0)])?,
        "list": entry_selector(&nft_artifact, "list", &[int(0), int(1)])?,
        "cancel": entry_selector(&nft_artifact, "cancel", &[int(0)])?,
        "buy": entry_selector(&nft_artifact, "buy", &[zero32(), int(0), int(0)])?,
    });
    let rewards_entries = json!({
        "open": entry_selector(&rewards_artifact, "open", &[zero32(), int(0), int(202610)])?,
        "play": entry_selector(&rewards_artifact, "play", &[int(0), int(0), int(202610)])?,
        "checkIn": entry_selector(&rewards_artifact, "checkIn", &[int(0), int(0)])?,
        "claim": entry_selector(&rewards_artifact, "claim", &[int(0), int(0), int(-1)])?,
    });
    let minter_claim = decl_selector(
        &initialized,
        "claim",
        &[minter_state(kcc20_covid, 0, true), int(0), int(0), kcc20_state(vec![0; 32], IDENTIFIER_COVENANT_ID, 0, true)],
    )?;
    let states = ArtifactValue::Array(vec![kcc20_state(vec![0; 32], IDENTIFIER_COVENANT_ID, 0, true), kcc20_state(vec![0; 32], IDENTIFIER_PUBKEY, 0, false)]);
    let kcc20_transfer = decl_selector(&branch, "transfer", &[states, vec![0u8; 65].into(), ArtifactValue::Byte(0)])?;
    let treasury_spk = pay_to_script_hash_script(&bytecode(&treasury(treasury_owner)?));

    let config = json!({
        "network": network,
        "addressPrefix": prefix.to_string(),
        "daaPerDay": DAA_PER_DAY,
        "entryPrice": ENTRY_PRICE,
        "mintPrice": MINT_PRICE,
        "maxSupply": MAX_NFTS,
        "covValue": PLAYER_VALUE,
        "globalValue": GLOBAL_VALUE,
        "tokensPerPoint": TOKENS_PER_POINT,
        "tokenUnit": TOKEN_UNIT,
        "maxTokenSupply": MAX_TOKEN_SUPPLY,
        "covenantBudget": COVENANT_BUDGET,
        "walletBudget": WALLET_BUDGET,
        "rootOwner": hex(&me),
        "treasurySpk": hex(treasury_spk.script()),
        "nft": { "covid": nft_covid.to_string(), "template": template_json(&nft_artifact), "entries": nft_entries },
        "rewards": {
            "covid": rewards_covid.to_string(),
            "template": template_json(&rewards_artifact),
            "entries": rewards_entries,
            "root": { "txid": txs[1].tx.id().to_string(), "index": 0 },
        },
        "minter": {
            "covid": minter_covid.to_string(),
            "template": template_json(&initialized),
            "claim": minter_claim,
            "genesis": { "txid": txs[3].tx.id().to_string(), "index": 1 },
        },
        "kcc20": {
            "covid": kcc20_covid.to_string(),
            "template": template_json(&branch),
            "transfer": kcc20_transfer,
            "genesis": { "txid": txs[3].tx.id().to_string(), "index": 0 },
        },
    });
    Ok(Deployment { config, txs })
}


/// Inputs per treasury withdrawal transaction: keeps each one well under the standard mass.
const TREASURY_INPUTS: usize = 30;

/// Spends the Treasury's UTXOs (`utxos`: outpoint + amount) to `to`, signed by the Treasury
/// owner key; one transaction per chunk of inputs, the fee taken from its output.
pub fn treasury_withdraw(params: &Params, owner: &Keypair, utxos: &[(TransactionOutpoint, u64)], to: ScriptPublicKey) -> Res<Vec<Built>> {
    let artifact = treasury(owner.x_only_public_key().0.serialize())?;
    let spk = pay_to_script_hash_script(&bytecode(&artifact));
    utxos
        .chunks(TREASURY_INPUTS)
        .map(|chunk| {
            let total: u64 = chunk.iter().map(|u| u.1).sum();
            let mut b = Built::new(
                chunk.iter().map(|u| covenant_input(u.0)).collect(),
                vec![TransactionOutput::new(total, to.clone())],
                chunk.iter().map(|u| UtxoEntry::new(u.1, spk.clone(), 0, false, None)).collect(),
            );
            let sign = |b: &mut Built| -> Res<()> {
                for i in 0..b.tx.inputs.len() {
                    b.tx.inputs[i].signature_script = entry_sigscript(&artifact, "withdraw", &[b.sig(i, owner).into()])?;
                }
                Ok(())
            };
            sign(&mut b)?;
            let fee = b.fee(params)?;
            b.tx.outputs[0].value = total.checked_sub(fee).ok_or("treasury too small to pay the fee")?;
            b.tx.finalize();
            sign(&mut b)?;
            b.verify()?;
            Ok(b)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn treasury_withdrawal_verifies_only_with_the_owner_key() {
        let owner = Keypair::new_global(&mut secp256k1::rand::thread_rng());
        let to = pay_to_address_script(&Address::new(Prefix::Testnet, Version::PubKey, &[7; 32]));
        let utxos: Vec<_> = (0..35u8).map(|i| (TransactionOutpoint::new(Hash::from_bytes([i; 32]), 0), 50 * SOMPI_PER_KAS as u64)).collect();
        let txs = treasury_withdraw(&kaspa_consensus_core::config::params::TESTNET_PARAMS, &owner, &utxos, to).unwrap();
        assert_eq!(txs.len(), 2, "35 inputs in chunks of 30");
        assert!(txs[0].tx.outputs[0].value < 30 * 50 * SOMPI_PER_KAS as u64, "fee paid from the output");

        let thief = Keypair::new_global(&mut secp256k1::rand::thread_rng());
        let mut stolen = Built::new(txs[1].tx.inputs.clone(), txs[1].tx.outputs.clone(), txs[1].entries.clone());
        let artifact = treasury(owner.x_only_public_key().0.serialize()).unwrap();
        for i in 0..stolen.tx.inputs.len() {
            stolen.tx.inputs[i].signature_script = entry_sigscript(&artifact, "withdraw", &[stolen.sig(i, &thief).into()]).unwrap();
        }
        assert!(stolen.verify().is_err(), "another key cannot withdraw");
    }
}
