---
title: Upstream sync v1.2.5 merge/release workflow
date: 2026-05-28
category: workflow-issues
module: anthropic-auth
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Syncing upstream into this fork
  - Resolving merge conflicts across package metadata, auth code, and tests
  - Releasing a fork package lane after an upstream merge
  - Diagnosing workspace tests that import built package entrypoints
tags:
  - upstream-sync
  - merge-conflicts
  - release
  - dist-rebuild
  - fork-maintenance
related_components:
  - tooling
  - testing_framework
---

# Upstream sync v1.2.5 merge/release workflow

## Context

The `v1.2.5` upstream sync was a fork-preservation workflow, not a vanilla upstream pull. The fork had its own package names, release lane, publish exclusions, release workflow hardening, and recent behavior fixes that needed to survive the merge.

The successful path used an integration-branch merge from upstream, resolved conflicts locally, opened PR #15 against `marcusrbrown/main`, addressed review feedback, merged, and released `v1.2.5-mb.1`.

## Guidance

Treat fork syncs as provenance-sensitive merges. Use an integration branch, not a rebase or cherry-pick, so fork release history stays explicit.

During conflict resolution, preserve fork invariants first:

- keep published packages under `@marcusrbrown/*`
- keep the fork release lane at the target `*-mb.*` version
- keep `@cortexkit/pi-anthropic-auth` private and outside the fork publish lane
- retain fork behavior fixes such as `Retry-After: 0`
- do not reintroduce post-publish registry tarball verification
- do not reintroduce the removed `mb` dist-tag lane or token-based dist-tag mutation

For `v1.2.5-mb.1`, the conflict set was:

- `packages/core/package.json`
- `packages/opencode/package.json`
- `packages/pi/package.json`
- `packages/core/src/accounts.ts`
- `packages/core/src/auth.ts`
- `packages/opencode/src/tests/accounts.test.ts`

After resolving metadata conflicts, validate the fork lane explicitly:

```bash
node scripts/version-sync.mjs 1.2.5-mb.1 --validate
bun install
```

Then run the normal quality gate before merge/release:

```bash
git diff --check
bun run typecheck
bun run test
bun run build
bun run lint
bun run format:check
```

If focused tests fail in code that imports workspace packages, check whether they are exercising ignored built output. In this repo, tests import `@marcusrbrown/anthropic-auth-core`, and the package `main` points at `packages/core/dist/index.js`. After a source merge, stale ignored `packages/core/dist` can cause tests to fail against old code. Rebuild the package before treating those failures as source regressions:

```bash
cd packages/core && bun run build
```

When review feedback finds a real logic bug, fix it with a targeted test-first change. PR #15 review found that quota fallback code could refresh tokens into `next`, then return or persist the stale pre-refresh `account` if the quota probe failed. The fix added tests for “token refresh succeeds, quota probe fails” and changed `packages/core/src/accounts.ts` to store/return the refreshed `next` account.

Release only after the PR is green, approved, and merged to `marcusrbrown/main`:

```bash
./scripts/release.sh --version 1.2.5-mb.1 --dry-run
./scripts/release.sh --version 1.2.5-mb.1 --yes
```

The tag push triggers `.github/workflows/release.yaml`. Verify the release with metadata and workflow state:

```bash
npm view @marcusrbrown/anthropic-auth-core@1.2.5-mb.1 version
npm view @marcusrbrown/anthropic-auth-core dist-tags.latest
npm view @marcusrbrown/opencode-anthropic-auth@1.2.5-mb.1 version
npm view @marcusrbrown/opencode-anthropic-auth dist-tags.latest
npm view @marcusrbrown/opencode-anthropic-auth@1.2.5-mb.1 dependencies.@marcusrbrown/anthropic-auth-core
gh release view v1.2.5-mb.1 --repo marcusrbrown/cortexkit_anthropic-auth
```

## Why This Matters

Fork syncs can be clean from Git’s perspective and still be wrong for the fork. The dangerous failure mode is “upstream-compatible but fork-broken”: package identity drifts back to upstream, private/excluded packages become publishable, release verification reintroduces old false failures, or fork-specific behavior fixes disappear.

Two non-obvious failure modes showed up during this sync:

- **Generated dist drift**: source files were correct, but focused tests initially failed because workspace package imports resolved to stale ignored `dist` output.
- **Fallback state drift**: the upstream quota fallback logic looked reasonable until review checked the path where token refresh succeeds and quota refresh fails; returning/persisting the stale object would have handed callers old credentials or overwritten refreshed ones.

Explicit fork-invariant validation plus review of merged behavior caught both before release.

## When to Apply

Use this guidance when:

- syncing this fork from upstream
- resolving merge conflicts in package metadata or release code
- changing `packages/*/package.json` versions or dependencies
- validating workspace tests after source merges
- preparing a `v*-mb.*` fork release
- deciding whether a release failure is a real blocker or stale/generated-state noise

## Examples

### Good sync posture

```bash
git switch -c sync/upstream-v1.2.5 marcusrbrown/main
git merge --no-ff upstream/main
```

Resolve conflicts by preserving fork invariants, then validate the target lane:

```bash
node scripts/version-sync.mjs 1.2.5-mb.1 --validate
bun install
```

### Bad sync posture

- rebasing fork release history onto upstream
- cherry-picking upstream commits without preserving merge provenance
- accepting upstream `@cortexkit/*` package metadata in published fork packages
- treating stale `dist` failures as source regressions before rebuilding the relevant package
- cutting a release before PR review/checks complete

### Final verified release state

For `v1.2.5-mb.1`:

- PR #15 merged as `758d83f chore(sync): merge upstream v1.2.5`
- tag `v1.2.5-mb.1` points at `758d83f`
- release workflow run `26590141395` succeeded
- `@marcusrbrown/anthropic-auth-core@1.2.5-mb.1` is published
- `@marcusrbrown/opencode-anthropic-auth@1.2.5-mb.1` is published
- both package `latest` dist-tags point to `1.2.5-mb.1`
- OpenCode depends on `@marcusrbrown/anthropic-auth-core@1.2.5-mb.1`
- GitHub release `v1.2.5-mb.1` exists

## Related

- `docs/solutions/workflow-issues/release-process-lessons-v1-2-2-mb-3-2026-05-28.md`
- `.github/instructions/release.instructions.md`
- `.github/workflows/release.yaml`
- `scripts/release.sh`
- `scripts/version-sync.mjs`
- `scripts/verify-artifacts.mjs`
- `docs/brainstorms/2026-05-25-fork-core-opencode-publish-requirements.md`
- `docs/plans/2026-05-25-001-fix-fork-core-opencode-publish-plan.md`
