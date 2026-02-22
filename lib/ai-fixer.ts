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

interface WorkerRunResult {
  workerId: number;
  fixes: FixResult[];
  diagnostics: string[];
  processedViolationCount: number;
  attemptedBatchCount: number;
  warning: string | null;
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
const DEFAULT_OPENCODE_MODEL = "opencode/glm-5-free";
const DEFAULT_OPENCODE_TIMEOUT_SECONDS = 180;
const DEFAULT_OPENCODE_TOTAL_TIMEOUT_SECONDS = 480;
const DEFAULT_OPENCODE_PROMPT_BATCH_SIZE = 1;
const DEFAULT_OPENCODE_PROMPT_MAX_BATCHES = 50;
const DEFAULT_OPENCODE_CONTRAST_THINKING = true;
const DEFAULT_OPENCODE_CONTRAST_BATCH_SIZE = 1;
const DEFAULT_OPENCODE_ALL_THINKING = false;
const DEFAULT_OPENCODE_WORKERS = 1;
const MAX_OPENCODE_WORKERS = 6;
const OPENCODE_RETRY_ON_EMPTY = true;
const MAX_CONSECUTIVE_EMPTY_BATCHES = 3;
const MIN_BATCH_DURATION_MS = 3_000;
const OPENCODE_VERIFY_DIR = "/workspace/.apex-a11y";
const OPENCODE_VERIFY_SCRIPT_PATH = `${OPENCODE_VERIFY_DIR}/apex-a11y-verify.js`;
const OPENCODE_VERIFY_BEFORE_PATH = `${OPENCODE_VERIFY_DIR}/apex-verify-before.json`;
const OPENCODE_VERIFY_AFTER_PATH = `${OPENCODE_VERIFY_DIR}/apex-verify-after.json`;

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
    await prisma.$transaction([
      prisma.fix.deleteMany({ where: { scanId } }),
      prisma.scan.update({
        where: { id: scanId },
        data: {
          status: "fixing",
          scoreAfter: null,
          afterScreenshot: null,
          errorMessage: null,
        },
      }),
    ]);

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
    const contrastBatchSize = Math.max(
      1,
      parseIntegerEnv(
        process.env.OPENCODE_CONTRAST_BATCH_SIZE,
        DEFAULT_OPENCODE_CONTRAST_BATCH_SIZE
      )
    );
    const configuredWorkers = Math.max(
      1,
      Math.min(
        MAX_OPENCODE_WORKERS,
        parseIntegerEnv(
          process.env.OPENCODE_WORKERS || process.env.OPENCODE_PARALLEL_GROUPS,
          DEFAULT_OPENCODE_WORKERS
        )
      )
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

    const fixesByViolation = new Map<string, FixResult>();
    const violationById = new Map(scan.violations.map((v) => [v.id, v]));
    const validViolationIds = new Set(scan.violations.map((v) => v.id));
    const diagnostics: string[] = [];
    let processedViolationCount = 0;
    let attemptedBatchCount = 0;
    let fixerWarning: string | null = null;
    let applyWarning: string | null = null;
    const fixerStartedAt = Date.now();

    const contrastViolations = violationsSummary.filter((v) => isContrastRule(v.ruleId));
    const nonContrastViolations = violationsSummary.filter((v) => !isContrastRule(v.ruleId));
    const queuedBatches: FixBatch[] = [];
    for (let offset = 0; offset < contrastViolations.length; offset += contrastBatchSize) {
      const chunk = contrastViolations.slice(offset, offset + contrastBatchSize);
      if (chunk.length === 0) continue;
      queuedBatches.push({
        violations: chunk,
        useThinking: allThinkingEnabled || contrastThinkingEnabled,
      });
    }
    for (let offset = 0; offset < nonContrastViolations.length; offset += promptBatchSize) {
      const chunk = nonContrastViolations.slice(offset, offset + promptBatchSize);
      if (chunk.length === 0) continue;
      queuedBatches.push({ violations: chunk, useThinking: allThinkingEnabled });
    }

    // Dedup: remove batches that re-process the same violation IDs
    const seenViolationIds = new Set<string>();
    const dedupedBatches: FixBatch[] = [];
    for (const batch of queuedBatches) {
      const newViolations = batch.violations.filter((v) => !seenViolationIds.has(v.id));
      if (newViolations.length === 0) continue;
      for (const v of newViolations) seenViolationIds.add(v.id);
      dedupedBatches.push({ ...batch, violations: newViolations });
    }

    const batchesToRun = dedupedBatches.slice(0, maxPromptBatches);
    if (dedupedBatches.length > maxPromptBatches) {
      diagnostics.push(`batch limit reached (${maxPromptBatches})`);
    }
    if (dedupedBatches.length < queuedBatches.length) {
      diagnostics.push(`deduped ${queuedBatches.length - dedupedBatches.length} duplicate violation(s)`);
    }

    const workerBatchGroups = partitionBatches(batchesToRun, configuredWorkers);
    const workerCount = workerBatchGroups.length || 1;
    if (workerCount > 1) {
      diagnostics.push(`parallel subagents enabled (${workerCount} workers)`);
    }

    if (workerCount <= 1) {
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

      const batches = workerBatchGroups[0] || [];
      let consecutiveEmptyBatches = 0;
      for (const batchConfig of batches) {
        const elapsedSeconds = Math.floor((Date.now() - fixerStartedAt) / 1000);
        const remainingBudgetSeconds = totalTimeoutSeconds - elapsedSeconds;
        if (remainingBudgetSeconds <= 0) {
          fixerWarning = `AI fixer stopped after ${totalTimeoutSeconds}s budget (MVP time limit).`;
          diagnostics.push("overall timeout budget reached");
          break;
        }

        // If multiple batches in a row produce 0 fixes instantly, the model
        // is broken (bad auth, bad format flag, etc.) — stop wasting time.
        if (consecutiveEmptyBatches >= MAX_CONSECUTIVE_EMPTY_BATCHES) {
          fixerWarning = `AI fixer stopped: ${consecutiveEmptyBatches} consecutive batches returned 0 fixes (model may be misconfigured).`;
          diagnostics.push(`early bail: ${consecutiveEmptyBatches} consecutive empty batches`);
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
        const prompt = buildFixPrompt(batch, fixesFilePath);
        const batchStartMs = Date.now();
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
        const batchDurationMs = Date.now() - batchStartMs;
        if (batchResult.diagnostic) {
          diagnostics.push(`batch ${attemptedBatchCount}: ${batchResult.diagnostic}`);
        }

        // Track consecutive failures — if a batch completes in <3s with 0 fixes,
        // the command is likely failing immediately (bad flag, auth, etc.)
        if (batchResult.fixes.length === 0) {
          consecutiveEmptyBatches += 1;
          if (batchDurationMs < MIN_BATCH_DURATION_MS) {
            diagnostics.push(
              `batch ${attemptedBatchCount}: completed in ${batchDurationMs}ms with 0 fixes (likely instant failure)`
            );
          }
        } else {
          consecutiveEmptyBatches = 0;
        }

        for (const fix of batchResult.fixes) {
          const repoFilePath = normalizeRepoFilePath(fix.filePath);
          if (!repoFilePath) continue;

          const violationIds = extractViolationIds(
            fix?.violationId,
            batch.map((v) => v.id)
          );

          for (const violationId of violationIds) {
            const violation = violationById.get(violationId);
            if (!violation) continue;

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

      if (dirs && fixesByViolation.size > 0) {
        const applyStats = await applyFixesToRepoPath(
          dirs.repoPath,
          Array.from(fixesByViolation.values())
        );
        diagnostics.push(
          `applied ${applyStats.appliedFixCount}/${fixesByViolation.size} fix snippet(s) across ${applyStats.changedFileCount} file(s)`
        );
        if (applyStats.appliedFixCount === 0) {
          applyWarning = "AI generated fixes, but none matched source snippets for patching.";
        }
      }
    } else {
      if (!dirs) throw new Error("Fix generation workspace was not initialized.");
      const baseRepoPath = dirs.repoPath;
      const workerSettled = await Promise.allSettled(
        workerBatchGroups.map((batches, index) =>
          runFixWorker({
            workerId: index + 1,
            repoUrl,
            accessToken,
            baseRepoPath,
            selectedModel,
            opencodeTimeoutSeconds,
            totalTimeoutSeconds,
            thinkingVariant,
            batches,
            validViolationIds,
            fixerStartedAt,
          })
        )
      );

      for (const [idx, workerResult] of workerSettled.entries()) {
        if (workerResult.status === "rejected") {
          diagnostics.push(
            `worker ${idx + 1} failed: ${sanitizeDiagnostic(String(workerResult.reason)).slice(0, 200)}`
          );
          continue;
        }

        attemptedBatchCount += workerResult.value.attemptedBatchCount;
        processedViolationCount += workerResult.value.processedViolationCount;
        diagnostics.push(...workerResult.value.diagnostics);

        if (workerResult.value.warning && !fixerWarning) {
          fixerWarning = workerResult.value.warning;
        }

        for (const fix of workerResult.value.fixes) {
          fixesByViolation.set(fix.violationId, fix);
        }
      }

      for (const normalizedFix of fixesByViolation.values()) {
        await prisma.fix.upsert({
          where: { violationId: normalizedFix.violationId },
          update: {
            filePath: normalizedFix.filePath,
            originalCode: normalizedFix.originalCode,
            fixedCode: normalizedFix.fixedCode,
            explanation: normalizedFix.explanation,
            status: "pending",
          },
          create: {
            scanId,
            violationId: normalizedFix.violationId,
            filePath: normalizedFix.filePath,
            originalCode: normalizedFix.originalCode,
            fixedCode: normalizedFix.fixedCode,
            explanation: normalizedFix.explanation,
            status: "pending",
          },
        });
      }

      if (dirs && fixesByViolation.size > 0) {
        const applyStats = await applyFixesToRepoPath(
          dirs.repoPath,
          Array.from(fixesByViolation.values())
        );
        diagnostics.push(
          `applied ${applyStats.appliedFixCount}/${fixesByViolation.size} fix snippet(s) across ${applyStats.changedFileCount} file(s)`
        );
        if (applyStats.appliedFixCount === 0) {
          applyWarning = "AI generated fixes, but none matched source snippets for patching.";
        }
      }

      await prisma.scan.update({
        where: { id: scanId },
        data: {
          errorMessage:
            `AI fixer progress: ${fixesByViolation.size} fix(es) captured after ${attemptedBatchCount} batch(es) across ${workerCount} workers. ` +
            `Elapsed ${Math.floor((Date.now() - fixerStartedAt) / 1000)}s/${totalTimeoutSeconds}s.`,
        },
      });
    }

    const fixes = Array.from(fixesByViolation.values());

    // If no machine-readable fixes were produced, do not fail the full scan.
    // Keep scan complete and expose a useful message for manual follow-up.
    if (!fixes.length) {
      const extra = diagnostics.join(" | ").slice(0, 240);
      const scoreBefore = scan.score ?? calculateAccessibilityScore(scan.violations);
      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: "complete",
          scoreAfter: scoreBefore,
          afterScreenshot: scan.beforeScreenshot,
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
        errorMessage: [fixerWarning, applyWarning, postFixWarning].filter(Boolean).join(" ") || null,
      },
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : "Fix generation failed";
    const msg = sanitizeDiagnostic(rawMsg).slice(0, 500) || "Fix generation failed";
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
  violations: ViolationSummary[],
  fixesFilePath: string
): string {
  const uniqueRuleIds = Array.from(
    new Set(
      violations
        .map((v) => (v.ruleId || "").trim())
        .filter((ruleId): ruleId is string => Boolean(ruleId))
    )
  );
  const verifyRulesArg = uniqueRuleIds.length > 0 ? ` --rules "${uniqueRuleIds.join(",")}"` : "";
  const verifyBeforeCommand =
    `node ${OPENCODE_VERIFY_SCRIPT_PATH}${verifyRulesArg} --out ${OPENCODE_VERIFY_BEFORE_PATH}`;
  const verifyAfterCommand =
    `node ${OPENCODE_VERIFY_SCRIPT_PATH}${verifyRulesArg} --out ${OPENCODE_VERIFY_AFTER_PATH}`;
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

SELF-VALIDATION REQUIREMENT:
- Tool permissions in this sandbox allow shell commands, node/npm, and git.
- Run the checker before edits: ${verifyBeforeCommand}
- Run the checker after edits: ${verifyAfterCommand}
- Use the before/after JSON to confirm targeted counts do not get worse.
- If checker execution fails, continue with best-effort fixes and include "checker_failed" in explanation.

CRITICAL OUTPUT REQUIREMENTS:
- After making each fix, you MUST write a JSON summary to ${fixesFilePath}
- The JSON MUST be: {"fixes": [{"filePath": "...", "originalCode": "...", "fixedCode": "...", "explanation": "...", "violationId": "..."}]}
- originalCode = the exact snippet BEFORE your change
- fixedCode = the exact snippet AFTER your change
- Also print the same JSON as your absolute final output (no markdown, no prose, no commentary)
- Do NOT skip writing ${fixesFilePath} — it is required for the pipeline to capture your work
- Do NOT output planning text, todos, or prose — ONLY the JSON object`;
}

function buildRetryJsonPrompt(
  originalPrompt: string,
  fixesFilePath: string
): string {
  return `The previous run attempted accessibility fixes but did not produce the required JSON output file.

Look at the git diff in this workspace (run \`git diff\`) to see what changes were already made.
For each changed file, produce a JSON summary.

Write to ${fixesFilePath} a JSON object:
{"fixes": [{"filePath": "relative/path", "originalCode": "exact original snippet", "fixedCode": "exact fixed snippet", "explanation": "what was changed", "violationId": "from the original prompt"}]}

Also print this JSON as your final output. No markdown, no prose.
If no changes exist in git diff, attempt the original fixes and write the JSON.

Original task context (for violation IDs):
${originalPrompt.slice(0, 2000)}`;
}

/**
 * OpenCode --format json emits newline-delimited JSON events.
 * Extract the assistant's text content from these events.
 *
 * Actual event shapes from opencode:
 *   {"type":"text",     "part":{"type":"text","text":"..."}}
 *   {"type":"tool_use", "part":{"tool":"write","state":{"input":{"content":"...","filePath":"..."}}}}
 *   {"type":"step_start","part":{...}}
 *   {"type":"step_finish","part":{...}}
 *
 * We want the concatenated text from "text" events, plus any tool-write
 * content that targets .apex-fixes*.json files.
 */
function extractTextFromOpencodeJsonEvents(raw: string): string {
  if (!raw || !raw.includes('"type"')) return "";

  const lines = raw.split(/\r?\n/);
  const textParts: string[] = [];
  // Separate bucket for content written via tool to the fixes file
  const toolWriteContents: string[] = [];
  let foundAnyEvent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;

    try {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const event = JSON.parse(trimmed) as Record<string, any>;
      /* eslint-enable @typescript-eslint/no-explicit-any */

      if (!event.type) continue;
      foundAnyEvent = true;

      const part = event.part;
      if (!part || typeof part !== "object") continue;

      // 1) Text events — the model's streamed text output
      if (event.type === "text" && typeof part.text === "string" && part.text.trim()) {
        textParts.push(part.text);
      }

      // 2) Tool-use events — the model wrote a file via the write tool
      if (event.type === "tool_use" && part.tool === "write") {
        const state = part.state;
        if (state && typeof state === "object") {
          const input = state.input;
          if (input && typeof input === "object") {
            const content = input.content;
            const filePath: string = input.filePath ?? "";
            if (typeof content === "string" && content.trim()) {
              // Prioritise content written to the fixes file
              if (filePath.includes(".apex-fixes")) {
                toolWriteContents.push(content);
              } else {
                // Still useful for fallback extraction
                textParts.push(content);
              }
            }
          }
        }
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  if (!foundAnyEvent) return "";

  // Prefer tool-write content (it's the explicit JSON the model wrote to disk)
  if (toolWriteContents.length > 0) {
    return toolWriteContents.join("\n");
  }
  return textParts.join("\n");
}

function extractFixesFromText(text: string): FixResult[] {
  // First, try to extract text from OpenCode --format json events
  const extractedText = extractTextFromOpencodeJsonEvents(text);
  const textToSearch = extractedText || text;

  const direct = parseFixesJson(textToSearch.trim());
  if (direct.length > 0) return direct;

  // Search in both the extracted text and original for JSON with "fixes" key
  const textsToSearch = extractedText ? [extractedText, text] : [text];
  for (const searchText of textsToSearch) {
    const marker = '"fixes"';
    let cursor = 0;
    while (cursor < searchText.length) {
      const markerIdx = searchText.indexOf(marker, cursor);
      if (markerIdx === -1) break;

      const start = searchText.lastIndexOf("{", markerIdx);
      if (start === -1) {
        cursor = markerIdx + marker.length;
        continue;
      }

      const end = findMatchingJsonObjectEnd(searchText, start);
      if (end === -1) {
        cursor = markerIdx + marker.length;
        continue;
      }

      const parsed = parseFixesJson(searchText.slice(start, end + 1));
      if (parsed.length > 0) return parsed;
      cursor = end + 1;
    }
  }

  return [];
}

function parseFixesJson(raw: string): FixResult[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { fixes?: unknown };
    const fixes: unknown[] = Array.isArray(parsed?.fixes) ? parsed.fixes : [];
    return fixes
      .map((fix: unknown): FixResult | null => {
        if (!fix || typeof fix !== "object") return null;
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const c = fix as Record<string, any>;
        /* eslint-enable @typescript-eslint/no-explicit-any */
        // Accept common aliases the model might use
        const filePath = c.filePath ?? c.file ?? c.path ?? "";
        const originalCode = c.originalCode ?? c.original ?? c.before ?? "";
        const fixedCode = c.fixedCode ?? c.fixed ?? c.after ?? c.replacement ?? "";
        const explanation = c.explanation ?? c.description ?? c.reason ?? c.message ?? "";
        const violationId = c.violationId ?? c.violation_id ?? c.id ?? "";
        if (
          typeof filePath !== "string" || !filePath ||
          typeof originalCode !== "string" || !originalCode ||
          typeof fixedCode !== "string" || !fixedCode
        ) {
          return null;
        }
        return {
          filePath,
          originalCode,
          fixedCode,
          explanation: typeof explanation === "string" ? explanation : "",
          violationId: typeof violationId === "string" ? violationId : "",
        };
      })
      .filter((f): f is FixResult => f !== null);
  } catch {
    return [];
  }
}

function findMatchingJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let idx = start; idx < text.length; idx += 1) {
    const ch = text[idx];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return idx;
      if (depth < 0) return -1;
    }
  }

  return -1;
}

function extractViolationIds(
  rawViolationId: string | null | undefined,
  fallbackViolationIds: string[]
): string[] {
  const fallbackSingle = fallbackViolationIds.length === 1 ? fallbackViolationIds[0] : "";
  const source = (rawViolationId || fallbackSingle || "")
    .replace(/[\[\]"']/g, " ")
    .trim();
  if (!source) return [];

  const ids = source
    .split(/[,\s;|]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  return Array.from(new Set(ids));
}

function sanitizeDiagnostic(input: string): string {
  return input
    .replace(/x-access-token:[^@]+@github\.com/gi, "x-access-token:***@github.com")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "***")
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
  if (
    cleanOut.includes('"type":"step_start"') ||
    cleanOut.includes('"type":"tool_use"') ||
    /^> build\s/m.test(stdout)
  ) {
    // The event stream is now parsed by extractTextFromOpencodeJsonEvents.
    // Only flag it if the caller couldn't extract anything useful.
    return "OpenCode event stream (parsed by extractor).";
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

function parseIntegerEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function partitionBatches(batches: FixBatch[], workerCount: number): FixBatch[][] {
  if (batches.length === 0) return [];
  const groups = Array.from(
    { length: Math.max(1, Math.min(workerCount, batches.length)) },
    () => [] as FixBatch[]
  );
  for (let idx = 0; idx < batches.length; idx += 1) {
    groups[idx % groups.length].push(batches[idx]);
  }
  return groups.filter((group) => group.length > 0);
}

async function runFixWorker(params: {
  workerId: number;
  repoUrl: string;
  accessToken: string;
  baseRepoPath: string;
  selectedModel: string;
  opencodeTimeoutSeconds: number;
  totalTimeoutSeconds: number;
  thinkingVariant: string;
  batches: FixBatch[];
  validViolationIds: Set<string>;
  fixerStartedAt: number;
}): Promise<WorkerRunResult> {
  const fixesByViolation = new Map<string, FixResult>();
  const diagnostics: string[] = [];
  let processedViolationCount = 0;
  let attemptedBatchCount = 0;
  let warning: string | null = null;

  let dirs: { repoPath: string; outputPath: string; base: string } | null = null;
  let sandbox: SandboxInstance | null = null;

  try {
    if (params.batches.length === 0) {
      return {
        workerId: params.workerId,
        fixes: [],
        diagnostics,
        processedViolationCount,
        attemptedBatchCount,
        warning,
      };
    }

    dirs = await createTempDirs();
    try {
      await fs.cp(path.join(params.baseRepoPath, "."), dirs.repoPath, {
        recursive: true,
        force: true,
      });
    } catch {
      await fs.rm(dirs.repoPath, { recursive: true, force: true });
      await fs.mkdir(dirs.repoPath, { recursive: true });
      await cloneRepo(params.repoUrl, dirs.repoPath, params.accessToken);
    }
    sandbox = await createSandbox({
      repoPath: dirs.repoPath,
      outputPath: dirs.outputPath,
    });

    if (params.selectedModel.startsWith("opencode/")) {
      const authCheck = await execInSandbox(sandbox, [
        "bash",
        "-c",
        "opencode auth list 2>&1 || true",
      ]);
      if (authCheck.stdout.includes("0 credentials")) {
        throw new Error(
          `OpenCode credentials are missing in the sandbox. Run 'opencode auth login' for provider access before using model ${params.selectedModel}.`
        );
      }
    }

    let consecutiveEmpty = 0;
    for (const batchConfig of params.batches) {
      const elapsedSeconds = Math.floor((Date.now() - params.fixerStartedAt) / 1000);
      const remainingBudgetSeconds = params.totalTimeoutSeconds - elapsedSeconds;
      if (remainingBudgetSeconds <= 0) {
        warning = `AI fixer stopped after ${params.totalTimeoutSeconds}s budget (MVP time limit).`;
        diagnostics.push(`worker ${params.workerId}: overall timeout budget reached`);
        break;
      }

      if (consecutiveEmpty >= MAX_CONSECUTIVE_EMPTY_BATCHES) {
        warning = `Worker ${params.workerId} stopped: ${consecutiveEmpty} consecutive empty batches.`;
        diagnostics.push(`worker ${params.workerId}: early bail after ${consecutiveEmpty} empty batches`);
        break;
      }

      const batch = batchConfig.violations;
      if (batch.length === 0) continue;

      attemptedBatchCount += 1;
      processedViolationCount += batch.length;

      const batchTimeoutSeconds = Math.max(
        15,
        Math.min(params.opencodeTimeoutSeconds, remainingBudgetSeconds)
      );
      const workerFixesFilePath = `/workspace/.apex-fixes-worker-${params.workerId}.json`;
      const prompt = buildFixPrompt(batch, workerFixesFilePath);
      const batchStartMs = Date.now();
      const batchResult = await runOpencodeFixBatch(
        sandbox,
        params.selectedModel,
        batchTimeoutSeconds,
        workerFixesFilePath,
        prompt,
        batch.map((v) => v.id),
        batchConfig.useThinking,
        params.thinkingVariant
      );
      const batchDurationMs = Date.now() - batchStartMs;
      if (batchResult.diagnostic) {
        diagnostics.push(
          `worker ${params.workerId} batch ${attemptedBatchCount}: ${batchResult.diagnostic}`
        );
      }

      if (batchResult.fixes.length === 0) {
        consecutiveEmpty += 1;
        if (batchDurationMs < MIN_BATCH_DURATION_MS) {
          diagnostics.push(
            `worker ${params.workerId} batch ${attemptedBatchCount}: ${batchDurationMs}ms with 0 fixes (instant failure)`
          );
        }
      } else {
        consecutiveEmpty = 0;
      }

      for (const fix of batchResult.fixes) {
        const repoFilePath = normalizeRepoFilePath(fix.filePath);
        if (!repoFilePath) continue;

        const violationIds = extractViolationIds(
          fix?.violationId,
          batch.map((v) => v.id)
        );

        for (const violationId of violationIds) {
          if (!params.validViolationIds.has(violationId)) continue;

          fixesByViolation.set(violationId, {
            ...fix,
            violationId,
            filePath: repoFilePath,
          });
        }
      }
    }
  } catch (err) {
    diagnostics.push(
      `worker ${params.workerId} error: ${sanitizeDiagnostic(
        err instanceof Error ? err.message : String(err)
      ).slice(0, 220)}`
    );
  } finally {
    if (sandbox) await destroySandbox(sandbox);
    if (dirs) await cleanupTempDirs(dirs.base);
  }

  return {
    workerId: params.workerId,
    fixes: Array.from(fixesByViolation.values()),
    diagnostics,
    processedViolationCount,
    attemptedBatchCount,
    warning,
  };
}

async function applyFixesToRepoPath(
  repoPath: string,
  fixes: FixResult[]
): Promise<{ changedFileCount: number; appliedFixCount: number }> {
  const fixesByFile = new Map<string, FixResult[]>();
  const seenFixesByFile = new Map<string, Set<string>>();
  for (const fix of fixes) {
    const filePath = normalizeRepoFilePath(fix.filePath);
    if (!filePath) continue;

    if (normalizeSnippetForCompare(fix.originalCode) === normalizeSnippetForCompare(fix.fixedCode)) {
      continue;
    }

    const dedupeKey = `${fix.originalCode}\u0000${fix.fixedCode}`;
    const seenForFile = seenFixesByFile.get(filePath) ?? new Set<string>();
    if (seenForFile.has(dedupeKey)) continue;
    seenForFile.add(dedupeKey);
    seenFixesByFile.set(filePath, seenForFile);

    const list = fixesByFile.get(filePath) ?? [];
    list.push(fix);
    fixesByFile.set(filePath, list);
  }

  const repoRoot = path.resolve(repoPath);
  let changedFileCount = 0;
  let appliedFixCount = 0;

  for (const [filePath, fileFixes] of fixesByFile) {
    const absolutePath = path.resolve(repoRoot, filePath);
    if (!(absolutePath === repoRoot || absolutePath.startsWith(`${repoRoot}${path.sep}`))) {
      continue;
    }

    let currentContent: string;
    try {
      currentContent = await fs.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    const originalContent = currentContent;
    let fileAppliedCount = 0;

    for (const fix of fileFixes) {
      const patchResult = applySnippetFix(currentContent, fix.originalCode, fix.fixedCode);
      if (!patchResult.applied) continue;
      currentContent = patchResult.content;
      fileAppliedCount += 1;
    }

    if (fileAppliedCount === 0 || currentContent === originalContent) continue;

    await fs.writeFile(absolutePath, currentContent, "utf8");
    changedFileCount += 1;
    appliedFixCount += fileAppliedCount;
  }

  return { changedFileCount, appliedFixCount };
}

function applySnippetFix(
  content: string,
  originalCode: string,
  fixedCode: string
): { content: string; applied: boolean } {
  if (!originalCode) {
    if (!fixedCode || content === fixedCode) return { content, applied: false };
    return { content: fixedCode, applied: true };
  }

  const exactIdx = content.indexOf(originalCode);
  if (exactIdx !== -1) {
    return {
      content:
        content.slice(0, exactIdx) +
        fixedCode +
        content.slice(exactIdx + originalCode.length),
      applied: true,
    };
  }

  const normalizedContent = content.replace(/\r\n/g, "\n");
  const normalizedOriginal = originalCode.replace(/\r\n/g, "\n");
  const normalizedFixed = fixedCode.replace(/\r\n/g, "\n");
  const normalizedIdx = normalizedContent.indexOf(normalizedOriginal);
  if (normalizedIdx !== -1) {
    return {
      content:
        normalizedContent.slice(0, normalizedIdx) +
        normalizedFixed +
        normalizedContent.slice(normalizedIdx + normalizedOriginal.length),
      applied: true,
    };
  }

  const trimmedOriginal = normalizedOriginal.trim();
  if (!trimmedOriginal) return { content, applied: false };
  const trimmedIdx = normalizedContent.indexOf(trimmedOriginal);
  if (trimmedIdx !== -1) {
    return {
      content:
        normalizedContent.slice(0, trimmedIdx) +
        normalizedFixed.trim() +
        normalizedContent.slice(trimmedIdx + trimmedOriginal.length),
      applied: true,
    };
  }

  const lineFallback = applyLineLevelFix(normalizedContent, normalizedOriginal, normalizedFixed);
  if (lineFallback.applied) return lineFallback;

  return { content, applied: false };
}

function applyLineLevelFix(
  content: string,
  originalCode: string,
  fixedCode: string
): { content: string; applied: boolean } {
  const originalLines = originalCode.split("\n");
  const fixedLines = fixedCode.split("\n");
  if (originalLines.length !== fixedLines.length) {
    return { content, applied: false };
  }

  let next = content;
  let appliedAny = false;

  for (let i = 0; i < originalLines.length; i += 1) {
    const from = originalLines[i];
    const to = fixedLines[i];
    if (from === to) continue;
    if (!from.trim()) continue;
    if (countLineOccurrences(next, from) !== 1) continue;

    const replaced = replaceLineOnce(next, from, to);
    if (replaced === next) continue;
    next = replaced;
    appliedAny = true;
  }

  return { content: next, applied: appliedAny && next !== content };
}

function countLineOccurrences(content: string, line: string): number {
  if (!line) return 0;
  const regex = new RegExp(`(^|\\n)${escapeRegExp(line)}(?=\\n|$)`, "g");
  let count = 0;
  while (regex.exec(content)) {
    count += 1;
  }
  return count;
}

function replaceLineOnce(content: string, from: string, to: string): string {
  if (!from) return content;
  const regex = new RegExp(`(^|\\n)${escapeRegExp(from)}(?=\\n|$)`);
  return content.replace(regex, (_match, prefix: string) => `${prefix}${to}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSnippetForCompare(snippet: string): string {
  return snippet.replace(/\r\n/g, "\n").trim();
}

function buildA11yVerificationScript(): string {
  return `
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

function readArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1] || fallback;
}

function parseRules(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((rule) => rule.trim())
    .filter((rule) => Boolean(rule));
}

const outPath = readArg('--out', '/workspace/.apex-a11y/apex-verify.json');
const targetRules = parseRules(readArg('--rules', ''));

function writeResult(payload) {
  const text = JSON.stringify(payload, null, 2);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, text);
  } catch {}
  try { process.stdout.write(text + '\\n'); } catch {}
}

function countNodes(violation) {
  if (!violation || !Array.isArray(violation.nodes)) return 1;
  return Math.max(1, violation.nodes.length);
}

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
      await new Promise((resolve) => setTimeout(resolve, STATIC_SERVER_BOOT_WAIT));
      if (proc.exitCode === null) return { proc, port };
      killProcess(proc);
    }
    return null;
  }

  try {
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
          await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_INTERVAL));
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
      throw new Error('Unable to load app for verification');
    }

    const results = await new AxeBuilder({ page }).analyze();
    const allViolations = Array.isArray(results.violations) ? results.violations : [];
    const totalViolationNodes = allViolations.reduce(
      (sum, violation) => sum + countNodes(violation),
      0
    );

    const targetSet = new Set(targetRules);
    const scopedViolations = targetRules.length > 0
      ? allViolations.filter((violation) => targetSet.has(violation.id))
      : allViolations;
    const targetViolationNodes = scopedViolations.reduce(
      (sum, violation) => sum + countNodes(violation),
      0
    );
    const targetRuleCounts = {};
    for (const violation of scopedViolations) {
      const key = String(violation.id || '');
      if (!key) continue;
      targetRuleCounts[key] = (targetRuleCounts[key] || 0) + countNodes(violation);
    }

    writeResult({
      ok: true,
      url,
      timestamp: new Date().toISOString(),
      targetRules,
      totalRuleViolations: allViolations.length,
      totalViolationNodes,
      targetRuleViolations: scopedViolations.length,
      targetViolationNodes,
      targetRuleCounts,
    });

    await context.close();
    await browser.close();
    killProcess(devServer);
    killProcess(staticServer);
    process.exit(0);
  } catch (err) {
    const error = err && err.message ? err.message : String(err);
    writeResult({
      ok: false,
      error,
      timestamp: new Date().toISOString(),
      targetRules,
    });
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
    killProcess(devServer);
    killProcess(staticServer);
    process.exit(1);
  }
})().catch((err) => {
  const error = err && err.message ? err.message : String(err);
  writeResult({
    ok: false,
    error,
    timestamp: new Date().toISOString(),
    targetRules,
  });
  process.exit(1);
});
`;
}

async function ensureA11yVerificationScript(sandbox: SandboxInstance): Promise<void> {
  const script = buildA11yVerificationScript();
  const scriptB64 = Buffer.from(script).toString("base64");
  await execInSandbox(sandbox, [
    "bash",
    "-c",
    `mkdir -p ${shellQuote(OPENCODE_VERIFY_DIR)};
