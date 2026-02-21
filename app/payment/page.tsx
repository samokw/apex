"use client";

import { useState, useEffect } from "react";
import { Navbar } from "@/components/navbar";
import { useSession } from "next-auth/react";

interface WalletInfo {
  address: string | null;
  balance: number;
}

interface PaymentResult {
  txHash: string;
  amount: string;
  explorerUrl: string;
}

export default function PaymentPage() {
  const { data: session } = useSession();
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastPayment, setLastPayment] = useState<PaymentResult | null>(null);
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
      });
      const data = await res.json();
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

  const makePayment = async (paymentType: string) => {
    setActionLoading(paymentType);
    setError(null);
    setLastPayment(null);
    try {
      const res = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pay", paymentType }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setLastPayment(data);
        fetchBalance();
      }
    } catch {
      setError("Payment failed");
    }
    setActionLoading(null);
  };

  // Scans use escrow (1 XRP locked when you run a scan from Repos), so no "Pay for Scan" here.
  const paymentTiers = [
    { type: "report", label: "Report", amount: "0.5", desc: "AODA compliance report" },
    { type: "pr-credit", label: "PR", amount: "2", desc: "Remediation + pull request" },
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
          Pay per scan with XRP micropayments on the XRPL Testnet.
        </p>
        <p className="font-body text-xs text-[#919191] mb-4 max-w-xl">
          <strong className="text-[#b3b3b3]">Your wallet</strong> (created below) is where you pay from. When you click Pay, XRP is sent from your wallet to <strong className="text-[#b3b3b3]">Apex&apos;s wallet</strong> (configured on the server). You never use your own .env wallet here — that&apos;s for the server to receive payments.
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

        {/* Payment tiers — Report & PR; scans use escrow when you run them from Repos */}
        {wallet?.address && (
          <div className="mb-8">
            <div className="font-mono text-xs uppercase tracking-widest text-[#919191] mb-2">Purchase credits</div>
            <p className="font-body text-xs text-[#919191] mb-4">Scans use escrow: 1 XRP is locked when you run a scan from the Repos tab (released to Apex on success). Pay below for Report or PR.</p>
            <div className="grid grid-cols-2 gap-0 border-t border-[#1a1a1a]">
              {paymentTiers.map((tier, i) => (
                <div key={tier.type} className={`py-10 px-6 md:px-8 flex flex-col justify-between ${i > 0 ? "border-l border-[#1a1a1a]" : ""}`}>
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-4">{tier.label}</div>
                    <div className="font-editorial text-4xl md:text-5xl italic text-[#f5f5f5]">
                      {tier.amount}
                    </div>
                    <div className="font-mono text-xs text-[#919191] mt-1">XRP</div>
                    <p className="font-body text-xs text-[#919191] mt-4">{tier.desc}</p>
                  </div>
                  <button
                    onClick={() => makePayment(tier.type)}
                    disabled={actionLoading !== null}
                    className="mt-6 w-full font-mono text-xs uppercase tracking-wider text-[#00f0ff] border border-[#1a1a1a] py-3 hover:border-[#00f0ff] hover:bg-[#00f0ff] hover:text-black disabled:opacity-50 transition-all min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff]"
                    aria-label={`Pay ${tier.amount} XRP for ${tier.label}`}
                  >
                    {actionLoading === tier.type ? "Processing..." : "Pay"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Last payment result */}
        {lastPayment && (
          <div className="py-6 mb-8 border-t border-b border-[#4ade8033]" role="status" aria-live="polite">
            <div className="flex items-center gap-3 mb-3">
              <svg className="w-5 h-5 text-[#4ade80]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-mono text-sm uppercase tracking-wider text-[#4ade80]">Payment Confirmed</span>
            </div>
            <div className="space-y-2 text-sm font-body">
              <div>
                <span className="text-[#919191]">Amount: </span>
                <span className="font-mono">{lastPayment.amount} XRP</span>
              </div>
              <div>
                <span className="text-[#919191]">Transaction: </span>
                <code className="font-mono text-xs text-[#b3b3b3] break-all">{lastPayment.txHash}</code>
              </div>
              <a
                href={lastPayment.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[#00f0ff] hover:underline font-mono text-xs mt-2"
              >
                View on XRPL Explorer →
              </a>
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
