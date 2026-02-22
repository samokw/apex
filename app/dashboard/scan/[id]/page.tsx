"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  escrowTxHash?: string | null;
  escrowCancelAfter?: string | null;
  escrowRefundedAt?: string | null;
  violations: Violation[];
  fixes: Fix[];
  pullRequest: PullRequest | null;
}

interface FixWithViolation {
  fix: Fix;
  violation: Violation;
}

interface FixGroup {
  key: string;
  ruleId: string;
  impact: string;
  description: string;
  wcagCriteria: string | null;
  aodaRelevant: boolean;
  items: FixWithViolation[];
}

/* ── Pipeline steps ── */
const PIPELINE_STEPS = [
  { key: "pending", label: "Queued",   icon: "clock" },
  { key: "cloning", label: "Cloning",  icon: "repo" },
  { key: "scanning", label: "Scanning", icon: "scan" },
  { key: "fixing",  label: "AI Fixing", icon: "sparkle" },
  { key: "complete", label: "Done",    icon: "check" },
] as const;

const IMPACT_ORDER: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

function PipelineIcon({ icon, active, done }: { icon: string; active: boolean; done: boolean }) {
  const color = done ? "#4ade80" : active ? "#00f0ff" : "#777";
  const cls = active ? "animate-pulse" : "";
  switch (icon) {
    case "clock":
      return (
        <svg className={`w-4 h-4 ${cls}`} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
          <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
        </svg>
      );
    case "repo":
      return (
        <svg className={`w-4 h-4 ${cls}`} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" />
        </svg>
      );
    case "scan":
      return (
        <svg className={`w-4 h-4 ${cls}`} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
          <path d="M2 12h2m16 0h2M12 2v2m0 16v2m-7.07-2.93l1.41-1.41m11.32-11.32l1.41-1.41M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case "sparkle":
      return (
        <svg className={`w-4 h-4 ${cls}`} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
          <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
        </svg>
      );
    case "check":
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2.5}>
          <path d="M5 13l4 4L19 7" />
        </svg>
      );
    default:
      return null;
  }
}

