/** What a check is given: the repository's folder, and the words after its name. */
export type CheckContext = { root: string; args: string[] };

/** One `c-f-x check <name>`. It resolves to the problems it found; none means it passed. */
export type Check = {
  name: string;
  summary: string;
  run: (context: CheckContext) => Promise<string[]>;
};
