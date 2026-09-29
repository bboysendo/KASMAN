// Broadcasts signed transactions (Safe JSON, as `kasman-pool deploy` writes them) in order,
// through a public Kaspa node found by the SDK's resolver. Kaspa's REST API cannot submit
// covenant transactions, so this goes over wRPC.
//
//   node scripts/broadcast.mjs <txs.json> testnet-10|mainnet
//
// Safe to run again after an interruption: transactions the network already has are skipped.
import { readFileSync } from "node:fs";
import * as kaspa from "../vendor/kaspa/kaspa.js";

const [file, network] = process.argv.slice(2);
if (!file || !network) throw new Error("usage: node scripts/broadcast.mjs <txs.json> <testnet-10|mainnet>");
kaspa.initSync({ module: readFileSync(new URL("../vendor/kaspa/kaspa_bg.wasm", import.meta.url)) });

const rpc = new kaspa.RpcClient({ resolver: new kaspa.Resolver(), networkId: network });
await rpc.connect();
console.log(`node ${rpc.url}`);
try {
  for (const json of JSON.parse(readFileSync(file, "utf8"))) {
    const tx = kaspa.Transaction.deserializeFromSafeJSON(JSON.stringify(json));
    let transactionId = tx.id;
    try {
      ({ transactionId } = await rpc.submitTransaction({ transaction: tx, allowOrphan: false }));
      console.log(`sent ${transactionId}`);
    } catch (e) {
      // Running the same file again after an interruption: skip what the network already has.
      if (!/already|spent|exist/i.test(String(e))) throw e;
      console.log(`already on the network, skipped: ${transactionId} (${e})`);
      continue;
    }
    // The next transaction spends this one's change: wait until the node knows it.
    for (let i = 0; i < 60; i++) {
      const { entries } = await rpc.getUtxosByAddresses(tx.addresses(network).map(String));
      if (entries.some((e) => e.outpoint.transactionId === transactionId)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
} finally {
  await rpc.disconnect();
}
