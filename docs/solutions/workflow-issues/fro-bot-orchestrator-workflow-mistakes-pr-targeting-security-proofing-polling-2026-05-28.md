---
title: Fro Bot workflow orchestration needs verified state
date: 2026-05-28
category: workflow-issues
module: fro-bot-workflow
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - orchestrating PR follow-up work for fork-based repos
  - handling GitHub security-alert visibility claims without live API proof
  - deciding whether to undo local commits during investigation
  - determining correct upstream/base repo for PRs
tags: [fro-bot, fork-prs, github-security, workflow-discipline, polling]
---

# Fro Bot workflow orchestration needs verified state

## Context

During PR #13 workflow cleanup, orchestration drifted from verified state in several ways:

- A GitHub personal-repo Advanced Security `Access to alerts` grant path was inferred from docs, but the actual `advanced-security.png` screenshot showed no such UI.
- Security-alert API/PAT-scope conclusions were treated as proven without a successful live API check from the relevant token context.
- A local commit was reverted as an overcorrection before Marcus explicitly requested rollback.
- A PR was opened against upstream `cortexkit/anthropic-auth` instead of the fork target `marcusrbrown/cortexkit_anthropic-auth`.
- Polling shifted between “stop touching Fro Bot” and “poll it” instead of following the latest explicit instruction.

The fix pattern is process discipline: verify first, pin fork targets explicitly, preserve local history unless told otherwise, and treat permission claims as unknown until proven by the live system.

## Guidance

### Treat security-alert access as unproven until live verification succeeds

Do not infer GitHub security-alert visibility from generic docs, PAT scope descriptions, or partial UI screenshots. For this repo, Fro Bot security-alert visibility is unproven unless a workflow run successfully calls the exact GitHub API with `FRO_BOT_PAT` and reports a successful status.

If debugging access, print only non-sensitive evidence:

- HTTP status
- `X-Accepted-GitHub-Permissions`
- `X-OAuth-Scopes` / `X-GitHub-SSO` when relevant
- endpoint path

Do not print secrets or full alert bodies.

### Pin fork PR repo and base explicitly

For fork maintenance PRs, do not rely on `gh pr create` defaults. Explicitly target the fork repository and fork maintenance branch:

```bash
gh pr create \
  --repo marcusrbrown/cortexkit_anthropic-auth \
  --base marcusrbrown/main \
  --title "..." \
  --body "..."
```

Before or after creating a PR, verify the target:

```bash
gh pr view <number> \
  --repo marcusrbrown/cortexkit_anthropic-auth \
  --json url,baseRefName,headRefName,state
```

Expected base for fork maintenance work is `marcusrbrown/main`, not upstream `main`.

### Do not undo commits unless explicitly requested

If local history already contains a commit, preserve it until the desired cleanup path is explicit. When a correction changes the interpretation of the work, prefer one of these before `reset` or `revert`:

- explain the current state and ask which cleanup path to use
- make a forward follow-up commit
- leave the branch parked

Local history edits are cheap technically, but expensive conversationally when they discard or hide work the user expected to keep.

### Poll from the authoritative target and follow the latest direction

When polling GitHub state, poll the actual PR/run in the intended repository. If Marcus corrects polling direction, follow the newest instruction rather than preserving an earlier automated todo state.

For PR checks:

```bash
gh pr checks <number> --repo marcusrbrown/cortexkit_anthropic-auth
```

For a specific workflow run:

```bash
gh run view <run-id> --repo marcusrbrown/cortexkit_anthropic-auth
```

## Why This Matters

These failures share one root cause: acting on assumptions instead of confirmed state. The cost is not just a wrong command; it creates avoidable PR churn, wrong public artifacts, speculative security guidance, and unnecessary local history changes.

Fork workflows make this especially sharp. One missing `--repo` or `--base` flag can open a PR in the wrong repository. One invented GitHub UI path can waste time chasing permissions that are not available. One premature revert can erase the exact local change the user wanted to ship.

## When to Apply

- Creating or updating PRs from a fork.
- Handling GitHub security-alert access, Dependabot alert access, PAT scope, or collaborator-permission questions.
- Working with local commits that may need cleanup.
- Polling GitHub PR/check/run status.
- Any time evidence is incomplete and the next sentence starts to sound like inference.

## Examples

### Correct fork PR creation

```bash
gh pr create \
  --repo marcusrbrown/cortexkit_anthropic-auth \
  --base marcusrbrown/main \
  --title "ci(fro-bot): remove security alert scan" \
  --body "$(cat /tmp/pr-body.md)"
```

### Incorrect upstream target

```bash
gh pr create --repo cortexkit/anthropic-auth --base main
```

### Safe security-access claim

Use:

> Fro Bot security-alert visibility is unproven until the workflow successfully calls the exact endpoint with the configured token.

Avoid:

> Fro Bot can access alerts because it is a collaborator.

Avoid:

> Grant access under Settings → Advanced Security → Access to alerts.

That path was not visible in the repo screenshot and should not be claimed without current UI/API evidence.

### Safe local-history response

Use:

> The branch currently has commit X. Do you want me to revert it, amend it, or leave it parked?

Avoid immediately running:

```bash
git revert <commit>
```

unless rollback was explicitly requested.

## Related

- `.github/workflows/fro-bot.yaml` — Fro Bot prompt and trusted-author workflow constraints.
- `.github/copilot-instructions.md` — repo-level agent instructions and security/privacy posture.
- `.github/instructions/release.instructions.md` — fork release constraints and least-privilege workflow guidance.
- `scripts/release.sh` — release branch gate includes `marcusrbrown/main`.
