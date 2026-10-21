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

## Supabase CLI and the established migration boundary — mandatory for Codex

**Read this before any SpecMarket Supabase operation.** Production project ref: `rtkhgldaswsclkorlyxx`. The read-only Supabase MCP is for inspection, not SQL/Edge deployment rights.

### Never reopen the legacy migration boundary

This is a **standing user decision from 17–19 September 2026**, not a new migration defect to fix on every release:
- **Twelve legacy Epicentr/Kasta SQL files were intentionally excluded** when a September bank migration was deployed from a *temporary Supabase workdir*. The original repository and historical migrations stayed unchanged; the bank migration was successfully applied. Do **not** go back to run, repair, backfill, rename, re-mark, or reconcile those historical SQL files during unrelated work.
- On **19 September**, `20260919150000_prom_completion_dismissal.sql` was executed **directly** as targeted SQL; the column was verified in production, while history reconciliation was expressly forbidden. Missing history rows for such previously executed scripts do **not** prove schema changes are missing.
- Production includes active NovaPay cron and existing NovaPay SQL functions. The old `20260918170000_prepare_novapay_sync_schedule.sql` includes a command to **disable** the NovaPay cron. Never run it simply because it looks pending.
- Source files include duplicate legacy version prefixes (e.g., several `20260808_*.sql`, `20260810_*.sql`, `20260811_*.sql`). Treat the full legacy migration list as **known historical debt**, not as an open task or release prerequisite. The `20260821_reconciliation.sql` file and its remote `20260821` version both exist.

**Absolute operational rule:** A new feature must only touch **its own explicitly approved SQL** and named Edge Function. Do not scan/reconcile/fix all old migrations or suggest a blanket `db push`. Never run `migration repair`, `db reset`, `--include-all`, or `--include-seed` against production. Never execute a stale SQL file to "fill a gap." This supersedes any generic instruction that the *entire* migration history must be clean before an unrelated feature can be released.

### CLI version, authentication

Use explicit **`pnpm dlx supabase@2.113.0`** for CLI commands instead of an unpinned/global executable:
- v2.111.0 has a mixed 8/14-digit migration sorting bug ([#6036](https://github.com/supabase/cli/issues/6036); fix [#6038](https://github.com/supabase/cli/pull/6038)).
- v2.112.0 fixes sorting but has the `inserted_at` API-key validation error on `link` ([#6115](https://github.com/supabase/cli/issues/6115); fix [#6117](https://github.com/supabase/cli/pull/6117)).
- v2.113.0 includes both upstream fixes; it was successfully linked to **this project** on 21 October 2026.

Do not rotate credentials, request PATs in chat, alter auth/MCP scopes, or try alternate versions to work around the **known legacy-history discrepancy**.

### How to release a new SQL migration

1. Work in a clean checkout pinned to the approved commit. Verify **only the new SQL** and its exact dependencies against production **read-only**. Preserve current data, privileges, existing cron and known migration boundaries.
2. Reuse the **successful 17 September pattern** when suitable: a separate temporary workdir, with source migration history excluded and only the specifically necessary known-applied baseline and approved new SQL staged for inspection. Never edit or delete old files in the original repository. Merely reducing the folder content must **not** be mistaken for permission to write, and must never accidentally replay old SQL.
3. If CLI `db push --dry-run` (against that isolated workdir) can be proven to propose **only** the current approved SQL and no other work, proceed with that ordinary migration route **only under explicit production approval**. If it cannot, prefer a separately reviewed **single-target SQL execution strategy**, with matching migration-version registration only when atomicity and safe privileges are verified and specifically authorized. Do not auto-insert or auto-repair entries in `supabase_migrations.schema_migrations`.
4. After success, read back actual schema/function/grants, preserve legacy records, and verify only the affected orders. A green web deploy does **not** deploy Supabase SQL or Edge Functions.

**Failure behavior:** STOP for unverified prerequisites of the **current migration**, privileges, unexpected production state, or unsafe write plan. Do not STOP merely because the known old migration list is inconsistent; likewise do not use that inconsistency as grounds to execute those files. If safe targeted execution cannot be proven, report precisely the missing proof and await authorization. Do not turn it into an audit of all old migrations.

For an explicitly approved Edge rollout, verify the exact code SHA first and deploy only the named function; e.g.:

```powershell
pnpm dlx supabase@2.113.0 functions deploy sync-delivery-tracking --project-ref rtkhgldaswsclkorlyxx
```

Do not change `verify_jwt`, settings, authentication, secrets, cron or other Edge Functions. Any additional production modification needs explicit permission.

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
