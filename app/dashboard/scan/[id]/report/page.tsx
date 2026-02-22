import { getApexSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { generateReportSummary } from "@/lib/wcag";
import { SeverityBadge } from "@/components/severity-badge";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getApexSession();
  if (!session) redirect("/auth/signin");

  const { id } = await params;

  const scan = await prisma.scan.findUnique({
    where: { id, userId: session.dbUserId },
    include: {
      violations: { orderBy: { score: "desc" } },
      fixes: true,
      pullRequest: true,
    },
  });

  if (!scan) redirect("/dashboard");

  const report = generateReportSummary(
    scan.violations.map((v) => ({
      impact: v.impact,
      ruleId: v.ruleId,
      description: v.description,
      wcagCriteria: v.wcagCriteria,
      aodaRelevant: v.aodaRelevant,
    }))
  );

  const aodaViolations = scan.violations.filter((v) => v.aodaRelevant);
  const acceptedFixes = scan.fixes.filter((f) => f.status === "accepted");

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link
          href={`/dashboard/scan/${scan.id}`}
          className="text-[#919191] hover:text-[#00f0ff] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff] rounded-lg"
          aria-label="Back to scan results"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="font-editorial text-[clamp(1.5rem,3vw,2.5rem)] italic leading-tight pr-2">
            Compliance Report
          </h1>
          <p className="font-mono text-xs text-[#919191] uppercase tracking-wider mt-1">
            {scan.repoOwner}/{scan.repoName} — {new Date(scan.createdAt).toLocaleDateString("en-CA")}
          </p>
        </div>
      </div>
      <hr className="editorial-rule-thick mb-8" aria-hidden="true" />

      {/* Disclaimer */}
      <div
        className="py-5 mb-8 border-t border-b border-[#ffc53d33]"
        role="region"
        aria-label="Legal disclaimer"
      >
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-[#ffc53d] mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <p className="text-sm text-[#b3b3b3] font-body leading-relaxed">
            {report.disclaimer}
          </p>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 mb-8 border-t border-[#1a1a1a]">
        <div className="py-8 md:pr-8">
          <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">
            Score
          </div>
          <div
            className="font-editorial text-5xl italic pr-2"
            style={{
              color: report.score >= 90 ? "#4ade80" : report.score >= 70 ? "#ffc53d" : "#ff3b5c",
            }}
          >
            {report.score}
          </div>
          <div className="font-mono text-[11px] text-[#919191] mt-1">out of 100</div>
        </div>

        <div className="py-8 md:px-8 border-l border-[#1a1a1a]">
          <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">
            Violations
          </div>
          <div className="font-editorial text-5xl italic pr-2">{report.totalViolations}</div>
        </div>

        <div className="py-8 md:px-8 border-l border-[#1a1a1a]">
          <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">
            AODA Relevant
          </div>
          <div className="font-editorial text-5xl italic text-[#00f0ff] pr-2">
            {report.aodaRelevantCount}
          </div>
        </div>

        <div className="py-8 md:pl-8 border-l border-[#1a1a1a]">
          <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">
            Fixes Applied
          </div>
          <div className="font-editorial text-5xl italic text-[#4ade80] pr-2">
            {acceptedFixes.length}
          </div>
        </div>
      </div>

      {/* Severity breakdown */}
      <div className="mb-8">
        <div className="font-mono text-xs uppercase tracking-widest text-[#919191] mb-4">Severity Breakdown</div>
        <hr className="editorial-rule-full mb-6" aria-hidden="true" />
        <div className="space-y-4">
          {(["critical", "serious", "moderate", "minor"] as const).map((level) => {
            const count = report.bySeverity[level];
            const maxCount = Math.max(...Object.values(report.bySeverity), 1);
            const pct = (count / maxCount) * 100;
            const colors: Record<string, string> = {
              critical: "#ff3b5c",
              serious: "#ff8a3d",
              moderate: "#ffc53d",
              minor: "#4ade80",
            };

            return (
              <div key={level} className="flex items-center gap-6">
                <div className="w-24 shrink-0 font-mono text-xs uppercase tracking-wider" style={{ color: colors[level] }}>
                  {level}
                </div>
                <div className="flex-1 h-1 bg-[#1a1a1a] overflow-hidden" role="progressbar" aria-valuenow={count} aria-valuemin={0} aria-valuemax={maxCount} aria-label={`${level}: ${count} violations`}>
                  <div
                    className="h-full transition-all duration-1000"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: colors[level],
                    }}
                  />
                </div>
                <div className="w-10 text-right font-mono text-sm">{count}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AODA section */}
      {aodaViolations.length > 0 && (
        <div className="mb-8">
          <div className="font-mono text-xs uppercase tracking-widest text-[#919191] mb-2">AODA / IASR</div>
          <h2 className="font-editorial text-xl italic mb-2 pr-2">
            Information and Communications Standard
          </h2>
          <p className="text-sm text-[#b3b3b3] font-body mb-6">
            The following violations are relevant to Ontario&apos;s Integrated Accessibility Standards
            Regulation (IASR), which requires conformance to WCAG 2.0 Level AA.
          </p>
          <hr className="editorial-rule-full mb-4" aria-hidden="true" />
          <div role="list" aria-label="AODA-relevant violations">
            {aodaViolations.map((v) => (
              <div
                key={v.id}
                className="flex items-start gap-3 py-4 border-t border-[#1a1a1a]"
                role="listitem"
              >
                <SeverityBadge impact={v.impact} />
                <div className="flex-1">
                  <div className="text-sm font-body">{v.description}</div>
                  <div className="text-xs text-[#919191] font-mono mt-1">
                    {v.ruleId} {v.wcagCriteria && `· WCAG ${v.wcagCriteria}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All violations table */}
      <div className="mb-8">
        <div className="font-mono text-xs uppercase tracking-widest text-[#919191] mb-4">All Violations</div>
        <hr className="editorial-rule-full mb-0" aria-hidden="true" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Complete violations list">
            <thead>
              <tr className="border-b border-[#1a1a1a]">
                <th className="text-left py-3 px-2 font-mono text-[11px] uppercase tracking-wider text-[#919191] font-normal" scope="col">Severity</th>
                <th className="text-left py-3 px-2 font-mono text-[11px] uppercase tracking-wider text-[#919191] font-normal" scope="col">Rule</th>
                <th className="text-left py-3 px-2 font-mono text-[11px] uppercase tracking-wider text-[#919191] font-normal" scope="col">Description</th>
                <th className="text-left py-3 px-2 font-mono text-[11px] uppercase tracking-wider text-[#919191] font-normal" scope="col">WCAG</th>
                <th className="text-left py-3 px-2 font-mono text-[11px] uppercase tracking-wider text-[#919191] font-normal" scope="col">AODA</th>
                <th className="text-left py-3 px-2 font-mono text-[11px] uppercase tracking-wider text-[#919191] font-normal" scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {scan.violations.map((v) => {
                const fix = scan.fixes.find((f) => f.violationId === v.id);
                return (
                  <tr key={v.id} className="border-b border-[#0f0f0f] hover:bg-[#0a0a0a]">
                    <td className="py-3 px-2"><SeverityBadge impact={v.impact} /></td>
                    <td className="py-3 px-2 font-mono text-xs text-[#b3b3b3]">{v.ruleId}</td>
                    <td className="py-3 px-2 text-[#b3b3b3] font-body max-w-md"><span className="line-clamp-2">{v.description}</span></td>
                    <td className="py-3 px-2 font-mono text-xs text-[#919191]">{v.wcagCriteria || "—"}</td>
                    <td className="py-3 px-2">
                      {v.aodaRelevant ? (
                        <span className="text-[#00f0ff] font-mono text-xs">Yes</span>
                      ) : (
                        <span className="text-[#919191] font-mono text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-2 font-mono text-xs">
                      {fix ? (
                        <span style={{ color: fix.status === "accepted" ? "#4ade80" : fix.status === "rejected" ? "#ff3b5c" : "#ffc53d" }}>
                          {fix.status}
                        </span>
                      ) : (
                        <span className="text-[#919191]">unfixed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Score improvement */}
      {scan.scoreAfter !== null && scan.score !== null && (
        <div className="mb-8">
          <div className="font-mono text-xs uppercase tracking-widest text-[#919191] mb-4">Score Improvement</div>
          <hr className="editorial-rule-full mb-6" aria-hidden="true" />
          <div className="flex items-center gap-12 justify-center py-8">
            <div className="text-center">
              <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Before</div>
              <div className="font-editorial text-5xl italic pr-2" style={{
                color: scan.score >= 90 ? "#4ade80" : scan.score >= 70 ? "#ffc53d" : "#ff3b5c"
              }}>
                {scan.score}
              </div>
            </div>
            <svg className="w-6 h-6 text-[#919191]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
            <div className="text-center">
              <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">After</div>
              <div className="font-editorial text-5xl italic text-[#4ade80] pr-2">{scan.scoreAfter}</div>
            </div>
            <div className="text-center border-l border-[#1a1a1a] pl-12">
              <div className="font-mono text-[11px] uppercase tracking-widest text-[#919191] mb-2">Improvement</div>
              <div className="font-editorial text-5xl italic text-[#00f0ff] pr-2">
                +{scan.scoreAfter - scan.score}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
