const SEVERITY_CONFIG: Record<
  string,
  { color: string; bg: string; glow: string; label: string }
> = {
  critical: {
    color: "#ff3b5c",
    bg: "rgba(255,59,92,0.1)",
    glow: "rgba(255,59,92,0.3)",
    label: "Critical",
  },
  serious: {
    color: "#ff8a3d",
    bg: "rgba(255,138,61,0.1)",
    glow: "rgba(255,138,61,0.3)",
    label: "Serious",
  },
  moderate: {
    color: "#ffc53d",
    bg: "rgba(255,197,61,0.1)",
    glow: "rgba(255,197,61,0.3)",
    label: "Moderate",
  },
  minor: {
    color: "#4ade80",
    bg: "rgba(74,222,128,0.1)",
    glow: "rgba(74,222,128,0.3)",
    label: "Minor",
  },
};

export function SeverityBadge({ impact }: { impact: string }) {
  const config = SEVERITY_CONFIG[impact] ?? SEVERITY_CONFIG.minor;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold font-mono uppercase tracking-wider"
      style={{
        color: config.color,
        backgroundColor: config.bg,
        boxShadow: `0 0 8px ${config.glow}`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: config.color }}
        aria-hidden="true"
      />
      {config.label}
    </span>
  );
}

export function ScoreGauge({ score, label }: { score: number; label?: string }) {
  const getColor = (s: number) => {
    if (s >= 90) return "#4ade80";
    if (s >= 70) return "#ffc53d";
    if (s >= 50) return "#ff8a3d";
    return "#ff3b5c";
  };

  const color = getColor(score);
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label={label || "Accessibility score"}>
      <svg width="100" height="100" className="-rotate-90">
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="#1a1a1a"
          strokeWidth="6"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{
            filter: `drop-shadow(0 0 6px ${color}60)`,
            transition: "stroke-dashoffset 1s ease-out",
          }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ color }}>
        <span className="text-2xl font-bold font-mono">{score}</span>
      </div>
      {label && <span className="text-xs text-[#787878]">{label}</span>}
    </div>
  );
}
