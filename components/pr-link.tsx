"use client";

export function PrLink({ href, prNumber }: { href: string; prNumber: number }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="font-mono text-xs text-[#00f0ff] hover:underline"
      aria-label={`View pull request #${prNumber}`}
    >
      PR #{prNumber}
    </a>
  );
}
