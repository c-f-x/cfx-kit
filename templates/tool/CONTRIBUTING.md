# Contributing

Thank you for helping. This file says how to propose a change. `AGENTS.md` holds the project's rules, for people and agents alike, and wins where this file disagrees.

## Before you start

- For a bug, open an issue with the steps that show it. For an idea, open an issue first, so we can agree on it before you write code.
- To report a vulnerability, follow `SECURITY.md`. Never open a public issue for it.

## Make the change

1. Branch from `master` and open a pull request against it.
2. Write the failing test first, then the change that makes it pass.
3. Run `pnpm check`. It runs lint, types, every test and the build, and stops at the first failure. It must pass.
4. Keep the pull request to one change. Say why in its description.

## Licence

By contributing, you agree that your contribution is licensed under the MIT License in `LICENSE`.
