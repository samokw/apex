export type ImpactLevel = "critical" | "serious" | "moderate" | "minor";

const IMPACT_WEIGHTS: Record<ImpactLevel, number> = {
  critical: 10,
  serious: 7,
  moderate: 4,
  minor: 1,
};

const WCAG_TO_AODA: Record<string, { relevant: boolean; description: string }> = {
  "1.1.1": { relevant: true, description: "Non-text Content" },
  "1.2.1": { relevant: true, description: "Audio-only and Video-only" },
  "1.2.2": { relevant: true, description: "Captions (Prerecorded)" },
  "1.2.3": { relevant: true, description: "Audio Description or Media Alternative" },
  "1.3.1": { relevant: true, description: "Info and Relationships" },
  "1.3.2": { relevant: true, description: "Meaningful Sequence" },
  "1.3.3": { relevant: true, description: "Sensory Characteristics" },
  "1.4.1": { relevant: true, description: "Use of Color" },
  "1.4.2": { relevant: true, description: "Audio Control" },
  "1.4.3": { relevant: true, description: "Contrast (Minimum)" },
  "1.4.4": { relevant: true, description: "Resize Text" },
  "1.4.5": { relevant: true, description: "Images of Text" },
  "2.1.1": { relevant: true, description: "Keyboard" },
  "2.1.2": { relevant: true, description: "No Keyboard Trap" },
  "2.2.1": { relevant: true, description: "Timing Adjustable" },
  "2.2.2": { relevant: true, description: "Pause, Stop, Hide" },
  "2.3.1": { relevant: true, description: "Three Flashes or Below Threshold" },
  "2.4.1": { relevant: true, description: "Bypass Blocks" },
  "2.4.2": { relevant: true, description: "Page Titled" },
  "2.4.3": { relevant: true, description: "Focus Order" },
  "2.4.4": { relevant: true, description: "Link Purpose (In Context)" },
  "2.4.5": { relevant: true, description: "Multiple Ways" },
  "2.4.6": { relevant: true, description: "Headings and Labels" },
  "2.4.7": { relevant: true, description: "Focus Visible" },
  "3.1.1": { relevant: true, description: "Language of Page" },
  "3.1.2": { relevant: true, description: "Language of Parts" },
  "3.2.1": { relevant: true, description: "On Focus" },
  "3.2.2": { relevant: true, description: "On Input" },
  "3.2.3": { relevant: true, description: "Consistent Navigation" },
  "3.2.4": { relevant: true, description: "Consistent Identification" },
  "3.3.1": { relevant: true, description: "Error Identification" },
  "3.3.2": { relevant: true, description: "Labels or Instructions" },
  "3.3.3": { relevant: true, description: "Error Suggestion" },
  "3.3.4": { relevant: true, description: "Error Prevention (Legal, Financial, Data)" },
  "4.1.1": { relevant: true, description: "Parsing" },
  "4.1.2": { relevant: true, description: "Name, Role, Value" },
};

export function getImpactWeight(impact: string): number {
  return IMPACT_WEIGHTS[impact as ImpactLevel] ?? 1;
}

export function calculateAccessibilityScore(
  violations: Array<{ impact: string }>
): number {
  if (violations.length === 0) return 100;

  const totalWeight = violations.reduce(
    (sum, v) => sum + getImpactWeight(v.impact),
    0
  );

  const maxPossible = violations.length * 10;
  const score = Math.max(0, Math.round(100 - (totalWeight / maxPossible) * 100));
  return score;
}

export function extractWcagCriteria(tags: string[]): string[] {
  return tags.filter((tag) => /^wcag\d+$/.test(tag) || /^wcag\d{3,}$/.test(tag));
}

export function isAodaRelevant(wcagCriteria: string[]): boolean {
  for (const criterion of wcagCriteria) {
    const match = criterion.match(/wcag(\d)(\d)(\d+)/);
    if (match) {
      const key = `${match[1]}.${match[2]}.${match[3]}`;
      if (WCAG_TO_AODA[key]?.relevant) return true;
    }
  }
  return false;
}

export function getAodaInfo(wcagCriteria: string[]) {
  const results: Array<{ criterion: string; description: string }> = [];
  for (const criterion of wcagCriteria) {
    const match = criterion.match(/wcag(\d)(\d)(\d+)/);
    if (match) {
      const key = `${match[1]}.${match[2]}.${match[3]}`;
      const info = WCAG_TO_AODA[key];
      if (info) {
        results.push({ criterion: key, description: info.description });
      }
    }
  }
  return results;
}

export function generateReportSummary(violations: Array<{
  impact: string;
  ruleId: string;
  description: string;
  wcagCriteria: string | null;
  aodaRelevant: boolean;
}>) {
  const bySeverity = {
    critical: violations.filter((v) => v.impact === "critical"),
    serious: violations.filter((v) => v.impact === "serious"),
    moderate: violations.filter((v) => v.impact === "moderate"),
    minor: violations.filter((v) => v.impact === "minor"),
  };

  const aodaViolations = violations.filter((v) => v.aodaRelevant);

  return {
    totalViolations: violations.length,
    bySeverity: {
      critical: bySeverity.critical.length,
      serious: bySeverity.serious.length,
      moderate: bySeverity.moderate.length,
      minor: bySeverity.minor.length,
    },
    aodaRelevantCount: aodaViolations.length,
    score: calculateAccessibilityScore(violations),
    disclaimer:
      "This report is generated by automated tools and covers approximately 57% of accessibility issues. " +
      "It does not constitute legal compliance certification under AODA/IASR. " +
      "Manual review by accessibility experts is required for full compliance. " +
      "AODA requires conformance to WCAG 2.0 Level AA for the Information and Communications Standard.",
  };
}
