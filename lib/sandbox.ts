import Docker from "dockerode";
import path from "path";
import fs from "fs/promises";
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

  const container = await docker.createContainer({
    Image: SCANNER_IMAGE,
    Cmd: ["sleep", "3600"],
    Env: envVars,
    HostConfig: {
      Binds: [
        `${config.repoPath}:/workspace:rw`,
        `${config.outputPath}:/output:rw`,
      ],
      AutoRemove: true,
      Memory: 2 * 1024 * 1024 * 1024,
      NanoCpus: 2 * 1e9,
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

export async function execInSandbox(
  sandbox: SandboxInstance,
  command: string[],
  timeoutMs = 120_000,
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
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stream.destroy();
      resolve({
        stdout: Buffer.concat(chunks).toString("utf-8"),
        exitCode: -1,
      });
    }, timeoutMs);

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
