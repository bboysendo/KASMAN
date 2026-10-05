import { Link } from "react-router";
import { KASMAN_X_URL } from "../lib/prices";

const FEATURES = [
  { icon: "⚔️", title: "1v1 Real-Time Matches", desc: "Face other players head to head, live, on the same maze.", glow: "hover:shadow-red-500/40 hover:border-red-400/60" },
  { icon: "💰", title: "KAS Wager Pools", desc: "Put KAS on the line and win the pot. Prize pools paid out in KAS.", glow: "hover:shadow-yellow-300/40 hover:border-yellow-300/60" },
  { icon: "🏆", title: "Ranked Leaderboard", desc: "A seasonal ranking for the best players, reset every season.", glow: "hover:shadow-kas/50 hover:border-kas/70" },
];

/** Teaser for the future multiplayer mode. Nothing here talks to the server or the wallet. */
export default function Pvp() {
  return (
    <div className="relative mx-auto max-w-5xl overflow-hidden px-4 py-12 sm:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(112,199,186,0.18),transparent_60%),linear-gradient(rgba(112,199,186,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(112,199,186,0.05)_1px,transparent_1px)] bg-[size:auto,32px_32px,32px_32px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_85%)]"
      />

      <div className="text-center">
        <span className="neon-pulse font-arcade inline-block rounded-full border border-red-400/70 bg-red-500/10 px-3 py-1 text-[10px] text-red-300 shadow-[0_0_14px] shadow-red-500/60">
          SOON
        </span>
        <h1 className="neon-pulse font-arcade mt-6 text-2xl leading-relaxed text-yellow-300 [text-shadow:0_0_8px_rgba(253,224,71,0.8),0_0_28px_rgba(253,224,71,0.45)] sm:text-4xl">
          KASMAN PVP ARENA
        </h1>
        <p className="font-arcade mt-5 text-sm tracking-widest text-kas [text-shadow:0_0_10px_rgba(112,199,186,0.8)] sm:text-base">
          COMING SOON
        </p>
      </div>

      <ul className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
        {FEATURES.map((f) => (
          <li
            key={f.title}
            className={`flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center shadow-[0_0_28px_-8px] shadow-transparent transition ${f.glow}`}
          >
            <span aria-hidden className="text-4xl">{f.icon}</span>
            <h2 className="font-arcade text-xs leading-relaxed text-white">{f.title}</h2>
            <p className="text-sm text-white/60">{f.desc}</p>
          </li>
        ))}
      </ul>

      <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          to="/shop"
          className="font-arcade rounded-lg bg-kas px-6 py-4 text-center text-xs text-black shadow-[0_0_24px] shadow-kas/60 hover:brightness-110"
        >
          PREPARE YOUR POTIONS
        </Link>
        <a
          href={KASMAN_X_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-arcade rounded-lg border border-kas/50 px-6 py-4 text-center text-xs text-kas hover:bg-kas/10"
        >
          STAY TUNED
        </a>
      </div>
    </div>
  );
}