if [ ! -s ${shellQuote(OPENCODE_VERIFY_SCRIPT_PATH)} ]; then
echo '${scriptB64}' | base64 -d > ${shellQuote(OPENCODE_VERIFY_SCRIPT_PATH)};
chmod +x ${shellQuote(OPENCODE_VERIFY_SCRIPT_PATH)};
fi`,
  ], {
    timeoutMs: 90_000,
  });
}

async function readVerificationOutput(
  sandbox: SandboxInstance,
  filePath: string
): Promise<Record<string, unknown> | null> {
  const result = await execInSandbox(sandbox, [
    "bash",
    "-c",
    `if [ -f ${shellQuote(filePath)} ]; then cat ${shellQuote(filePath)}; else exit 3; fi`,
  ], {
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0) return null;

  const raw = result.stdout.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function numberFromRecord(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) return null;
  const raw = record[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringFromRecord(record: Record<string, unknown> | null, key: string): string {
  if (!record) return "";
  const raw = record[key];
  return typeof raw === "string" ? raw : "";
}

async function collectVerificationDiagnostic(sandbox: SandboxInstance): Promise<string> {
  const before = await readVerificationOutput(sandbox, OPENCODE_VERIFY_BEFORE_PATH).catch(() => null);
  const after = await readVerificationOutput(sandbox, OPENCODE_VERIFY_AFTER_PATH).catch(() => null);

  if (!before && !after) return "";

  const beforeTargetNodes = numberFromRecord(before, "targetViolationNodes");
  const afterTargetNodes = numberFromRecord(after, "targetViolationNodes");
  if (beforeTargetNodes !== null && afterTargetNodes !== null) {
    const delta = afterTargetNodes - beforeTargetNodes;
    const deltaLabel = delta === 0 ? "0" : delta > 0 ? `+${delta}` : `${delta}`;
    return `checker target nodes ${beforeTargetNodes}->${afterTargetNodes} (${deltaLabel})`;
  }

  const afterError = stringFromRecord(after, "error");
  if (afterError) {
    return `checker after failed: ${sanitizeDiagnostic(afterError).slice(0, 120)}`;
  }

  const beforeError = stringFromRecord(before, "error");
  if (beforeError) {
    return `checker before failed: ${sanitizeDiagnostic(beforeError).slice(0, 120)}`;
  }

  if (afterTargetNodes !== null) {
    return `checker after target nodes ${afterTargetNodes}`;
  }

  if (beforeTargetNodes !== null) {
    return `checker before target nodes ${beforeTargetNodes}`;
  }

  return "";
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
  let verifierSetupDiagnostic = "";
  try {
    await ensureA11yVerificationScript(sandbox);
  } catch (err) {
    const raw =
      err instanceof Error ? err.message : typeof err === "string" ? err : "unknown verifier setup error";
    verifierSetupDiagnostic = `checker setup failed: ${sanitizeDiagnostic(raw).slice(0, 120)}`;
  }

  const beforeDirtyContents = await captureDirtyWorkspaceSnapshot(sandbox);
  const opencodeExecTimeoutMs = Math.max(
    120_000,
    (opencodeTimeoutSeconds + 25) * 1000
  );
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const escapedModel = selectedModel.replace(/"/g, '\\"');
  const escapedVariant = thinkingVariant.replace(/"/g, '\\"');
  const escapedFixesFilePath = fixesFilePath.replace(/"/g, '\\"');
  const defaultFixesFilePath = "/workspace/.apex-fixes.json";
  const escapedDefaultFixesFilePath = defaultFixesFilePath.replace(/"/g, '\\"');
  const escapedVerifyBeforePath = OPENCODE_VERIFY_BEFORE_PATH.replace(/"/g, '\\"');
  const escapedVerifyAfterPath = OPENCODE_VERIFY_AFTER_PATH.replace(/"/g, '\\"');
  const thinkingArg = useThinking ? " --thinking" : "";
  const variantArg = useThinking && escapedVariant ? ` --variant "${escapedVariant}"` : "";

  // Use --format json to get structured events we can parse for the final text content.
  // The model's actual response is in events of type "text" or the assistant message.
  // Also check the .apex-fixes.json file which the model may write via tool use.
  const result = await execInSandbox(sandbox, [
    "bash",
    "-c",
    `rm -f "${escapedFixesFilePath}" "${escapedDefaultFixesFilePath}" "${escapedVerifyBeforePath}" "${escapedVerifyAfterPath}" /tmp/opencode-out.txt /tmp/opencode-err.txt /tmp/opencode-raw.txt;
