import { Octokit } from "@octokit/rest";
import { normalizeRepoFilePath } from "./repo-path";

export function createOctokit(accessToken: string) {
  return new Octokit({ auth: accessToken });
}

export async function listUserRepos(accessToken: string) {
  const octokit = createOctokit(accessToken);
  const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
    sort: "updated",
    per_page: 100,
    visibility: "all",
  });
  return repos.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    owner: repo.owner.login,
    description: repo.description,
    language: repo.language,
    defaultBranch: repo.default_branch,
    private: repo.private,
    updatedAt: repo.updated_at,
    htmlUrl: repo.html_url,
  }));
}

export async function createPullRequest(
  accessToken: string,
  params: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }
) {
  const octokit = createOctokit(accessToken);
  const { data } = await octokit.pulls.create({
    owner: params.owner,
    repo: params.repo,
    title: params.title,
    body: params.body,
    head: params.head,
    base: params.base,
  });
  return {
    prUrl: data.html_url,
    prNumber: data.number,
  };
}

export async function createBranch(
  accessToken: string,
  owner: string,
  repo: string,
  branchName: string,
  baseBranch: string
) {
  const octokit = createOctokit(accessToken);

  const { data: ref } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  });

  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: ref.object.sha,
  });

  return branchName;
}

export async function commitFile(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  content: string,
  message: string
) {
  const octokit = createOctokit(accessToken);
  const repoFilePath = normalizeRepoFilePath(filePath);
  if (!repoFilePath) {
    throw new Error("Invalid file path for commit");
  }

  let sha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: repoFilePath,
      ref: branch,
    });
    if (!Array.isArray(data) && data.type === "file") {
      sha = data.sha;
    }
  } catch {
    // File doesn't exist yet
  }

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: repoFilePath,
    message,
    content: Buffer.from(content).toString("base64"),
    branch,
    sha,
  });
}

export async function applyFixToFile(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string,
  filePath: string,
  originalCode: string,
  fixedCode: string,
  message: string,
) {
  const octokit = createOctokit(accessToken);

  let sha: string | undefined;
  let existingContent = "";

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branch,
    });
    if (!Array.isArray(data) && data.type === "file") {
      sha = data.sha;
      existingContent = Buffer.from(data.content, "base64").toString("utf-8");
    }
  } catch {
    return;
  }

  if (!existingContent.includes(originalCode)) {
    const normalizedExisting = existingContent.replace(/\r\n/g, "\n");
    const normalizedOriginal = originalCode.replace(/\r\n/g, "\n");
    if (normalizedExisting.includes(normalizedOriginal)) {
      existingContent = normalizedExisting;
      originalCode = normalizedOriginal;
    } else {
      console.warn(`[GitHub] Could not find originalCode in ${filePath}, skipping`);
      return;
    }
  }

  const updatedContent = existingContent.replace(originalCode, fixedCode);

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message,
    content: Buffer.from(updatedContent).toString("base64"),
    branch,
    sha,
  });
}
