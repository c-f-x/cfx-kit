import { execFileSync } from "node:child_process";

// Test support: makes a sample tool repository a git repository, the way a
// tool's own checkout looks. Not part of the build. Git runs without the
// user's or the system's config, so no hook, signing key or template of the
// machine touches the sample.

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "sample",
  GIT_AUTHOR_EMAIL: "sample@example.com",
  GIT_COMMITTER_NAME: "sample",
  GIT_COMMITTER_EMAIL: "sample@example.com",
};

export function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    env: ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Turns `repo` into a git repository on `master`, with no commits yet. */
export function initRepo(repo: string): void {
  git(repo, "init", "--quiet", "--initial-branch=master");
}

/** Commits the named files, and points `origin/master` at the commit, as a fetched main line. */
export function commitAsMainLine(repo: string, files: string[]): void {
  git(repo, "add", "--", ...files);
  git(repo, "commit", "--quiet", "--message", "sample");
  git(repo, "update-ref", "refs/remotes/origin/master", "HEAD");
}
