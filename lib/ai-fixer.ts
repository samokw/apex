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
import { normalizeRepoFilePath } from "./repo-path";
import fs from "fs/promises";
import path from "path";

interface FixResult {
  filePath: string;
  originalCode: string;
  fixedCode: string;
  explanation: string;
  violationId: string;
}

interface ViolationSummary {
  id: string;
  ruleId: string;
  impact: string;
  description: string;
  targetElement: string | null;
  htmlSnippet: string | null;
  wcagCriteria: string | null;
}

interface FixBatch {
  violations: ViolationSummary[];
  useThinking: boolean;
}

interface PostFixAxeViolation {
  impact: string;
  nodes?: Array<unknown>;
}

interface PostFixScanResult {
  violations: PostFixAxeViolation[];
  url: string;
  timestamp: string;
}
const DEFAULT_OPENCODE_MODEL = "anthropic/claude-sonnet-4-20250514";
const DEFAULT_OPENCODE_TIMEOUT_SECONDS = 90;
const DEFAULT_OPENCODE_TOTAL_TIMEOUT_SECONDS = 240;
const DEFAULT_OPENCODE_PROMPT_BATCH_SIZE = 1;
const DEFAULT_OPENCODE_PROMPT_MAX_BATCHES = 50;
const DEFAULT_OPENCODE_CONTRAST_THINKING = true;
const DEFAULT_OPENCODE_ALL_THINKING = false;

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

    const violationsSummary: ViolationSummary[] = scan.violations.map((v) => ({
      id: v.id,
      ruleId: v.ruleId,
      impact: v.impact,
      description: v.description,
      targetElement: v.targetElement,
      htmlSnippet: v.htmlSnippet,
      wcagCriteria: v.wcagCriteria,
    })).sort((a, b) => {
      const ruleCmp = rulePriority(b.ruleId) - rulePriority(a.ruleId);
      if (ruleCmp !== 0) return ruleCmp;

      const impactCmp = impactPriority(b.impact) - impactPriority(a.impact);
      if (impactCmp !== 0) return impactCmp;

      return a.id.localeCompare(b.id);
    });

    const selectedModel = process.env.OPENCODE_MODEL || DEFAULT_OPENCODE_MODEL;
    const opencodeTimeoutSeconds = Number(process.env.OPENCODE_TIMEOUT_SECONDS || DEFAULT_OPENCODE_TIMEOUT_SECONDS);
    const totalTimeoutSeconds = Math.max(
      30,
      Number(process.env.OPENCODE_TOTAL_TIMEOUT_SECONDS || DEFAULT_OPENCODE_TOTAL_TIMEOUT_SECONDS)
    );
    const promptBatchSize = Math.max(
      1,
      Number(process.env.OPENCODE_PROMPT_BATCH_SIZE || DEFAULT_OPENCODE_PROMPT_BATCH_SIZE)
    );
    const maxPromptBatches = Math.max(
      1,
      Number(process.env.OPENCODE_PROMPT_MAX_BATCHES || DEFAULT_OPENCODE_PROMPT_MAX_BATCHES)
    );
    const contrastThinkingEnabled = parseBooleanEnv(
      process.env.OPENCODE_CONTRAST_THINKING,
      DEFAULT_OPENCODE_CONTRAST_THINKING
    );
    const allThinkingEnabled = parseBooleanEnv(
      process.env.OPENCODE_ALL_THINKING,
      DEFAULT_OPENCODE_ALL_THINKING
    );
    const thinkingVariant = (process.env.OPENCODE_THINKING_VARIANT || "").trim();
    const fixesFilePath = "/workspace/.apex-fixes.json";
    if (selectedModel.startsWith("opencode/")) {
      const authCheck = await execInSandbox(sandbox, [
        "bash",
        "-c",
        "opencode auth list 2>&1 || true",
      ]);
      if (authCheck.stdout.includes("0 credentials")) {
        throw new Error(
          `OpenCode credentials are missing in the sandbox. Run 'opencode auth login' for provider access before using model ${selectedModel}.`
        );
      }
    }

    const fixesByViolation = new Map<string, FixResult>();
    const violationById = new Map(scan.violations.map((v) => [v.id, v]));
    const diagnostics: string[] = [];
    let processedViolationCount = 0;
    let attemptedBatchCount = 0;
    let fixerWarning: string | null = null;
    const fixerStartedAt = Date.now();

    const contrastViolations = violationsSummary.filter((v) => isContrastRule(v.ruleId));
    const nonContrastViolations = violationsSummary.filter((v) => !isContrastRule(v.ruleId));
    const queuedBatches: FixBatch[] = [];
    if (contrastViolations.length > 0) {
      queuedBatches.push({
        violations: contrastViolations,
        useThinking: allThinkingEnabled || contrastThinkingEnabled,
      });
    }
    for (let offset = 0; offset < nonContrastViolations.length; offset += promptBatchSize) {
      const chunk = nonContrastViolations.slice(offset, offset + promptBatchSize);
      if (chunk.length === 0) continue;
      queuedBatches.push({ violations: chunk, useThinking: allThinkingEnabled });
    }

    const batchesToRun = queuedBatches.slice(0, maxPromptBatches);
    if (queuedBatches.length > maxPromptBatches) {
      diagnostics.push(`batch limit reached (${maxPromptBatches})`);
    }

    for (const batchConfig of batchesToRun) {
      const elapsedSeconds = Math.floor((Date.now() - fixerStartedAt) / 1000);
      const remainingBudgetSeconds = totalTimeoutSeconds - elapsedSeconds;
      if (remainingBudgetSeconds <= 0) {
        fixerWarning = `AI fixer stopped after ${totalTimeoutSeconds}s budget (MVP time limit).`;
        diagnostics.push("overall timeout budget reached");
        break;
      }

      const batch = batchConfig.violations;
      if (batch.length === 0) break;
      attemptedBatchCount += 1;
      processedViolationCount += batch.length;

      const batchTimeoutSeconds = Math.max(
        15,
        Math.min(opencodeTimeoutSeconds, remainingBudgetSeconds)
      );
      const prompt = buildFixPrompt(batch);
      const batchResult = await runOpencodeFixBatch(
        sandbox,
        selectedModel,
        batchTimeoutSeconds,
        fixesFilePath,
        prompt,
        batch.map((v) => v.id),
        batchConfig.useThinking,
        thinkingVariant
      );
      if (batchResult.diagnostic) {
        diagnostics.push(`batch ${attemptedBatchCount}: ${batchResult.diagnostic}`);
      }

      for (const fix of batchResult.fixes) {
        const fallbackViolationId = batch.length === 1 ? batch[0].id : "";
        const violationId = fix?.violationId || fallbackViolationId;
        if (!violationId) continue;
        const violation = violationById.get(violationId);
        if (!violation) continue;

        const repoFilePath = normalizeRepoFilePath(fix.filePath);
        if (!repoFilePath) continue;

        const normalizedFix: FixResult = {
          ...fix,
          violationId,
          filePath: repoFilePath,
        };

        fixesByViolation.set(violationId, normalizedFix);

        await prisma.fix.upsert({
          where: { violationId },
          update: {
            filePath: repoFilePath,
            originalCode: normalizedFix.originalCode,
            fixedCode: normalizedFix.fixedCode,
            explanation: normalizedFix.explanation,
            status: "pending",
          },
          create: {
            scanId,
            violationId,
            filePath: repoFilePath,
            originalCode: normalizedFix.originalCode,
            fixedCode: normalizedFix.fixedCode,
            explanation: normalizedFix.explanation,
            status: "pending",
          },
        });
      }

      await prisma.scan.update({
        where: { id: scanId },
        data: {
          errorMessage:
            `AI fixer progress: ${fixesByViolation.size} fix(es) captured after ${attemptedBatchCount} batch(es). ` +
            `Elapsed ${Math.floor((Date.now() - fixerStartedAt) / 1000)}s/${totalTimeoutSeconds}s.`,
        },
      });
    }

    const fixes = Array.from(fixesByViolation.values());

    // If no machine-readable fixes were produced, do not fail the full scan.
    // Keep scan complete and expose a useful message for manual follow-up.
    if (!fixes.length) {
      const extra = diagnostics.join(" | ").slice(0, 240);
      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: "complete",
          errorMessage:
            `No fixes were produced by the AI fixer (model: ${selectedModel}). ` +
            `Processed ${processedViolationCount} violation(s) across ${attemptedBatchCount} batch(es). ` +
            (extra || "The model returned no applicable edits."),
        },
      });
      return;
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

    const postFixScan = await runPostFixScan(sandbox, dirs.outputPath);
    let afterScreenshot: string | null = null;
    let scoreAfter: number;
    let postFixWarning: string | null = null;

    try {
      const buf = await fs.readFile(path.join(dirs.outputPath, "after.png"));
      afterScreenshot = buf.toString("base64");
    } catch {
      // Screenshot is optional for score calculation.
    }

    if (postFixScan.ok) {
      scoreAfter = calculateAccessibilityScore(
        postFixScan.result.violations.flatMap((violation) => {
          const nodeCount = Math.max(1, violation.nodes?.length ?? 0);
          return Array.from({ length: nodeCount }, () => ({ impact: violation.impact }));
        })
      );
    } else {
      // Fallback only when post-fix re-scan fails unexpectedly.
      const allFixes = await prisma.fix.findMany({ where: { scanId } });
      const remainingViolations = scan.violations.filter(
        (v) => !allFixes.some((f) => f.violationId === v.id)
      );
      scoreAfter = calculateAccessibilityScore(remainingViolations);
      postFixWarning = `Post-fix re-scan failed; using inferred score. ${postFixScan.error}`;
    }

    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: "complete",
        scoreAfter,
        afterScreenshot,
        errorMessage: [fixerWarning, postFixWarning].filter(Boolean).join(" ") || null,
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
  violations: ViolationSummary[]
): string {
  const violationList = violations
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

After making fixes for this batch:
1. Write a JSON summary to /workspace/.apex-fixes.json with this structure:
{"fixes": [{"filePath": "...", "originalCode": "...", "fixedCode": "...", "explanation": "...", "violationId": "..."}]}
2. Also print the same JSON object as your final response, with no markdown and no extra text.
3. Do not output planning text, todos, or prose.`;
}

function extractFixesFromText(text: string): FixResult[] {
  // Fallback: try to parse any JSON blocks in the output
  const jsonMatch = text.match(/\{[\s\S]*"fixes"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.fixes || [];
    } catch { /* continue */ }
  }
  return [];
}

function sanitizeDiagnostic(input: string): string {
  return input
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactFixerDiagnostic(stdout: string, stderr: string): string {
  const cleanErr = sanitizeDiagnostic(stderr).slice(0, 240);
  if (cleanErr) return cleanErr;

  const cleanOut = sanitizeDiagnostic(stdout);
  if (!cleanOut) return "";
  if (cleanOut.includes('"type":"step_start"') || cleanOut.includes('"type":"tool_use"')) {
    return "Received OpenCode event stream instead of final fixes JSON.";
  }

  return cleanOut.slice(0, 240);
}

function impactPriority(impact: string): number {
  const normalized = impact.toLowerCase();
  if (normalized === "critical") return 4;
  if (normalized === "serious") return 3;
  if (normalized === "moderate") return 2;
  if (normalized === "minor") return 1;
  return 0;
}

function rulePriority(ruleId: string): number {
  const normalized = (ruleId || "").toLowerCase();
  if (normalized === "color-contrast") return 3;
  if (isContrastRule(normalized)) return 2;
  return 0;
}

function isContrastRule(ruleId: string): boolean {
  const normalized = (ruleId || "").toLowerCase();
  return normalized.includes("contrast");
}

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

async function runOpencodeFixBatch(
  sandbox: SandboxInstance,
  selectedModel: string,
  opencodeTimeoutSeconds: number,
  fixesFilePath: string,
  prompt: string,
  fallbackViolationIds: string[],
  useThinking: boolean,
  thinkingVariant: string
): Promise<{ fixes: FixResult[]; diagnostic: string }> {
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const escapedModel = selectedModel.replace(/"/g, '\\"');
  const escapedVariant = thinkingVariant.replace(/"/g, '\\"');
  const thinkingArg = useThinking ? " --thinking" : "";
  const variantArg = useThinking && escapedVariant ? ` --variant "${escapedVariant}"` : "";

  const result = await execInSandbox(sandbox, [
    "bash",
    "-c",
    `rm -f ${fixesFilePath} /tmp/opencode-out.txt /tmp/opencode-err.txt;
timeout ${opencodeTimeoutSeconds}s opencode run -m "${escapedModel}"${thinkingArg}${variantArg} "${escapedPrompt}" --format default > /tmp/opencode-out.txt 2> /tmp/opencode-err.txt || true;
if [ -f ${fixesFilePath} ]; then cat ${fixesFilePath};
elif [ -s /tmp/opencode-out.txt ]; then cat /tmp/opencode-out.txt;
else echo '{"fixes":[]}'; fi`,
  ]);

  let opencodeErr = "";
  try {
    const errResult = await execInSandbox(sandbox, [
      "bash",
      "-c",
      "if [ -f /tmp/opencode-err.txt ]; then cat /tmp/opencode-err.txt; fi",
    ]);
    opencodeErr = errResult.stdout.trim();
  } catch {
    // Best effort.
  }

  let fixes: FixResult[] = [];
  try {
    const parsed = JSON.parse(result.stdout.trim());
    fixes = Array.isArray(parsed?.fixes) ? parsed.fixes : [];
  } catch {
    fixes = extractFixesFromText(result.stdout);
  }

  if (!fixes.length && opencodeErr) {
    fixes = extractFixesFromText(opencodeErr);
  }

  const singleViolationId = fallbackViolationIds.length === 1 ? fallbackViolationIds[0] : "";
  if (!fixes.length && singleViolationId && opencodeErr) {
    const fromDiff = extractFixesFromDiff(opencodeErr, singleViolationId);
    if (fromDiff.length) {
      fixes = [fromDiff[0]];
    }
  }

  if (singleViolationId) {
    fixes = fixes.map((fix) => ({
      ...fix,
      violationId: fix.violationId || singleViolationId,
    }));
  }

  return {
    fixes,
    diagnostic: compactFixerDiagnostic(result.stdout, opencodeErr),
  };
}

function extractFixesFromDiff(diffOutput: string, violationId: string): FixResult[] {
  if (!diffOutput) return [];
  const clean = diffOutput.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = clean.split(/\r?\n/);
  const fixes: FixResult[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith("Index: ")) {
      i += 1;
      continue;
    }

    const rawPath = line.slice("Index: ".length).trim();
    const filePath = normalizeRepoFilePath(rawPath);
    i += 1;

    let inHunk = false;
    const oldLines: string[] = [];
    const newLines: string[] = [];

    while (i < lines.length && !lines[i].startsWith("Index: ")) {
      const current = lines[i];

      if (current.startsWith("@@")) {
        inHunk = true;
        i += 1;
        continue;
      }

      if (!inHunk) {
        i += 1;
        continue;
      }

      if (current.startsWith("---") || current.startsWith("+++")) {
        i += 1;
        continue;
      }

      if (current.startsWith("\\ No newline at end of file")) {
        i += 1;
        continue;
      }

      if (current.startsWith("+")) {
        newLines.push(current.slice(1));
      } else if (current.startsWith("-")) {
        oldLines.push(current.slice(1));
      } else if (current.startsWith(" ")) {
        const content = current.slice(1);
        oldLines.push(content);
        newLines.push(content);
      }

      i += 1;
    }

    if (!filePath) continue;

    const originalCode = oldLines.join("\n").trim();
    const fixedCode = newLines.join("\n").trim();
    if (!originalCode && !fixedCode) continue;

    fixes.push({
      filePath,
      originalCode,
      fixedCode,
      explanation: "Captured from model-emitted patch output.",
      violationId,
    });
  }

  return fixes;
}

async function runPostFixScan(
  sandbox: SandboxInstance,
  outputPath: string
): Promise<{ ok: true; result: PostFixScanResult } | { ok: false; error: string }> {
  const resultsPath = path.join(outputPath, "after-scan-results.json");
  const errorPath = path.join(outputPath, "after-scan-error.json");
  const afterPngPath = path.join(outputPath, "after.png");
  await fs.rm(resultsPath, { force: true }).catch(() => {});
  await fs.rm(errorPath, { force: true }).catch(() => {});
  await fs.rm(afterPngPath, { force: true }).catch(() => {});

  const script = `
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  let page = await context.newPage();

  let url = null;
  let devServer = null;
  let staticServer = null;
  const workspace = '/workspace';
  const ports = [3000, 5173, 4173, 8080, 8000, 4200];
  const staticPorts = [3900, 3901, 3902, 3903, 3904];

  const PORT_CONNECT_TIMEOUT = 2000;
  const SERVER_WAIT_TIMEOUT = 35000;
  const SERVER_POLL_INTERVAL = 1200;
  const NPM_INSTALL_TIMEOUT = 90000;
  const STATIC_SERVER_BOOT_WAIT = 900;
  const STATIC_PAGE_SETTLE_WAIT = 1200;

  function killProcess(proc) {
    if (!proc) return;
    try { process.kill(-proc.pid, 'SIGKILL'); } catch {
      try { proc.kill('SIGKILL'); } catch {}
    }
  }

  function collectCandidateDirs(baseDir) {
    const discovered = [baseDir];
    const common = ['frontend', 'client', 'web', 'app', 'apps', 'packages'];

    for (const name of common) {
      const p = baseDir + '/' + name;
      if (fs.existsSync(p)) discovered.push(p);
    }

    const queue = [{ dir: baseDir, depth: 0 }];
    while (queue.length) {
      const current = queue.shift();
      if (!current || current.depth >= 2) continue;
      let entries = [];
      try {
        entries = fs.readdirSync(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = current.dir + '/' + entry.name;
        if (fs.existsSync(full + '/package.json') || fs.existsSync(full + '/index.html')) discovered.push(full);
        queue.push({ dir: full, depth: current.depth + 1 });
      }
    }

    return Array.from(new Set(discovered));
  }

  async function tryConnectToPort() {
    for (const port of ports) {
      try {
        await page.goto('http://localhost:' + port, { timeout: PORT_CONNECT_TIMEOUT, waitUntil: 'domcontentloaded' });
        return 'http://localhost:' + port;
      } catch {}
    }
    return null;
  }

  async function startStaticServer(rootDir) {
    const serverScript = [
      "const http=require('http');",
      "const fs=require('fs');",
      "const path=require('path');",
      "const root=path.resolve(process.argv[1]);",
      "const port=Number(process.argv[2]||3900);",
      "const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.ico':'image/x-icon','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf'};",
      "const server=http.createServer((req,res)=>{",
      "  try {",
      "    const raw=((req.url||'/').split('?')[0]||'/');",
      "    const clean=decodeURIComponent(raw).replace(/^\\\\/+/, '');",
      "    let rel=clean||'index.html';",
      "    let file=path.resolve(root, rel);",
      "    if(!file.startsWith(root)){res.statusCode=403;res.end('forbidden');return;}",
      "    if(fs.existsSync(file) && fs.statSync(file).isDirectory()){file=path.join(file,'index.html');}",
      "    if(!fs.existsSync(file)){res.statusCode=404;res.end('not found');return;}",
      "    const ext=path.extname(file).toLowerCase();",
      "    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');",
      "    fs.createReadStream(file).pipe(res);",
      "  } catch { res.statusCode=500; res.end('error'); }",
      "});",
      "server.listen(port,'0.0.0.0',()=>{});",
    ].join('\\n');

    for (const port of staticPorts) {
      const proc = spawn('node', ['-e', serverScript, rootDir, String(port)], {
        stdio: 'pipe',
        detached: true,
        env: { ...process.env, NODE_ENV: 'development' },
      });
      await new Promise(r => setTimeout(r, STATIC_SERVER_BOOT_WAIT));
      if (proc.exitCode === null) return { proc, port };
      killProcess(proc);
    }
    return null;
  }

  const candidateDirs = collectCandidateDirs(workspace);

  for (const cwd of candidateDirs) {
    const pkgPath = cwd + '/package.json';
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};
      const scriptName = scripts.dev ? 'dev' : scripts.start ? 'start' : scripts.serve ? 'serve' : null;
      if (!scriptName) continue;

      try {
        if (!fs.existsSync(cwd + '/node_modules')) {
          execSync('npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund', {
            cwd,
            stdio: 'pipe',
            env: { ...process.env, NODE_ENV: 'development' },
            timeout: NPM_INSTALL_TIMEOUT,
          });
        }
      } catch {}

      devServer = spawn('npm', ['run', scriptName], {
        cwd,
        stdio: 'pipe',
        detached: true,
        env: { ...process.env, PORT: '3000', NODE_ENV: 'development' },
      });

      const startedAt = Date.now();
      while (Date.now() - startedAt < SERVER_WAIT_TIMEOUT) {
        await new Promise(r => setTimeout(r, SERVER_POLL_INTERVAL));
        url = await tryConnectToPort();
        if (url) break;
        if (devServer.exitCode !== null) break;
      }

      if (url) break;
      killProcess(devServer);
      devServer = null;
    } catch {}
  }

  if (!url) {
    url = await tryConnectToPort();
  }

  if (!url) {
    const candidates = [];
    for (const base of candidateDirs) {
      candidates.push({ file: base + '/index.html', root: base, route: '/index.html' });
      candidates.push({ file: base + '/public/index.html', root: base, route: '/public/index.html' });
      candidates.push({ file: base + '/dist/index.html', root: base, route: '/dist/index.html' });
      candidates.push({ file: base + '/build/index.html', root: base, route: '/build/index.html' });
      candidates.push({ file: base + '/out/index.html', root: base, route: '/out/index.html' });
    }

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate.file)) continue;
      const started = await startStaticServer(candidate.root);
      if (!started) continue;
      const candidateUrl = 'http://localhost:' + started.port + candidate.route;
      const staticPage = await context.newPage();
      try {
        await staticPage.goto(candidateUrl, { timeout: 12000, waitUntil: 'domcontentloaded' });
        await staticPage.waitForTimeout(STATIC_PAGE_SETTLE_WAIT);
        if (staticPage.url().startsWith('chrome-error://')) throw new Error('render error');
        const probe = await staticPage.evaluate(() => {
          const body = document.body;
          return {
            textLen: body && body.innerText ? body.innerText.trim().length : 0,
            childCount: body ? body.querySelectorAll('*').length : 0,
          };
        });
        if (probe.textLen === 0 && probe.childCount < 3) throw new Error('blank render');

        await page.close().catch(() => {});
        page = staticPage;
        staticServer = started.proc;
        url = candidateUrl;
        break;
      } catch {
        await staticPage.close().catch(() => {});
        killProcess(started.proc);
      }
    }
  }

  if (!url) {
    fs.writeFileSync('/output/after-scan-error.json', JSON.stringify({ error: 'Unable to load app for post-fix scan' }));
    await context.close();
    await browser.close();
    killProcess(devServer);
    killProcess(staticServer);
    process.exit(1);
  }

  await page.screenshot({ path: '/output/after.png', fullPage: true });
  const results = await new AxeBuilder({ page }).analyze();
  fs.writeFileSync('/output/after-scan-results.json', JSON.stringify({
    violations: results.violations,
    url,
    timestamp: new Date().toISOString(),
  }, null, 2));

  await context.close();
  await browser.close();
  killProcess(devServer);
  killProcess(staticServer);
  process.exit(0);
})().catch(err => {
  fs.writeFileSync('/output/after-scan-error.json', JSON.stringify({ error: err.message }));
  process.exit(1);
});
`;

  const scriptB64 = Buffer.from(script).toString("base64");
  const execResult = await execInSandbox(sandbox, [
    "bash",
    "-c",
    `echo '${scriptB64}' | base64 -d > /tmp/post-fix-scan.js && node /tmp/post-fix-scan.js 2>&1`,
  ]);

  try {
    const raw = await fs.readFile(resultsPath, "utf-8");
    const parsed = JSON.parse(raw) as PostFixScanResult;
    return { ok: true, result: parsed };
  } catch {
    // continue to structured error below
  }

  let error = `Post-fix scan failed (exit ${execResult.exitCode})`;
  try {
    const errRaw = await fs.readFile(errorPath, "utf-8");
    try {
      error = JSON.parse(errRaw).error || error;
    } catch {
      error = sanitizeDiagnostic(errRaw).slice(0, 240) || error;
    }
  } catch {
    // no structured error file
  }

  if (
    error.startsWith("Post-fix scan failed") &&
    execResult.stdout &&
    sanitizeDiagnostic(execResult.stdout)
  ) {
    error = sanitizeDiagnostic(execResult.stdout).slice(0, 240) || error;
  } else if (execResult.stdout) {
    error = sanitizeDiagnostic(execResult.stdout).slice(0, 240) || error;
  }

  return { ok: false, error };
}
