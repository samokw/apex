"use client";

import { useState, useEffect } from "react";
import { Navbar } from "@/components/navbar";
import { useSession } from "next-auth/react";

interface WalletInfo {
  address: string | null;
  balance: number;
}

export default function PaymentPage() {
  const { data: session } = useSession();
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBalance();
  }, []);

  const fetchBalance = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get-balance" }),
      });
      const data = await res.json();
      setWallet({ address: data.address, balance: data.balance });
    } catch {
      setError("Failed to load wallet");
    }
    setLoading(false);
  };

  const createWallet = async () => {
    setActionLoading("create");
    setError(null);
    try {
      const res = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-wallet" }),
        credentials: "include",
      });
      const data = await res.json();
      if (res.status === 401) {
        setError(data.error || "Please sign in. If you reset the database, sign out and sign in again.");
        setActionLoading(null);
        return;
      }
      if (data.error) {
        setError(data.error);
      } else {
        setWallet({ address: data.address, balance: data.balance });
      }
    } catch {
      setError("Failed to create wallet");
    }
    setActionLoading(null);
  };

  const pricingTiers = [
    { label: "Scan", amount: "1", desc: "Accessibility scan with AI fix generation", trigger: "Run from the Repos tab" },
    { label: "Report", amount: "0.5", desc: "AODA/WCAG compliance report", trigger: "Click Report on a scan" },
    { label: "PR", amount: "2", desc: "AI remediation + GitHub pull request", trigger: "Click Create PR on a scan" },
  ];

  return (
    <div className="min-h-screen bg-[#050505]">
      <Navbar
        username={(session?.user as Record<string, string>)?.name ?? ""}
        avatarUrl={(session?.user as Record<string, string>)?.image ?? undefined}
      />

      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-6 md:px-16 py-8">
        <h1 className="font-editorial text-[clamp(2rem,4vw,3.5rem)] italic leading-tight mb-2">
          Wallet
        </h1>
        <p className="font-body text-sm text-[#b3b3b3] mb-2">
          Pay with XRP escrow on the XRPL Testnet — no upfront charges.
        </p>
        <p className="font-body text-xs text-[#919191] mb-4 max-w-xl">
          XRP is locked in escrow when you run a scan, generate a report, or create a PR.
          On success, the escrow releases to Apex. If something fails, you can cancel and reclaim your XRP after 5 minutes.
        </p>
        <hr className="editorial-rule-thick mb-8" aria-hidden="true" />

        {error && (
          <div className="mb-6 py-4 border-t border-b border-[#ff3b5c33] text-[#ff3b5c] text-sm font-body" role="alert">
            {error}
          </div>
        )}

        {/* Wallet */}
        {loading ? (
          <div className="py-12 animate-pulse" aria-busy="true" aria-label="Loading wallet">
            <div className="h-6 bg-[#1a1a1a] rounded w-1/3 mb-4" />
            <div className="h-10 bg-[#1a1a1a] rounded w-1/4" />
          </div>
        ) : !wallet?.address ? (
          <div className="py-16 border-t border-[#1a1a1a]">
            <h2 className="font-editorial text-2xl italic mb-3">No wallet connected</h2>
            <p className="font-body text-sm text-[#b3b3b3] mb-8 max-w-md">
              Create a testnet wallet to start paying for scans with XRP.
              Testnet wallets are funded with 1,000 test XRP automatically.
            </p>
            <button
              onClick={createWallet}
              disabled={actionLoading !== null}
              className="group flex items-center gap-3 font-mono text-xs uppercase tracking-wider border-t border-b border-[#1a1a1a] py-4 hover:border-[#00f0ff] text-[#00f0ff] disabled:opacity-50 transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff] w-full"
            >
              {actionLoading === "create" ? "Creating..." : "Create Testnet Wallet"}
              <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-0 border-t border-[#1a1a1a] mb-8">
            <div className="md:col-span-4 py-8 md:pr-8">
              <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Balance</div>
              <div className="font-editorial text-5xl italic text-[#00f0ff]">
                {wallet.balance.toLocaleString()}
              </div>
              <div className="font-mono text-xs text-[#919191] mt-1">XRP</div>
            </div>
            <div className="md:col-span-4 py-8 md:px-8 border-l border-[#1a1a1a]">
              <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Network</div>
              <div className="font-editorial text-2xl italic">Testnet</div>
              <div className="font-mono text-xs text-[#919191] mt-1">XRPL</div>
            </div>
            <div className="md:col-span-4 py-8 md:pl-8 border-l border-[#1a1a1a]">
              <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Address</div>
              <code className="text-xs font-mono text-[#b3b3b3] break-all leading-relaxed">
                {wallet.address}
              </code>
            </div>
          </div>
        )}

        {/* Pricing — all payments happen via escrow from the scan flow */}
        {wallet?.address && (
          <div className="mb-8">
            <div className="font-mono text-xs uppercase tracking-widest text-[#919191] mb-2">Pricing</div>
            <p className="font-body text-xs text-[#919191] mb-4">
              All payments use XRPL escrow. XRP is locked when you trigger an action and released to Apex on success.
              If something fails, you can cancel the escrow and reclaim your XRP after 5 minutes.
            </p>
            <div className="grid grid-cols-3 gap-0 border-t border-[#1a1a1a]">
              {pricingTiers.map((tier, i) => (
                <div key={tier.label} className={`py-10 px-6 md:px-8 ${i > 0 ? "border-l border-[#1a1a1a]" : ""}`}>
                  <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-4">{tier.label}</div>
                  <div className="font-editorial text-4xl md:text-5xl italic text-[#f5f5f5]">
                    {tier.amount}
                  </div>
                  <div className="font-mono text-xs text-[#919191] mt-1">XRP</div>
                  <p className="font-body text-xs text-[#919191] mt-4">{tier.desc}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-[#00f0ff] mt-4">{tier.trigger}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info */}
        <div className="py-5 border-t border-[#1a1a1a]">
          <p className="text-xs text-[#919191] font-body leading-relaxed">
            This uses the XRPL Testnet — no real funds are involved. Transaction fees are approximately
            0.000001 XRP per transfer. In production, the same payment flow would work on XRPL Mainnet
            with real XRP for frictionless micropayments with no credit card required.
          </p>
        </div>
      </main>
    </div>
  );
}
