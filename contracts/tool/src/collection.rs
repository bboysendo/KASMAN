//! KASMAN token (KCC20.sil), Kasman NFT collection (KasmanNFT.sil), the on-chain rewards
//! ledger (KasmanRewards.sil), its minter (DailyMinter.sil) and the mint/royalty treasury (Treasury.sil): compilation, state
//! encoding and sigscripts. The tests run whole transaction flows through the script engine.

use std::collections::BTreeMap;

use kaspa_consensus_core::Hash;
use kaspa_consensus_core::tx::{CovenantBinding, TransactionOutput};
use kaspa_txscript::script_builder::ScriptBuilder;
use kaspa_txscript::{EngineFlags, pay_to_script_hash_script};
use silverscript_abi::{ArtifactValue, SilAbiArtifact, encode_contract_covenant_decl_sig_script, encode_contract_entry_sig_script};
use silverscript_lang::compiler::{CompileOptions, compile_to_sil_abi_artifact_with_options};

const KCC20_SOURCE: &str = include_str!("../../KCC20.sil");
const NFT_SOURCE: &str = include_str!("../../KasmanNFT.sil");
const MINTER_SOURCE: &str = include_str!("../../DailyMinter.sil");
const TREASURY_SOURCE: &str = include_str!("../../Treasury.sil");
const REWARDS_SOURCE: &str = include_str!("../../KasmanRewards.sil");
const POOL_SOURCE: &str = include_str!("../../KasmanPool.sil");

pub const SOMPI_PER_KAS: i64 = 100_000_000;
/// KASMAN has 7 decimals: 100 billion tokens = 10^18 base units, inside Kaspa's int64 range.
pub const TOKEN_UNIT: i64 = 10_000_000;
pub const MAX_TOKEN_SUPPLY: i64 = 100_000_000_000 * TOKEN_UNIT;
/// Daily reward at 1.0x (src/lib/prices.ts DAILY_REWARD). A record's points are tenths of it.
pub const TOKENS_PER_DAY: i64 = 1_000 * TOKEN_UNIT;
pub const TOKENS_PER_POINT: i64 = TOKENS_PER_DAY / 10;
/// Entry fee (src/lib/prices.ts ENTRY_FEE_KAS).
pub const ENTRY_PRICE: i64 = 10 * SOMPI_PER_KAS;
/// 10 blocks per second.
pub const DAA_PER_DAY: i64 = 864_000;
pub const MINT_PRICE: i64 = 50 * SOMPI_PER_KAS;
pub const MAX_NFTS: i64 = 3_000;
/// Token covenant fan-in/fan-out bounds baked into KCC20.
pub const KCC20_MAX_INS: i64 = 2;
pub const KCC20_MAX_OUTS: i64 = 2;

pub const ROOT: i64 = 0;
pub const FREE: i64 = 1;
pub const LOCKED: i64 = 2;
pub const LISTED: i64 = 3;

pub const IDENTIFIER_PUBKEY: u8 = 0x00;
pub const IDENTIFIER_COVENANT_ID: u8 = 0x02;

type Res<T> = Result<T, String>;

fn compile(source: &str, args: Vec<ArtifactValue>) -> Res<SilAbiArtifact> {
    compile_to_sil_abi_artifact_with_options(source, &args, CompileOptions::default()).map_err(|e| e.to_string())
}

fn contract(artifact: &SilAbiArtifact) -> &silverscript_abi::SilContractArtifact {
    artifact.contracts.values().next().expect("one contract")
}

pub fn bytecode(artifact: &SilAbiArtifact) -> Vec<u8> {
    contract(artifact).compiled.bytecode.clone()
}

/// (prefix, suffix, template hash): what another contract needs to recognise this template.
pub fn template(artifact: &SilAbiArtifact) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let compiled = &contract(artifact).compiled;
    let (start, len) = (compiled.state_span.offset, compiled.state_span.len);
    (compiled.bytecode[..start].to_vec(), compiled.bytecode[start + len..].to_vec(), compiled.template_hash.to_vec())
}

fn push_redeem(artifact: &SilAbiArtifact) -> Vec<u8> {
    ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, ..Default::default() })
        .add_data(&bytecode(artifact))
        .expect("push redeem script")
        .drain()
}

/// Sigscript for a handwritten `entry`.
pub fn entry_sigscript(artifact: &SilAbiArtifact, entry: &str, args: &[ArtifactValue]) -> Res<Vec<u8>> {
    let name = artifact.contracts.keys().next().expect("one contract");
    let mut script = encode_contract_entry_sig_script(artifact, name, entry, args).map_err(|e| e.to_string())?;
    script.extend(push_redeem(artifact));
    Ok(script)
}

/// Sigscript for a `#[covenant...]` declaration.
pub fn decl_sigscript(artifact: &SilAbiArtifact, function: &str, args: &[ArtifactValue], leader: bool) -> Res<Vec<u8>> {
    let name = artifact.contracts.keys().next().expect("one contract");
    let mut script = encode_contract_covenant_decl_sig_script(artifact, name, function, leader, args).map_err(|e| e.to_string())?;
    script.extend(push_redeem(artifact));
    Ok(script)
}

pub fn covenant_output(artifact: &SilAbiArtifact, value: u64, authorizing_input: u16, covenant_id: Hash) -> TransactionOutput {
    TransactionOutput {
        value,
        script_public_key: pay_to_script_hash_script(&bytecode(artifact)),
        covenant: Some(CovenantBinding { authorizing_input, covenant_id }),
    }
}

pub fn object(fields: Vec<(&str, ArtifactValue)>) -> ArtifactValue {
    fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect::<BTreeMap<_, _>>().into()
}

pub fn treasury(owner: [u8; 32]) -> Res<SilAbiArtifact> {
    compile(TREASURY_SOURCE, vec![owner.to_vec().into()])
}

