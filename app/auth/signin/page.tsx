"use client";

import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center relative">
      <div
        className="fixed inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 40% 40% at 50% 50%, rgba(0,240,255,0.04) 0%, transparent 70%)",
        }}
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg px-8"
      >
        <div className="mb-12">
          <span className="font-editorial text-2xl italic text-[#f5f5f5]">Apex</span>
        </div>

        <hr className="editorial-rule-thick mb-10" aria-hidden="true" />

        <h1 className="font-editorial text-[clamp(2.5rem,5vw,4rem)] leading-[0.95] italic mb-4">
          Sign in
        </h1>
        <p className="font-body text-base text-[#b3b3b3] mb-10 max-w-sm">
          Connect your GitHub account to scan repositories for accessibility violations.
        </p>

        <button
          onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
          className="group w-full flex items-center justify-between border-t border-b border-[#1a1a1a] py-5 hover:border-[#00f0ff] transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
        >
          <span className="flex items-center gap-4">
            <svg
              className="w-5 h-5 text-[#f5f5f5]"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            <span className="font-body text-base text-[#f5f5f5] group-hover:text-[#00f0ff] transition-colors">
              Continue with GitHub
            </span>
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
        </button>

        <div className="mt-8">
          <div className="font-mono text-xs uppercase tracking-widest text-[#919191] mb-3">
            Permissions
          </div>
          <p className="font-body text-sm text-[#919191] leading-relaxed">
            We request <span className="text-[#b3b3b3] font-mono">repo</span> scope to
            clone repositories, scan for accessibility issues, and create pull
            requests with fixes. Your code is processed in isolated Docker containers
            and never stored permanently.
          </p>
        </div>
      </main>
    </div>
  );
}
