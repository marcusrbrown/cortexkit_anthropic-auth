---
title: Release process lessons from v1.2.2-mb.3
date: 2026-05-28
category: workflow-issues
module: release-process
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Releasing npm packages with committed manifests and lockfiles
  - Validating published artifacts after npm publish
  - Release workflows race npm registry propagation
tags:
  - release-process
  - npm-publish
  - lockfile
  - registry-propagation
  - version-sync
  - workflow
related_components:
  - tooling
  - testing_framework
---

# Release process lessons from v1.2.2-mb.3

## Context

The `v1.2.2-mb.3` fork release exposed release-process failure modes around committed release state, lockfile sync, test design, and npm registry verification.

The release ultimately succeeded, but only after separating real blockers from false negatives:

- package manifests had to be committed at the target fork version before tagging
- `bun.lock` had to be updated and committed after manifest changes
- tests pinned to the current workspace version created release churn without testing behavior
- post-publish registry tarball downloads raced npm propagation even though the packages were already published and visible via metadata checks

## Guidance

Commit the complete release state before tagging. For this fork lane, that means:

- `packages/core/package.json` version matches the release
- `packages/opencode/package.json` version matches the release
- `packages/opencode/package.json` depends on `@marcusrbrown/anthropic-auth-core` at the same fork version
- `bun.lock` is regenerated with `bun install` and committed

Use the release script dry run to preview version-sync changes, but do not treat the dry run as applying them:

```bash
./scripts/release.sh --version 1.2.2-mb.3 --dry-run
```

Before a real release, the committed state must pass:

```bash
node scripts/version-sync.mjs 1.2.2-mb.3 --validate
bun install --frozen-lockfile
```

Keep release tests behavioral. Do not read source/config files and assert their contents or pin tests to the current workspace release version. Behavior tests should exercise scripts/functions against synthetic fixtures, temp directories, local tarballs, or real command outputs.

After `npm publish`, verify npm metadata and dist-tags, not immediate registry tarball downloads. `npm view @pkg@version` and `npm view @pkg dist-tags.latest` are sufficient for the release workflow. A follow-up `npm pack @pkg@version` can return `ETARGET` during registry propagation even after publish succeeded.

Reruns are safe only because the workflow treats already-published packages as a verification path: if `npm view PKG@VER` succeeds, the job skips republishing and verifies metadata before continuing.

## Why This Matters

Releases should fail for real package or workflow defects, not because verification races the registry or because tests encode the previous release number.

Uncommitted manifest and lockfile changes make the release artifact ambiguous. CI installs with `bun install --frozen-lockfile`, so a stale lockfile fails before any publish step. Version-sync validation also intentionally fails when the committed manifests do not already match the release version.

Registry tarball verification after publish added a false sense of safety. npm had accepted the publish, signed provenance, moved `latest`, and exposed metadata, but immediate `npm pack @pkg@version` could still fail until tarball download propagation caught up. That check blocked downstream jobs even though the package was already published.

## When to Apply

Use this guidance when:

- preparing a fork release
- bumping package versions or workspace dependencies
- updating `bun.lock` after package manifest changes
- writing or reviewing release tests
- diagnosing npm Trusted Publishing or release workflow failures
- deciding whether a failed release run should be rerun or fixed

## Examples

### Good release preparation

```bash
node scripts/version-sync.mjs 1.2.2-mb.3
bun install
node scripts/version-sync.mjs 1.2.2-mb.3 --validate
bun install --frozen-lockfile
```

Then commit the manifest and lockfile changes before tagging.

### Bad release preparation

```bash
./scripts/release.sh --version 1.2.2-mb.3 --dry-run
./scripts/release.sh --version 1.2.2-mb.3 --yes
```

The dry run previews mutations; it does not update committed manifests or the lockfile.

### Behavioral release tests

Good:

- run `version-sync.mjs` against a temp workspace and inspect the script result
- pack a synthetic tarball fixture and verify package behavior/metadata through the verification script
- assert the release script refuses invalid semver or dirty state

Bad:

- read `packages/core/package.json` and assert a hard-coded current version
- read workflow YAML text and assert command strings are present
- pin tests to the latest release number when the behavior being tested is version-independent

### Publish verification

Use metadata and dist-tag checks after publish:

```bash
npm view @marcusrbrown/anthropic-auth-core@1.2.2-mb.3 version
npm view @marcusrbrown/anthropic-auth-core dist-tags.latest
npm view @marcusrbrown/opencode-anthropic-auth@1.2.2-mb.3 dependencies
```

Avoid hard-gating on immediate registry tarball download after publish:

```bash
npm pack @marcusrbrown/opencode-anthropic-auth@1.2.2-mb.3
```

That command can race tarball propagation even when publish and metadata checks have already succeeded.

## Related

- `.github/workflows/release.yaml`
- `.github/instructions/release.instructions.md`
- `scripts/release.sh`
- `scripts/version-sync.mjs`
- `scripts/verify-artifacts.mjs`
- `docs/plans/2026-05-25-001-fix-fork-core-opencode-publish-plan.md`
- `docs/brainstorms/2026-05-25-fork-core-opencode-publish-requirements.md`
