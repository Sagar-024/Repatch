// GitHub API adapter - PR creation and issue fetching

interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
}

interface GitHubPR {
  html_url: string;
  number: number;
  title: string;
  body: string;
}

/**
 * Fetch an issue from GitHub
 */
export async function fetchIssue(repoUrl: string, issueNumber: number): Promise<GitHubIssue> {
  const token = process.env.GH_TOKEN;
  const { owner, repo } = parseRepoUrl(repoUrl);

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    {
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        Accept: "application/vnd.github.v3+json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch issue: ${response.statusText}`);
  }

  return response.json() as Promise<GitHubIssue>;
}

/**
 * Create a pull request
 */
export async function createPullRequest(
  repoUrl: string,
  branch: string,
  title: string,
  body: string,
  baseBranch: string = "main"
): Promise<GitHubPR> {
  const token = process.env.GH_TOKEN;
  const { owner, repo } = parseRepoUrl(repoUrl);

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title,
        body,
        head: branch,
        base: baseBranch
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to create PR: ${response.statusText}`);
  }

  return response.json() as Promise<GitHubPR>;
}

/**
 * Parse a GitHub URL to get owner and repo
 */
function parseRepoUrl(url: string): { owner: string; repo: string } {
  // HTTPS: https://github.com/owner/repo
  // SSH: git@github.com:owner/repo.git
  let match = url.match(/github\.com[\/:]([^\/]+)\/([^\/]+)/);

  if (!match) {
    throw new Error("Invalid GitHub URL");
  }

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, "")
  };
}

/**
 * Check if GitHub token is available
 */
export function hasGitHubToken(): boolean {
  return !!process.env.GH_TOKEN;
}