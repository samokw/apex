import { getApexSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await getApexSession();
  if (!session) redirect("/auth/signin");

  const scans = await prisma.scan.findMany({
    where: { userId: session.dbUserId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { violations: true, fixes: true } },
      pullRequest: true,
    },
  });

  const statusConfig: Record<string, { color: string; label: string }> = {
    pending: { color: "#919191", label: "Pending" },
    cloning: { color: "#ffc53d", label: "Cloning" },
    scanning: { color: "#00f0ff", label: "Scanning" },
    fixing: { color: "#ff8a3d", label: "Fixing" },
    complete: { color: "#4ade80", label: "Complete" },
    failed: { color: "#ff3b5c", label: "Failed" },
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="font-editorial text-[clamp(2rem,4vw,3.5rem)] italic leading-tight pr-2">
          Dashboard
        </h1>
        <Link
          href="/dashboard/repos"
          className="group flex items-center gap-3 font-mono text-xs uppercase tracking-wider text-[#919191] hover:text-[#00f0ff] transition-colors min-h-[44px]"
        >
          <span>New Scan</span>
          <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
          </svg>
        </Link>
      </div>
      <hr className="editorial-rule-thick mb-8" aria-hidden="true" />

      <div className="font-mono text-xs uppercase tracking-widest text-[#919191] mb-6">
        Scan History
      </div>

      {scans.length === 0 ? (
        <div className="py-20 text-center border-t border-[#1a1a1a]">
          <h2 className="font-editorial text-2xl italic mb-3 pr-2">No scans yet</h2>
          <p className="font-body text-sm text-[#b3b3b3] mb-8 max-w-sm mx-auto">
            Select a repository to run your first accessibility scan.
          </p>
          <Link
            href="/dashboard/repos"
            className="group inline-flex items-center gap-3 font-body text-base hover:text-[#00f0ff] transition-colors min-h-[44px] border-b border-[#1a1a1a] pb-1 hover:border-[#00f0ff]"
          >
            Browse Repositories
            <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      ) : (
        <div role="list" aria-label="Scan history">
          {scans.map((scan) => {
            const st = statusConfig[scan.status] ?? statusConfig.pending;
            return (
              <div
                key={scan.id}
                className="group block border-t border-[#1a1a1a] hover:border-[#00f0ff] transition-colors"
                role="listitem"
              >
                <div className="grid grid-cols-12 gap-4 py-6 items-center">
                  <div className="col-span-5 md:col-span-4">
                    <Link href={`/dashboard/scan/${scan.id}`}>
                      <h3 className="font-editorial text-lg italic group-hover:text-[#00f0ff] transition-colors truncate pr-2">
                        {scan.repoOwner}/{scan.repoName}
                      </h3>
                    </Link>
                    <p className="text-xs text-[#919191] font-mono mt-1">
                      {new Date(scan.createdAt).toLocaleDateString("en-CA", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>

                  <div className="col-span-2 md:col-span-2 text-center">
                    {scan.score !== null ? (
                      <div>
                        <div className="font-editorial text-2xl italic pr-2" style={{
                          color: (scan.score ?? 0) >= 90 ? "#4ade80" : (scan.score ?? 0) >= 70 ? "#ffc53d" : "#ff3b5c"
                        }}>
                          {scan.score}
                        </div>
                        <div className="font-mono text-[11px] text-[#919191] uppercase tracking-wider">Score</div>
                      </div>
                    ) : (
                      <span className="font-mono text-xs text-[#919191]">&mdash;</span>
                    )}
                  </div>

                  <div className="col-span-1 text-center">
                    <div className="font-mono text-base">{scan._count.violations}</div>
                    <div className="font-mono text-[11px] text-[#919191] uppercase tracking-wider">Issues</div>
                  </div>

                  <div className="col-span-1 text-center">
                    <div className="font-mono text-base">{scan._count.fixes}</div>
                    <div className="font-mono text-[11px] text-[#919191] uppercase tracking-wider">Fixes</div>
                  </div>

                  <div className="col-span-3 md:col-span-4 flex items-center justify-end gap-4">
                    <span
                      className="font-mono text-xs uppercase tracking-wider"
                      style={{ color: st.color }}
                    >
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full mr-2"
                        style={{ backgroundColor: st.color }}
                        aria-hidden="true"
                      />
                      {st.label}
                    </span>

                    {scan.pullRequest && (
                      <a
                        href={scan.pullRequest.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-[#00f0ff] hover:underline"
                        aria-label={`View pull request #${scan.pullRequest.prNumber}`}
                      >
                        PR #{scan.pullRequest.prNumber}
                      </a>
                    )}

                    <Link
                      href={`/dashboard/scan/${scan.id}`}
                      className="inline-flex items-center text-[#919191] hover:text-[#00f0ff] transition-colors"
                      aria-label={`View details for ${scan.repoOwner}/${scan.repoName}`}
                    >
                      <svg className="w-4 h-4 group-hover:translate-x-1 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
          <hr className="border-[#1a1a1a]" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
