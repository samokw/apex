import { prisma } from "./db";
import {
  createTempDirs,
  cloneRepo,
  createSandbox,
  execInSandbox,
  destroySandbox,
  cleanupTempDirs,
  type SandboxInstance,
} from "./sandbox";
import { calculateAccessibilityScore } from "./wcag";
import fs from "fs/promises";
import path from "path";

interface FixResult {
  filePath: string;
  originalCode: string;
  fixedCode: string;
  explanation: string;
  violationId: string;
}

export async function generateFixes(scanId: string, accessToken: string) {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: { violations: true },
  });

  if (!scan) throw new Error("Scan not found");
  if (scan.violations.length === 0) return;

  let dirs: { repoPath: string; outputPath: string; base: string } | null = null;
  let sandbox: SandboxInstance | null = null;

  try {
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: "fixing" },
    });

    dirs = await createTempDirs();
    const repoUrl = `https://github.com/${scan.repoOwner}/${scan.repoName}`;
    await cloneRepo(repoUrl, dirs.repoPath, accessToken);

    sandbox = await createSandbox({
      repoPath: dirs.repoPath,
      outputPath: dirs.outputPath,
    });

    const violationsSummary = scan.violations.map((v) => ({
      id: v.id,
      ruleId: v.ruleId,
      impact: v.impact,
      description: v.description,
      targetElement: v.targetElement,
      htmlSnippet: v.htmlSnippet,
      wcagCriteria: v.wcagCriteria,
    }));

    const prompt = buildFixPrompt(violationsSummary);

    const result = await execInSandbox(sandbox, [
      "bash", "-c",
      `opencode run "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" --format json 2>/dev/null || echo '{"fixes":[]}'`,
    ]);

    let fixes: FixResult[] = [];
    try {
      const parsed = JSON.parse(result.stdout.trim());
      fixes = parsed.fixes || [];
    } catch {
      fixes = extractFixesFromText(result.stdout, scan.violations);
    }

    for (const fix of fixes) {
      const violation = scan.violations.find((v) => v.id === fix.violationId) || scan.violations[0];
      if (!violation) continue;

      await prisma.fix.create({
        data: {
          scanId,
          violationId: violation.id,
          filePath: fix.filePath,
          originalCode: fix.originalCode,
          fixedCode: fix.fixedCode,
          explanation: fix.explanation,
          status: "pending",
        },
      });
    }

    // Generate git diff for all changes
    const diffResult = await execInSandbox(sandbox, [
      "bash", "-c",
      "cd /workspace && git diff --no-color 2>/dev/null || true",
    ]);

    if (diffResult.stdout.trim()) {
      await fs.writeFile(
        path.join(dirs.outputPath, "diff.patch"),
        diffResult.stdout
      );
    }

    // Take after screenshot
    await execInSandbox(sandbox, [
      "bash", "-c",
      `node -e "
const { chromium } = require('playwright');
const net = require('net');
function tryConnect(port, host) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(1500);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}
(async () => {
  let url = null;
  for (const p of [3000, 5173, 4173, 8080]) {
    if (await tryConnect(p, '127.0.0.1')) { url = 'http://127.0.0.1:' + p; break; }
    if (await tryConnect(p, '::1')) { url = 'http://[::1]:' + p; break; }
  }
  if (!url) return;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url, { timeout: 10000, waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: '/output/after.png', fullPage: true });
  await context.close();
  await browser.close();
})().catch(() => {});
"`,
    ]);

    let afterScreenshot: string | null = null;
    try {
      const buf = await fs.readFile(path.join(dirs.outputPath, "after.png"));
      afterScreenshot = buf.toString("base64");
    } catch { /* no screenshot */ }

    // Recalculate score after fixes
    const allFixes = await prisma.fix.findMany({ where: { scanId } });
    const remainingViolations = scan.violations.filter(
      (v) => !allFixes.some((f) => f.violationId === v.id)
    );
    const scoreAfter = calculateAccessibilityScore(remainingViolations);

    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: "complete",
        scoreAfter,
        afterScreenshot,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fix generation failed";
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: "failed", errorMessage: msg },
    });
  } finally {
    if (sandbox) await destroySandbox(sandbox);
    if (dirs) await cleanupTempDirs(dirs.base);
  }
}

function buildFixPrompt(
  violations: Array<{
    id: string;
    ruleId: string;
    impact: string;
    description: string;
    targetElement: string | null;
    htmlSnippet: string | null;
    wcagCriteria: string | null;
  }>
): string {
  const violationList = violations
    .slice(0, 20)
    .map(
      (v, i) =>
        `${i + 1}. [${v.impact.toUpperCase()}] ${v.ruleId}: ${v.description}
   Element: ${v.targetElement || "unknown"}
   HTML: ${v.htmlSnippet?.substring(0, 200) || "N/A"}
   WCAG: ${v.wcagCriteria || "N/A"}
   Violation ID: ${v.id}`
    )
    .join("\n\n");

  return `You are an accessibility remediation agent. Fix the following WCAG accessibility violations in this codebase.

IMPORTANT: Follow the existing code style and patterns. Do not introduce new dependencies.

For Ontario AODA/IASR compliance, these must conform to WCAG 2.0 Level AA.

Violations to fix:

${violationList}

For each fix:
1. Find the relevant source file
2. Apply the minimum change needed to resolve the violation
3. Preserve existing styling and code patterns

After making all fixes, output a JSON summary to /output/fixes.json with this structure:
{"fixes": [{"filePath": "...", "originalCode": "...", "fixedCode": "...", "explanation": "...", "violationId": "..."}]}`;
}

function extractFixesFromText(
  text: string,
  violations: Array<{ id: string }>
): FixResult[] {
  // Fallback: try to parse any JSON blocks in the output
  const jsonMatch = text.match(/\{[\s\S]*"fixes"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.fixes || [];
    } catch { /* continue */ }
  }

  return violations.slice(0, 5).map((v) => ({
    filePath: "unknown",
    originalCode: "",
    fixedCode: "",
    explanation: "Fix could not be automatically generated. Manual review required.",
    violationId: v.id,
  }));
}
