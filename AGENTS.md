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

## Preferred data platform

- When a feature genuinely needs persistent or shared data, authentication, file storage, or server-side functions, recommend Supabase first unless an existing project requirement makes it unsuitable.
- Do not create a Supabase project, install its client, design tables, or change external infrastructure without first explaining the required scope and receiving explicit approval.
- Before implementation, verify whether a Supabase project, schema, environment variables, and access policies already exist. Do not assume they are configured.
- Access Supabase from the browser only through its Data API with a publishable key. A legacy `anon` key is acceptable only for an existing project that has not migrated yet. Never expose a secret or `service_role` key in frontend code.
- Enable Row Level Security on every exposed table or view and define least-privilege policies before allowing frontend access. Never disable or bypass RLS merely to make a request succeed.
- Keep privileged operations and secrets in Supabase Edge Functions or another server-side layer. Do not implement them in Vue code.
- Keep schemas, migrations, and policies reviewable and reproducible in repository files. Do not rely on undocumented dashboard-only changes.

## Supabase CLI for Codex — mandatory, project-specific

This section is a standing instruction for every Codex run that touches Supabase in SpecMarket, including production operations. Read it **before invoking any Supabase CLI command**. Project ref: `rtkhgldaswsclkorlyxx`. A registered, read-only Supabase MCP does **not** grant CLI access or deployment rights.

**Known CLI regression (do not rediscover on every task):** Supabase CLI **v2.112.0** can fail during `supabase link` / API-key retrieval with `LegacyLinkApiKeysNetworkError`, `SchemaError`, and a malformed `inserted_at` timestamp. This is the CLI's API response schema validation defect, **not evidence of a bad PAT, network, or project permissions**. Official upstream: [issue #6115](https://github.com/supabase/cli/issues/6115), [fix PR #6117](https://github.com/supabase/cli/pull/6117). v2.111.0 is the documented workaround. Until a replacement version has been *explicitly tested with this project* and this file updated, **always invoke the pinned v2.111.0 for Supabase commands**. Never silently use globally installed `supabase`, `latest`, or unpinned `pnpm dlx supabase`.

From the **repository root** in Windows PowerShell (one consistent executable for every step):

```powershell
pnpm dlx supabase@2.111.0 --version
pnpm dlx supabase@2.111.0 link --project-ref rtkhgldaswsclkorlyxx
pnpm dlx supabase@2.111.0 migration list
pnpm dlx supabase@2.111.0 db push --dry-run
```

The first invocation may install the pinned CLI into pnpm's temporary cache. Use the existing locally configured authentication; only perform `pnpm dlx supabase@2.111.0 login` if authentication is genuinely absent and user interaction is authorized. Never print credentials or ask the user to paste PATs or database passwords into chat.

Only **after** an explicit production authorization, a successful `migration list`, and a `db push --dry-run` showing *exactly* the user-approved migration(s), may Codex invoke:

```powershell
pnpm dlx supabase@2.111.0 db push
```

For an explicitly approved Edge-function rollout, verify the exact code SHA first, then deploy only the named function, e.g.:

```powershell
pnpm dlx supabase@2.111.0 functions deploy sync-delivery-tracking --project-ref rtkhgldaswsclkorlyxx
```

Do not change `verify_jwt`, project settings, auth scopes, secrets, cron schedules, or unrelated functions. Do **not** run `db reset`, `migration repair`, `--include-all`, `--include-seed`, or blind `db push` against production. On missing permissions, a different auth error, unexpected pending migrations, history drift, or a dry-run that cannot be verified, **STOP** and report the precise blocker. Do not auto-apply a workaround that changes database state. A successful web frontend deploy is *not* proof of a Supabase SQL migration or Edge deploy.

If the known `inserted_at` validation error reappears, first show the **actual CLI version used** and retry using the pinned invocation above. Do not burn time on repeated token reauthorization, MCP reconfiguration, DNS/network changes, or repeated failing `supabase link` commands. This version workaround addresses the specific timestamp-schema bug; it does **not** guarantee that the currently configured account has write permissions.

## Project workflow

- Use `pnpm`; do not use npm or yarn in this repository.
- Read and apply the repo-local `frontend` skill before modifying Vue components, TypeScript frontend code, Pinia stores, routes, Tailwind styles, Vite configuration, or frontend lint/build configuration.
- Follow its VueUse section before writing shared reactive or browser utilities.
- For dynamic data tables, use the installed `@tanstack/vue-table` v9 API with typed columns, stable row IDs, explicit `tableFeatures`, and `FlexRender`; add only features required by the existing behavior.
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

## Production logging policy

- Do not add routine `console.log`, `console.info`, `console.debug`, progress messages, retry warnings, or dumps of successful requests/responses in production Edge Functions.
- Return actionable errors to the CRM UI; scheduled jobs that cannot display an error may emit one concise `console.error` for an unresolved failure, not one per order/TTN/retry. Use stable error codes or aggregate counts; never print request bodies, credentials, tokens, buyer data, IBANs, or TTNs.
- Keep operational state that directly drives CRM behavior (for example, `crm_delivery_tracking_state.last_error` and NovaPay's failure-only browser-visible sync journal). These are not optional debug traces and must not be deleted under a logging cleanup.
- NovaPay journal is failure-only. Do not write routine running/progress/success entries to the database; existing bank cache timestamps indicate success and the CRM still displays failed scheduled runs.
- Do not change working sync schedules, marketplace API actions, or database replication to reduce Supabase Logs Ingest. Hosted Supabase automatically records API and function invocations; application `console` suppression cannot turn those platform events off.
- The smallest possible Postgres logging settings are documented in `scripts/supabase-minimal-logging.md`. Apply those project-level settings separately with authorized Supabase access; do not silently overwrite unrelated Postgres configuration.
