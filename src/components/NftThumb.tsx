import { useState } from "react";

const NFT_IMAGE_URL = "/assets/nft/yonatoshi-1594.png";
/** Some image saves double up the extension; try that path too before giving up. */
const NFT_IMAGE_FALLBACK_URL = `${NFT_IMAGE_URL}.png`;

/**
 * Yonatoshi #1594's preview thumbnail (the monthly bonus NFT, `FIRST_PLACE_NFT` in
 * `src/lib/prices.ts`). Falls back to a plain gradient box if neither path loads.
 */
export default function NftThumb({ className = "" }: { className?: string }) {
  const [src, setSrc] = useState(NFT_IMAGE_URL);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className={`shrink-0 rounded-lg border border-yellow-300/30 bg-linear-to-br from-yellow-300/30 via-black to-purple-900/40 ${className}`} />;
  }
  return (
    <img
      src={src}
      alt="Yonatoshi #1594"
      onError={() => (src === NFT_IMAGE_URL ? setSrc(NFT_IMAGE_FALLBACK_URL) : setFailed(true))}
      className={`shrink-0 rounded-lg border border-yellow-300/30 object-cover ${className}`}
    />
  );
}
