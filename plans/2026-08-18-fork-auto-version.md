# Fork Auto-Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select an unpublished, synchronized version for all four fork packages when `--version` is omitted, without changing the version used for upstream dependencies.

**Architecture:** A small pure module owns candidate selection from the checked-out upstream version and the union of registry versions. `fork/build.mjs` stages the requested ref, reads its CLI version, queries all four fork package names, and uses the selected fork version only for republished package manifests and mutual fork dependencies; untouched upstream dependencies retain the checked-out upstream version.

**Tech Stack:** Node.js ESM, Vitest, npm registry CLI, pnpm workspace build.

## Global Constraints

- An explicit `--version` bypasses registry-based selection.
- Automatic selection starts with the checked-out `apps/cli/package.json` version.
- A candidate must be unused by every fork package so partial publishes cannot collide.
- Automatic increments only advance an existing numeric prerelease suffix; unsupported version forms fail with an actionable `--version` instruction.
- Registry failures other than package-not-found fail the build instead of guessing.
- Untouched `@deepseek-ai/dsh-*` dependencies use the checked-out upstream version, not an independently incremented fork version.

---

### Task 1: Pure fork-version selection

**Files:**
- Create: `fork/versioning.mjs`
- Create: `fork/versioning.spec.mjs`

**Interfaces:**
- Produces: `nextAvailableForkVersion(upstreamVersion: string, publishedVersions: Iterable<string>): string`.
- Produces: `parsePublishedVersions(output: string): string[]`.

- [x] **Step 1: Write failing selection tests**

Cover an unused source version (`rc.7`), a synchronized collision (`rc.7` to `rc.8`), a partial-publish collision across a union (`rc.7` and `rc.8` to `rc.9`), malformed registry JSON, scalar npm JSON output, and a used stable/non-numeric prerelease that requires explicit `--version`.

- [x] **Step 2: Run the tests and confirm the missing-module failure**

Run: `pnpm exec vitest run fork/versioning.spec.mjs`

Expected: FAIL because `fork/versioning.mjs` does not exist.

- [x] **Step 3: Implement the pure helpers**

Implement exact semver validation for `X.Y.Z` with an optional prerelease, return the upstream version when unused, and increment only the final numeric prerelease identifier until the candidate is absent from the supplied union. Parse npm's JSON array, scalar string, and empty output forms; reject other values.

- [x] **Step 4: Run the focused tests**

Run: `pnpm exec vitest run fork/versioning.spec.mjs`

Expected: all version-selection tests pass.

### Task 2: Build integration and synchronized documentation

**Files:**
- Modify: `fork/build.mjs`
- Modify: `fork/README.md`
- Create: `fork/README.zh.md`
- Create: `fork/README.i18n.yaml`

**Interfaces:**
- Consumes: `nextAvailableForkVersion` and `parsePublishedVersions` from Task 1.
- Produces: optional `--version`; automatic registry selection when absent; distinct `forkVersion` and `upstreamVersion` manifest rewrites.

- [x] **Step 1: Integrate automatic selection**

Remove the hardcoded default version. After staging `--ref`, read `apps/cli/package.json`, query `npm view <name> versions --json` for all four scoped names, treat npm `E404` as an empty version list, union the results, and select the first unused candidate. Keep explicit `--version` validation and bypass all registry calls when supplied.

- [x] **Step 2: Separate dependency versions**

Write `forkVersion` into the four publication manifests and mutual fork dependency ranges. Rewrite all remaining `@deepseek-ai/dsh-*` ranges to `^${upstreamVersion}` so an independently incremented fork version never requests an unpublished upstream package.

- [x] **Step 3: Update usage documentation as a bilingual pair**

Document automatic selection, `--version` override behavior, partial-publish handling, and dynamic artifact names. Replace hardcoded publish filenames with the commands printed by the build. Add the required Chinese counterpart and record both confirmed blob hashes.

- [x] **Step 4: Verify the build script and documentation**

Run: `pnpm exec vitest run fork/versioning.spec.mjs`

Run: `node --check fork/build.mjs && node --check fork/versioning.mjs`

Run: `pnpm run verify-translation-pairing --write fork/README.md && pnpm run verify-translation-pairing fork/README.md`

Expected: tests pass, both scripts parse, and the fork README pair is consistent.

- [ ] **Step 5: Verify repository-facing behavior**

Run: `pnpm exec vitest run packages/bundle/web-app/tests/startup.spec.ts packages/bundle/web-app/tests/trusted-hosts.spec.ts packages/bundle/web-app/tests/web-app.spec.ts packages/host/webserver/tests/webserver.spec.ts`

Run: `pnpm run typecheck`

Run: `pnpm run doc-sync`

Expected: all focused tests, type checking, and documentation gates pass. Do not commit; leave the completed changes for user review because no new commit was requested.
