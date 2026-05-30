import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT_PATH = join(import.meta.dir, 'analyze-claude-dumps.mjs')

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'claude-dumps-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function writeMeta(name: string, meta: Record<string, unknown>) {
  writeFileSync(join(tempDir, name), `${JSON.stringify(meta, null, 2)}\n`)
}

function runAnalyze(args: string[] = []) {
  const result = spawnSync('node', [SCRIPT_PATH, '--dir', tempDir, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

describe('analyze-claude-dumps', () => {
  test('flags non-tail cache-bust candidates from metadata only', () => {
    writeMeta('001.meta.json', {
      id: '001',
      createdAt: '2026-05-29T12:00:00.000Z',
      session: 'abc123',
      transport: 'direct',
      mode: 'direct',
      bodyBytes: 100,
      bodyHash: 'body-a',
      body: {
        systemHash: 'system-a',
        message0Hash: 'message0-a',
        messagesAfter0Hash: 'tail-a',
      },
    })
    writeMeta('002.meta.json', {
      id: '002',
      createdAt: '2026-05-29T12:01:00.000Z',
      session: 'abc123',
      transport: 'direct',
      mode: 'direct',
      bodyBytes: 120,
      bodyHash: 'body-b',
      body: {
        systemHash: 'system-b',
        message0Hash: 'message0-a',
        messagesAfter0Hash: 'tail-b',
      },
    })

    const result = runAnalyze(['--json'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('prompt')
    const report = JSON.parse(result.stdout)
    expect(report.pairs[0]).toMatchObject({
      previous: '001',
      current: '002',
      session: 'abc123',
      risk: 'bust-candidate',
      changes: {
        systemHash: true,
        message0Hash: false,
        messagesAfter0Hash: true,
      },
    })
  })

  test('treats tail-only message changes as expected continuation', () => {
    writeMeta('001.meta.json', {
      id: '001',
      createdAt: '2026-05-29T12:00:00.000Z',
      session: 'abc123',
      body: {
        systemHash: 'system-a',
        message0Hash: 'message0-a',
        messagesAfter0Hash: 'tail-a',
      },
    })
    writeMeta('002.meta.json', {
      id: '002',
      createdAt: '2026-05-29T12:01:00.000Z',
      session: 'abc123',
      body: {
        systemHash: 'system-a',
        message0Hash: 'message0-a',
        messagesAfter0Hash: 'tail-b',
      },
    })

    const result = runAnalyze(['--json'])

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report.pairs[0]).toMatchObject({
      risk: 'tail-only',
      changes: {
        systemHash: false,
        message0Hash: false,
        messagesAfter0Hash: true,
      },
    })
  })
})
