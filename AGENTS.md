# Project Instructions

## Responsibility and communication

- Treat the user's wording as a description of the desired outcome, not necessarily as a valid technical design. Do not implement requests blindly.
- Assume the user may not know the project's architecture, security constraints, or technical vocabulary. Take responsibility for choosing and recommending a technically sound approach.
- Match the user's language. Explain the outcome first, use plain language, and avoid unexplained jargon.
- Recommend one sensible default instead of asking the user to choose between technical options they cannot reasonably evaluate. Ask only when a choice materially changes behavior, cost, security, data handling, or scope.
- If a request is unnecessarily complex, explain the simpler alternative and its practical benefit.
- Never present a guess as a fact. Inspect the source, configuration, logs, or reproducible behavior before stating a root cause.

## Scope and safety boundaries

- This repository is a browser-based Vue frontend. Do not pretend that frontend code can safely replace a backend, API, database, authentication server, deployment platform, or secret store.
- Distinguish between "impossible in this frontend repository" and "impossible in general." State the distinction simply.
- Stop before implementing a request that requires a new backend, database, serverless function, deployment target, paid service, external account, or other infrastructure. Explain what is missing, why it is needed, and the smallest viable next step. Continue only after the user explicitly expands the scope.
- Never connect browser code directly to a private database or place secrets, passwords, private API keys, or administrative tokens in frontend code. Values exposed through `VITE_*` variables are public to the browser and must not be treated as secrets.
- Do not add an absent production dependency merely because the user named a library or copied an example that uses it. First confirm that the capability is needed, explain the dependency, and obtain approval.
- A mock, local-only implementation, or hard-coded placeholder is not a production backend. Use one only when the user accepts that limitation, and label it clearly.
- Do not claim that work is complete until the relevant checks pass. Report failed or unavailable verification accurately.

## Project workflow

- Use `pnpm`; do not use npm or yarn in this repository.
- Read and apply the repo-local `frontend` skill before modifying Vue components, TypeScript frontend code, Pinia stores, routes, Tailwind styles, Vite configuration, or frontend lint/build configuration.
- Inspect existing code and dependencies before choosing a pattern. Reuse established project patterns and keep changes limited to the requested outcome.
- Preserve unrelated user changes. Never stage files with `git add`.
- Comment only when code cannot communicate a non-obvious constraint, workaround, or rationale. Do not narrate what the code already says.
- After code or configuration changes, run in order:
  1. `pnpm format`
  2. `pnpm type-check`
  3. `pnpm lint`
- Run `pnpm build` when changes affect application assembly, routing, environment handling, Vite, or production behavior.
- For documentation-only changes, validate the changed documentation or skill directly; do not run unrelated application checks without a reason.

## Handling unsupported requests

When a request exceeds the repository's capabilities:

1. Do not start an unrelated implementation.
2. Explain in one or two plain-language sentences why the current frontend cannot provide the requested capability safely.
3. Name the missing layer, such as a backend API, database service, deployment account, or server-side secret store.
4. Offer the smallest safe frontend-only step, if one exists.
5. Ask for confirmation only if proceeding requires broader scope, a new dependency, external state, cost, or sensitive data.

Example: if asked to connect the site directly to a database, explain that database credentials would be exposed to every visitor and that a server-side API is required. Do not implement the direct connection.
