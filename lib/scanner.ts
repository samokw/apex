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
import {
  calculateAccessibilityScore,
  extractWcagCriteria,
  isAodaRelevant,
  getImpactWeight,
} from "./wcag";
import fs from "fs/promises";
import path from "path";

interface AxeViolation {
  id: string;
  impact: string;
  description: string;
  helpUrl: string;
  tags: string[];
  nodes: Array<{
    html: string;
    target: string[];
  }>;
}

interface ScanResult {
  violations: AxeViolation[];
  url: string;
  timestamp: string;
}

export async function runScan(scanId: string, accessToken: string) {
  const scan = await prisma.scan.findUnique({ where: { id: scanId } });
  if (!scan) throw new Error("Scan not found");

  const repoUrl = `https://github.com/${scan.repoOwner}/${scan.repoName}`;
  let dirs: { repoPath: string; outputPath: string; base: string } | null = null;
  let sandbox: SandboxInstance | null = null;

  try {
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: "cloning" },
    });

    dirs = await createTempDirs();
    await cloneRepo(repoUrl, dirs.repoPath, accessToken);

    await prisma.scan.update({
      where: { id: scanId },
      data: { status: "scanning" },
    });

    sandbox = await createSandbox({
      repoPath: dirs.repoPath,
      outputPath: dirs.outputPath,
    });

    await execInSandbox(sandbox, [
      "bash", "-c",
      "cd /workspace && npm install --legacy-peer-deps 2>/dev/null || yarn install 2>/dev/null || true",
    ]);

    const scanScript = `
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const fs = require('fs');
const http = require('http');
const pathMod = require('path');
const net = require('net');

function checkPort(port) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(1500);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, '127.0.0.1');
  });
}

(async () => {
  console.log('Starting scan...');
  let url = null;
  let devServer = null;
  let staticServer = null;

  const pkgPath = '/workspace/package.json';
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const scripts = pkg.scripts || {};
    const startCmd = scripts.dev || scripts.start || scripts.serve;
    if (startCmd) {
      console.log('Attempting to start dev server...');
      const { spawn } = require('child_process');
      devServer = spawn('npm', ['run', scripts.dev ? 'dev' : scripts.start ? 'start' : 'serve'], {
        cwd: '/workspace',
        stdio: 'pipe',
        env: { ...process.env, PORT: '3000', NODE_ENV: 'development' },
      });
      devServer.stderr.on('data', d => console.log('server stderr:', d.toString().substring(0, 200)));
      devServer.stdout.on('data', d => console.log('server stdout:', d.toString().substring(0, 200)));
      await new Promise(r => setTimeout(r, 8000));
    }
  }

  const ports = [3000, 5173, 4173, 8080, 8000, 4200];
  for (const p of ports) {
    if (await checkPort(p)) {
      url = 'http://127.0.0.1:' + p;
      console.log('Found dev server at port', p);
      break;
    }
  }

  if (!url) {
    const candidates = [
      '/workspace/index.html',
      '/workspace/public/index.html',
      '/workspace/dist/index.html',
      '/workspace/build/index.html',
      '/workspace/out/index.html',
    ];
    for (const f of candidates) {
      if (fs.existsSync(f)) {
        const serveDir = pathMod.dirname(f);
        staticServer = http.createServer((req, res) => {
          let reqPath = req.url.split('?')[0];
          if (reqPath === '/') reqPath = '/index.html';
          const filePath = pathMod.join(serveDir, reqPath);
          const ext = pathMod.extname(filePath);
          const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
          fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
            res.end(data);
          });
        });
        const port = await new Promise((resolve, reject) => {
          staticServer.listen(0, '127.0.0.1', () => resolve(staticServer.address().port));
          staticServer.on('error', reject);
        });
        url = 'http://127.0.0.1:' + port;
        console.log('Serving static file via HTTP on port ' + port + ':', f);
        break;
      }
    }
  }

  if (!url) {
    const error = 'No running dev server found and no index.html in the repository. Make sure the repo has a web frontend with an index.html or a dev server script.';
    console.error(error);
    fs.writeFileSync('/output/scan-error.json', JSON.stringify({ error }));
    if (devServer) devServer.kill();
    process.exit(1);
  }

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log('Page loaded:', url);

  console.log('Taking screenshot...');
  await page.screenshot({ path: '/output/before.png', fullPage: true });

  console.log('Running axe-core analysis...');
  const results = await new AxeBuilder({ page }).analyze();

  console.log('Found', results.violations.length, 'violations');
  fs.writeFileSync('/output/scan-results.json', JSON.stringify({
    violations: results.violations,
    url: url,
    timestamp: new Date().toISOString()
  }, null, 2));

  await context.close();
  await browser.close();
  if (staticServer) staticServer.close();
  console.log('Scan complete.');
  process.exit(0);
})().catch(err => {
  console.error('Scan error:', err.message);
  const fs = require('fs');
  fs.writeFileSync('/output/scan-error.json', JSON.stringify({ error: err.message }));
  process.exit(1);
});
`;

    const scriptB64 = Buffer.from(scanScript).toString("base64");
    const execResult = await execInSandbox(sandbox, [
      "bash", "-c",
      `echo '${scriptB64}' | base64 -d > /tmp/scan.js && node /tmp/scan.js 2>&1`,
    ]);

    console.log("[Apex Scanner] exit:", execResult.exitCode, "stdout:", execResult.stdout.substring(0, 500));

    const resultsPath = path.join(dirs.outputPath, "scan-results.json");
    let scanResults: ScanResult;

    try {
      const raw = await fs.readFile(resultsPath, "utf-8");
      scanResults = JSON.parse(raw);
    } catch {
      const errorPath = path.join(dirs.outputPath, "scan-error.json");
      let errorMsg = `Scan script failed (exit ${execResult.exitCode})`;
      try {
        const errRaw = await fs.readFile(errorPath, "utf-8");
        errorMsg = JSON.parse(errRaw).error;
      } catch {
        if (execResult.stdout) {
          errorMsg += ": " + execResult.stdout.substring(0, 300);
        }
      }

      await prisma.scan.update({
        where: { id: scanId },
        data: { status: "failed", errorMessage: errorMsg },
      });
      return;
    }

    const screenshotPath = path.join(dirs.outputPath, "before.png");
    let screenshotData: string | null = null;
    try {
      const buf = await fs.readFile(screenshotPath);
      screenshotData = buf.toString("base64");
    } catch { /* no screenshot */ }

    for (const violation of scanResults.violations) {
      const wcagCriteria = extractWcagCriteria(violation.tags);
      const aodaRelevant = isAodaRelevant(wcagCriteria);
      const weight = getImpactWeight(violation.impact);

      for (const node of violation.nodes) {
        await prisma.violation.create({
          data: {
            scanId,
            ruleId: violation.id,
            impact: violation.impact,
            description: violation.description,
            helpUrl: violation.helpUrl,
            wcagCriteria: wcagCriteria.join(","),
            aodaRelevant,
            targetElement: node.target.join(" > "),
            htmlSnippet: node.html.substring(0, 2000),
            score: weight,
          },
        });
      }
    }

    const allViolations = await prisma.violation.findMany({
      where: { scanId },
    });
    const score = calculateAccessibilityScore(allViolations);

    await prisma.scan.update({
      where: { id: scanId },
      data: {
        status: "complete",
        score,
        beforeScreenshot: screenshotData,
        containerId: sandbox.containerId,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: "failed", errorMessage },
    });
  } finally {
    if (sandbox) await destroySandbox(sandbox);
    if (dirs) await cleanupTempDirs(dirs.base);
  }
}
