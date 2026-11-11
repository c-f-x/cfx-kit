import { execFile } from "node:child_process";

// What an operation that changes a deployment needs before its first step: a
// clean working tree, so the deploy is a commit that can be traced, and a
// HEAD equal to the trunk on the remote as it is now, so nobody deploys an
// old or unmerged checkout. The clean-tree rule is ported from `isClean` in
// cfanalytics:scripts/ops.mjs; the trunk rule is docs/conventions.md, section 3.

/** What one git command answered. `code` is null when git could not start. */
export type GitAnswer = { code: number | null; stdout: string; stderr: string };

/** Runs git in `cwd`. Passed in so a caller decides how git runs. */
export type Git = (cwd: string, args: readonly string[]) => Promise<GitAnswer>;

/** Runs the system's git. */
export const systemGit: Git = (cwd, args) =>
  new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { encoding: "utf8" }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : null;
      resolve({ code, stdout, stderr });
    });
  });

export type PreconditionOptions = {
  /** The checkout the operation runs from. */
  root: string;
  remote?: string;
  trunk?: string;
  git?: Git;
};

const SHOWN_CHANGES = 10;

/** The lines of `git status --porcelain`, with at most SHOWN_CHANGES shown. */
function changesText(lines: string[]): string {
  const shown = lines.slice(0, SHOWN_CHANGES).join(", ");
  const more = lines.length - SHOWN_CHANGES;
  return more > 0 ? `${shown}, and ${String(more)} more` : shown;
}

/**
 * Checks that `root` is a clean checkout of the trunk as the remote has it
 * now. It fetches the trunk first. Resolves to every reason it is not; none
 * means the operation may start.
 */
export async function deployPreconditions({
  root,
  remote = "origin",
  trunk = "master",
  git = systemGit,
}: PreconditionOptions): Promise<string[]> {
  const status = await git(root, ["status", "--porcelain"]);
  if (status.code !== 0) {
    return [`${root} is not a git checkout git can read: ${status.stderr.trim()}`];
  }
  const reasons: string[] = [];
  const changes = status.stdout.split("\n").filter((line) => line.trim() !== "");
  if (changes.length > 0) {
    reasons.push(
      `the working tree has changes (${changesText(changes)}). Commit them, so what runs can be traced.`,
    );
  }

  const tracking = `refs/remotes/${remote}/${trunk}`;
  const fetched = await git(root, ["fetch", "--quiet", remote, `+refs/heads/${trunk}:${tracking}`]);
  if (fetched.code !== 0) {
    reasons.push(`could not fetch ${remote}/${trunk}: ${fetched.stderr.trim()}`);
    return reasons;
  }
  const head = await git(root, ["rev-parse", "HEAD"]);
  const tip = await git(root, ["rev-parse", tracking]);
  if (head.code !== 0 || tip.code !== 0) {
    reasons.push(`could not read HEAD or ${remote}/${trunk}: ${head.stderr}${tip.stderr}`.trim());
    return reasons;
  }
  const [headId, tipId] = [head.stdout.trim(), tip.stdout.trim()];
  if (headId !== tipId) {
    reasons.push(
      `HEAD is ${headId.slice(0, 12)}, but ${remote}/${trunk} is ${tipId.slice(0, 12)}. Run from a checkout of current ${remote}/${trunk}.`,
    );
  }
  return reasons;
}
