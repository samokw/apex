"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Repo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  language: string | null;
  defaultBranch: string;
  private: boolean;
  updatedAt: string;
  htmlUrl: string;
}

interface ScanCredits {
  allowed: boolean;
  hasWallet: boolean;
  balance?: number;
  minBalanceForEscrow?: number;
  scanCreditsRemaining?: number | null;
}

export default function ReposPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scanCredits, setScanCredits] = useState<ScanCredits | null>(null);
  const router = useRouter();

  const fetchCanScan = () => {
    fetch("/api/payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "can-scan" }),
    })
      .then((r) => r.json())
      .then((data) => setScanCredits(data))
      .catch(() => setScanCredits({ allowed: false, hasWallet: false, balance: 0 }));
  };

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((data) => {
        setRepos(data.repos || []);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load repositories");
        setLoading(false);
      });
    fetchCanScan();
  }, []);

  // Refetch credits when tab gets focus (e.g. after paying on Wallet tab)
  useEffect(() => {
    const onFocus = () => fetchCanScan();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const startScan = async (repo: Repo) => {
    setError(null);
    setScanning(repo.fullName);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoOwner: repo.owner,
          repoName: repo.name,
          branch: repo.defaultBranch,
        }),
      });
      const data = await res.json();
      if (data.scanId) {
        fetchCanScan(); // deduct credit in UI
        router.push(`/dashboard/scan/${data.scanId}`);
      } else {
        setError(data.error || "Failed to start scan");
        if (res.status === 402) fetchCanScan();
        setScanning(null);
      }
    } catch {
      setError("Failed to start scan");
      setScanning(null);
    }
  };

  const canScan = scanCredits?.allowed ?? false;

  const filtered = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.description?.toLowerCase().includes(search.toLowerCase())
  );

  const langColors: Record<string, string> = {
    TypeScript: "#3178c6",
    JavaScript: "#f7df1e",
    Python: "#3572A5",
    Rust: "#dea584",
    Go: "#00ADD8",
    Java: "#b07219",
    Ruby: "#701516",
    Swift: "#F05138",
    HTML: "#e34c26",
    CSS: "#563d7c",
    Vue: "#41b883",
    Svelte: "#ff3e00",
  };

  return (
    <div>
      <h1 className="font-editorial text-[clamp(2rem,4vw,3.5rem)] italic leading-tight mb-4">
        Repositories
      </h1>
      <hr className="editorial-rule-thick mb-8" aria-hidden="true" />

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mb-8">
        <div className="md:col-span-8">
          <label htmlFor="repo-search" className="sr-only">
            Search repositories
          </label>
          <div className="relative">
            <svg
              className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-[#919191]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              id="repo-search"
              type="search"
              placeholder="Search repositories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-7 pr-4 py-3 bg-transparent border-b border-[#1a1a1a] text-sm font-body text-[#f5f5f5] placeholder-[#919191] focus:outline-none focus:border-[#00f0ff] transition-colors min-h-[44px]"
            />
          </div>
        </div>
        <div className="md:col-span-4 flex items-end">
          <div className="font-mono text-xs uppercase tracking-widest text-[#919191]">
            {loading ? "Loading..." : `${filtered.length} repositories`}
          </div>
        </div>
      </div>

      {scanCredits && !canScan && (
        <div
          className="mb-6 py-4 px-4 border border-[#00f0ff33] bg-[#00f0ff0a] text-sm font-body text-[#b3b3b3]"
          role="status"
        >
          {!scanCredits.hasWallet ? (
            <>Create a testnet wallet in the <Link href="/payment" className="text-[#00f0ff] hover:underline">Wallet</Link> tab to run scans. Each scan locks 1 XRP in escrow (released to Apex on success, or you can cancel after 30 min if it fails).</>
          ) : (
            <>You need at least {scanCredits.minBalanceForEscrow ?? 2} XRP to run a scan (1 XRP is locked in escrow per scan; the rest is a buffer for transaction fees). Get testnet XRP in the <Link href="/payment" className="text-[#00f0ff] hover:underline">Wallet</Link> tab.</>
          )}
        </div>
      )}

      {scanCredits != null && scanCredits.hasWallet && typeof scanCredits.balance === "number" && (
        <div className="mb-4 font-mono text-xs text-[#919191]">
          Balance: {scanCredits.balance} XRP — need 2+ to scan (1 XRP locked in escrow per scan + small buffer for fees)
        </div>
      )}

      {error && (
        <div
          className="mb-6 py-4 border-t border-b border-[#ff3b5c33] text-[#ff3b5c] text-sm font-body"
          role="alert"
        >
          {error}
          {error.includes("Pay") && (
            <span className="block mt-2">
              <Link href="/payment" className="text-[#00f0ff] hover:underline">Go to Wallet →</Link>
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div aria-busy="true" aria-label="Loading repositories">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="border-t border-[#1a1a1a] py-5 animate-pulse">
              <div className="h-5 bg-[#1a1a1a] rounded w-1/3 mb-2" />
              <div className="h-4 bg-[#0f0f0f] rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : (
        <div role="list" aria-label="Repositories">
          {filtered.map((repo) => (
            <div
              key={repo.id}
              className="group border-t border-[#1a1a1a] hover:border-[#00f0ff] transition-colors"
              role="listitem"
            >
              <div className="flex items-center justify-between py-5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-3">
                    <h3 className="font-editorial text-lg italic group-hover:text-[#00f0ff] transition-colors truncate">
                      {repo.name}
                    </h3>
                    {repo.private && (
                      <span className="font-mono text-[11px] uppercase tracking-wider text-[#919191]">
                        Private
                      </span>
                    )}
                    {repo.language && (
                      <span className="flex items-center gap-1.5 font-mono text-xs text-[#b3b3b3]">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{
                            backgroundColor: langColors[repo.language] || "#919191",
                          }}
                          aria-hidden="true"
                        />
                        {repo.language}
                      </span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-sm text-[#919191] font-body mt-1 truncate">
                      {repo.description}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => startScan(repo)}
                  disabled={scanning !== null || !canScan}
                  className="ml-6 font-mono text-xs uppercase tracking-wider text-[#00f0ff] hover:text-[#f5f5f5] disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[44px] min-w-[44px] flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff] rounded-lg px-2"
                  aria-label={canScan ? `Scan ${repo.name}` : `Need 2+ XRP in wallet to scan ${repo.name}`}
                  aria-busy={scanning === repo.fullName}
                >
                  {scanning === repo.fullName ? (
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Scanning
                    </span>
                  ) : (
                    <>
                      Scan
                      <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
          <hr className="border-[#1a1a1a]" aria-hidden="true" />

          {filtered.length === 0 && !loading && (
            <div className="text-center py-16 font-body text-sm text-[#919191]">
              No repositories found matching &quot;{search}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
