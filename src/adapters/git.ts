import { simpleGit, SimpleGit } from "simple-git";
import * as path from "path";

/**
 * Clone a GitHub repository (supports HTTPS and SSH URLs)
 * Uses GH_TOKEN from environment if available for authentication
 */
export async function cloneRepo(url: string, targetDir: string): Promise<void> {
  const git: SimpleGit = simpleGit();
  const ghToken = process.env.GH_TOKEN;

  // Parse the URL and add authentication if token is available
  let cloneUrl = url;

  if (ghToken) {
    // Convert SSH URL to HTTPS if needed, or add token to HTTPS URL
    if (url.startsWith("git@github.com:")) {
      // SSH format: git@github.com:owner/repo.git
      const match = url.match(/git@github\.com:(.+?)\/(.+?)(\.git)?$/);
      if (match) {
        cloneUrl = `https://${match[1]}:${ghToken}@github.com/${match[2]}.git`;
      }
    } else if (url.startsWith("https://")) {
      // HTTPS format: https://github.com/owner/repo.git
      const urlObj = new URL(url);
      cloneUrl = `https://${ghToken}@${urlObj.host}${urlObj.pathname}`;
    }
  }

  const options: { directory?: string } = {};

  // If target directory exists and has .git, don't clone (already exists)
  // Otherwise clone fresh
  try {
    await git.clone(cloneUrl, targetDir, ["--depth", "1"]);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Parse specific error cases
    if (errorMessage.includes("Authentication failed") || errorMessage.includes("401")) {
      throw new Error("Access denied. Check GH_TOKEN or SSH keys.");
    } else if (errorMessage.includes("not found") || errorMessage.includes("404")) {
      throw new Error("Repository not found. Check the URL.");
    } else if (errorMessage.includes("Could not resolve host")) {
      throw new Error("Network error. Check your internet connection.");
    }

    throw new Error(`Clone failed: ${errorMessage}`);
  }
}

/**
 * Check if a directory is a valid git repository
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
  const git: SimpleGit = simpleGit(dirPath);
  try {
    return await git.checkIsRepo();
  } catch {
    return false;
  }
}

/**
 * Create a new branch and switch to it
 */
export async function createBranch(repoPath: string, branchName: string): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    await git.checkoutLocalBranch(branchName);
  } catch (error: unknown) {
    throw new Error(`Failed to create branch ${branchName}: ${error}`);
  }
}

/**
 * Stage and commit all changes
 */
export async function commitChanges(repoPath: string, message: string): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    await git.add(".");
    await git.commit(message);
  } catch (error: unknown) {
    throw new Error(`Failed to commit changes: ${error}`);
  }
}

/**
 * Push the current branch to remote
 */
export async function pushBranch(repoPath: string, branchName: string): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    // Check if remote exists
    const remotes = await git.getRemotes();
    if (remotes.length === 0) {
      throw new Error("No remote found to push to.");
    }

    await git.push("origin", branchName, ["--set-upstream"]);
  } catch (error: unknown) {
    throw new Error(`Failed to push branch ${branchName}: ${error}`);
  }
}

/**
 * Get the default branch name (main or master)
 */
export async function getDefaultBranch(repoPath: string): Promise<string> {
  const git: SimpleGit = simpleGit(repoPath);
  const branches = await git.branch();

  // Check common default branch names
  if (branches.current) return branches.current;
  if (branches.all.includes("main")) return "main";
  if (branches.all.includes("master")) return "master";

  return "main";
}