pub fn treasury_hash(owner: [u8; 32]) -> Res<[u8; 32]> {
    let redeem = bytecode(&treasury(owner)?);
    Ok(*blake2b_simd::Params::new().hash_length(32).to_state().update(&redeem).finalize().as_bytes().first_chunk().unwrap())
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Nft {
    pub token_id: i64,
    pub owner: [u8; 32],
    pub mode: i64,
    pub price: i64,
}

/// Collection-wide constants of KasmanNFT.
#[derive(Clone, Copy)]
pub struct Collection {
    pub treasury_hash: [u8; 32],
    pub mint_price: i64,
    pub max_supply: i64,
    pub daa_per_day: i64,
}

impl Collection {
    pub fn compile(&self, nft: Nft) -> Res<SilAbiArtifact> {
        compile(
            NFT_SOURCE,
            vec![
                self.treasury_hash.to_vec().into(),
                self.mint_price.into(),
                self.max_supply.into(),
                self.daa_per_day.into(),
                nft.token_id.into(),
                nft.owner.to_vec().into(),
                nft.mode.into(),
                nft.price.into(),
            ],
        )
    }
}

pub fn kcc20(owner: Vec<u8>, amount: i64, identifier_type: u8, is_minter: bool) -> Res<SilAbiArtifact> {
    compile(
        KCC20_SOURCE,
        vec![
            owner.into(),
            amount.into(),
            ArtifactValue::Byte(identifier_type),
            ArtifactValue::Bool(is_minter),
            KCC20_MAX_INS.into(),
            KCC20_MAX_OUTS.into(),
        ],
    )
}

pub fn kcc20_state(owner: Vec<u8>, identifier_type: u8, amount: i64, is_minter: bool) -> ArtifactValue {
    object(vec![
        ("ownerIdentifier", owner.into()),
        ("identifierType", ArtifactValue::Byte(identifier_type)),
        ("amount", amount.into()),
        ("isMinter", ArtifactValue::Bool(is_minter)),
    ])
}

fn pool(oracle: [u8; 32], month: i64) -> Res<SilAbiArtifact> {
    compile(POOL_SOURCE, vec![oracle.to_vec().into(), month.into()])
}

/// KasmanPool redeem script of `month` (YYYYMM).
pub fn pool_script(oracle: [u8; 32], month: i64) -> Res<Vec<u8>> {
    Ok(bytecode(&pool(oracle, month)?))
}

/// KasmanPool's redeem script around its `month` push: prefix (ending with the 3-byte push
/// opcode) and suffix. KasmanRewards rebuilds pool addresses from them.
pub fn pool_template(oracle: [u8; 32]) -> Res<(Vec<u8>, Vec<u8>)> {
    let (a, b) = (pool_script(oracle, 202610)?, pool_script(oracle, 202611)?);
    let at = a.iter().zip(&b).position(|(x, y)| x != y).ok_or("pool scripts do not differ by month")?;
    if at == 0 || a[at - 1] != 3 || a[at..at + 3] != [0x72, 0x17, 0x03] {
        return Err("unexpected month encoding in KasmanPool".into());
    }
    Ok((a[..at].to_vec(), a[at + 3..].to_vec()))
}

/// One KasmanRewards UTXO: the root, or a player's record.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Record {
    pub root: bool,
    pub owner: [u8; 32],
    pub points: i64,
    pub last_claim_daa: i64,
}

/// Game-wide constants of KasmanRewards.
#[derive(Clone)]
pub struct Rewards {
    pub pool_prefix: Vec<u8>,
    pub pool_suffix: Vec<u8>,
    pub entry_price: i64,
    pub nft_covid: Hash,
    pub collection: Collection,
}

impl Rewards {
    pub fn new(oracle: [u8; 32], collection: Collection, nft_covid: Hash) -> Res<Self> {
        let (pool_prefix, pool_suffix) = pool_template(oracle)?;
        Ok(Rewards { pool_prefix, pool_suffix, entry_price: ENTRY_PRICE, nft_covid, collection })
    }

    pub fn compile(&self, r: Record) -> Res<SilAbiArtifact> {
        let probe = Nft { token_id: 0, owner: [0; 32], mode: 0, price: 0 };
        let (np, ns, nh) = template(&self.collection.compile(probe)?);
        compile(
            REWARDS_SOURCE,
            vec![
                self.pool_prefix.clone().into(),
                self.pool_suffix.clone().into(),
                self.entry_price.into(),
                self.collection.daa_per_day.into(),
                self.nft_covid.as_bytes().to_vec().into(),
                (np.len() as i64).into(),
                (ns.len() as i64).into(),
                nh.into(),
                ArtifactValue::Bool(r.root),
                r.owner.to_vec().into(),
                r.points.into(),
                r.last_claim_daa.into(),
            ],
        )
    }
}

/// Everything DailyMinter needs to recognise the token and the reward records.
pub struct MinterConfig {
    pub admin: [u8; 32],
    pub rewards_covid: Hash,
    pub rewards: Rewards,
}

impl MinterConfig {
    pub fn compile(&self, kcc20_covid: Hash, remaining: i64, initialized: bool) -> Res<SilAbiArtifact> {
        let (kp, ks, kh) = template(&kcc20(vec![0; 32], 0, IDENTIFIER_COVENANT_ID, true)?);
        let (rp, rs, rh) = template(&self.rewards.compile(Record { root: false, owner: [0; 32], points: 0, last_claim_daa: 0 })?);
        compile(
            MINTER_SOURCE,
            vec![
                self.admin.to_vec().into(),
                kcc20_covid.as_bytes().to_vec().into(),
                remaining.into(),
                ArtifactValue::Bool(initialized),
                (kp.len() as i64).into(),
                (ks.len() as i64).into(),
                kh.into(),
                self.rewards_covid.as_bytes().to_vec().into(),
                (rp.len() as i64).into(),
                (rs.len() as i64).into(),
                rh.into(),
                TOKENS_PER_POINT.into(),
            ],
        )
    }
}

