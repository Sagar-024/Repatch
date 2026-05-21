import { simpleGit, SimpleGit } from "simple-git";
import * as path from "path";
import * as fs from "fs";

/**
 * Clone a GitHub repository (supports HTTPS and SSH URLs)
 * Uses GH_TOKEN from environment if available for authentication
 */
export async function cloneRepo(url: string, targetDir: string): Promise<void> {
  const git: SimpleGit = simpleGit();
  const ghToken = process.env.GH_TOKEN;

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

  // If target directory exists and has .git, don't clone (already exists)
  if (await isGitRepo(targetDir)) {
    return;
  }

  try {
    await git.clone(cloneUrl, targetDir, ["--depth", "1"]);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

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

export async function checkoutPR(repoPath: string, prNumber: number): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    const branchName = `pr-${prNumber}`;
    await git.fetch("origin", `pull/${prNumber}/head:${branchName}`);
    await git.checkout(branchName);
  } catch (error: unknown) {
    throw new Error(`Failed to checkout PR ${prNumber}: ${error}`);
  }
}

export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    if (!fs.existsSync(dirPath)) {
      return false;
    }
    const git: SimpleGit = simpleGit(dirPath);
    return await git.checkIsRepo();
  } catch {
    return false;
  }
}

export async function createBranch(repoPath: string, branchName: string): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    await git.checkoutLocalBranch(branchName);
  } catch (error: unknown) {
    throw new Error(`Failed to create branch ${branchName}: ${error}`);
  }
}

export async function commitChanges(repoPath: string, message: string, files: string[] = ["."]): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    for (const file of files) {
      await git.add(file);
    }
    await git.commit(message);
  } catch (error: unknown) {
    throw new Error(`Failed to commit changes: ${error}`);
  }
}

export async function getModifiedFiles(repoPath: string): Promise<string[]> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    const status = await git.status();
    return [
      ...status.modified,
      ...status.not_added,
      ...status.created,
      ...status.staged
    ];
  } catch {
    return [];
  }
}

export async function getDiff(repoPath: string): Promise<string> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    // Intent-to-add untracked files so they show up in diff
    const status = await git.status();
    for (const file of status.not_added) {
      await git.add(["-N", file]);
    }
    
    // Get diff of everything compared to HEAD
    return await git.diff(["HEAD"]);
  } catch (error) {
    console.error(`Error generating diff: ${error}`);
    return "";
  }
}

export async function getDiffStat(repoPath: string): Promise<string> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    const status = await git.status();
    for (const file of status.not_added) {
      await git.add(["-N", file]);
    }
    return await git.diff(["HEAD", "--stat"]);
  } catch {
    return "";
  }
}

export async function setRemoteUrl(repoPath: string, remoteName: string, newUrl: string): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    await git.remote(["set-url", remoteName, newUrl]);
  } catch (error: unknown) {
    throw new Error(`Failed to set remote URL: ${error}`);
  }
}

export async function pushBranch(repoPath: string, branchName: string): Promise<void> {
  const git: SimpleGit = simpleGit(repoPath);
  try {
    const remotes = await git.getRemotes();
    if (remotes.length === 0) {
      throw new Error("No remote found to push to.");
    }

    await git.push("origin", branchName, ["--set-upstream"]);
  } catch (error: unknown) {
    throw new Error(`Failed to push branch ${branchName}: ${error}`);
  }
}

export async function getDefaultBranch(repoPath: string): Promise<string> {
  const git: SimpleGit = simpleGit(repoPath);
  const branches = await git.branch();

  // Prioritize common default branch names
  if (branches.all.includes("origin/main")) return "main";
  if (branches.all.includes("origin/master")) return "master";
  if (branches.all.includes("main")) return "main";
  if (branches.all.includes("master")) return "master";

  // Fallback to current if it's not a repatch branch
  if (branches.current && !branches.current.startsWith("repatch/")) {
    return branches.current;
  }

  return "main";
}