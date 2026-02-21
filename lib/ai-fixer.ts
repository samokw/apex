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
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";
import path from "path";

interface FixResult {
  filePath: string;
  originalCode: string;
  fixedCode: string;
  explanation: string;
  violationId: string;
}

const anthropic = new Anthropic();

async function collectSourceFiles(
  repoPath: string,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const extensions = [".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte", ".css"];
  const ignore = ["node_modules", ".git", "dist", "build", ".next"];

  async function walk(dir: string, rel: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignore.includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        try {
          const content = await fs.readFile(fullPath, "utf-8");
          if (content.length < 50_000) {
            files.set(relPath, content);
          }
        } catch { /* skip unreadable files */ }
      }
    }
  }

  await walk(repoPath, "");
  return files;
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

    const sourceFiles = await collectSourceFiles(dirs.repoPath);

    const violationsSummary = scan.violations
      .slice(0, 20)
      .map(
        (v, i) =>
          `${i + 1}. [${v.impact.toUpperCase()}] ${v.ruleId}: ${v.description}
   Element: ${v.targetElement || "unknown"}
   HTML: ${v.htmlSnippet?.substring(0, 300) || "N/A"}
   WCAG: ${v.wcagCriteria || "N/A"}
   Violation ID: ${v.id}`,
      )
      .join("\n\n");

    const fileList = Array.from(sourceFiles.entries())
      .map(([filePath, content]) => `--- ${filePath} ---\n${content}`)
      .join("\n\n");

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are an accessibility remediation expert. Fix the WCAG violations below by modifying the source files.

VIOLATIONS:

${violationsSummary}

SOURCE FILES:

${fileList}

For Ontario AODA/IASR compliance, fixes must conform to WCAG 2.0 Level AA.

Rules:
- Apply the MINIMUM change needed to fix each violation
- Preserve existing code style
- Do not add new dependencies

Respond with ONLY a JSON object (no markdown fences, no extra text) in this exact format:
{"fixes": [{"filePath": "path/to/file", "originalCode": "the exact original lines", "fixedCode": "the corrected lines", "explanation": "what was changed and why", "violationId": "the violation ID from above"}]}

Include the relevant surrounding context (3-5 lines) in originalCode and fixedCode so the diff is meaningful. Every fix MUST have non-empty originalCode and fixedCode.`,
        },
      ],
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    let fixes: FixResult[] = [];
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*"fixes"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        fixes = (parsed.fixes || []).filter(
          (f: FixResult) => f.originalCode && f.fixedCode,
        );
      }
    } catch {
      console.error("[AI Fixer] Failed to parse Claude response:", responseText.substring(0, 500));
    }

    if (fixes.length === 0) {
      fixes = scan.violations.slice(0, 5).map((v) => {
        const snippet = v.htmlSnippet || "";
        return {
          filePath: v.sourceFile || "index.html",
          originalCode: snippet,
          fixedCode: snippet,
          explanation:
            "Automatic fix could not be generated. Manual review required.",
          violationId: v.id,
        };
      });
    }

    for (const fix of fixes) {
      const violation =
        scan.violations.find((v) => v.id === fix.violationId) ||
        scan.violations[0];
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

    // Apply fixes to local files so the after screenshot reflects the changes
    for (const fix of fixes) {
      if (fix.originalCode === fix.fixedCode) continue;
      const filePath = path.join(dirs.repoPath, fix.filePath);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        if (content.includes(fix.originalCode)) {
          await fs.writeFile(filePath, content.replace(fix.originalCode, fix.fixedCode), "utf-8");
        }
      } catch { /* file not found or unreadable, skip */ }
    }

    sandbox = await createSandbox({
      repoPath: dirs.repoPath,
      outputPath: dirs.outputPath,
    });

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
  await page.goto(url, { timeout: 10000, waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
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

    const allFixes = await prisma.fix.findMany({ where: { scanId } });
    const remainingViolations = scan.violations.filter(
      (v) => !allFixes.some((f) => f.violationId === v.id),
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
