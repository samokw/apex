"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

interface NavbarProps {
  username?: string;
  avatarUrl?: string;
}

export function Navbar({ username, avatarUrl }: NavbarProps) {
  const pathname = usePathname();

  const links = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/dashboard/repos", label: "Repos" },
    { href: "/payment", label: "Wallet" },
  ];

  return (
    <nav
      className="sticky top-0 z-40 border-b border-[#1a1a1a] bg-[#050505]/90 backdrop-blur-xl"
      aria-label="Main navigation"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-16 flex items-center justify-between h-16">
        <div className="flex items-center gap-10">
          <Link href="/dashboard" className="flex items-baseline gap-2">
            <span className="font-editorial text-xl italic text-[#f5f5f5]">Apex</span>
            <span className="font-mono text-[11px] uppercase tracking-widest text-[#919191]">v1</span>
          </Link>

          <div className="hidden md:flex items-center gap-0 border-l border-[#1a1a1a] pl-6">
            {links.map((link, i) => {
              const active = pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-4 py-2 text-sm font-mono uppercase tracking-wider transition-colors min-h-[44px] flex items-center ${
                    active
                      ? "text-[#00f0ff]"
                      : "text-[#919191] hover:text-[#f5f5f5]"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt={`${username}'s avatar`}
              className="w-7 h-7 rounded-full border border-[#1a1a1a] grayscale"
            />
          )}
          <span className="text-xs text-[#b3b3b3] hidden md:block font-mono">
            {username}
          </span>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="text-xs font-mono uppercase tracking-wider text-[#919191] hover:text-[#ff3b5c] transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00f0ff] rounded-lg border-l border-[#1a1a1a] pl-4"
            aria-label="Sign out"
          >
            Exit
          </button>
        </div>
      </div>
    </nav>
  );
}
