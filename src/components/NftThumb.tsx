import { useState } from "react";
import { FIRST_PLACE_NFT } from "../lib/prices";

const NFT_IMAGE_URL = "/assets/nft/neuralkey151.jpg";

/**
 * Preview thumbnail of the monthly bonus NFT (`FIRST_PLACE_NFT` in `src/lib/prices.ts`).
 * Falls back to a plain gradient box if the image doesn't load.
 */
export default function NftThumb({ className = "" }: { className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className={`shrink-0 rounded-lg border border-yellow-300/30 bg-linear-to-br from-yellow-300/30 via-black to-purple-900/40 ${className}`} />;
  }
  return (
    <img
      src={NFT_IMAGE_URL}
      alt={FIRST_PLACE_NFT.name}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-lg border border-yellow-300/30 object-cover ${className}`}
    />
  );
}
