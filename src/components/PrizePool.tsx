/** Monthly prize pool card, shared by every page that shows it. */
export default function PrizePool({ pool, className = "" }: { pool: number; className?: string }) {
  return (
    <div className={`rounded-xl border border-kas/30 bg-kas/5 p-4 ${className}`}>
      <p className="text-xs uppercase tracking-widest text-white/50">Prize Pool</p>
      <p className="font-arcade mt-2 text-2xl text-kas">{pool} KAS</p>
    </div>
  );
}
