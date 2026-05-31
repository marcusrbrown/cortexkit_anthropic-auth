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

test('cch-only change (billing header volatility) is NOT a bust candidate', () => {
  writeMeta('001.meta.json', {
    id: '001',
    createdAt: '2026-05-30T10:00:00.000Z',
    session: 'sess1',
    body: {
      systemHash: 'system-hash-a',
      stableSystemHash: 'stable-hash-x',
      message0Hash: 'message0-a',
      messagesAfter0Hash: 'tail-a',
      cch: 'aabb1',
    },
  })
  writeMeta('002.meta.json', {
    id: '002',
    createdAt: '2026-05-30T10:01:00.000Z',
    session: 'sess1',
    body: {
      systemHash: 'system-hash-b',
      stableSystemHash: 'stable-hash-x',
      message0Hash: 'message0-a',
      messagesAfter0Hash: 'tail-b',
      cch: 'ccdd2',
    },
  })

  const result = runAnalyze(['--json'])
  expect(result.exitCode).toBe(0)
  const report = JSON.parse(result.stdout)
  expect(report.pairs[0]).toMatchObject({
    previous: '001',
    current: '002',
    risk: 'tail-only',
    changes: {
      stableSystemHash: false,
      cch: true,
    },
  })
})

test('real stable-system change alongside cch change IS still a bust candidate', () => {
  writeMeta('001.meta.json', {
    id: '001',
    createdAt: '2026-05-30T10:00:00.000Z',
    session: 'sess2',
    body: {
      systemHash: 'system-hash-a',
      stableSystemHash: 'stable-hash-old',
      message0Hash: 'message0-a',
      messagesAfter0Hash: 'tail-a',
      cch: 'aabb1',
    },
  })
  writeMeta('002.meta.json', {
    id: '002',
    createdAt: '2026-05-30T10:01:00.000Z',
    session: 'sess2',
    body: {
      systemHash: 'system-hash-b',
      stableSystemHash: 'stable-hash-new',
      message0Hash: 'message0-a',
      messagesAfter0Hash: 'tail-b',
      cch: 'ccdd2',
    },
  })

  const result = runAnalyze(['--json'])
  expect(result.exitCode).toBe(0)
  const report = JSON.parse(result.stdout)
  expect(report.pairs[0]).toMatchObject({
    previous: '001',
    current: '002',
    risk: 'bust-candidate',
    changes: {
      stableSystemHash: true,
      cch: true,
    },
  })
})

test('legacy meta without stableSystemHash still busts on systemHash change', () => {
  writeMeta('001.meta.json', {
    id: '001',
    createdAt: '2026-05-30T10:00:00.000Z',
    session: 'sess3',
    body: {
      systemHash: 'sys-a',
      message0Hash: 'm0-a',
      messagesAfter0Hash: 'tail-a',
    },
  })
  writeMeta('002.meta.json', {
    id: '002',
    createdAt: '2026-05-30T10:01:00.000Z',
    session: 'sess3',
    body: {
      systemHash: 'sys-b',
      message0Hash: 'm0-a',
      messagesAfter0Hash: 'tail-b',
    },
  })

  const result = runAnalyze(['--json'])
  expect(result.exitCode).toBe(0)
  const report = JSON.parse(result.stdout)
  expect(report.pairs[0]).toMatchObject({
    risk: 'bust-candidate',
    changes: { systemHash: true },
  })
})

test('mixed legacy and stable meta falls back to systemHash', () => {
  writeMeta('001.meta.json', {
    id: '001',
    createdAt: '2026-05-30T10:00:00.000Z',
    session: 'sess4',
    body: {
      systemHash: 'system-hash-a',
      message0Hash: 'message0-a',
      messagesAfter0Hash: 'tail-a',
      cch: 'aabb1',
    },
  })
  writeMeta('002.meta.json', {
    id: '002',
    createdAt: '2026-05-30T10:01:00.000Z',
    session: 'sess4',
    body: {
      systemHash: 'system-hash-b',
      stableSystemHash: 'stable-hash-x',
      message0Hash: 'message0-a',
      messagesAfter0Hash: 'tail-b',
      cch: 'ccdd2',
    },
  })

  const result = runAnalyze(['--json'])
  expect(result.exitCode).toBe(0)
  const report = JSON.parse(result.stdout)
  expect(report.pairs[0]).toMatchObject({
    risk: 'bust-candidate',
    changes: {
      systemHash: true,
      cch: true,
    },
  })
  expect(report.pairs[0].changes).not.toHaveProperty('stableSystemHash')
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

  test('does not pair anonymous dumps without a session together', () => {
    writeMeta('001.meta.json', {
      id: '001',
      createdAt: '2026-05-29T12:00:00.000Z',
      transport: 'direct',
      body: {
        systemHash: 'system-a',
        message0Hash: 'message0-a',
        messagesAfter0Hash: 'tail-a',
      },
    })
    writeMeta('002.meta.json', {
      id: '002',
      createdAt: '2026-05-29T12:01:00.000Z',
      transport: 'direct',
      body: {
        systemHash: 'system-b',
        message0Hash: 'message0-b',
        messagesAfter0Hash: 'tail-b',
      },
    })

    const result = runAnalyze(['--json'])

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout)
    // Anonymous dumps must NOT be paired together — no bust candidates between them
    expect(report.pairs).toHaveLength(0)
  })
})
