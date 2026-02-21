"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { SeverityBadge } from "@/components/severity-badge";
import Link from "next/link";
import ReactDiffViewer from "react-diff-viewer-continued";

interface Violation {
  id: string;
  ruleId: string;
  impact: string;
  description: string;
  helpUrl: string | null;
  wcagCriteria: string | null;
  aodaRelevant: boolean;
  targetElement: string | null;
  htmlSnippet: string | null;
  score: number;
}

interface Fix {
  id: string;
  violationId: string;
  filePath: string;
  originalCode: string;
  fixedCode: string;
  explanation: string | null;
  status: string;
}

interface PullRequest {
  prUrl: string;
  prNumber: number;
  status: string;
}

interface Scan {
  id: string;
  repoOwner: string;
  repoName: string;
  status: string;
  score: number | null;
  scoreAfter: number | null;
  beforeScreenshot: string | null;
  afterScreenshot: string | null;
  errorMessage: string | null;
  createdAt: string;
  violations: Violation[];
  fixes: Fix[];
  escrowTxHash?: string | null;
  escrowCancelAfter?: string | null;
  pullRequest: PullRequest | null;
}

export default function ScanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [scan, setScan] = useState<Scan | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [reportPaid, setReportPaid] = useState(false);
  const [prPaid, setPrPaid] = useState(false);

  const fetchScan = useCallback(async () => {
    const res = await fetch(`/api/scan/${params.id}`);
    const data = await res.json();
    setScan(data.scan);
    setLoading(false);
  }, [params.id]);

  const checkPayments = useCallback(async () => {
    const [reportRes, prRes] = await Promise.all([
      fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-payment", paymentType: "report", scanId: params.id }),
      }),
      fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-payment", paymentType: "pr-credit", scanId: params.id }),
      }),
    ]);
    const reportData = await reportRes.json();
    const prData = await prRes.json();
    setReportPaid(!!reportData.paid);
    setPrPaid(!!prData.paid);
  }, [params.id]);

  useEffect(() => {
    fetchScan();
    checkPayments();
    const interval = setInterval(() => {
      fetchScan();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchScan, checkPayments]);

  useEffect(() => {
    const required = searchParams.get("paymentRequired");
    if (required === "report") {
      setPaymentError("Payment required to view the report. Click 'Report (0.5 XRP)' to pay with escrow.");
    }
  }, [searchParams]);

  const generateFixes = async () => {
    setActionLoading("fix");
    await fetch("/api/fix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId: params.id }),
    });
    setTimeout(fetchScan, 2000);
    setActionLoading(null);
  };

  const updateFixStatus = async (fixId: string, status: string) => {
    await fetch(`/api/scan/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fixId, status }),
    });
    fetchScan();
  };

  const payAndNavigateReport = async () => {
    if (reportPaid) {
      router.push(`/dashboard/scan/${params.id}/report`);
      return;
    }
    setActionLoading("report");
    setPaymentError(null);
    try {
      const res = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-escrow",
          paymentType: "report",
          scanId: params.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPaymentError(data.error || "Payment failed");
        setActionLoading(null);
        return;
      }
      setReportPaid(true);
      router.push(`/dashboard/scan/${params.id}/report`);
    } catch {
      setPaymentError("Payment failed. Please try again.");
      setActionLoading(null);
    }
  };

  const payAndCreatePR = async () => {
    setActionLoading("pr");
    setPaymentError(null);
    try {
      // Create escrow first
      const payRes = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-escrow",
          paymentType: "pr-credit",
          scanId: params.id,
        }),
      });
      const payData = await payRes.json();
      if (!payRes.ok) {
        setPaymentError(payData.error || "Payment failed");
        setActionLoading(null);
        return;
      }

      // Now create the PR
      const prRes = await fetch("/api/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId: params.id, paymentId: payData.paymentId }),
      });
      const prData = await prRes.json();
      if (prData.prUrl) {
        fetchScan();
      } else if (prData.error) {
        setPaymentError(`PR failed: ${prData.error}. Your 2 XRP escrow can be cancelled after 5 min.`);
      }
    } catch {
      setPaymentError("PR creation failed. Your escrow can be cancelled after 5 min.");
    }
    setActionLoading(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32" aria-busy="true" aria-label="Loading scan results">
        <div className="flex flex-col items-center gap-4">
          <svg className="w-6 h-6 text-[#00f0ff] animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="font-body text-sm text-[#b3b3b3]">Loading scan results...</p>
        </div>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="text-center py-32">
        <p className="font-body text-[#b3b3b3]">Scan not found</p>
        <Link href="/dashboard" className="text-[#00f0ff] text-sm mt-4 inline-block hover:underline font-mono">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const isInProgress = ["pending", "cloning", "scanning", "fixing"].includes(scan.status);
  const acceptedFixes = scan.fixes.filter((f) => f.status === "accepted");

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => router.push("/dashboard")}
              className="text-[#919191] hover:text-[#00f0ff] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff] rounded-lg"
              aria-label="Back to dashboard"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="font-editorial text-[clamp(1.5rem,3vw,2.5rem)] italic leading-tight">
              {scan.repoOwner}<span className="text-[#919191]">/</span>{scan.repoName}
            </h1>
          </div>
          <p className="font-mono text-xs text-[#919191] uppercase tracking-wider ml-14">
            {new Date(scan.createdAt).toLocaleString("en-CA")}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {scan.status === "complete" && scan.fixes.length === 0 && scan.violations.length > 0 && (
            <button
              onClick={generateFixes}
              disabled={actionLoading !== null}
              className="font-mono text-xs uppercase tracking-wider px-5 py-3 border border-[#00f0ff] text-[#00f0ff] hover:bg-[#00f0ff] hover:text-black disabled:opacity-50 transition-all min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff]"
            >
              {actionLoading === "fix" ? "Generating..." : "Generate AI Fixes"}
            </button>
          )}

          {acceptedFixes.length > 0 && !scan.pullRequest && (
            <button
              onClick={payAndCreatePR}
              disabled={actionLoading !== null}
              className="font-mono text-xs uppercase tracking-wider px-5 py-3 border border-[#4ade80] text-[#4ade80] hover:bg-[#4ade80] hover:text-black disabled:opacity-50 transition-all min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4ade80]"
            >
              {actionLoading === "pr" ? "Creating PR..." : prPaid ? `Create PR (${acceptedFixes.length})` : `Create PR — 2 XRP (${acceptedFixes.length})`}
            </button>
          )}

          <button
            onClick={payAndNavigateReport}
            disabled={actionLoading !== null}
            className="font-mono text-xs uppercase tracking-wider px-5 py-3 border border-[#1a1a1a] text-[#919191] hover:border-[#00f0ff] hover:text-[#00f0ff] disabled:opacity-50 transition-all min-h-[44px] flex items-center"
          >
            {actionLoading === "report" ? "Paying..." : reportPaid ? "View Report" : "Report — 0.5 XRP"}
          </button>
        </div>
      </div>
      <hr className="editorial-rule-thick mb-8" aria-hidden="true" />

      {/* Payment error */}
      {paymentError && (
        <div className="py-4 px-5 mb-6 border border-[#ff3b5c33] bg-[#ff3b5c08]" role="alert">
          <p className="text-sm text-[#ff3b5c] font-body">{paymentError}</p>
          <button
            onClick={() => setPaymentError(null)}
            className="text-xs text-[#919191] hover:text-[#f5f5f5] font-mono mt-2 uppercase tracking-wider"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Status bar */}
      {isInProgress && (
        <div className="py-6 mb-8 border-t border-b border-[#1a1a1a]" role="status" aria-live="polite">
          <div className="flex items-center gap-4">
            <svg className="w-5 h-5 text-[#00f0ff] animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div>
              <div className="font-mono text-sm uppercase tracking-wider">{scan.status}...</div>
              <p className="text-sm text-[#919191] font-body mt-1">This may take a few minutes depending on the repository size.</p>
            </div>
          </div>
        </div>
      )}

      {scan.status === "failed" && (
        <div className="py-6 mb-8 border-t border-b border-[#ff3b5c33]" role="alert">
          <div className="font-mono text-sm uppercase tracking-wider text-[#ff3b5c] mb-1">Scan Failed</div>
          <p className="text-sm text-[#b3b3b3] font-body">{scan.errorMessage || "An unknown error occurred"}</p>
          {scan.escrowTxHash && (
            <p className="text-xs text-[#919191] font-body mt-3">
              Your 1 XRP is still in escrow. After {scan.escrowCancelAfter ? new Date(scan.escrowCancelAfter).toLocaleString() : "~5 min"} you can cancel the escrow to get it back.{" "}
              <a href={`https://testnet.xrpl.org/transactions/${scan.escrowTxHash}`} target="_blank" rel="noopener noreferrer" className="text-[#00f0ff] hover:underline">View escrow on XRPL</a>
            </p>
          )}
        </div>
      )}

      {scan.pullRequest && (
        <div className="py-6 mb-8 border-t border-b border-[#4ade8033]">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-sm uppercase tracking-wider text-[#4ade80] mb-1">Pull Request Created</div>
              <p className="text-sm text-[#b3b3b3] font-body">PR #{scan.pullRequest.prNumber} — {scan.pullRequest.status}</p>
            </div>
            <a
              href={scan.pullRequest.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-[#4ade80] hover:text-[#f5f5f5] transition-colors min-h-[44px]"
            >
              View on GitHub
              <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      )}

      {/* Score strip */}
      {scan.score !== null && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 mb-8 border-t border-[#1a1a1a]">
          <div className="py-8 md:pr-8">
            <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Score Before</div>
            <div className="font-editorial text-4xl italic" style={{
              color: (scan.score ?? 0) >= 90 ? "#4ade80" : (scan.score ?? 0) >= 70 ? "#ffc53d" : "#ff3b5c"
            }}>
              {scan.score}
            </div>
          </div>
          {scan.scoreAfter !== null && (
            <div className="py-8 md:px-8 border-l border-[#1a1a1a]">
              <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Score After</div>
              <div className="font-editorial text-4xl italic text-[#4ade80]">{scan.scoreAfter}</div>
            </div>
          )}
          <div className="py-8 md:px-8 border-l border-[#1a1a1a]">
            <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Violations</div>
            <div className="font-editorial text-4xl italic">{scan.violations.length}</div>
          </div>
          <div className="py-8 md:pl-8 border-l border-[#1a1a1a]">
            <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Fixes</div>
            <div className="font-editorial text-4xl italic">{scan.fixes.length}</div>
          </div>
        </div>
      )}

      {/* Screenshots */}
      {(scan.beforeScreenshot || scan.afterScreenshot) && (
        <div className="mb-8">
          <div className="font-mono text-xs uppercase tracking-widest text-[#919191] mb-4">Before / After</div>
          <hr className="editorial-rule-full mb-6" aria-hidden="true" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {scan.beforeScreenshot && (
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-3">Before</div>
                <img
                  src={`data:image/png;base64,${scan.beforeScreenshot}`}
                  alt="Screenshot of the application before accessibility fixes"
                  className="border border-[#1a1a1a] w-full"
                />
              </div>
            )}
            {scan.afterScreenshot && (
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-3">After</div>
                <img
                  src={`data:image/png;base64,${scan.afterScreenshot}`}
                  alt="Screenshot of the application after accessibility fixes"
                  className="border border-[#1a1a1a] w-full"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Violations list */}
      {scan.violations.length > 0 && (
        <div className="mb-8">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-mono text-xs uppercase tracking-widest text-[#919191]">
              Violations ({scan.violations.length})
            </h2>
          </div>
          <div role="list" aria-label="Accessibility violations">
            {scan.violations.map((violation) => {
              const fix = scan.fixes.find((f) => f.violationId === violation.id);
              return (
                <div key={violation.id} className="border-t border-[#1a1a1a]" role="listitem">
                  <div className="py-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <SeverityBadge impact={violation.impact} />
                          <code className="text-xs text-[#919191] font-mono">{violation.ruleId}</code>
                          {violation.aodaRelevant && (
                            <span className="font-mono text-[11px] uppercase tracking-wider text-[#00f0ff] border-b border-[#00f0ff33]">
                              AODA
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-body mb-2">{violation.description}</p>
                        {violation.wcagCriteria && (
                          <p className="text-xs text-[#919191] font-mono">
                            WCAG: {violation.wcagCriteria}
                          </p>
                        )}
                        {violation.targetElement && (
                          <p className="text-xs text-[#919191] font-mono mt-1 truncate">
                            Target: {violation.targetElement}
                          </p>
                        )}
                        {violation.helpUrl && (
                          <a
                            href={violation.helpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[#00f0ff] hover:underline mt-2 inline-block font-mono"
                            aria-label={`Learn more about ${violation.ruleId}`}
                          >
                            Learn more →
                          </a>
                        )}
                      </div>

                      {fix && (
                        <div className="flex items-center gap-2">
                          {fix.status === "pending" && (
                            <>
                              <button
                                onClick={() => updateFixStatus(fix.id, "accepted")}
                                className="font-mono text-xs uppercase tracking-wider px-4 py-2 text-[#4ade80] border border-[#4ade8033] hover:bg-[#4ade80] hover:text-black transition-all min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4ade80]"
                                aria-label={`Accept fix for ${violation.ruleId}`}
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => updateFixStatus(fix.id, "rejected")}
                                className="font-mono text-xs uppercase tracking-wider px-4 py-2 text-[#ff3b5c] border border-[#ff3b5c33] hover:bg-[#ff3b5c] hover:text-black transition-all min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3b5c]"
                                aria-label={`Reject fix for ${violation.ruleId}`}
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {fix.status === "accepted" && (
                            <span className="font-mono text-xs uppercase tracking-wider text-[#4ade80]">Accepted</span>
                          )}
                          {fix.status === "rejected" && (
                            <span className="font-mono text-xs uppercase tracking-wider text-[#ff3b5c]">Rejected</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {fix && fix.originalCode && fix.fixedCode && (
                    <div className="border-t border-[#1a1a1a]">
                      {fix.explanation && (
                        <div className="px-5 py-3 bg-[#0a0a0a] text-xs text-[#b3b3b3] font-body">
                          <strong className="text-[#f5f5f5] font-mono uppercase tracking-wider">Fix:</strong>{" "}
                          {fix.explanation}
                        </div>
                      )}
                      <div className="text-xs">
                        <ReactDiffViewer
                          oldValue={fix.originalCode}
                          newValue={fix.fixedCode}
                          splitView={true}
                          useDarkTheme={true}
                          leftTitle={fix.filePath}
                          rightTitle={`${fix.filePath} (fixed)`}
                          styles={{
                            contentText: { fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px" },
                            diffContainer: { background: "#0a0a0a" },
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <hr className="border-[#1a1a1a]" aria-hidden="true" />
          </div>
        </div>
      )}
    </div>
  );
}
