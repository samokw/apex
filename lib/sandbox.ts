import Docker from "dockerode";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import os from "os";

const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock",
});

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
  const base = path.join(os.tmpdir(), `apex-${Date.now()}`);
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

  const { execSync } = await import("child_process");
  execSync(`git clone --depth 1 ${authedUrl} ${targetPath}`, {
    stdio: "pipe",
    timeout: 120000,
  });
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
    const chunks: Buffer[] = [];
    const onOutput = options?.onOutput;

    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (onOutput) {
        onOutput(chunk.toString("utf-8"));
      }
    });
    stream.on("end", async () => {
      try {
        const inspect = await exec.inspect();
        resolve({
          stdout: Buffer.concat(chunks).toString("utf-8"),
          exitCode: inspect.ExitCode ?? 1,
        });
      } catch (err) {
        reject(err);
      }
    });
    stream.on("error", reject);
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
