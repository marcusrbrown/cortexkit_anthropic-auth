---
name: anthropic-auth-upstream-release
description: Use when syncing this anthropic-auth fork from upstream, resolving fork merge conflicts, preserving fork package/release invariants, or cutting v*-mb.* fork releases.
---

# Anthropic Auth Upstream Sync and Fork Release

## Overview

This repo is a fork with its own published package lane. Upstream syncs must preserve fork provenance, package identity, release hardening, and npm Trusted Publishing behavior.

Core rule: **sync by integration merge, validate fork invariants, release through `scripts/release.sh`, then verify npm metadata and GitHub release state.**

## When to Use

Use for:

- syncing `marcusrbrown/cortexkit_anthropic-auth` from `cortexkit/anthropic-auth`
- resolving conflicts from upstream tags or `upstream/main`
- preparing or cutting `vX.Y.Z-mb.N` releases
- debugging fork release workflow failures
- checking package metadata, dist-tags, Trusted Publishing, or fork package dependencies

Do not use for ordinary feature work unrelated to upstream sync or fork release mechanics.

## Fork Invariants

Preserve these during every sync/release:

| Area | Required state |
|---|---|
| Core package | `@marcusrbrown/anthropic-auth-core` |
| OpenCode package | `@marcusrbrown/opencode-anthropic-auth` |
| OpenCode core dependency | `@marcusrbrown/anthropic-auth-core` at the same fork version |
| Pi package | `@cortexkit/pi-anthropic-auth`, private, not published |
| Version lane | `X.Y.Z-mb.N` for fork-published Core/OpenCode packages |
| npm publish | Trusted Publishing/OIDC with provenance |
| dist-tag | `latest` only; no `mb` dist-tag lane |
| Tokens | no fallback `NPM_TOKEN`; no `NPM_DIST_TAG_TOKEN` |
| GitHub environment | no `environment: npm-publish` unless GitHub + npm trust configs are both verified |
| Registry verification | npm metadata/dist-tag checks; no post-publish registry tarball download gate |

Behavioral fork fixes must also survive syncs, including `Retry-After: 0` handling.

## Upstream Sync Pattern

Use an integration branch. Do **not** rebase or cherry-pick upstream syncs.

```bash
git switch marcusrbrown/main
git pull --ff-only origin marcusrbrown/main
git switch -c sync/upstream-vX.Y.Z
git merge --no-ff upstream/main
```

If fetching upstream tags deletes fork-only `v*-mb.*` tags, disable tag pruning locally before continuing.

Resolve conflicts by keeping upstream source improvements and fork metadata/invariants. Common conflict files:

- `packages/core/package.json`
- `packages/opencode/package.json`
- `packages/pi/package.json`
- `packages/core/src/accounts.ts`
- `packages/core/src/auth.ts`
- `packages/opencode/src/tests/accounts.test.ts`

After package/version conflicts, sync and validate the target lane:

```bash
node scripts/version-sync.mjs X.Y.Z-mb.N
bun install
node scripts/version-sync.mjs X.Y.Z-mb.N --validate
```

If the manifests already match, validation-only is fine.

## Stale Dist Trap

Workspace tests can import built package entrypoints. `@marcusrbrown/anthropic-auth-core` resolves through package `main` to `packages/core/dist/index.js`, and `dist` is ignored.

If source looks correct but focused tests fail after a merge, rebuild Core before diagnosing source logic:

```bash
cd packages/core && bun run build
```

Do not commit ignored `dist` output.

## Validation Gate

Before opening/merging the sync PR or cutting a release, run:

```bash
node scripts/version-sync.mjs X.Y.Z-mb.N --validate
git diff --check
bun run typecheck
bun run test
bun run build
bun run lint
bun run format:check
```

If review finds a real behavior bug, fix it with targeted tests first. For the `v1.2.5` sync, review caught stale account persistence after token refresh succeeded and quota refresh failed; tests had to assert refreshed credentials were returned and stored.

## PR Rules

Open PRs against the fork explicitly:

```bash
gh pr create --repo marcusrbrown/cortexkit_anthropic-auth --base marcusrbrown/main
```

Poll CI and review state. Do not merge unless checks are green, review is approved or no longer blocking, and Marcus explicitly confirms merge.

After merge, sync local main:

```bash
git fetch origin marcusrbrown/main
git switch marcusrbrown/main
git pull --ff-only origin marcusrbrown/main
```

## Release Pattern

Release from clean, synced `marcusrbrown/main`.

Dry-run first:

```bash
./scripts/release.sh --version X.Y.Z-mb.N --dry-run
```

Then, after dry-run passes and release is intended:

```bash
./scripts/release.sh --version X.Y.Z-mb.N --yes
```

The tag push triggers `.github/workflows/release.yaml`: test → publish Core → publish OpenCode → GitHub release.

## Release Verification

Verify metadata, dist-tags, dependency, workflow, release, local state:

```bash
npm view @marcusrbrown/anthropic-auth-core@X.Y.Z-mb.N version
npm view @marcusrbrown/anthropic-auth-core dist-tags.latest
npm view @marcusrbrown/opencode-anthropic-auth@X.Y.Z-mb.N version
npm view @marcusrbrown/opencode-anthropic-auth dist-tags.latest
npm view @marcusrbrown/opencode-anthropic-auth@X.Y.Z-mb.N dependencies.@marcusrbrown/anthropic-auth-core
gh release view vX.Y.Z-mb.N --repo marcusrbrown/cortexkit_anthropic-auth
gh run view <release-run-id> --repo marcusrbrown/cortexkit_anthropic-auth --json status,conclusion,url,headBranch,headSha
git status --short --branch
git tag --points-at HEAD | grep '^vX\.Y\.Z-mb\.N$'
```

Expected final state:

- both fork packages published at `X.Y.Z-mb.N`
- both `latest` dist-tags point to `X.Y.Z-mb.N`
- OpenCode depends on fork Core at `X.Y.Z-mb.N`
- GitHub release `vX.Y.Z-mb.N` exists
- release workflow conclusion is `success`
- local `marcusrbrown/main` matches `origin/marcusrbrown/main`
- `HEAD` has the release tag

## Common Mistakes

| Mistake | Fix |
|---|---|
| Rebase/cherry-pick upstream sync | Use integration merge to preserve fork provenance |
| Accept upstream `@cortexkit/*` package names in published packages | Keep `@marcusrbrown/*` Core/OpenCode names |
| Forget Pi exclusion | Keep Pi private and out of fork publish lane |
| Diagnose stale `dist` as source bug | Rebuild Core dist, then retest |
| Add file-content tests for workflows/config | Test behavior/syntax instead |
| Reintroduce registry tarball verification | Use npm metadata and dist-tags |
| Create PR against upstream repo/base | Use `--repo marcusrbrown/cortexkit_anthropic-auth --base marcusrbrown/main` |
| Merge without explicit confirmation | Stop and ask Marcus |

## Related Docs

- `docs/solutions/workflow-issues/upstream-sync-v1-2-5-merge-conflicts-release-2026-05-28.md`
- `docs/solutions/workflow-issues/release-process-lessons-v1-2-2-mb-3-2026-05-28.md`
- `.github/instructions/release.instructions.md`
- `scripts/release.sh`
- `scripts/version-sync.mjs`
- `.github/workflows/release.yaml`
