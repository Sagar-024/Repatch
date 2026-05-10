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
 * Fork a repository to the authenticated user's account
 */
export async function forkRepository(repoUrl: string): Promise<{ owner: string; repo: string; html_url: string }> {
  const token = process.env.GH_TOKEN;
  const { owner, repo } = parseRepoUrl(repoUrl);

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/forks`,
    {
      method: "POST",
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      }
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fork repository: ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json() as any;
  return {
    owner: data.owner.login,
    repo: data.name,
    html_url: data.html_url
  };
}

/**
 * Get authenticated user's login
 */
export async function getAuthenticatedUser(): Promise<string> {
  const token = process.env.GH_TOKEN;
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      Accept: "application/vnd.github.v3+json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch user: ${response.statusText}`);
  }

  const data = await response.json() as any;
  return data.login;
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
    const errorBody = await response.text();
    throw new Error(`Failed to create PR: ${response.statusText} - ${errorBody}`);
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