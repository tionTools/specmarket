---
name: frontend
description: Apply this repository's frontend conventions when implementing, refactoring, debugging, or reviewing Vue SFCs, TypeScript frontend code, Pinia stores, Vue Router routes, Tailwind CSS, Vite, or frontend lint and build configuration. Use only the libraries installed in this repository. Do not use this skill to invent backend, API, database, deployment, or absent-library conventions.
---

# Frontend

Follow `AGENTS.md` first. Implement the smallest safe solution that satisfies the user's actual goal and stays within this frontend repository.

## Confirm the stack

Use only the stack declared in `package.json` and the repository configuration:

- Vue 3 with Composition API and `<script setup lang="ts">`
- strict TypeScript
- Pinia
- Vue Router with routes declared in `src/router/index.ts`
- `@vueuse/core`
- `@tanstack/vue-table` for dynamic data tables
- Tailwind CSS v4 through `@tailwindcss/vite`
- Vite
- pnpm
- ESLint, Oxlint, and Oxfmt

Inspect `package.json` before relying on any additional package. Do not introduce conventions for Apollo, GraphQL, shadcn-vue, Reka UI, TanStack, form libraries, test frameworks, Nuxt, Tauri, or other packages unless they are deliberately added later.

## Build dynamic tables with TanStack Table

For a dynamic data table, use the installed `@tanstack/vue-table` v9 API: `useTable`, explicit `tableFeatures`, typed column definitions, stable row IDs, and `FlexRender` for headers and cells. Keep loading, persistence, router, and business actions in the owning page; feature table components receive props and emit actions. Add only the required table features—do not introduce sorting, filtering, pagination, or other TanStack capabilities unless the current behavior requires them.

## Use VueUse first

Before writing a shared reactive or browser utility, check `@vueuse/core`. If a stable composable preserves the required behavior, use it instead of manual listeners, timers, storage, clipboard, visibility, online-state, file-dialog, scroll-lock, or similar infrastructure. Import only the functions used.

Do not apply VueUse mechanically to business logic: retain specialized code when a composable would change required semantics, validation, or the timing of writes, and briefly record why.

## Work from evidence

1. Read the relevant source, configuration, and nearby patterns.
2. Translate the user's requested outcome into the smallest compatible frontend change.
3. Identify any missing server-side or external capability before editing.
4. Implement without unrelated refactors or speculative architecture.
5. Verify the result with the repository commands from `AGENTS.md`.

Do not turn an unsupported request into a fake frontend implementation. Explain the limitation in plain language and stop before expanding scope.

## Organize frontend code

- Keep `src/pages/` components light: compose the page and connect route-level inputs, but move reusable behavior and substantial business logic into the relevant feature folder.
- Keep application shells in `src/layouts/` and route declarations and guards in `src/router/`.
- Add feature-specific components and composables beside their feature under `src/<feature>/` when a feature grows beyond a simple page.
- Put broadly reusable presentation-only components under `src/components/ui/<name>/`. Make them receive state through props, models, and events. Do not import Pinia stores, the router, or feature modules from this presentation layer.
- Put generic framework-independent helpers and composables under `src/lib/`.
- Put Pinia stores under `src/stores/`, unless a store belongs to exactly one feature and is clearer beside that feature.
- Do not create empty folders or abstractions for hypothetical future needs.
- Avoid barrel files that only re-export other modules. Import from the defining file.

## Follow naming conventions

- Do not suffix reactive variables with `Ref`: use `count`, not `countRef`.
- Name local boolean refs and computed values with `is*`. Use `can*` for permissions or capabilities.
- Name boolean props without the `is` prefix: use `disabled` or `sidebarOpen`.
- Prefix parameterized boolean checks with `check*`.
- Reserve `on*` for event subscription hooks. Prefix event handlers with `handle*`.
- Use native private fields such as `#value` instead of TypeScript `private` fields.

## Write Vue components

- Use `<script setup lang="ts">` and type component contracts.
- Do not export types, interfaces, injection keys, or utilities from `<script setup>`. Put shared declarations in a neighboring `.ts` file.
- Use `useTemplateRef()` for template refs.
- Use camelCase for component props and emitted events in SFC templates.
- Avoid arrow functions in template event listeners. Use a named `handle*` function or `$event`.
- Use object syntax for conditional class bindings.
- Prefer `v-bind()` inside scoped CSS over dynamic `:style` object bindings. Allow `:style` only when each `v-for` iteration genuinely needs a different runtime value.
- Do not place comments inside `<template>` or between SFC root blocks. Put a necessary explanation beside the relevant script logic.

## Write composables

- Accept reactive inputs as `MaybeRefOrGetter<T>`.
- Prefix positional reactive inputs with `source`, then normalize them with `toRef()` at the start of the composable.
- Keep option-object property names unprefixed and access them through the options object before normalization.
- Treat incoming refs as read-only inputs. Only the owner of reactive state may mutate it; request changes through the caller's explicit API or component events.
- Use `onScopeDispose()` for cleanup so the composable also works outside component lifecycle scopes.
- Use `watch()` with `onWatcherCleanup()` for cancellable last-wins asynchronous side effects. Do not invent sequence counters or unmanaged timers when Vue lifecycle cleanup solves the problem.

## Use Pinia consistently

- Keep a store object intact. Do not destructure it and do not use `storeToRefs`; access state, getters, and actions through `store.member`.
- Do not mutate store state directly outside the store. Expose an action for each external mutation.
- Keep store state and actions focused on shared application state. Prefer local component state when no cross-component ownership is required.

## Use Tailwind CSS v4

- Prefer Tailwind utilities over one-off CSS when an existing utility expresses the design clearly.
- Use direct Tailwind v4 values such as `w-2.5` instead of arbitrary brackets such as `w-[10px]` when an equivalent direct utility exists.
- Use arbitrary values only when the value cannot be represented directly.
- Do not copy Hora-specific palette, status, border, shadcn, or design-token rules into this repository.

## Keep TypeScript strict

- Preserve strict typing and `noUncheckedIndexedAccess`.
- Do not silence an error with `any`, unchecked casts, or non-null assertions when the boundary can be modeled or validated.
- Keep types close to the feature that owns them. Move a type to a shared module only when multiple independent consumers need it.

## Finish the task

- Run `pnpm format`, `pnpm type-check`, and `pnpm lint` in that order after code or configuration changes.
- Run `pnpm build` for routing, environment, Vite, or production-assembly changes.
- Report what changed, what was verified, and any remaining limitation in simple language.