function ScanPipeline({ status }: { status: string }) {
  const stepIdx = PIPELINE_STEPS.findIndex((s) => s.key === status);
  const isFailed = status === "failed";
  const currentIdx = isFailed ? -1 : stepIdx;
  const completedSteps = PIPELINE_STEPS.filter((_, i) => currentIdx > i || status === "complete").length;
  const totalSteps = PIPELINE_STEPS.length;

  return (
    <div
      className="flex items-center gap-0 w-full"
      role="progressbar"
      aria-valuenow={completedSteps}
      aria-valuemin={0}
      aria-valuemax={totalSteps}
      aria-valuetext={`Step ${Math.min(currentIdx + 1, totalSteps)} of ${totalSteps}: ${PIPELINE_STEPS[Math.min(Math.max(currentIdx, 0), totalSteps - 1)].label}`}
      aria-label="Scan progress"
    >
      {PIPELINE_STEPS.map((step, i) => {
        const done = currentIdx > i || status === "complete";
        const active = currentIdx === i && status !== "complete";
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-500 ${
                  done
                    ? "border-[#4ade80] bg-[#4ade8015]"
                    : active
                      ? "border-[#00f0ff] bg-[#00f0ff10] shadow-[0_0_12px_rgba(0,240,255,0.3)]"
                      : "border-[#222] bg-[#0a0a0a]"
                }`}
              >
                <PipelineIcon icon={step.icon} active={active} done={done} />
              </div>
              <span className={`font-mono text-[10px] uppercase tracking-wider transition-colors duration-500 ${
                done ? "text-[#4ade80]" : active ? "text-[#00f0ff]" : "text-[#888]"
              }`}>
                {step.label}
              </span>
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <div className="flex-1 h-px mx-2 mt-[-18px] relative overflow-hidden">
                <div className={`absolute inset-0 transition-all duration-700 ${
                  currentIdx > i ? "bg-[#4ade80]" : "bg-[#222]"
                }`} />
                {active && (
                  <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#00f0ff] to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Section navigation ── */
interface SectionDef {
  id: string;
  label: string;
  count?: number;
  show: boolean;
}

function SectionNav({
  sections,
  activeSection,
  onNavigate,
}: {
  sections: SectionDef[];
  activeSection: string;
  onNavigate: (id: string) => void;
}) {
  const visible = sections.filter((s) => s.show);
  if (visible.length === 0) return null;

  return (
    <nav
      className="sticky top-0 z-30 -mx-6 md:-mx-16 px-6 md:px-16 py-3 bg-[#050505]/90 backdrop-blur-md border-b border-[#1a1a1a]"
      aria-label="Page sections"
    >
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none" role="tablist" aria-label="Scan result sections">
        {visible.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={activeSection === s.id}
            aria-controls={s.id}
            onClick={() => onNavigate(s.id)}
            className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest px-3 py-2 rounded-full whitespace-nowrap transition-all min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff] ${
              activeSection === s.id
                ? "bg-[#00f0ff15] text-[#00f0ff] border border-[#00f0ff33]"
                : "text-[#a0a0a0] hover:text-[#d0d0d0] border border-transparent hover:border-[#1a1a1a]"
            }`}
          >
            {s.label}
            {s.count !== undefined && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                activeSection === s.id ? "bg-[#00f0ff25] text-[#00f0ff]" : "bg-[#1a1a1a] text-[#a0a0a0]"
              }`}>
                {s.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

/* ── Scroll-down indicator ── */
function ScrollCue({ targetId, label }: { targetId: string; label: string }) {
  const [visible, setVisible] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      setVisible(window.scrollY < 200);
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => {
        const target = document.getElementById(targetId);
        if (target) {
          target.scrollIntoView({ behavior: prefersReducedMotion ? "instant" : "smooth", block: "start" });
          // Move focus to the target section for keyboard users (WCAG 2.4.3)
          target.setAttribute("tabindex", "-1");
          target.focus({ preventScroll: true });
        }
      }}
      className={`flex flex-col items-center gap-2 py-4 mx-auto text-[#00f0ff] opacity-70 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff] rounded-lg ${
        prefersReducedMotion ? "" : "animate-[gentle-bounce_2s_ease-in-out_infinite]"
      }`}
      aria-label={label}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.25em]" aria-hidden="true">{label}</span>
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

/* ── Screen reader announcer (WCAG 4.1.3 Status Messages) ── */
function useAnnounce() {
  const [message, setMessage] = useState("");

  const announce = useCallback((text: string) => {
    setMessage("");
    // Clear then set to ensure re-announcement
    setTimeout(() => setMessage(text), 100);
  }, []);

  const Announcer = useCallback(
    () => (
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {message}
      </div>
    ),
    [message]
  );

  return { announce, Announcer };
}

/* ── Main page ── */
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
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("score");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const prevStatusRef = useRef<string | null>(null);
  const { announce, Announcer } = useAnnounce();

  const fetchScan = useCallback(async () => {
    const res = await fetch(`/api/scan/${params.id}?_=${Date.now()}`, {
      cache: "no-store",
    });
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
  }, [fetchScan, checkPayments]);

  useEffect(() => {
    const required = searchParams.get("paymentRequired");
    if (required === "report") {
      setPaymentError("Payment required to view the report. Click 'Report (0.5 XRP)' to pay with escrow.");
    }
  }, [searchParams]);

  useEffect(() => {
    const isInProg = scan && ["pending", "cloning", "scanning", "fixing"].includes(scan.status);
    if (!isInProg) return;
    const interval = setInterval(fetchScan, 5000);
    return () => clearInterval(interval);
  }, [scan?.status, fetchScan]);

  /* Announce status changes to screen readers (WCAG 4.1.3) */
  useEffect(() => {
    if (!scan) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = scan.status;
    if (prev && prev !== scan.status) {
      const statusMessages: Record<string, string> = {
        cloning: "Cloning repository",
        scanning: "Scanning for accessibility violations",
        fixing: "Generating fixes",
        complete: `Scan complete. Found ${scan.violations.length} violation${scan.violations.length !== 1 ? "s" : ""}`,
        failed: `Scan failed: ${scan.errorMessage || "unknown error"}`,
      };
      announce(statusMessages[scan.status] || `Scan status: ${scan.status}`);
    }
  }, [scan?.status, scan?.violations.length, scan?.errorMessage, announce]);

  /* Intersection observer for section tracking */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.2) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.2 }
    );

    Object.values(sectionRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [scan?.status, scan?.violations.length, scan?.fixes.length]);

  const registerSection = useCallback((id: string) => (el: HTMLElement | null) => {
    sectionRefs.current[id] = el;
  }, []);

  const scrollToSection = useCallback((id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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
    announce(`Fix ${status === "accepted" ? "accepted" : "rejected"}`);
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

  /* ── Loading state ── */
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
  const violationsById = new Map(scan.violations.map((violation) => [violation.id, violation]));
  const groupedFixes = Object.values(
    scan.fixes.reduce<Record<string, FixGroup>>((acc, fix) => {
      const violation = violationsById.get(fix.violationId);
      if (!violation) return acc;

      const groupKey = [
        violation.ruleId,
        violation.impact,
        violation.description,
        violation.wcagCriteria || "",
      ].join("::");

      if (!acc[groupKey]) {
        acc[groupKey] = {
          key: groupKey,
          ruleId: violation.ruleId,
          impact: violation.impact,
          description: violation.description,
          wcagCriteria: violation.wcagCriteria,
          aodaRelevant: violation.aodaRelevant,
          items: [],
        };
      }

      acc[groupKey].items.push({ fix, violation });
      return acc;
    }, {})
  )
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (a, b) =>
          a.fix.filePath.localeCompare(b.fix.filePath) ||
          a.fix.id.localeCompare(b.fix.id)
      ),
    }))
    .sort(
      (a, b) =>
        (IMPACT_ORDER[a.impact] ?? 99) - (IMPACT_ORDER[b.impact] ?? 99) ||
        b.items.length - a.items.length ||
        a.ruleId.localeCompare(b.ruleId)
    );
  const unpatchedViolations = scan.violations.filter(
    (violation) => !scan.fixes.some((fix) => fix.violationId === violation.id)
  );

  const sections: SectionDef[] = [
    { id: "score", label: "Overview", show: scan.score !== null || isInProgress },
    { id: "screenshots", label: "Screenshots", show: !!(scan.beforeScreenshot || scan.afterScreenshot) },
    { id: "fixes", label: "Fixes", count: scan.fixes.length, show: scan.fixes.length > 0 },
    { id: "violations", label: "Violations", count: unpatchedViolations.length, show: unpatchedViolations.length > 0 },
    { id: "pr", label: "Pull Request", show: !!scan.pullRequest },
  ];

  const hasContentBelow = scan.violations.length > 0 || scan.fixes.length > 0;

  return (
    <div className="relative">
      <Announcer />
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
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
            <h1 className="font-editorial text-[clamp(1.5rem,3vw,2.5rem)] italic leading-tight pr-2">
              {scan.repoOwner}<span className="text-[#919191]">/</span>{scan.repoName}
            </h1>
          </div>
          <p className="font-mono text-xs text-[#919191] uppercase tracking-wider ml-14">
            {new Date(scan.createdAt).toLocaleString("en-CA")}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap ml-14 sm:ml-0">
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
              {actionLoading === "pr" ? "Creating PR..." : prPaid ? `Create PR (${acceptedFixes.length})` : `Create PR \u2014 2 XRP (${acceptedFixes.length})`}
            </button>
          )}

          <button
            onClick={payAndNavigateReport}
            disabled={actionLoading !== null}
            className="font-mono text-xs uppercase tracking-wider px-5 py-3 border border-[#1a1a1a] text-[#919191] hover:border-[#00f0ff] hover:text-[#00f0ff] disabled:opacity-50 transition-all min-h-[44px] flex items-center"
          >
            {actionLoading === "report" ? "Paying..." : reportPaid ? "View Report" : "Report \u2014 0.5 XRP"}
          </button>
        </div>
      </div>
      <hr className="editorial-rule-thick mb-6" aria-hidden="true" />

      {/* ── Payment error ── */}
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

      {/* ── Sticky section nav ── */}
      {!isInProgress && sections.filter((s) => s.show).length > 1 && (
        <SectionNav sections={sections} activeSection={activeSection} onNavigate={scrollToSection} />
      )}

      {/* ── Progress pipeline ── */}
      {isInProgress && (
        <div className="py-8 mb-8 slide-up" aria-live="polite">
          <div className="max-w-md mx-auto mb-6">
            <ScanPipeline status={scan.status} />
          </div>
          <p className="text-center text-sm text-[#a0a0a0] font-body">
            This may take a few minutes depending on the repository size.
          </p>
        </div>
      )}

      {/* ── Failed banner ── */}
      {scan.status === "failed" && (
        <div className="py-6 mb-8 border-l-2 border-[#ff3b5c] pl-5 bg-[#ff3b5c08] rounded-r slide-up" role="alert">
          <div className="font-mono text-sm uppercase tracking-wider text-[#ff3b5c] mb-1">Scan Failed</div>
          <p className="text-sm text-[#b3b3b3] font-body">{scan.errorMessage || "An unknown error occurred"}</p>
          {scan.escrowTxHash && (
            <div className="mt-4 p-4 rounded-lg bg-[#0d0d0d] border border-[#1a1a1a]">
              <p className="font-mono text-sm uppercase tracking-wider text-[#f5f5f5] mb-1">Get your 1 XRP back</p>
              <p className="text-sm text-[#b3b3b3] font-body mb-3">
                Your 1 XRP is in escrow. <strong className="text-[#f5f5f5]">Refunds are done here in the app</strong> \u2014 the XRPL Explorer only shows the transaction; it has no refund button. After 5 minutes from the scan start (or ~1 minute in development) you can get your XRP back using the button below.
              </p>
              {scan.escrowRefundedAt ? (
                <p className="text-sm text-[#4ade80] font-body">1 XRP has been returned to your wallet.</p>
              ) : scan.escrowCancelAfter && new Date(scan.escrowCancelAfter) > new Date() ? (
                <p className="text-sm text-[#919191] font-body">
                  Refund available after {new Date(scan.escrowCancelAfter).toLocaleString()}.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      setRefundError(null);
                      setRefundLoading(true);
                      try {
                        const res = await fetch(`/api/scan/${params.id}/refund-escrow`, { method: "POST" });
                        const data = await res.json();
                        if (!res.ok) {
                          setRefundError(data.error || "Refund failed");
                          return;
                        }
                        fetchScan();
                      } finally {
                        setRefundLoading(false);
                      }
                    }}
                    disabled={refundLoading}
                    className="font-mono text-xs uppercase tracking-wider px-4 py-2 rounded bg-[#00f0ff] text-[#0a0a0a] hover:bg-[#00d4e6] disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                  >
                    {refundLoading ? "Refunding\u2026" : "Get my 1 XRP back"}
                  </button>
                  {refundError && (
                    <p className="text-sm text-[#ff3b5c] font-body mt-2" role="alert">{refundError}</p>
                  )}
                </>
              )}
              <p className="text-xs text-[#919191] font-body mt-3">
                <a href={`https://testnet.xrpl.org/transactions/${scan.escrowTxHash}`} target="_blank" rel="noopener noreferrer" className="text-[#00f0ff] hover:underline">View escrow on XRPL</a> (for reference only)
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── PR banner ── */}
      {scan.pullRequest && (
        <section id="pr" ref={registerSection("pr")} className="py-6 mb-8 border-l-2 border-[#4ade80] pl-5 bg-[#4ade8008] rounded-r slide-up">
          <div className="flex items-center justify-between flex-wrap gap-4">
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
        </section>
      )}

      {/* ── Score / Overview ── */}
      {scan.score !== null && (
        <section id="score" ref={registerSection("score")} className="mb-10 scroll-mt-20 slide-up" aria-label="Scan overview" role="tabpanel">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-t border-[#1a1a1a]">
            <div className="py-8 md:pr-8">
              <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Score Before</div>
              <div className="font-editorial text-4xl italic pr-2" style={{
                color: (scan.score ?? 0) >= 90 ? "#4ade80" : (scan.score ?? 0) >= 70 ? "#ffc53d" : "#ff3b5c"
              }}>
                {scan.score}
              </div>
            </div>
            {scan.scoreAfter !== null && (
              <div className="py-8 md:px-8 border-l border-[#1a1a1a]">
                <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Score After</div>
                <div className="font-editorial text-4xl italic text-[#4ade80] pr-2">{scan.scoreAfter}</div>
              </div>
            )}
            <div className="py-8 md:px-8 border-l border-[#1a1a1a]">
              <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Violations</div>
              <div className="font-editorial text-4xl italic pr-2">{scan.violations.length}</div>
            </div>
            <div className="py-8 md:pl-8 border-l border-[#1a1a1a]">
              <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Fixes</div>
              <div className="font-editorial text-4xl italic pr-2">{scan.fixes.length}</div>
            </div>
          </div>

          {/* Scroll cue — appears after scan completes and content exists below */}
          {!isInProgress && hasContentBelow && (
            <ScrollCue
              targetId={scan.fixes.length > 0 ? "fixes" : "violations"}
              label={scan.fixes.length > 0 ? "Review fixes below" : "View violations below"}
            />
          )}
        </section>
      )}

      {/* ── Screenshots ── */}
      {(scan.beforeScreenshot || scan.afterScreenshot) && (
        <section id="screenshots" ref={registerSection("screenshots")} className="mb-10 scroll-mt-20 slide-up" style={{ animationDelay: "0.1s" }} aria-label="Before and after screenshots" role="tabpanel">
          <h2 className="font-mono text-xs uppercase tracking-widest text-[#919191] mb-4">Before / After</h2>
          <hr className="editorial-rule-full mb-6" aria-hidden="true" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {scan.beforeScreenshot && (
              <div>
                <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-3">Before</div>
                <img
                  src={`data:image/png;base64,${scan.beforeScreenshot}`}
                  alt="Screenshot of the application before accessibility fixes"
                  loading="lazy"
                  decoding="async"
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
                  loading="lazy"
                  decoding="async"
                  className="border border-[#1a1a1a] w-full"
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Grouped fix review ── */}
      {scan.fixes.length > 0 && (
        <section id="fixes" ref={registerSection("fixes")} className="mb-10 scroll-mt-20 slide-up" style={{ animationDelay: "0.15s" }} aria-label={`Fix review, ${scan.fixes.length} fixes`} role="tabpanel">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-mono text-xs uppercase tracking-widest text-[#919191]">
              Fix Review By Violation ({scan.fixes.length})
            </h2>
          </div>
          <div className="space-y-6">
            {groupedFixes.map((group) => (
              <section key={group.key} className="border-2 border-[#1a1a1a]" aria-label={`Fixes for ${group.ruleId}`}>
                <div className="px-5 py-4 border-b border-[#1a1a1a] bg-[#0a0a0a]">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <SeverityBadge impact={group.impact} />
                    <code className="text-xs text-[#919191] font-mono">{group.ruleId}</code>
                    {group.aodaRelevant && (
                      <span className="font-mono text-[11px] uppercase tracking-wider text-[#00f0ff] border-b border-[#00f0ff33]">
                        AODA
                      </span>
                    )}
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[#919191]">
                      {group.items.length} diff{group.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="text-sm font-body mb-2">{group.description}</p>
                  <p className="text-xs text-[#919191] font-mono">WCAG: {group.wcagCriteria || "N/A"}</p>
                </div>

                {(scan.beforeScreenshot || scan.afterScreenshot) && (
                  <div className="px-5 py-5 border-b border-[#1a1a1a]">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {scan.beforeScreenshot && (
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Before</p>
                          <img
                            src={`data:image/png;base64,${scan.beforeScreenshot}`}
                            alt={`Before screenshot for ${group.ruleId}`}
                            loading="lazy"
                            decoding="async"
                            className="border border-[#1a1a1a] w-full"
                          />
                        </div>
                      )}
                      {scan.afterScreenshot && (
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">After</p>
                          <img
                            src={`data:image/png;base64,${scan.afterScreenshot}`}
                            alt={`After screenshot for ${group.ruleId}`}
                            loading="lazy"
                            decoding="async"
                            className="border border-[#1a1a1a] w-full"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  {group.items.map(({ fix }) => (
                    <article key={fix.id} className="border-t first:border-t-0 border-[#1a1a1a]">
                      <div className="px-5 py-5">
                        <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                          <div className="flex-1 min-w-[240px]">
                            <p className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">File</p>
                            <p className="font-mono text-sm text-[#f5f5f5] break-all">{fix.filePath || "(unknown file)"}</p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateFixStatus(fix.id, "accepted")}
                              aria-pressed={fix.status === "accepted"}
                              className={`font-mono text-xs uppercase tracking-wider px-4 py-2 transition-all min-h-[44px] focus-visible:outline-none focus-visible:ring-2 ${
                                fix.status === "accepted"
                                  ? "bg-[#4ade80] text-black border border-[#4ade80] focus-visible:ring-[#4ade80]"
                                  : "text-[#4ade80] border border-[#4ade8033] hover:bg-[#4ade80] hover:text-black focus-visible:ring-[#4ade80]"
                              }`}
                              aria-label={`Accept fix for ${group.ruleId}`}
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => updateFixStatus(fix.id, "rejected")}
                              aria-pressed={fix.status === "rejected"}
                              className={`font-mono text-xs uppercase tracking-wider px-4 py-2 transition-all min-h-[44px] focus-visible:outline-none focus-visible:ring-2 ${
                                fix.status === "rejected"
                                  ? "bg-[#ff3b5c] text-black border border-[#ff3b5c] focus-visible:ring-[#ff3b5c]"
                                  : "text-[#ff3b5c] border border-[#ff3b5c33] hover:bg-[#ff3b5c] hover:text-black focus-visible:ring-[#ff3b5c]"
                              }`}
                              aria-label={`Reject fix for ${group.ruleId}`}
                            >
                              Reject
                            </button>
                          </div>
                        </div>

                        {fix.explanation && (
                          <div className="mb-3 text-xs text-[#b3b3b3] font-body">
                            <strong className="text-[#f5f5f5] font-mono uppercase tracking-wider">Fix:</strong>{" "}
                            {fix.explanation}
                          </div>
                        )}

                        {fix.originalCode && fix.fixedCode ? (
                          <div className="text-xs border border-[#1a1a1a]">
                            <ReactDiffViewer
                              oldValue={fix.originalCode}
                              newValue={fix.fixedCode}
                              splitView={true}
                              useDarkTheme={true}
                              leftTitle={`${fix.filePath} (original)`}
                              rightTitle={`${fix.filePath} (fixed)`}
                              styles={{
                                contentText: { fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px" },
                                diffContainer: { background: "#0a0a0a" },
                              }}
                            />
                          </div>
                        ) : (
                          <p className="font-mono text-xs text-[#919191]">
                            Code diff unavailable for this fix.
                          </p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      )}

      {/* ── Violations without generated fixes ── */}
      {unpatchedViolations.length > 0 && (
        <section id="violations" ref={registerSection("violations")} className="mb-10 scroll-mt-20 slide-up" style={{ animationDelay: "0.2s" }} aria-label={`Unfixed violations, ${unpatchedViolations.length} issues`} role="tabpanel">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-mono text-xs uppercase tracking-widest text-[#919191]">
              Unfixed Violations ({unpatchedViolations.length})
            </h2>
          </div>
          <div role="list" aria-label="Violations without generated fixes">
            {unpatchedViolations.map((violation) => (
              <div key={violation.id} className="border-t border-[#1a1a1a] py-5" role="listitem">
                <div className="flex items-center gap-3 mb-2">
                  <SeverityBadge impact={violation.impact} />
                  <code className="text-xs text-[#919191] font-mono">{violation.ruleId}</code>
                </div>
                <p className="text-sm font-body mb-2">{violation.description}</p>
                <p className="text-xs text-[#919191] font-mono">WCAG: {violation.wcagCriteria || "N/A"}</p>
              </div>
            ))}
            <hr className="border-[#1a1a1a]" aria-hidden="true" />
          </div>
        </section>
      )}
    </div>
  );
}
