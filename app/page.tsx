"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function LandingPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="relative min-h-screen">
      {/* Grain overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-50 opacity-[0.03]"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Thin top accent line */}
      <div className="fixed top-0 left-0 right-0 h-[2px] bg-linear-to-r from-transparent via-[#00f0ff] to-transparent z-40 opacity-60" aria-hidden="true" />

      {/* Navigation — minimal, editorial */}
      <nav
        className="relative z-30 flex items-center justify-between px-8 md:px-16 py-8"
        aria-label="Main navigation"
      >
        <div className="flex items-baseline gap-2">
          <span className="font-editorial text-2xl tracking-tight italic">Apex</span>
          <span className="editorial-label">v1</span>
        </div>
        <div className="flex items-center gap-8">
          <Link
            href="/auth/signin"
            className="editorial-label hover:text-[#f5f5f5] transition-colors min-h-[44px] flex items-center"
          >
            Sign In
          </Link>
          <Link
            href="/auth/signin"
            className="text-sm font-medium tracking-wide text-[#050505] bg-[#f5f5f5] px-5 py-2.5 hover:bg-[#00f0ff] transition-colors min-h-[44px] flex items-center"
          >
            Start Scanning
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <main id="main-content" tabIndex={-1} className="relative z-10">
        <section className="px-8 md:px-16 pt-12 pb-0">
          {/* Editorial top rule */}
          <hr className="editorial-rule-thick mb-8" aria-hidden="true" />

          <div className="grid grid-cols-1 md:grid-cols-12 gap-0">
            {/* Left column — big issue number */}
            <div className="md:col-span-2 mb-6 md:mb-0">
              <div
                className={`editorial-number select-none pr-2 ${mounted ? "slide-up" : "opacity-0"}`}
                aria-hidden="true"
              >
                01
              </div>
              <div className="editorial-label mt-2">Issue / 2026</div>
            </div>

            {/* Main headline column */}
            <div className="md:col-span-7 md:border-l md:border-[#1a1a1a] md:pl-10">
              <h1
                className={`font-editorial text-[clamp(3rem,8vw,7.5rem)] leading-[0.9] tracking-tight mb-8 pr-2 ${mounted ? "slide-up" : "opacity-0"}`}
                style={{ animationDelay: "0.1s" }}
              >
                Your code
                <br />
                <span className="italic text-[#00f0ff]">excludes</span>
                <br />
                people.
              </h1>
              <p
                className={`font-body text-lg md:text-xl text-[#b3b3b3] leading-relaxed max-w-lg mb-10 ${mounted ? "slide-up" : "opacity-0"}`}
                style={{ animationDelay: "0.25s" }}
              >
                Apex finds the accessibility violations buried in your codebase,
                writes the fix, and opens the PR — so your product works for everyone
                who tries to use it.
              </p>
              <div
                className={`flex items-center gap-6 ${mounted ? "slide-up" : "opacity-0"}`}
                style={{ animationDelay: "0.4s" }}
              >
                <Link
                  href="/auth/signin"
                  className="group inline-flex items-center gap-3 text-base font-medium min-h-[44px]"
                >
                  <span className="w-12 h-12 rounded-full bg-[#00f0ff] flex items-center justify-center group-hover:scale-110 transition-transform" aria-hidden="true">
                    <svg className="w-5 h-5 text-[#050505]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                  </span>
                  <span className="border-b border-[#f5f5f5] pb-0.5 group-hover:border-[#00f0ff] group-hover:text-[#00f0ff] transition-colors">
                    Connect with GitHub
                  </span>
                </Link>
              </div>
            </div>

            {/* Right sidebar — vertical data strip */}
            <div className="hidden md:flex md:col-span-3 md:border-l md:border-[#1a1a1a] md:pl-8 flex-col justify-between">
              <div
                className={`${mounted ? "fade-in" : "opacity-0"}`}
                style={{ animationDelay: "0.5s" }}
              >
                <div className="editorial-label mb-3">Standard</div>
                <div className="font-editorial text-3xl italic mb-1">WCAG 2.0</div>
                <div className="text-sm text-[#b3b3b3]">Level AA</div>
              </div>
              <div
                className={`mt-12 ${mounted ? "fade-in" : "opacity-0"}`}
                style={{ animationDelay: "0.65s" }}
              >
                <div className="editorial-label mb-3">Jurisdiction</div>
                <div className="font-editorial text-3xl italic mb-1">Ontario</div>
                <div className="text-sm text-[#b3b3b3]">AODA / IASR</div>
              </div>
              <div
                className={`mt-12 ${mounted ? "fade-in" : "opacity-0"}`}
                style={{ animationDelay: "0.8s" }}
              >
                <div className="editorial-label mb-3">Payment Rail</div>
                <div className="font-editorial text-3xl italic mb-1">XRPL</div>
                <div className="text-sm text-[#b3b3b3]">Micropayments</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── EDITORIAL DIVIDER — the pull quote ── */}
        <section className="px-8 md:px-16 py-24 md:py-32" aria-labelledby="pullquote">
          <hr className="editorial-rule-full mb-16" aria-hidden="true" />
          <div className="grid grid-cols-1 md:grid-cols-12 gap-0">
            <div className="md:col-span-2">
              <div className="editorial-label">The Problem</div>
            </div>
            <blockquote className="md:col-span-8" id="pullquote">
              <p className="font-editorial text-[clamp(1.5rem,4vw,3.5rem)] leading-[1.15] italic text-[#b3b3b3] pr-2">
                &ldquo;Automated testing with axe-core catches roughly{" "}
                <span className="text-[#f5f5f5] not-italic">57%</span> of accessibility
                failures by issue volume. The other{" "}
                <span className="text-[#ff8a3d] not-italic">43%</span> ship to production, where they become
                someone else&rsquo;s{" "}
                <span className="text-[#ff3b5c] not-italic">barrier</span>.&rdquo;
              </p>
              <cite className="block mt-6 not-italic">
                <a
                  href="https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-[#919191] hover:text-[#00f0ff] transition-colors underline underline-offset-4 decoration-[#1a1a1a] hover:decoration-[#00f0ff]"
                >
                  Source: Deque Systems — Automated Testing Identifies 57% of Digital Accessibility Issues
                </a>
              </cite>
            </blockquote>
          </div>
        </section>

        {/* ── HOW IT WORKS — editorial numbered sections ── */}
        <section className="px-8 md:px-16 pb-24" aria-labelledby="process-heading">
          <hr className="editorial-rule-thick mb-6" aria-hidden="true" />
          <div className="flex items-baseline justify-between mb-16">
            <h2 id="process-heading" className="editorial-label">The Process</h2>
            <span className="editorial-label">Four stages</span>
          </div>

          <div className="space-y-0">
            {[
              {
                num: "01",
                title: "Scan",
                subtitle: "Browser-based analysis",
                body: "Apex clones your repository into an isolated Docker sandbox, starts your dev server, and unleashes Playwright with axe-core against every rendered page. Full screenshots captured.",
                detail: "Playwright + axe-core",
              },
              {
                num: "02",
                title: "Diagnose",
                subtitle: "Violation mapping",
                body: "Every violation is scored by severity — critical, serious, moderate, minor — and mapped to WCAG success criteria. Violations relevant to Ontario's AODA are flagged for prioritization.",
                detail: "WCAG 2.0 AA mapped",
              },
              {
                num: "03",
                title: "Fix",
                subtitle: "AI-powered remediation",
                body: "OpenCode agent reads your entire codebase inside the sandbox. It understands your framework, your component patterns, your naming conventions — then writes fixes that belong in your code.",
                detail: "OpenCode in Docker",
              },
              {
                num: "04",
                title: "Ship",
                subtitle: "Pull request with evidence",
                body: "Review each fix in a side-by-side diff. Accept what works, reject what doesn't. Apex creates the branch, commits, and opens a PR with before/after screenshots and a compliance summary.",
                detail: "Human-in-the-loop",
              },
            ].map((step, i) => (
              <article key={step.num} className="grid grid-cols-1 md:grid-cols-12 gap-0 border-t border-[#1a1a1a] py-12 md:py-16 group">
                {/* Number */}
                <div className="md:col-span-1">
                  <span
                    className="font-editorial text-5xl md:text-6xl text-[#3d3d3d] group-hover:text-[#00f0ff] transition-colors duration-500 select-none"
                    aria-hidden="true"
                  >
                    {step.num}
                  </span>
                </div>

                {/* Title */}
                <div className="md:col-span-3 flex flex-col justify-start mt-4 md:mt-0">
                  <h3 className="font-editorial text-4xl md:text-5xl italic group-hover:text-[#00f0ff] transition-colors duration-500">
                    {step.title}
                  </h3>
                  <span className="editorial-label mt-2">{step.subtitle}</span>
                </div>

                {/* Body */}
                <div className="md:col-span-5 md:border-l md:border-[#1a1a1a] md:pl-10 mt-6 md:mt-0">
                  <p className="font-body text-[#b3b3b3] leading-relaxed text-base">
                    {step.body}
                  </p>
                </div>

                {/* Detail label */}
                <div className="md:col-span-3 md:border-l md:border-[#1a1a1a] md:pl-8 mt-6 md:mt-0 flex items-start">
                  <span className="font-mono text-xs text-[#919191] tracking-wider uppercase bg-[#0a0a0a] px-3 py-1.5 border border-[#1a1a1a]">
                    {step.detail}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── SEVERITY — editorial data visualization ── */}
        <section className="px-8 md:px-16 pb-24 md:pb-32" aria-labelledby="severity-heading">
          <hr className="editorial-rule-thick mb-6" aria-hidden="true" />
          <div className="flex items-baseline justify-between mb-16">
            <h2 id="severity-heading" className="editorial-label">Severity Index</h2>
            <span className="editorial-label">Weighted scoring</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-0" role="list" aria-label="Severity levels">
            {[
              { label: "Critical", color: "#ff3b5c", weight: 10, desc: "Blocks access entirely" },
              { label: "Serious", color: "#ff8a3d", weight: 7, desc: "Creates significant barriers" },
              { label: "Moderate", color: "#ffc53d", weight: 4, desc: "Causes difficulty or confusion" },
              { label: "Minor", color: "#4ade80", weight: 1, desc: "Best practice improvement" },
            ].map((level, i) => (
              <div
                key={level.label}
                className={`py-10 md:py-16 ${i > 0 ? "border-l border-[#1a1a1a]" : ""} ${i < 2 ? "border-b md:border-b-0 border-[#1a1a1a]" : ""} px-6 md:px-8 group`}
                role="listitem"
              >
                <div
                  className="font-editorial text-[clamp(4rem,8vw,7rem)] leading-none italic transition-colors duration-500 pr-2"
                  style={{ color: "#3d3d3d" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = level.color)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#3d3d3d")}
                  aria-hidden="true"
                >
                  {level.weight}
                </div>
                <div className="mt-4">
                  <div
                    className="w-full h-[2px] mb-4"
                    style={{ backgroundColor: level.color, opacity: 0.4 }}
                    aria-hidden="true"
                  />
                  <div className="font-medium text-sm" style={{ color: level.color }}>
                    {level.label}
                  </div>
                  <div className="text-xs text-[#919191] font-body mt-1">
                    {level.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── PAYMENT — editorial feature strip ── */}
        <section className="px-8 md:px-16 pb-24 md:pb-32" aria-labelledby="payment-heading">
          <hr className="editorial-rule-full mb-6" aria-hidden="true" />
          <div className="flex items-baseline justify-between mb-6">
            <h2 id="payment-heading" className="editorial-label">Payment</h2>
            <span className="editorial-label">XRPL Testnet</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-0 border-t border-[#1a1a1a]">
            <div className="md:col-span-5 py-12 md:py-16 md:pr-12">
              <h3 className="font-editorial text-4xl md:text-5xl italic leading-tight mb-6">
                No subscriptions.<br />
                <span className="text-[#00f0ff]">Pay per scan.</span>
              </h3>
              <p className="font-body text-[#b3b3b3] leading-relaxed text-base">
                XRP Ledger micropayments mean you only pay for what you use —
                no monthly fees, no credit cards, no vendor lock-in. Transaction
                costs are fractions of a cent.
              </p>
            </div>

            <div className="md:col-span-7 md:border-l md:border-[#1a1a1a] grid grid-cols-3 divide-x divide-[#1a1a1a]">
              {[
                { amount: "1", unit: "XRP", label: "Scan", desc: "Full accessibility audit" },
                { amount: "0.5", unit: "XRP", label: "Report", desc: "AODA compliance report" },
                { amount: "2", unit: "XRP", label: "PR", desc: "Remediation + pull request" },
              ].map((tier) => (
                <div key={tier.label} className="py-12 md:py-16 px-6 md:px-8 flex flex-col justify-between">
                  <div>
                    <div className="editorial-label mb-4">{tier.label}</div>
                    <div className="font-editorial text-4xl md:text-5xl italic text-[#f5f5f5]">
                      {tier.amount}
                    </div>
                    <div className="font-mono text-xs text-[#919191] mt-1">{tier.unit}</div>
                  </div>
                  <div className="font-body text-xs text-[#919191] mt-6">{tier.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── WHY IT MATTERS — Black-owned businesses and compliance barriers ── */}
        <section className="px-8 md:px-16 pb-24 md:pb-32" aria-labelledby="why-heading">
          <hr className="editorial-rule-full mb-6" aria-hidden="true" />
          <div className="flex items-baseline justify-between mb-6">
            <h2 id="why-heading" className="editorial-label">Why It Matters</h2>
            <span className="editorial-label">Canada</span>
          </div>

          {/* Cost comparison banner */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-[#1a1a1a] mb-0">
            <div className="py-10 md:py-14 px-6 md:px-8">
              <div className="editorial-label mb-3">Traditional Audit</div>
              <div className="font-editorial text-4xl md:text-5xl italic text-[#ff3b5c] pr-2">$2,500–$15K</div>
              <div className="font-mono text-xs text-[#919191] mt-2">CAD per assessment</div>
              <a
                href="https://accessibilitypartners.ca/accessibility-audit-cost-in-canada/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-3 font-mono text-[11px] text-[#919191] hover:text-[#00f0ff] transition-colors underline underline-offset-4 decoration-[#1a1a1a] hover:decoration-[#00f0ff]"
              >
                Accessibility Partners Canada
              </a>
            </div>
            <div className="py-10 md:py-14 px-6 md:px-8 border-l border-[#1a1a1a]">
              <div className="editorial-label mb-3">Apex Scan</div>
              <div className="font-editorial text-4xl md:text-5xl italic text-[#4ade80] pr-2">1 XRP</div>
              <div className="font-mono text-xs text-[#919191] mt-2">~$1.50 CAD per scan</div>
            </div>
            <div className="py-10 md:py-14 px-6 md:px-8 border-l border-[#1a1a1a]">
              <div className="editorial-label mb-3">Non-Compliance</div>
              <div className="font-editorial text-4xl md:text-5xl italic text-[#ff8a3d] pr-2">$100K</div>
              <div className="font-mono text-xs text-[#919191] mt-2">per day — AODA penalties</div>
              <a
                href="https://accessibilitypartners.ca/legal-obligations-and-fines-for-non-compliance-with-aoda/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-3 font-mono text-[11px] text-[#919191] hover:text-[#00f0ff] transition-colors underline underline-offset-4 decoration-[#1a1a1a] hover:decoration-[#00f0ff]"
              >
                Accessibility Partners Canada
              </a>
            </div>
          </div>

          {/* Two-column: narrative + stats */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-0 border-t border-[#1a1a1a]">
            <div className="md:col-span-5 py-12 md:py-16 md:pr-12">
              <h3 className="font-editorial text-3xl md:text-4xl italic leading-tight mb-6 pr-2">
                Compliance costs money.<br />
                <span className="text-[#00f0ff]">Most don&rsquo;t have it.</span>
              </h3>
              <p className="font-body text-[#b3b3b3] leading-relaxed text-base mb-4">
                A single WCAG accessibility audit in Canada costs $2,500 to $15,000.
                Black-owned businesses — 63% of which are sole proprietorships with no
                employees — can&rsquo;t absorb that cost. Meanwhile, AODA non-compliance
                carries fines of up to $100,000 per day.
              </p>
              <p className="font-body text-[#b3b3b3] leading-relaxed text-base">
                Apex replaces the $2,500 audit with a 1 XRP scan. No bank account, no
                credit card, no subscription — just XRPL micropayments that make AODA
                compliance accessible to founders who have been locked out of the
                resources they need.
              </p>
            </div>

            <div className="md:col-span-7 md:border-l md:border-[#1a1a1a]">
              {[
                {
                  stat: "76%",
                  body: "of Black entrepreneurs said their race made it harder to succeed in Canada, and only 19% said they trust banks to do what is right for them.",
                  source: "African Canadian Senate Group / Abacus Data, 2021",
                  href: "https://abacusdata.ca/black-entrepreneurs-canada-inclusive-entrepreneurship/",
                },
                {
                  stat: "63%",
                  body: "of Black-owned businesses in Canada are sole proprietorships — meaning virtually no staff, no compliance team, and no legal resources.",
                  source: "Statistics Canada, 2023",
                  href: "https://www150.statcan.gc.ca/n1/pub/11-627-m/11-627-m2023052-eng.htm",
                },
                {
                  stat: "26pt",
                  body: "gap — Black households have a homeownership rate over 26 percentage points below the national average, limiting collateral for startup and growth funding.",
                  source: "CMHC (Canada Mortgage and Housing Corporation)",
                  href: "https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/housing-research/research-reports/housing-finance/research-insight-homeownership-rate-varies-significantly-race",
                },
                {
                  stat: "75%",
                  body: "of Black entrepreneurs say finding $10,000 to support their business would be difficult — a traditional accessibility audit alone can exceed that.",
                  source: "Abacus Data / African Canadian Senate Group, 2021",
                  href: "https://abacusdata.ca/black-entrepreneurs-canada-inclusive-entrepreneurship/",
                },
                {
                  stat: "~80%",
                  body: "of Black entrepreneurs report difficulty securing capital. Banks are less likely to approve loans for Black-owned firms compared to similar white-owned firms.",
                  source: "Bain & Company / BlackNorth Initiative, 2023",
                  href: "https://www.bain.com/insights/understanding-and-removing-barriers-to-black-entrepreneurship-in-canada/",
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className={`py-8 md:py-10 px-6 md:px-10 ${i > 0 ? "border-t border-[#1a1a1a]" : ""} group`}
                >
                  <div className="flex items-start gap-6">
                    <div className="font-editorial text-4xl md:text-5xl italic text-[#00f0ff] shrink-0 w-20 md:w-24 pr-2">
                      {item.stat}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-[#b3b3b3] text-sm leading-relaxed">
                        {item.body}
                      </p>
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block mt-2 font-mono text-[11px] text-[#919191] hover:text-[#00f0ff] transition-colors underline underline-offset-4 decoration-[#1a1a1a] hover:decoration-[#00f0ff]"
                      >
                        {item.source}
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA — dramatic editorial close ── */}
        <section className="px-8 md:px-16 pb-24 md:pb-32" aria-labelledby="cta-heading">
          <hr className="editorial-rule-thick mb-16" aria-hidden="true" />

          <div className="grid grid-cols-1 md:grid-cols-12">
            <div className="md:col-span-8">
              <h2 id="cta-heading" className="font-editorial text-[clamp(2.5rem,6vw,6rem)] leading-[0.9] italic mb-8 pr-2">
                Ship accessible<br />
                software, or don&rsquo;t<br />
                ship at <span className="not-italic text-[#00f0ff]">all</span>.
              </h2>
            </div>
            <div className="md:col-span-4 flex flex-col justify-end md:pl-8">
              <Link
                href="/auth/signin"
                className="group flex items-center justify-between w-full border-t border-b border-[#1a1a1a] py-5 hover:border-[#00f0ff] transition-colors min-h-[44px]"
              >
                <span className="font-body text-base group-hover:text-[#00f0ff] transition-colors">
                  Connect your repository
                </span>
                <svg
                  className="w-5 h-5 text-[#919191] group-hover:text-[#00f0ff] group-hover:translate-x-1 transition-all"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
              <div className="editorial-label mt-6 text-[#919191]">
                GitHub OAuth &middot; repo scope &middot; Docker isolation
              </div>
            </div>
          </div>
        </section>

        {/* ── FOOTER — editorial colophon ── */}
        <footer className="px-8 md:px-16 pb-12 pt-8">
          <hr className="editorial-rule-thick mb-10" aria-hidden="true" />
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
            <div className="md:col-span-3">
              <span className="font-editorial text-3xl italic text-[#f5f5f5]">Apex</span>
              <p className="font-body text-sm text-[#b3b3b3] leading-relaxed mt-4">
                AI-powered accessibility remediation for startups and small businesses.
              </p>
            </div>
            <div className="md:col-span-4">
              <div className="text-xs font-semibold uppercase tracking-widest text-[#b3b3b3] mb-4">
                Legal
              </div>
              <p className="font-body text-sm text-[#919191] leading-relaxed">
                Apex provides automated accessibility scanning and AI-generated fix
                suggestions. It does not constitute legal compliance certification
                under AODA, IASR, or any other accessibility regulation.
                Human review is always required.
              </p>
            </div>
            <div className="md:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-widest text-[#b3b3b3] mb-4">
                Stack
              </div>
              <ul className="space-y-2 text-sm text-[#b3b3b3] font-mono">
                <li>Next.js 15</li>
                <li>Playwright</li>
                <li>axe-core</li>
                <li>OpenCode</li>
                <li>XRPL</li>
                <li>Prisma</li>
              </ul>
            </div>
            <div className="md:col-span-3 md:text-right">
              <div className="text-xs font-semibold uppercase tracking-widest text-[#b3b3b3] mb-4">
                Compliance Context
              </div>
              <ul className="space-y-2 text-sm text-[#b3b3b3] font-mono md:text-right">
                <li>WCAG 2.0 Level AA</li>
                <li>AODA / IASR</li>
                <li>Ontario, Canada</li>
              </ul>
            </div>
          </div>
          <div className="mt-10 pt-6 border-t border-[#1a1a1a] flex flex-col sm:flex-row items-center justify-between gap-2">
            <span className="font-mono text-xs text-[#919191]">
              &copy; {new Date().getFullYear()} Apex
            </span>
            <span className="font-mono text-xs text-[#919191]">
              All fixes are suggestions, not guarantees.
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
