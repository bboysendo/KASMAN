import { Suspense, lazy, useEffect, useRef } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router";
import kasmanPng from "./assets/kasman.png";
import Home from "./pages/Home";
import Inventory from "./pages/Inventory";
import LeaderboardPage from "./pages/LeaderboardPage";
import Pvp from "./pages/Pvp";
import Quests from "./pages/Quests";
import Shop from "./pages/Shop";
import Staking from "./pages/Staking";
import Tokenomics from "./pages/Tokenomics";
import WalletButton from "./components/WalletButton";
import { disconnectWallet, getAccount } from "./lib/leaderboard";
import { KASMAN_X_URL } from "./lib/prices";
import { onWalletChange } from "./lib/wallet";
import { useStore } from "./store";

// PixiJS is heavy; only load it on the Play page.
const Play = lazy(() => import("./pages/Play"));

const NAV: { to: string; label: string; badge?: string }[] = [
  { to: "/", label: "Home" },
  { to: "/play", label: "Play" },
  { to: "/pvp", label: "PVP", badge: "SOON" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/inventory", label: "Inventory" },
  { to: "/shop", label: "Shop" },
  { to: "/quests", label: "Quests" },
  { to: "/staking", label: "Staking" },
  { to: "/tokenomics", label: "Tokenomics" },
];

export default function App() {
  // Tickets, lives and skins live on the server; refresh the local copy once per visit.
  useEffect(() => {
    const { syncAccount } = useStore.getState();
    void getAccount().then(syncAccount, () => {});
    // Switching or locking the KasWare account signs the player out, except mid-run (the score submit
    // and the potions need the session; payments already refuse a switched account in wallet.ts) and
    // when the same account comes back (KasWare reconnecting): then just refresh in the background.
    onWalletChange((accounts) => {
      const { address, runActive } = useStore.getState();
      if (!address) return;
      if (runActive || accounts?.[0] === address) void getAccount().then(syncAccount, () => {});
      else void disconnectWallet().then(syncAccount, () => {});
    });
  }, []);

  // Exposed as --header-h so the Play game view can size itself to exactly what's left below the
  // header instead of guessing its height.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const sync = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <BrowserRouter>
      <div className="flex min-h-dvh flex-col">
        <header ref={headerRef} className="sticky top-0 z-40 short:static border-b border-white/10 bg-night/80 backdrop-blur">
          <nav className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:gap-6">
            <NavLink to="/" className="font-arcade flex shrink-0 items-center gap-2 text-base leading-none text-yellow-300">
              <img src={kasmanPng} alt="" className="size-8 object-contain" />
              <span className="hidden translate-y-0.5 sm:inline">KASMAN</span>
            </NavLink>
            <ul className="ml-auto flex text-xs sm:gap-4 sm:text-sm">
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end
                    className={({ isActive }) => `relative rounded px-1 py-1 sm:px-2 ${isActive ? "text-kas" : "text-white/70 hover:text-white"}`}
                  >
                    {n.label}
                    {n.badge && (
                      <span className="neon-pulse font-arcade pointer-events-none absolute -right-1 -top-2 rounded-sm border border-red-400/70 bg-night px-1 text-[6px] leading-[1.4] text-red-300 shadow-[0_0_6px] shadow-red-500/70">
                        {n.badge}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
            <WalletButton />
          </nav>
        </header>
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/play" element={<Suspense fallback={<p className="p-8 text-center text-white/50">Loading…</p>}><Play /></Suspense>} />
            <Route path="/pvp" element={<Pvp />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/quests" element={<Quests />} />
            <Route path="/staking" element={<Staking />} />
            <Route path="/tokenomics" element={<Tokenomics />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </main>
        <footer className="flex justify-center border-t border-white/10 py-6">
          <a
            href={KASMAN_X_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Kasman on X (Twitter)"
            className="text-white/40 transition-colors hover:text-kas"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </footer>
      </div>
    </BrowserRouter>
  );
}