timeout ${opencodeTimeoutSeconds}s opencode run -m "${escapedModel}"${thinkingArg}${variantArg} "${escapedPrompt}" --format json > /tmp/opencode-raw.txt 2> /tmp/opencode-err.txt || true;
if [ -f "${escapedFixesFilePath}" ]; then cat "${escapedFixesFilePath}";
elif [ "${escapedFixesFilePath}" != "${escapedDefaultFixesFilePath}" ] && [ -f "${escapedDefaultFixesFilePath}" ]; then cat "${escapedDefaultFixesFilePath}";
else
  cat /tmp/opencode-raw.txt 2>/dev/null || echo '{"fixes":[]}'; fi`,
  ], {
    timeoutMs: opencodeExecTimeoutMs,
  });

  let opencodeErr = "";
  try {
    const errResult = await execInSandbox(sandbox, [
      "bash",
      "-c",
      "if [ -f /tmp/opencode-err.txt ]; then cat /tmp/opencode-err.txt; fi",
    ], {
      timeoutMs: 20_000,
    });
    opencodeErr = errResult.stdout.trim();
  } catch {
    // Best effort.
  }

  let fixes = parseFixesJson(result.stdout.trim());
  if (!fixes.length) {
    fixes = extractFixesFromText(result.stdout);
  }

  if (!fixes.length && opencodeErr) {
    fixes = extractFixesFromText(opencodeErr);
  }

  const fallbackIds = Array.from(new Set(fallbackViolationIds.filter(Boolean)));
  const fallbackViolationTag = fallbackIds.join(",");

  if (!fixes.length) {
    const fromStdoutDiff = extractFixesFromDiff(result.stdout, fallbackViolationTag);
    if (fromStdoutDiff.length) {
      fixes = assignFallbackViolationIds(fromStdoutDiff, fallbackIds);
    }
  }

  if (!fixes.length && opencodeErr) {
    const fromStderrDiff = extractFixesFromDiff(opencodeErr, fallbackViolationTag);
    if (fromStderrDiff.length) {
      fixes = assignFallbackViolationIds(fromStderrDiff, fallbackIds);
    }
  }

  // Always check workspace for actual file changes — this is the most reliable
  // signal that the model did work, even if it didn't write JSON.
  const workspaceDerivedFixes = await extractAppliedFixesFromWorkspace(
    sandbox,
    beforeDirtyContents,
    fallbackIds
  );
  const likelyEditFailure = likelyUnappliedEditFailure(`${result.stdout}\n${opencodeErr}`);

  if (workspaceDerivedFixes.length > 0) {
    fixes = workspaceDerivedFixes;
  } else if (fixes.length > 0) {
    fixes = await keepPatchableFixes(sandbox, fixes);
  }

  // Retry: if we got zero fixes and the model likely ran (non-empty output),
  // try a simpler prompt that just asks for JSON based on the git diff.
  if (fixes.length === 0 && OPENCODE_RETRY_ON_EMPTY) {
    const gitDiffResult = await execInSandbox(sandbox, [
      "bash", "-c",
      "cd /workspace && git diff --no-color 2>/dev/null || true",
    ], { timeoutMs: 15_000 });

    if (gitDiffResult.stdout.trim()) {
      // Model edited files but didn't write JSON — extract from the diff
      const diffFixes = extractFixesFromDiff(gitDiffResult.stdout, fallbackViolationTag);
      if (diffFixes.length > 0) {
        fixes = assignFallbackViolationIds(diffFixes, fallbackIds);
      }
    } else if (result.stdout.length > 50) {
      // Model produced output but no file edits and no JSON — retry with
      // a shorter extraction-only prompt asking it to just output JSON.
      const retryPrompt = buildRetryJsonPrompt(prompt, fixesFilePath);
      const retryEscaped = retryPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const retryTimeoutSeconds = Math.min(60, Math.max(15, opencodeTimeoutSeconds / 2));
      const retryResult = await execInSandbox(sandbox, [
        "bash", "-c",
        `rm -f "${escapedFixesFilePath}" "${escapedDefaultFixesFilePath}";
