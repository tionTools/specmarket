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

This is a standing rule for every Codex run that touches Supabase in SpecMarket. Read this before invoking any CLI command. Production project ref: `rtkhgldaswsclkorlyxx`. Read-only Supabase MCP does not grant CLI write privileges.

**Use `pnpm dlx supabase@2.113.0` consistently for this project.** This is the first stable release containing both relevant upstream fixes:
- CLI **2.111.0** links successfully but still has the **mixed 8-digit/14-digit migration ordering bug**: an existing `20260821_reconciliation.sql` version can falsely appear missing when a `20260821120000_*.sql` migration is also present. Upstream [#6036](https://github.com/supabase/cli/issues/6036), fixed by [#6038](https://github.com/supabase/cli/pull/6038) in v2.112.0.
- CLI **2.112.0** fixes migration sorting but breaks `supabase link` when API-key `inserted_at` has a numeric timezone offset (`LegacyLinkApiKeysNetworkError`). Upstream [#6115](https://github.com/supabase/cli/issues/6115), fixed by [#6117](https://github.com/supabase/cli/pull/6117) in v2.113.0.
- Stable v2.113.0 release notes: https://github.com/supabase/cli/releases/tag/v2.113.0. Upstream fixes are verified by release notes, but compatibility with **this project's** linked production database still needs the following read-only verification.

From the repository root in Windows PowerShell:

```powershell
pnpm dlx supabase@2.113.0 --version
pnpm dlx supabase@2.113.0 link --project-ref rtkhgldaswsclkorlyxx
pnpm dlx supabase@2.113.0 migration list
pnpm dlx supabase@2.113.0 db push --dry-run
```

Use the existing local authentication. Do not change tokens, PAT scope, MCP permissions, or password settings merely because a previously buggy CLI version failed. Never print credentials or request that secrets be pasted in chat.

**Migrations are a separate safety gate, even on a fixed CLI:** the tracked `20260821_reconciliation.sql` **does exist**; do not remove/revert its remote history based on the old version-ordering bug. The repository also contains `20260918170000_prepare_novapay_sync_schedule.sql` (can disable NovaPay scheduled job) and `20260919150000_prom_completion_dismissal.sql`. If `migration list` still reports them pending, check their real remote migration history and schema state via read-only access; these are unrelated to reminder feature. Never auto-apply, mark applied, mark reverted, or change migration file names to suppress a mismatch.

Only after an explicit production authorization and a **successful dry-run showing exactly the approved migrations**, may Codex run:

```powershell
pnpm dlx supabase@2.113.0 db push
```

For an explicitly approved Edge rollout, verify the exact code SHA, then deploy only the named function:

```powershell
pnpm dlx supabase@2.113.0 functions deploy sync-delivery-tracking --project-ref rtkhgldaswsclkorlyxx
```

Do not change `verify_jwt`, settings, authentication, secrets, cron, or other functions. Never use `db reset`, `migration repair`, `--include-all`, `--include-seed`, an unpinned CLI, or blind `db push` against production. On unknown pending migrations, true history drift, missing permissions, unsuccessful dry-run, or unexpected schema differences: **STOP**, retain data, and report the exact outstanding versions and read-only evidence. Neither a successful `supabase link` nor a successful frontend deploy proves that SQL/Edge rollout has happened.

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
