import { FIRST_PLACE_NFT } from "../lib/prices";
import NftThumb from "./NftThumb";

/** The month's 1st place bonus NFT, shown large in the prize pool panel with a link to its KaspaCom page. */
export default function FirstPlaceNft({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-yellow-300/30 bg-[radial-gradient(ellipse_at_top,rgba(253,224,71,0.12),transparent_70%)] p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="whitespace-nowrap text-xs uppercase tracking-widest text-yellow-300">1st Place Bonus</p>
        <span className="font-arcade whitespace-nowrap rounded-full border border-emerald-300/60 bg-emerald-300/15 px-2.5 py-1 text-[10px] text-emerald-300 shadow-[0_0_12px] shadow-emerald-300/30">
          {/* Fixed "KAS", not the testnet ticker: the NFT is a real mainnet asset. */}
          💰 ~{FIRST_PLACE_NFT.approxValue.toLocaleString("en-US")} KAS
        </span>
      </div>
      <NftThumb className="mt-3 aspect-square w-full" />
      <p className="mt-3 font-semibold">{FIRST_PLACE_NFT.name}</p>
      <a
        href={FIRST_PLACE_NFT.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 block rounded-lg border border-yellow-300/40 py-2 text-center text-sm text-yellow-300 hover:bg-yellow-300/10"
      >
        View on KaspaCom
      </a>
    </div>
  );
}