timeout ${retryTimeoutSeconds}s opencode run -m "${escapedModel}" "${retryEscaped}" --format json > /tmp/opencode-retry.txt 2>/dev/null || true;
if [ -f "${escapedFixesFilePath}" ]; then cat "${escapedFixesFilePath}";
elif [ -f "${escapedDefaultFixesFilePath}" ]; then cat "${escapedDefaultFixesFilePath}";
else cat /tmp/opencode-retry.txt 2>/dev/null || echo '{"fixes":[]}'; fi`,
      ], { timeoutMs: (retryTimeoutSeconds + 20) * 1000 });

      let retryFixes = parseFixesJson(retryResult.stdout.trim());
      if (!retryFixes.length) retryFixes = extractFixesFromText(retryResult.stdout);
      if (retryFixes.length > 0) {
        fixes = retryFixes;
      }
    }
  }

  const singleViolationId = fallbackViolationIds.length === 1 ? fallbackViolationIds[0] : "";
  if (singleViolationId) {
    fixes = fixes.map((fix) => ({
      ...fix,
      violationId: fix.violationId || singleViolationId,
    }));
  }

  const verificationDiagnostic = await collectVerificationDiagnostic(sandbox).catch(() => "");
  const diagnosticParts: string[] = [];
  const baseDiagnostic = compactFixerDiagnostic(result.stdout, opencodeErr);
  if (baseDiagnostic) diagnosticParts.push(baseDiagnostic);
  if (workspaceDerivedFixes.length > 0) {
    diagnosticParts.push(`used workspace diff (${workspaceDerivedFixes.length} file change(s))`);
  } else if (likelyEditFailure && fixes.length === 0) {
    diagnosticParts.push("edit tool failed before producing patchable changes.");
  }
  if (verificationDiagnostic) diagnosticParts.push(verificationDiagnostic);
  if (verifierSetupDiagnostic) diagnosticParts.push(verifierSetupDiagnostic);
  const diagnostic = diagnosticParts.join(" | ").slice(0, 240);

  return {
    fixes,
    diagnostic,
  };
}

async function captureDirtyWorkspaceSnapshot(
  sandbox: SandboxInstance
): Promise<Map<string, string>> {
  const files = await listDirtyWorkspaceFiles(sandbox);
  const snapshot = new Map<string, string>();

  for (const filePath of files) {
    const content = await readWorkspaceFileContent(sandbox, filePath);
    if (content === null) continue;
    snapshot.set(filePath, content);
  }

  return snapshot;
}

async function extractAppliedFixesFromWorkspace(
  sandbox: SandboxInstance,
  beforeDirtyContents: Map<string, string>,
  fallbackViolationIds: string[]
): Promise<FixResult[]> {
  const afterDirtyFiles = await listDirtyWorkspaceFiles(sandbox);
  if (!afterDirtyFiles.length) return [];

  const appliedFixes: FixResult[] = [];
  for (const filePath of afterDirtyFiles) {
    const fixedCode = await readWorkspaceFileContent(sandbox, filePath);
    if (fixedCode === null) continue;

    let originalCode = beforeDirtyContents.get(filePath);
    if (originalCode === undefined) {
      originalCode = await readHeadFileContent(sandbox, filePath);
    }

    if (normalizeSnippetForCompare(originalCode) === normalizeSnippetForCompare(fixedCode)) {
      continue;
    }

    appliedFixes.push({
      filePath,
      originalCode,
      fixedCode,
      explanation: "Derived from the sandbox git diff after model edits.",
      violationId: "",
    });
  }

  return assignFallbackViolationIds(appliedFixes, fallbackViolationIds);
}

async function keepPatchableFixes(
  sandbox: SandboxInstance,
  fixes: FixResult[]
): Promise<FixResult[]> {
  if (!fixes.length) return [];

  const grouped = new Map<string, FixResult[]>();
  for (const fix of fixes) {
    const filePath = normalizeRepoFilePath(fix.filePath);
    if (!filePath) continue;
    const next = grouped.get(filePath) ?? [];
    next.push({ ...fix, filePath });
    grouped.set(filePath, next);
  }

  const validFixes: FixResult[] = [];
  for (const [filePath, fileFixes] of grouped) {
    let currentContent = await readWorkspaceFileContent(sandbox, filePath);
    if (currentContent === null) continue;

    for (const fix of fileFixes) {
      const probe = applySnippetFix(currentContent, fix.originalCode, fix.fixedCode);
      if (!probe.applied) continue;
      validFixes.push(fix);
      currentContent = probe.content;
    }
  }

  return validFixes;
}

async function listDirtyWorkspaceFiles(sandbox: SandboxInstance): Promise<string[]> {
  const result = await execInSandbox(sandbox, [
    "bash",
    "-c",
    "cd /workspace && git diff --name-only --diff-filter=ACMRTUXB --",
  ]);
  if (result.exitCode !== 0) return [];

  const files = result.stdout
    .split(/\r?\n/)
    .map((line) => normalizeRepoFilePath(line.trim()))
    .filter((line): line is string => Boolean(line));

  return Array.from(new Set(files));
}

async function readWorkspaceFileContent(
  sandbox: SandboxInstance,
  filePath: string
): Promise<string | null> {
  const normalized = normalizeRepoFilePath(filePath);
  if (!normalized) return null;

  const absolutePath = `/workspace/${normalized}`;
  const result = await execInSandbox(sandbox, [
    "bash",
    "-c",
    `if [ -f ${shellQuote(absolutePath)} ]; then cat ${shellQuote(absolutePath)}; else exit 3; fi`,
  ]);

  if (result.exitCode !== 0) return null;
  return result.stdout;
}

async function readHeadFileContent(
  sandbox: SandboxInstance,
  filePath: string
): Promise<string> {
  const normalized = normalizeRepoFilePath(filePath);
  if (!normalized) return "";

  const result = await execInSandbox(sandbox, [
    "bash",
    "-c",
    `cd /workspace && git cat-file -p ${shellQuote(`HEAD:${normalized}`)} 2>/dev/null || true`,
  ]);

  if (result.exitCode !== 0) return "";
  return result.stdout;
}

function likelyUnappliedEditFailure(rawOutput: string): boolean {
  const normalized = sanitizeDiagnostic(rawOutput).toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes("edit failed") ||
    normalized.includes("found multiple matches for oldstring") ||
    normalized.includes("failed to apply") ||
    normalized.includes("patch failed")
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function extractFixesFromDiff(diffOutput: string, violationId: string): FixResult[] {
  if (!diffOutput) return [];
  const clean = diffOutput.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = clean.split(/\r?\n/);
  const fixes: FixResult[] = [];

  let i = 0;
  while (i < lines.length) {
    const filePath = extractDiffFilePath(lines[i] || "");
    if (!filePath) {
      i += 1;
      continue;
    }

    i += 1;

    let inHunk = false;
    const oldLines: string[] = [];
    const newLines: string[] = [];

    while (i < lines.length && !isDiffFileBoundary(lines[i] || "")) {
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

function assignFallbackViolationIds(
  fixes: FixResult[],
  fallbackViolationIds: string[]
): FixResult[] {
  if (!fixes.length || !fallbackViolationIds.length) return fixes;
  if (fixes.length === 1) {
    const fallbackId = fallbackViolationIds[0] || "";
    return [{ ...fixes[0], violationId: fixes[0].violationId || fallbackId }];
  }

  return fixes.map((fix, idx) => ({
    ...fix,
    violationId:
      fix.violationId ||
      fallbackViolationIds[Math.min(idx, fallbackViolationIds.length - 1)] ||
      "",
  }));
}

function isDiffFileBoundary(line: string): boolean {
  return line.startsWith("Index: ") || line.startsWith("diff --git ");
}

function extractDiffFilePath(line: string): string | null {
  if (line.startsWith("Index: ")) {
    return normalizeRepoFilePath(line.slice("Index: ".length).trim());
  }

  const gitDiffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (gitDiffMatch) {
    return normalizeRepoFilePath(gitDiffMatch[2]);
  }

  return null;
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
