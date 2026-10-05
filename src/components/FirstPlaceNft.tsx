import { FIRST_PLACE_NFT } from "../lib/prices";
import NftThumb from "./NftThumb";

/** The month's 1st place bonus NFT, shown large in the prize pool panel with a link to its KaspaCom page. */
export default function FirstPlaceNft({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-yellow-300/30 bg-[radial-gradient(ellipse_at_top,rgba(253,224,71,0.12),transparent_70%)] p-4 ${className}`}>
      <p className="text-xs uppercase tracking-widest text-yellow-300">1st Place Bonus</p>
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
