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
    console.log(`[Scan ${scanId}] Starting — cloning ${repoUrl}`);
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: "cloning" },
    });

    dirs = await createTempDirs();
    await cloneRepo(repoUrl, dirs.repoPath, accessToken);
    console.log(`[Scan ${scanId}] Clone done — creating sandbox`);

    await prisma.scan.update({
      where: { id: scanId },
      data: { status: "scanning" },
    });

    sandbox = await createSandbox({
      repoPath: dirs.repoPath,
      outputPath: dirs.outputPath,
    });
    console.log(`[Scan ${scanId}] Sandbox up — running scan script (browser + axe)...`);

    const scanScript = `
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

(async () => {
  console.log('Starting scan...');
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
  const SERVER_WAIT_TIMEOUT = 45000;
  const SERVER_POLL_INTERVAL = 1500;
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
        if (fs.existsSync(full + '/package.json') || fs.existsSync(full + '/index.html')) {
          discovered.push(full);
        }
        queue.push({ dir: full, depth: current.depth + 1 });
      }
    }

    return Array.from(new Set(discovered));
  }

  async function tryConnectToPort() {
    for (const port of ports) {
      try {
        await page.goto('http://localhost:' + port, { timeout: PORT_CONNECT_TIMEOUT, waitUntil: 'domcontentloaded' });
        console.log('Connected to dev server at port', port);
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
      "server.listen(port,'0.0.0.0',()=>console.log('Static server listening', port, root));",
    ].join('\\n');

    for (const port of staticPorts) {
      const proc = spawn('node', ['-e', serverScript, rootDir, String(port)], {
        stdio: 'pipe',
        detached: true,
        env: { ...process.env, NODE_ENV: 'development' },
      });
      proc.stderr.on('data', d => console.log('static stderr:', d.toString().substring(0, 200)));
      proc.stdout.on('data', d => console.log('static stdout:', d.toString().substring(0, 200)));
      await new Promise(r => setTimeout(r, STATIC_SERVER_BOOT_WAIT));

      if (proc.exitCode === null) {
        return { proc, port };
      }
      killProcess(proc);
    }

    return null;
  }

  const candidateDirs = collectCandidateDirs(workspace);
  console.log('Scan candidate directories:', candidateDirs.join(', '));

  // Try starting a dev server from each candidate directory
  for (const cwd of candidateDirs) {
    const pkgPath = cwd + '/package.json';
    if (!fs.existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};
      const scriptName = scripts.dev ? 'dev' : scripts.start ? 'start' : scripts.serve ? 'serve' : null;
      if (!scriptName) continue;

      console.log('Attempting to start dev server in', cwd, 'using script', scriptName);

      try {
        if (!fs.existsSync(cwd + '/node_modules')) {
          console.log('Installing dependencies in', cwd, '...');
          execSync('npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund', {
            cwd,
            stdio: 'pipe',
            env: { ...process.env, NODE_ENV: 'development' },
            timeout: NPM_INSTALL_TIMEOUT,
          });
          console.log('Dependencies installed in', cwd);
        } else {
          console.log('node_modules already exists in', cwd, ', skipping install');
        }
      } catch (installErr) {
        console.log('Dependency install failed in', cwd, ':', String(installErr).substring(0, 200));
      }

      devServer = spawn('npm', ['run', scriptName], {
        cwd,
        stdio: 'pipe',
        detached: true,
        env: { ...process.env, PORT: '3000', NODE_ENV: 'development' },
      });
      devServer.stderr.on('data', d => console.log('server stderr:', d.toString().substring(0, 200)));
      devServer.stdout.on('data', d => console.log('server stdout:', d.toString().substring(0, 200)));

      const startedAt = Date.now();
      while (Date.now() - startedAt < SERVER_WAIT_TIMEOUT) {
        await new Promise(r => setTimeout(r, SERVER_POLL_INTERVAL));
        url = await tryConnectToPort();
        if (url) break;
        if (devServer.exitCode !== null) {
          console.log('Dev server exited with code', devServer.exitCode, 'in', cwd);
          break;
        }
      }

      if (url) break;

      if (devServer) {
        killProcess(devServer);
        devServer = null;
      }
    } catch (err) {
      console.log('Failed reading package in', cwd, ':', String(err).substring(0, 200));
    }
  }

  // Also try connecting to an already running server (without launching anything)
  if (!url) {
    url = await tryConnectToPort();
  }

  // Fallback to static HTML
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
      if (fs.existsSync(candidate.file)) {
        if (staticServer) {
          killProcess(staticServer);
          staticServer = null;
        }
        const started = await startStaticServer(candidate.root);
        if (!started) {
          console.log('Unable to start static server for', candidate.root);
          continue;
        }

        const candidateUrl = 'http://localhost:' + started.port + candidate.route;
        const staticPage = await context.newPage();
        try {
          await staticPage.goto(candidateUrl, { timeout: 12000, waitUntil: 'domcontentloaded' });
          await staticPage.waitForTimeout(STATIC_PAGE_SETTLE_WAIT);
          if (staticPage.url().startsWith('chrome-error://')) {
            throw new Error('Chromium failed to render static file');
          }
          const renderProbe = await staticPage.evaluate(() => {
            const body = document.body;
            return {
              textLen: body && body.innerText ? body.innerText.trim().length : 0,
              childCount: body ? body.querySelectorAll('*').length : 0,
            };
          });
          if (renderProbe.textLen === 0 && renderProbe.childCount < 3) {
            throw new Error('Static HTML rendered as blank page');
          }

          await page.close().catch(() => {});
          page = staticPage;
          staticServer = started.proc;
          url = candidateUrl;
          console.log('Using static HTML via HTTP:', candidate.file, candidateUrl);
          break;
        } catch (err) {
          console.log('Static candidate failed:', candidate.file, String(err).substring(0, 180));
          await staticPage.close().catch(() => {});
          killProcess(started.proc);
        }
      }
    }
  }

  if (!url) {
    const error = 'No running dev server found and no index.html in the repository. Make sure the repo has a web frontend with an index.html or a dev server script.';
    console.error(error);
    fs.writeFileSync('/output/scan-error.json', JSON.stringify({ error }));
    await context.close();
    await browser.close();
    if (devServer) killProcess(devServer);
    if (staticServer) killProcess(staticServer);
    process.exit(1);
  }

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
  if (devServer) killProcess(devServer);
  if (staticServer) killProcess(staticServer);
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
    const execResult = await execInSandbox(
      sandbox,
      [
        "bash", "-c",
        `echo '${scriptB64}' | base64 -d > /tmp/scan.js && node /tmp/scan.js 2>&1`,
      ],
      {
        onOutput: (chunk) => process.stdout.write(chunk),
      }
    );

    console.log("[Scan " + scanId + "] Script finished — exit:", execResult.exitCode);

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