pub fn minter_state(kcc20_covid: Hash, remaining: i64, initialized: bool) -> ArtifactValue {
    object(vec![
        ("kcc20Covid", kcc20_covid.as_bytes().to_vec().into()),
        ("amount", remaining.into()),
        ("initialized", ArtifactValue::Bool(initialized)),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use kaspa_consensus_core::hashing::covenant_id::covenant_id;
    use kaspa_consensus_core::hashing::sighash::{SigHashReusedValuesUnsync, calc_schnorr_signature_hash};
    use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
    use kaspa_consensus_core::tx::{VerifiableTransaction,
        MutableTransaction, PopulatedTransaction, ScriptPublicKey, Transaction, TransactionId, TransactionInput, TransactionOutpoint,
        UtxoEntry,
    };
    use kaspa_txscript::caches::Cache;
    use kaspa_txscript::covenants::CovenantsContext;
    use kaspa_txscript::opcodes::codes::OpTrue;
    use kaspa_txscript::{EngineCtx, TxScriptEngine, pay_to_address_script};
    use secp256k1::Keypair;

    fn key() -> Keypair {
        Keypair::new_global(&mut secp256k1::rand::thread_rng())
    }
    fn xonly(k: &Keypair) -> [u8; 32] {
        k.x_only_public_key().0.serialize()
    }
    fn p2pk(k: &Keypair) -> ScriptPublicKey {
        pay_to_address_script(&kaspa_addresses::Address::new(kaspa_addresses::Prefix::Testnet, kaspa_addresses::Version::PubKey, &xonly(k)))
    }
    fn anyone() -> ScriptPublicKey {
        ScriptPublicKey::new(0, vec![OpTrue].into())
    }
    fn outpoint(n: u8) -> TransactionOutpoint {
        TransactionOutpoint::new(TransactionId::from_bytes([n; 32]), 0)
    }
    fn input(outpoint: TransactionOutpoint, sequence: u64) -> TransactionInput {
        TransactionInput::new_with_compute_budget(outpoint, vec![], sequence, 0)
    }
    fn utxo(output: &TransactionOutput) -> UtxoEntry {
        UtxoEntry::new(output.value, output.script_public_key.clone(), 0, false, output.covenant.map(|c| c.covenant_id))
    }
    fn plain_utxo(value: u64) -> UtxoEntry {
        UtxoEntry::new(value, anyone(), 0, false, None)
    }
    /// A UTXO of `k`'s wallet (P2PK).
    fn wallet_utxo(k: &Keypair, value: u64) -> UtxoEntry {
        UtxoEntry::new(value, p2pk(k), 0, false, None)
    }

    /// A rejection by the contract's rules, not a malformed test transaction.
    fn by_script(e: &str) -> bool {
        ["VerifyError", "EvalFalse", "LockTime"].iter().any(|k| e.contains(k))
    }

    struct Tx {
        tx: Transaction,
        entries: Vec<UtxoEntry>,
    }

    impl Tx {
        fn new(inputs: Vec<TransactionInput>, outputs: Vec<TransactionOutput>, entries: Vec<UtxoEntry>) -> Self {
            Tx { tx: Transaction::new(1, inputs, outputs, 0, Default::default(), 0, vec![]), entries }
        }
        /// Schnorr signature of input `i` (SIGHASH_ALL), as a `sig` argument.
        fn sign(&self, i: usize, k: &Keypair) -> ArtifactValue {
            let tx = MutableTransaction::with_entries(self.tx.clone(), self.entries.clone());
            let hash = calc_schnorr_signature_hash(&tx.as_verifiable(), i, SIG_HASH_ALL, &SigHashReusedValuesUnsync::new());
            let mut sig = k.sign_schnorr(secp256k1::Message::from_digest_slice(hash.as_bytes().as_slice()).unwrap()).as_ref().to_vec();
            sig.push(SIG_HASH_ALL.to_u8());
            sig.into()
        }
        /// Signs wallet input `i` (P2PK of `k`) the way KasWare's signPskt does: SIGHASH_ALL.
        fn sign_wallet(&mut self, i: usize, k: &Keypair) {
            let ArtifactValue::Bytes(sig) = self.sign(i, k) else { unreachable!() };
            let script = ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, ..Default::default() }).add_data(&sig).unwrap().drain();
            self.set_script(i, script);
        }
        fn with_lock_time(mut self, lock_time: u64) -> Self {
            self.tx = Transaction::new(1, self.tx.inputs, self.tx.outputs, lock_time, Default::default(), 0, vec![]);
            self
        }
        fn set_script(&mut self, i: usize, script: Vec<u8>) {
            self.tx.inputs[i].signature_script = script;
        }
        /// Script units input `i` uses, with mainnet's sigop cost (1,000 grams).
        fn units(&self, i: usize) -> u64 {
            let populated = PopulatedTransaction::new(&self.tx, self.entries.clone());
            let cov = CovenantsContext::from_tx(&populated).unwrap();
            let cache = Cache::new(100);
            let reused = SigHashReusedValuesUnsync::new();
            let mut vm = TxScriptEngine::from_transaction_input(
                &populated,
                &self.tx.inputs[i],
                i,
                populated.utxo(i).unwrap(),
                EngineCtx::new(&cache).with_reused(&reused).with_covenants_ctx(&cov),
                EngineFlags { covenants_enabled: true, sigop_script_units: kaspa_consensus_core::mass::Gram(1000).into() },
            );
            vm.execute().unwrap();
            vm.used_script_units().0
        }
        fn run(&self, i: usize) -> Result<(), String> {
            let populated = PopulatedTransaction::new(&self.tx, self.entries.clone());
            let cov = CovenantsContext::from_tx(&populated).map_err(|e| format!("{e:?}"))?;
            let cache = Cache::new(100);
            let reused = SigHashReusedValuesUnsync::new();
            let mut vm = TxScriptEngine::from_transaction_input(
                &populated,
                &self.tx.inputs[i],
                i,
                populated.utxo(i).unwrap(),
                EngineCtx::new(&cache).with_reused(&reused).with_covenants_ctx(&cov),
                EngineFlags { covenants_enabled: true, sigop_script_units: 0.into() },
            );
            vm.execute().map_err(|e| format!("{e:?}"))
        }
        fn run_all(&self) -> Result<(), String> {
            (0..self.tx.inputs.len()).try_for_each(|i| self.run(i).map_err(|e| format!("input {i}: {e}")))
        }
        fn out(&self, i: u32) -> TransactionOutpoint {
            TransactionOutpoint::new(self.tx.id(), i)
        }
    }

    struct World {
        admin: Keypair,
        alice: Keypair,
        bob: Keypair,
        collection: Collection,
        nft_covid: Hash,
        root: Nft,
        root_tx: Tx,
    }

    fn nft(token_id: i64, owner: [u8; 32], mode: i64, price: i64) -> Nft {
        Nft { token_id, owner, mode, price }
    }

    /// Genesis of the collection: a funding UTXO becomes the ROOT with next id 1.
    fn world(max_supply: i64) -> World {
        let (admin, alice, bob) = (key(), key(), key());
        let collection = Collection { treasury_hash: treasury_hash(xonly(&admin)).unwrap(), mint_price: MINT_PRICE, max_supply, daa_per_day: DAA_PER_DAY };
        let root = nft(1, xonly(&admin), ROOT, 0);
        let root_output = TransactionOutput {
            value: 1_000,
            script_public_key: pay_to_script_hash_script(&bytecode(&collection.compile(root).unwrap())),
            covenant: None,
        };
        let nft_covid = covenant_id(outpoint(1), std::iter::once((0, &root_output)));
        let root_tx = Tx::new(
            vec![input(outpoint(1), 0)],
            vec![TransactionOutput { covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: nft_covid }), ..root_output }],
            vec![plain_utxo(2_000)],
        );
        World { admin, alice, bob, collection, nft_covid, root, root_tx }
    }

    /// Mint `buyer`'s NFT from the root at output 0 of `prev`, paying `paid` sompi to the treasury.
    fn mint_tx(w: &World, prev: &Tx, root: Nft, buyer: [u8; 32], paid: u64) -> Tx {
        let c = &w.collection;
        let next_root = nft(root.token_id + 1, root.owner, ROOT, 0);
        let minted = nft(root.token_id, buyer, FREE, 0);
        let treasury_spk = pay_to_script_hash_script(&bytecode(&treasury(xonly(&w.admin)).unwrap()));
        let mut tx = Tx::new(
            vec![input(prev.out(0), 0), input(outpoint(9), 0)],
            vec![
                covenant_output(&c.compile(next_root).unwrap(), 1_000, 0, w.nft_covid),
                covenant_output(&c.compile(minted).unwrap(), 1_000, 0, w.nft_covid),
                TransactionOutput::new(paid, treasury_spk),
            ],
            vec![utxo(&prev.tx.outputs[0]), plain_utxo(paid + 10_000)],
        );
        let script = entry_sigscript(&c.compile(root).unwrap(), "mint", &[buyer.to_vec().into(), 2i64.into()]).unwrap();
        tx.set_script(0, script);
        tx
    }

    /// Moves the NFT at output `index` of `prev` to `next`, through `entry`, with a wallet input of `signer`.
    fn nft_tx(w: &World, prev: &Tx, index: u32, before: Nft, next: Nft, entry: &str, extra: Vec<ArtifactValue>, signer: &Keypair, sequence: u64) -> Tx {
        let c = &w.collection;
        let mut tx = Tx::new(
            vec![input(prev.out(index), sequence), input(outpoint(8), 0)],
            vec![covenant_output(&c.compile(next).unwrap(), 1_000, 0, w.nft_covid)],
            vec![utxo(&prev.tx.outputs[index as usize]), wallet_utxo(signer, 10_000)],
        );
        let mut args = vec![1i64.into()];
        args.extend(extra);
        tx.set_script(0, entry_sigscript(&c.compile(before).unwrap(), entry, &args).unwrap());
        tx.sign_wallet(1, signer);
        tx
    }

    #[test]
    fn mint_needs_the_full_price_and_stops_at_max_supply() {
        let w = world(2);
        w.root_tx.run_all().unwrap();
        let alice = xonly(&w.alice);

        mint_tx(&w, &w.root_tx, w.root, alice, MINT_PRICE as u64).run_all().expect("paid mint");
        assert!(mint_tx(&w, &w.root_tx, w.root, alice, MINT_PRICE as u64 - 1).run(0).is_err_and(|e| by_script(&e)), "underpaid mint");

        let mut extra = mint_tx(&w, &w.root_tx, w.root, alice, MINT_PRICE as u64);
        let copy = extra.tx.outputs[1].clone();
        extra.tx.outputs.push(copy);
        assert!(extra.run(0).is_err_and(|e| by_script(&e)), "a second NFT out of one mint");

        let mut stolen = mint_tx(&w, &w.root_tx, w.root, alice, MINT_PRICE as u64);
        stolen.tx.outputs[2].script_public_key = p2pk(&w.bob);
        assert!(stolen.run(0).is_err_and(|e| by_script(&e)), "price paid to someone else");

        let last = nft(3, w.root.owner, ROOT, 0); // next id 3 > max supply 2
        let over_prev = Tx::new(vec![], vec![covenant_output(&w.collection.compile(last).unwrap(), 1_000, 0, w.nft_covid)], vec![]);
        assert!(mint_tx(&w, &over_prev, last, alice, MINT_PRICE as u64).run(0).is_err_and(|e| by_script(&e)), "mint past max supply");
    }

    #[test]
    fn only_the_owner_moves_an_nft_and_locked_nfts_cannot_be_moved() {
        let w = world(MAX_NFTS);
        let (alice, bob) = (xonly(&w.alice), xonly(&w.bob));
        let mint = mint_tx(&w, &w.root_tx, w.root, alice, MINT_PRICE as u64);
        let free = nft(1, alice, FREE, 0);

        let give = nft(1, bob, FREE, 0);
        nft_tx(&w, &mint, 1, free, give, "transfer", vec![bob.to_vec().into()], &w.alice, 0).run(0).expect("owner transfers");
        assert!(nft_tx(&w, &mint, 1, free, give, "transfer", vec![bob.to_vec().into()], &w.bob, 0).run(0).is_err_and(|e| by_script(&e)), "thief transfers");

        let locked = nft(1, alice, LOCKED, 0);
        let lock = nft_tx(&w, &mint, 1, free, locked, "lock", vec![], &w.alice, 0);
        lock.run(0).expect("owner locks");
        assert!(nft_tx(&w, &lock, 0, locked, nft(1, bob, FREE, 0), "transfer", vec![bob.to_vec().into()], &w.alice, 0).run(0).is_err_and(|e| by_script(&e)), "transfer while locked");
        assert!(nft_tx(&w, &lock, 0, locked, nft(1, alice, LISTED, 5), "list", vec![5i64.into()], &w.alice, 0).run(0).is_err_and(|e| by_script(&e)), "list while locked");
        nft_tx(&w, &lock, 0, locked, free, "unlock", vec![], &w.alice, 0).run(0).expect("owner unlocks");

    }

    #[test]
    fn resale_pays_seller_95_percent_and_treasury_5_percent() {
        let w = world(MAX_NFTS);
        let (alice, bob) = (xonly(&w.alice), xonly(&w.bob));
        let mint = mint_tx(&w, &w.root_tx, w.root, alice, MINT_PRICE as u64);
        let price = 1_000 * SOMPI_PER_KAS;
        let listed = nft(1, alice, LISTED, price);
        let list = nft_tx(&w, &mint, 1, nft(1, alice, FREE, 0), listed, "list", vec![price.into()], &w.alice, 0);
        list.run(0).expect("owner lists");

        let treasury_spk = pay_to_script_hash_script(&bytecode(&treasury(xonly(&w.admin)).unwrap()));
        let buy = |seller_paid: i64, royalty_paid: i64| {
            let mut tx = Tx::new(
                vec![input(list.out(0), 0), input(outpoint(7), 0)],
                vec![
                    covenant_output(&w.collection.compile(nft(1, bob, FREE, 0)).unwrap(), 1_000, 0, w.nft_covid),
                    TransactionOutput::new(seller_paid as u64, p2pk(&w.alice)),
                    TransactionOutput::new(royalty_paid as u64, treasury_spk.clone()),
                ],
                vec![utxo(&list.tx.outputs[0]), plain_utxo(2 * price as u64)],
            );
            let args = [bob.to_vec().into(), 1i64.into(), 2i64.into()];
            tx.set_script(0, entry_sigscript(&w.collection.compile(listed).unwrap(), "buy", &args).unwrap());
            tx
        };
        buy(price * 95 / 100, price * 5 / 100).run(0).expect("full price");
        assert!(buy(price * 95 / 100 - 1, price * 5 / 100).run(0).is_err_and(|e| by_script(&e)), "seller underpaid");
        assert!(buy(price * 95 / 100, price * 5 / 100 - 1).run(0).is_err_and(|e| by_script(&e)), "royalty underpaid");
        nft_tx(&w, &list, 0, listed, nft(1, alice, FREE, 0), "cancel", vec![], &w.alice, 0).run(0).expect("owner cancels");
        assert!(nft_tx(&w, &list, 0, listed, nft(1, bob, FREE, 0), "cancel", vec![], &w.bob, 0).run(0).is_err_and(|e| by_script(&e)), "someone else cancels");
    }

    #[test]
    fn two_purchases_cannot_share_one_payment() {
        let w = world(MAX_NFTS);
        let (alice, bob) = (xonly(&w.alice), xonly(&w.bob));
        let first = mint_tx(&w, &w.root_tx, w.root, alice, MINT_PRICE as u64);
        let second = mint_tx(&w, &first, nft(2, w.root.owner, ROOT, 0), alice, MINT_PRICE as u64);
        let price = 1_000 * SOMPI_PER_KAS;
        let list = |prev: &Tx, id: i64| nft_tx(&w, prev, 1, nft(id, alice, FREE, 0), nft(id, alice, LISTED, price), "list", vec![price.into()], &w.alice, 0);
        let (l1, l2) = (list(&first, 1), list(&second, 2));
        let treasury_spk = pay_to_script_hash_script(&bytecode(&treasury(xonly(&w.admin)).unwrap()));
        let mut tx = Tx::new(
            vec![input(l1.out(0), 0), input(l2.out(0), 0), input(outpoint(7), 0)],
            vec![
                covenant_output(&w.collection.compile(nft(1, bob, FREE, 0)).unwrap(), 1_000, 0, w.nft_covid),
                covenant_output(&w.collection.compile(nft(2, bob, FREE, 0)).unwrap(), 1_000, 1, w.nft_covid),
                TransactionOutput::new((price * 95 / 100) as u64, p2pk(&w.alice)),
                TransactionOutput::new((price * 5 / 100) as u64, treasury_spk),
            ],
            vec![utxo(&l1.tx.outputs[0]), utxo(&l2.tx.outputs[0]), plain_utxo(2 * price as u64)],
        );
        let args = [bob.to_vec().into(), 2i64.into(), 3i64.into()];
        tx.set_script(0, entry_sigscript(&w.collection.compile(nft(1, alice, LISTED, price)).unwrap(), "buy", &args).unwrap());
        tx.set_script(1, entry_sigscript(&w.collection.compile(nft(2, alice, LISTED, price)).unwrap(), "buy", &args).unwrap());
        assert!(tx.run(0).is_err_and(|e| by_script(&e)), "second NFT rides on the first payment");
    }

    #[test]
    fn treasury_pays_out_only_to_its_owner_signature() {
        let admin = key();
        let t = treasury(xonly(&admin)).unwrap();
        let output = TransactionOutput::new(MINT_PRICE as u64, pay_to_script_hash_script(&bytecode(&t)));
        let withdraw = |signer: &Keypair| {
            let mut tx = Tx::new(vec![input(outpoint(3), 0)], vec![TransactionOutput::new(1_000, anyone())], vec![utxo(&output)]);
            let sig = tx.sign(0, signer);
            tx.set_script(0, entry_sigscript(&t, "withdraw", &[sig]).unwrap());
            tx
        };
        withdraw(&admin).run(0).expect("owner withdraws");
        assert!(withdraw(&key()).run(0).is_err_and(|e| by_script(&e)), "other key withdraws");
    }

    /// The rewards ledger (root genesis) on top of the NFT world, paying to `oracle`'s pools.
    struct Ledger {
        oracle: [u8; 32],
        rewards: Rewards,
        covid: Hash,
        root: Record,
        root_tx: Tx,
    }

    const MONTH: i64 = 202610;
    const DAY: u64 = DAA_PER_DAY as u64;

    fn ledger(w: &World) -> Ledger {
        let oracle = xonly(&key());
        let rewards = Rewards::new(oracle, w.collection, w.nft_covid).unwrap();
        let root = Record { root: true, owner: [0; 32], points: 0, last_claim_daa: 0 };
        let output = TransactionOutput { value: 1_000, script_public_key: pay_to_script_hash_script(&bytecode(&rewards.compile(root).unwrap())), covenant: None };
        let covid = covenant_id(outpoint(4), std::iter::once((0, &output)));
        let root_tx = Tx::new(
            vec![input(outpoint(4), 0)],
            vec![TransactionOutput { covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: covid }), ..output }],
            vec![plain_utxo(2_000)],
        );
        Ledger { oracle, rewards, covid, root, root_tx }
    }

    fn record(owner: [u8; 32], points: i64, last_claim_daa: i64) -> Record {
        Record { root: false, owner, points, last_claim_daa }
    }

    fn pool_output(l: &Ledger, month: i64, paid: i64) -> TransactionOutput {
        TransactionOutput::new(paid as u64, pay_to_script_hash_script(&pool_script(l.oracle, month).unwrap()))
    }

    /// A UTXO of `covid` holding `rec`, as if earlier transactions had made it.
    fn existing(l: &Ledger, rec: Record, covid: Hash) -> Tx {
        Tx::new(vec![], vec![covenant_output(&l.rewards.compile(rec).unwrap(), 1_000, 0, covid)], vec![])
    }

    /// A staked NFT `token_id` of `owner`, as if minted and locked earlier.
    fn staked(w: &World, token_id: i64, owner: [u8; 32], covid: Hash) -> (Tx, Nft) {
        let n = nft(token_id, owner, LOCKED, 0);
        (Tx::new(vec![], vec![covenant_output(&w.collection.compile(n).unwrap(), 1_000, 0, covid)], vec![]), n)
    }

    fn open_tx(l: &Ledger, owner: [u8; 32], pool: TransactionOutput) -> Tx {
        let mut tx = Tx::new(
            vec![input(l.root_tx.out(0), 0), input(outpoint(9), 0)],
            vec![
                covenant_output(&l.rewards.compile(l.root).unwrap(), 1_000, 0, l.covid),
                covenant_output(&l.rewards.compile(record(owner, 10, 0)).unwrap(), 1_000, 0, l.covid),
                pool,
            ],
            vec![utxo(&l.root_tx.tx.outputs[0]), plain_utxo(ENTRY_PRICE as u64 + 10_000)],
        );
        tx.set_script(0, entry_sigscript(&l.rewards.compile(l.root).unwrap(), "open", &[owner.to_vec().into(), 2i64.into(), MONTH.into()]).unwrap());
        tx
    }

    fn play_tx(l: &Ledger, prev: &Tx, rec: Record, month: i64, paid: i64, age: u64, signer: &Keypair) -> Tx {
        let pool = pool_output(l, month, paid);
        let next = record(rec.owner, rec.points + 10, rec.last_claim_daa);
        let mut tx = Tx::new(
            vec![input(prev.out(0), age), input(outpoint(8), 0)],
            vec![covenant_output(&l.rewards.compile(next).unwrap(), 1_000, 0, prev.tx.outputs[0].covenant.unwrap().covenant_id), pool],
            vec![utxo(&prev.tx.outputs[0]), wallet_utxo(signer, ENTRY_PRICE as u64 + 10_000)],
        );
        tx.set_script(0, entry_sigscript(&l.rewards.compile(rec).unwrap(), "play", &[1i64.into(), 1i64.into(), month.into()]).unwrap());
        tx.sign_wallet(1, signer);
        tx
    }

    /// Check-in of `rec` (age `age`) with the staked NFT of `nft_prev` (age `nft_age`), adding `added` points.
    #[allow(clippy::too_many_arguments)]
    fn checkin_tx(w: &World, l: &Ledger, prev: &Tx, rec: Record, nft_prev: &Tx, n: Nft, added: i64, age: u64, nft_age: u64, signer: &Keypair) -> Tx {
        let next = record(rec.owner, rec.points + added, rec.last_claim_daa);
        let nft_covid = nft_prev.tx.outputs[0].covenant.unwrap().covenant_id;
        let mut tx = Tx::new(
            vec![input(prev.out(0), age), input(nft_prev.out(0), nft_age), input(outpoint(8), 0)],
            vec![
                covenant_output(&l.rewards.compile(next).unwrap(), 1_000, 0, l.covid),
                covenant_output(&w.collection.compile(n).unwrap(), 1_000, 1, nft_covid),
            ],
            vec![utxo(&prev.tx.outputs[0]), utxo(&nft_prev.tx.outputs[0]), wallet_utxo(signer, 10_000)],
        );
        tx.set_script(0, entry_sigscript(&l.rewards.compile(rec).unwrap(), "checkIn", &[2i64.into(), 1i64.into()]).unwrap());
        tx.set_script(1, entry_sigscript(&w.collection.compile(n).unwrap(), "stakeUse", &[2i64.into()]).unwrap());
        tx.sign_wallet(2, signer);
        tx
    }

    /// Token genesis (DailyMinter C, KCC20 A).
    struct Token {
        config: MinterConfig,
        minter_covid: Hash,
        kcc20_covid: Hash,
        /// Output 0: KCC20 minter branch, output 1: DailyMinter.
        genesis: Tx,
    }

    fn token(admin: &Keypair, l: &Ledger, supply: i64) -> Token {
        let config = MinterConfig { admin: xonly(admin), rewards_covid: l.covid, rewards: l.rewards.clone() };
        let placeholder = Hash::from_bytes([0; 32]);
        let pre_init = config.compile(placeholder, supply, false).unwrap();
        let pre_output = TransactionOutput { value: 1_000, script_public_key: pay_to_script_hash_script(&bytecode(&pre_init)), covenant: None };
        let minter_covid = covenant_id(outpoint(2), std::iter::once((0, &pre_output)));
        let minter_genesis = Tx::new(
            vec![input(outpoint(2), 0)],
            vec![TransactionOutput { covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: minter_covid }), ..pre_output }],
            vec![plain_utxo(2_000)],
        );
        minter_genesis.run_all().unwrap();

        let branch = kcc20(minter_covid.as_bytes().to_vec(), 0, IDENTIFIER_COVENANT_ID, true).unwrap();
        let asset_outpoint = minter_genesis.out(0);
        let kcc20_covid = covenant_id(asset_outpoint, std::iter::once((0, &covenant_output(&branch, 1_000, 0, placeholder))));
        let initialized = config.compile(kcc20_covid, supply, true).unwrap();
        let mut genesis = Tx::new(
            vec![input(asset_outpoint, 0)],
            vec![covenant_output(&branch, 1_000, 0, kcc20_covid), covenant_output(&initialized, 1_000, 0, minter_covid)],
            vec![utxo(&minter_genesis.tx.outputs[0])],
        );
        let sig = genesis.sign(0, admin);
        genesis.set_script(0, decl_sigscript(&pre_init, "init", &[minter_state(kcc20_covid, supply, true), sig], true).unwrap());
        genesis.run_all().expect("token genesis");
        Token { config, minter_covid, kcc20_covid, genesis }
    }

    /// Claim of `rec` (UTXO 0 of `prev`) at DAA `now`, optionally with a staked NFT, minting
    /// `minted` (the minter's accounting) while the tokens output carries `out` for `recipient`.
    #[allow(clippy::too_many_arguments)]
    fn claim_tx(w: &World, l: &Ledger, t: &Token, remaining: i64, prev: &Tx, rec: Record, now: i64, staked_nft: Option<(&Tx, Nft)>, minted: i64, out: i64, recipient: [u8; 32], signer: &Keypair) -> Tx {
        let branch = kcc20(t.minter_covid.as_bytes().to_vec(), 0, IDENTIFIER_COVENANT_ID, true).unwrap();
        let minter = t.config.compile(t.kcc20_covid, remaining, true).unwrap();
        let next_minter = t.config.compile(t.kcc20_covid, remaining - minted, true).unwrap();
        let record_covid = prev.tx.outputs[0].covenant.unwrap().covenant_id;
        let mut inputs = vec![input(t.genesis.out(0), 0), input(t.genesis.out(1), 0), input(prev.out(0), 0)];
        let mut outputs = vec![
            covenant_output(&branch, 1_000, 0, t.kcc20_covid),
            covenant_output(&kcc20(recipient.to_vec(), out, IDENTIFIER_PUBKEY, false).unwrap(), 1_000, 0, t.kcc20_covid),
            covenant_output(&next_minter, 1_000, 1, t.minter_covid),
            covenant_output(&l.rewards.compile(record(rec.owner, 0, now)).unwrap(), 1_000, 2, record_covid),
        ];
        let mut entries = vec![utxo(&t.genesis.tx.outputs[0]), utxo(&t.genesis.tx.outputs[1]), utxo(&prev.tx.outputs[0])];
        if let Some((nft_prev, n)) = staked_nft {
            inputs.push(input(nft_prev.out(0), DAY));
            outputs.push(covenant_output(&w.collection.compile(n).unwrap(), 1_000, 3, nft_prev.tx.outputs[0].covenant.unwrap().covenant_id));
            entries.push(utxo(&nft_prev.tx.outputs[0]));
        }
        let wallet = inputs.len();
        inputs.push(input(outpoint(6), 0));
        entries.push(wallet_utxo(signer, 10_000));
        let mut tx = Tx::new(inputs, outputs, entries).with_lock_time(now as u64);

        let states = ArtifactValue::Array(vec![
            kcc20_state(t.minter_covid.as_bytes().to_vec(), IDENTIFIER_COVENANT_ID, 0, true),
            kcc20_state(recipient.to_vec(), IDENTIFIER_PUBKEY, out, false),
        ]);
        tx.set_script(0, decl_sigscript(&branch, "transfer", &[states, vec![0u8; 65].into(), ArtifactValue::Byte(0)], true).unwrap());
        let minter_args = [
            minter_state(t.kcc20_covid, remaining - minted, true),
            2i64.into(),
            now.into(),
            kcc20_state(t.minter_covid.as_bytes().to_vec(), IDENTIFIER_COVENANT_ID, 0, true),
        ];
        tx.set_script(1, decl_sigscript(&minter, "claim", &minter_args, true).unwrap());
        let nft_idx: i64 = if staked_nft.is_some() { 3 } else { -1 };
        let wallet_arg: ArtifactValue = (wallet as i64).into();
        tx.set_script(2, entry_sigscript(&l.rewards.compile(rec).unwrap(), "claim", &[wallet_arg.clone(), now.into(), nft_idx.into()]).unwrap());
        if let Some((_, n)) = staked_nft {
            tx.set_script(3, entry_sigscript(&w.collection.compile(n).unwrap(), "stakeUse", &[wallet_arg]).unwrap());
        }
        tx.sign_wallet(wallet, signer);
        tx
    }

    #[test]
    fn paying_an_entry_opens_a_record_and_counts_one_day_per_24h() {
        let w = world(MAX_NFTS);
        let l = ledger(&w);
        l.root_tx.run_all().unwrap();
        let alice = xonly(&w.alice);
        let bad = |tx: Tx, why: &str| assert!(tx.run(0).is_err_and(|e| by_script(&e)), "{why}");

        open_tx(&l, alice, pool_output(&l, MONTH, ENTRY_PRICE)).run_all().expect("first entry opens a record with day 1");
        bad(open_tx(&l, alice, pool_output(&l, MONTH, ENTRY_PRICE - 1)), "entry underpaid");
        bad(open_tx(&l, alice, TransactionOutput::new(ENTRY_PRICE as u64, p2pk(&w.alice))), "entry paid to a wallet, not a pool");
        let mut forged = open_tx(&l, alice, pool_output(&l, MONTH, ENTRY_PRICE));
        forged.tx.outputs[1] = covenant_output(&l.rewards.compile(record(alice, 1_000, 0)).unwrap(), 1_000, 0, l.covid);
        bad(forged, "record opened with extra points");

        let rec = record(alice, 10, 0);
        let prev = existing(&l, rec, l.covid);
        play_tx(&l, &prev, rec, MONTH, ENTRY_PRICE, DAY, &w.alice).run(0).expect("next day's entry counts");
        play_tx(&l, &prev, rec, 202611, ENTRY_PRICE, DAY, &w.alice).run(0).expect("any month's pool");
        bad(play_tx(&l, &prev, rec, MONTH, ENTRY_PRICE, DAY - 1, &w.alice), "second day within 24 h");
        bad(play_tx(&l, &prev, rec, MONTH, ENTRY_PRICE - 1, DAY, &w.alice), "entry underpaid");
        bad(play_tx(&l, &prev, rec, MONTH, ENTRY_PRICE, DAY, &w.bob), "someone else's record");
        let mut elsewhere = play_tx(&l, &prev, rec, MONTH, ENTRY_PRICE, DAY, &w.alice);
        elsewhere.tx.outputs[1] = TransactionOutput::new(ENTRY_PRICE as u64, p2pk(&w.alice));
        elsewhere.sign_wallet(1, &w.alice);
        bad(elsewhere, "entry paid back to the player");
    }

    #[test]
    fn check_in_with_a_staked_nft_counts_the_day_at_its_multiplier() {
        let w = world(MAX_NFTS);
        let l = ledger(&w);
        let alice = xonly(&w.alice);
        let rec = record(alice, 10, 0);
        let prev = existing(&l, rec, l.covid);
        let bad = |tx: Tx, why: &str| assert!(tx.run_all().is_err_and(|e| by_script(&e)), "{why}");

        let (legendary_prev, legendary) = staked(&w, 2_900, alice, w.nft_covid);
        checkin_tx(&w, &l, &prev, rec, &legendary_prev, legendary, 20, DAY, DAY, &w.alice).run_all().expect("legendary day = 2.0x");
        let (common_prev, common) = staked(&w, 7, alice, w.nft_covid);
        checkin_tx(&w, &l, &prev, rec, &common_prev, common, 11, DAY, DAY, &w.alice).run_all().expect("common day = 1.1x");

        bad(checkin_tx(&w, &l, &prev, rec, &legendary_prev, legendary, 21, DAY, DAY, &w.alice), "more points than the rarity gives");
        bad(checkin_tx(&w, &l, &prev, rec, &legendary_prev, legendary, 20, DAY - 1, DAY, &w.alice), "record counted twice within 24 h");
        bad(checkin_tx(&w, &l, &prev, rec, &legendary_prev, legendary, 20, DAY, DAY - 1, &w.alice), "NFT used twice within 24 h");
        let (bobs_prev, bobs) = staked(&w, 2_900, xonly(&w.bob), w.nft_covid);
        bad(checkin_tx(&w, &l, &prev, rec, &bobs_prev, bobs, 20, DAY, DAY, &w.alice), "someone else's NFT");
        let free = nft(2_900, alice, FREE, 0);
        let free_prev = Tx::new(vec![], vec![covenant_output(&w.collection.compile(free).unwrap(), 1_000, 0, w.nft_covid)], vec![]);
        bad(checkin_tx(&w, &l, &prev, rec, &free_prev, free, 20, DAY, DAY, &w.alice), "NFT not staked");
        let (fake_prev, fake) = staked(&w, 2_900, alice, Hash::from_bytes([5; 32]));
        bad(checkin_tx(&w, &l, &prev, rec, &fake_prev, fake, 20, DAY, DAY, &w.alice), "look-alike NFT outside the collection");
    }

    #[test]
    fn claim_mints_the_points_after_the_rarity_wait() {
        let w = world(MAX_NFTS);
        let l = ledger(&w);
        let t = token(&key(), &l, MAX_TOKEN_SUPPLY);
        let alice = xonly(&w.alice);
        let rec = record(alice, 30, 0);
        let prev = existing(&l, rec, l.covid);
        let paid = 30 * TOKENS_PER_POINT; // 3 days at 1.0x = 3,000 KASMAN
        let week = 7 * DAA_PER_DAY;
        let claim = |now: i64, n: Option<(&Tx, Nft)>, minted: i64, to: [u8; 32], signer: &Keypair| {
            claim_tx(&w, &l, &t, MAX_TOKEN_SUPPLY, &prev, rec, now, n, minted, minted, to, signer)
        };
        let bad = |tx: Tx, why: &str| assert!(tx.run_all().is_err_and(|e| by_script(&e)), "{why}");

        claim(week, None, paid, alice, &w.alice).run_all().expect("claim after 7 days without an NFT");
        bad(claim(week - 1, None, paid, alice, &w.alice), "claim before 7 days");
        bad(claim(week, None, paid + 1, alice, &w.alice), "mint more than the points");
        bad(claim(week, None, paid, xonly(&w.bob), &w.alice), "tokens to someone else");
        bad(claim(week, None, paid, alice, &w.bob), "claim without the owner's wallet");

        // The stated DAA must not be later than the transaction's lock time.
        let mut early = claim(week, None, paid, alice, &w.alice).with_lock_time(week as u64 - 1);
        early.set_script(2, entry_sigscript(&l.rewards.compile(rec).unwrap(), "claim", &[3i64.into(), week.into(), (-1i64).into()]).unwrap());
        assert!(early.run(2).is_err_and(|e| by_script(&e)), "stated DAA after the lock time");

        let (legendary_prev, legendary) = staked(&w, 2_900, alice, w.nft_covid);
        claim(DAA_PER_DAY, Some((&legendary_prev, legendary)), paid, alice, &w.alice).run_all().expect("legendary claims every day");
        let (epic_prev, epic) = staked(&w, 2_500, alice, w.nft_covid);
        bad(claim(DAA_PER_DAY, Some((&epic_prev, epic)), paid, alice, &w.alice), "epic waits 2 days");

        let fake = existing(&l, rec, Hash::from_bytes([5; 32]));
        bad(claim_tx(&w, &l, &t, MAX_TOKEN_SUPPLY, &fake, rec, week, None, paid, paid, alice, &w.alice), "look-alike record outside the ledger");
    }

    #[test]
    fn issuance_stops_at_the_supply_cap() {
        let w = world(MAX_NFTS);
        let l = ledger(&w);
        let remaining = TOKENS_PER_POINT * 5;
        let t = token(&key(), &l, remaining);
        let alice = xonly(&w.alice);
        let rec = record(alice, 30, 0);
        let prev = existing(&l, rec, l.covid);
        let week = 7 * DAA_PER_DAY;
        claim_tx(&w, &l, &t, remaining, &prev, rec, week, None, remaining, remaining, alice, &w.alice).run_all().expect("last tokens");
        assert!(
            claim_tx(&w, &l, &t, remaining, &prev, rec, week, None, remaining + 1, remaining + 1, alice, &w.alice).run_all().is_err_and(|e| by_script(&e)),
            "past the cap"
        );
    }

    /// Compute budget (units of 10,000 script units, the first ~one free) each covenant input
    /// needs; the web uses these (+ margin) in `src/lib/onchain.ts`. Run with --nocapture.
    #[test]
    fn compute_budgets() {
        let w = world(MAX_NFTS);
        let l = ledger(&w);
        let t = token(&key(), &l, MAX_TOKEN_SUPPLY);
        let alice = xonly(&w.alice);
        let rec = record(alice, 30, 0);
        let prev = existing(&l, rec, l.covid);
        let (nft_prev, n) = staked(&w, 2_900, alice, w.nft_covid);
        let budget = |units: u64| units.div_ceil(10_000);
        let mint = mint_tx(&w, &w.root_tx, w.root, alice, MINT_PRICE as u64);
        let open = open_tx(&l, alice, pool_output(&l, MONTH, ENTRY_PRICE));
        let play = play_tx(&l, &prev, rec, MONTH, ENTRY_PRICE, DAY, &w.alice);
        let check = checkin_tx(&w, &l, &prev, rec, &nft_prev, n, 20, DAY, DAY, &w.alice);
        let lock = nft_tx(&w, &mint, 1, nft(1, alice, FREE, 0), nft(1, alice, LOCKED, 0), "lock", vec![], &w.alice, 0);
        let claim = claim_tx(&w, &l, &t, MAX_TOKEN_SUPPLY, &prev, rec, DAA_PER_DAY, Some((&nft_prev, n)), 30 * TOKENS_PER_POINT, 30 * TOKENS_PER_POINT, alice, &w.alice);
        for (name, tx, i) in [("mint", &mint, 0), ("open", &open, 0), ("play", &play, 0), ("play wallet", &play, 1), ("checkIn", &check, 0), ("stakeUse", &check, 1), ("lock", &lock, 0),
            ("kcc20 branch", &claim, 0), ("minter claim", &claim, 1), ("record claim", &claim, 2), ("nft in claim", &claim, 3)] {
            let u = tx.units(i);
            println!("budget {name}: {} ({u} units)", budget(u));
            assert!(budget(u) < 60_000, "{name} fits u16");
        }
    }
}
