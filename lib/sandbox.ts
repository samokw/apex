import Docker from "dockerode";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import os from "os";

// Windows Docker Desktop uses a named pipe; Linux/macOS use a Unix socket.
// Prefer DOCKER_SOCKET so it works when server runs in WSL or process.platform is wrong.
const WINDOWS_PIPE = "//./pipe/docker_engine";
const UNIX_SOCKET = "/var/run/docker.sock";
const defaultSocket =
  process.platform === "win32" ? WINDOWS_PIPE : UNIX_SOCKET;
const socketPath =
  process.env.DOCKER_SOCKET ||
  (process.env.DOCKER_HOST?.startsWith("npipe://") ? WINDOWS_PIPE : null) ||
  defaultSocket;

const docker = new Docker({ socketPath });

const SCANNER_IMAGE = process.env.SCANNER_IMAGE || "apex-scanner:latest";

export interface SandboxConfig {
  repoPath: string;
  outputPath: string;
  envVars?: Record<string, string>;
}

export interface SandboxInstance {
  containerId: string;
  repoPath: string;
  outputPath: string;
}

export async function createTempDirs() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "apex-"));
  const repoPath = path.join(base, "repo");
  const outputPath = path.join(base, "output");
  await fs.mkdir(repoPath, { recursive: true });
  await fs.mkdir(outputPath, { recursive: true });
  return { repoPath, outputPath, base };
}

export async function cloneRepo(
  repoUrl: string,
  targetPath: string,
  token: string
): Promise<void> {
  const authedUrl = repoUrl.replace(
    "https://github.com/",
    `https://x-access-token:${token}@github.com/`
  );

  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const { spawnSync } = await import("child_process");
  const result = spawnSync("git", ["clone", "--depth", "1", authedUrl, targetPath], {
    stdio: "pipe",
    timeout: 120000,
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "unknown clone error")
      .toString()
      .trim()
      .slice(0, 800);
    throw new Error(`git clone failed: ${details}`);
  }
}

export async function createSandbox(
  config: SandboxConfig
): Promise<SandboxInstance> {
  const envVars = Object.entries(config.envVars ?? {}).map(
    ([k, v]) => `${k}=${v}`
  );

  if (process.env.ANTHROPIC_API_KEY) {
    envVars.push(`ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`);
  }

  const binds = [
    `${config.repoPath}:/workspace:rw`,
    `${config.outputPath}:/output:rw`,
    `apex-npm-cache:/root/.npm:rw`,
  ];

  const opencodeAuthBind = resolveOpenCodeAuthBind();
  if (opencodeAuthBind) {
    binds.push(opencodeAuthBind);
  }

  const container = await docker.createContainer({
    Image: SCANNER_IMAGE,
    Cmd: ["sleep", "3600"],
    Env: envVars,
    HostConfig: {
      Binds: binds,
      AutoRemove: true,
      Memory: 3 * 1024 * 1024 * 1024,
      NanoCpus: 2 * 1e9,
      Tmpfs: { "/tmp": "rw,exec,nosuid,size=256m" },
    },
    WorkingDir: "/workspace",
  });

  await container.start();

  return {
    containerId: container.id,
    repoPath: config.repoPath,
    outputPath: config.outputPath,
  };
}

export type ExecInSandboxOptions = {
  /** Called with each chunk of stdout/stderr as it arrives (e.g. for live logs) */
  onOutput?: (chunk: string) => void;
  /** Timeout in milliseconds (default: 120s). Resolves with exitCode -1 on timeout. */
  timeoutMs?: number;
};

export async function execInSandbox(
  sandbox: SandboxInstance,
  command: string[],
  options?: ExecInSandboxOptions
): Promise<{ stdout: string; exitCode: number }> {
  const container = docker.getContainer(sandbox.containerId);

  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
    WorkingDir: "/workspace",
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const onOutput = options?.onOutput;
    const timeoutMs = options?.timeoutMs ?? 120_000;
    let settled = false;

    // Docker multiplexed stream format: each frame is
    //   [stream_type(1)][0(3)][size(4 big-endian)][payload(size bytes)]
    // stream_type: 1=stdout, 2=stderr
    // We must demux to get clean text without binary frame headers.
    let pendingBuf = Buffer.alloc(0);

    function demuxPending() {
      while (pendingBuf.length >= 8) {
        const streamType = pendingBuf[0]; // 1=stdout, 2=stderr
        const frameSize = pendingBuf.readUInt32BE(4);
        if (pendingBuf.length < 8 + frameSize) break; // incomplete frame
        const payload = pendingBuf.subarray(8, 8 + frameSize);
        pendingBuf = pendingBuf.subarray(8 + frameSize);

        if (streamType === 1) {
          stdoutChunks.push(Buffer.from(payload));
        } else {
          stderrChunks.push(Buffer.from(payload));
        }

        if (onOutput) {
          onOutput(payload.toString("utf-8"));
        }
      }
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stream.destroy();
      demuxPending();
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        exitCode: -1,
      });
    }, timeoutMs);

    stream.on("data", (chunk: Buffer) => {
      pendingBuf = Buffer.concat([pendingBuf, chunk]);
      demuxPending();
    });
    stream.on("end", async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      demuxPending();
      try {
        const inspect = await exec.inspect();
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          exitCode: inspect.ExitCode ?? 1,
        });
      } catch (err) {
        reject(err);
      }
    });
    stream.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function destroySandbox(
  sandbox: SandboxInstance
): Promise<void> {
  try {
    const container = docker.getContainer(sandbox.containerId);
    await container.stop({ t: 5 });
  } catch {
    // Container may have already been removed (AutoRemove)
  }
}

export async function cleanupTempDirs(basePath: string): Promise<void> {
  try {
    await fs.rm(basePath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

function resolveOpenCodeAuthBind(): string | null {
  const authFileOverride = process.env.OPENCODE_AUTH_FILE;
  if (authFileOverride && existsSync(authFileOverride)) {
    return `${authFileOverride}:/root/.local/share/opencode/auth.json:ro`;
  }

  const authDirOverride = process.env.OPENCODE_AUTH_DIR;
  if (authDirOverride && existsSync(path.join(authDirOverride, "auth.json"))) {
    return `${path.join(authDirOverride, "auth.json")}:/root/.local/share/opencode/auth.json:ro`;
  }

  const home = os.homedir();
  const candidateDirs = [
    path.join(home, ".local", "share", "opencode"),
    path.join(home, ".config", "opencode"),
  ];

  for (const dir of candidateDirs) {
    const authFile = path.join(dir, "auth.json");
    if (existsSync(authFile)) {
      return `${authFile}:/root/.local/share/opencode/auth.json:ro`;
    }
  }

  return null;
}
