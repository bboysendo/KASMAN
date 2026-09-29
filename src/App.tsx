import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router";
import kasmanPng from "./assets/kasman.png";
import Home from "./pages/Home";
import Inventory from "./pages/Inventory";
import Marketplace from "./pages/Marketplace";
import Staking from "./pages/Staking";
import WalletButton from "./components/WalletButton";
import { disconnectWallet, getAccount } from "./lib/leaderboard";
import { onWalletChange } from "./lib/wallet";
import { useStore } from "./store";

// PixiJS is heavy; only load it on the Play page.
const Play = lazy(() => import("./pages/Play"));
// ponytail: placeholder until the real account URL is known.
const TWITTER_URL = "https://x.com/";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/play", label: "Play" },
  { to: "/inventory", label: "Inventory" },
  { to: "/marketplace", label: "Marketplace" },
  { to: "/staking", label: "Staking" },
];

export default function App() {
  // Tickets, lives and skins live on the server; refresh the local copy once per visit.
  useEffect(() => {
    const { syncAccount } = useStore.getState();
    void getAccount().then(syncAccount, () => {});
    // Switching or locking the KasWare account signs the player out.
    onWalletChange(() => {
      if (useStore.getState().address) void disconnectWallet().then(syncAccount, () => {});
    });
  }, []);

  return (
    <BrowserRouter>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-40 short:static border-b border-white/10 bg-night/80 backdrop-blur">
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
                    className={({ isActive }) => `rounded px-1 py-1 sm:px-2 ${isActive ? "text-kas" : "text-white/70 hover:text-white"}`}
                  >
                    {n.label}
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
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/staking" element={<Staking />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </main>
        <footer className="flex justify-center border-t border-white/10 py-6">
          <a
            href={TWITTER_URL}
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
