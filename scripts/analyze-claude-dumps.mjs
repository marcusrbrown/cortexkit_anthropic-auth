#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_DIR = join(tmpdir(), 'opencode-anthropic-auth-dumps')

function usage() {
  console.log(`Usage: node scripts/analyze-claude-dumps.mjs [options]

Options:
  --dir <path>       Dump directory (default: ${DEFAULT_DIR})
  --session <id>     Restrict to one short session id from metadata
  --json             Emit JSON instead of text
  --help             Show this help
`)
}

function parseArgs(argv) {
  const args = { dir: DEFAULT_DIR, session: null, json: false }

  for (let index = 2; index < argv.length; index++) {
    const arg = argv[index]
    const next = () => {
      const value = argv[++index]
      if (!value) throw new Error(`Missing value for ${arg}`)
      return value
    }

    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    } else if (arg === '--dir') {
      args.dir = next()
    } else if (arg === '--session') {
      args.session = next()
    } else if (arg === '--json') {
      args.json = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

function bodyHash(meta, key) {
  return meta?.body && typeof meta.body[key] !== 'undefined'
    ? meta.body[key]
    : null
}

function compareMeta(previous, current) {
  const changes = {
    systemHash:
      bodyHash(previous, 'systemHash') !== bodyHash(current, 'systemHash'),
    message0Hash:
      bodyHash(previous, 'message0Hash') !== bodyHash(current, 'message0Hash'),
    messagesAfter0Hash:
      bodyHash(previous, 'messagesAfter0Hash') !==
      bodyHash(current, 'messagesAfter0Hash'),
    cch: bodyHash(previous, 'cch') !== bodyHash(current, 'cch'),
    model: bodyHash(previous, 'model') !== bodyHash(current, 'model'),
  }
  const nonTailChanged =
    changes.systemHash || changes.message0Hash || changes.cch || changes.model
  return {
    previous: previous.id,
    current: current.id,
    session: current.session ?? previous.session ?? null,
    risk: nonTailChanged ? 'bust-candidate' : 'tail-only',
    changes,
    previousBytes: previous.bodyBytes ?? null,
    currentBytes: current.bodyBytes ?? null,
    previousTransport: previous.transport ?? null,
    currentTransport: current.transport ?? null,
    previousMode: previous.mode ?? null,
    currentMode: current.mode ?? null,
  }
}

async function loadMetadata(dir, session) {
  if (!existsSync(dir)) return []
  const files = (await readdir(dir)).filter((file) =>
    file.endsWith('.meta.json'),
  )
  const metas = []
  for (const file of files) {
    const meta = JSON.parse(await readFile(join(dir, file), 'utf8'))
    if (session && meta.session !== session) continue
    metas.push(meta)
  }
  return metas.sort((a, b) => {
    const created = String(a.createdAt ?? '').localeCompare(
      String(b.createdAt ?? ''),
    )
    if (created !== 0) return created
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
}

function buildPairs(metas) {
  const pairs = []
  const bySession = new Map()
  for (const meta of metas) {
    const session = meta.session
    if (!session) continue // skip anonymous dumps — pairing them fabricates misleading candidates
    const previous = bySession.get(session)
    if (previous) pairs.push(compareMeta(previous, meta))
    bySession.set(session, meta)
  }
  return pairs
}

function printText(report) {
  console.log('Claude dump cache-bust metadata analysis')
  console.log('========================================')
  console.log(`Directory: ${report.dir}`)
  console.log(`Dumps: ${report.dumps}`)
  console.log(`Adjacent pairs: ${report.pairs.length}`)
  console.log(`Bust candidates: ${report.summary.bustCandidates}`)
  console.log(`Tail-only: ${report.summary.tailOnly}`)
  for (const pair of report.pairs) {
    console.log(
      `${pair.risk}: ${pair.previous} -> ${pair.current} session=${pair.session ?? 'unknown'} changes=${
        Object.entries(pair.changes)
          .filter(([, changed]) => changed)
          .map(([key]) => key)
          .join(',') || 'none'
      }`,
    )
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const dir = resolve(args.dir)
  const metas = await loadMetadata(dir, args.session)
  const pairs = buildPairs(metas)
  const report = {
    dir,
    dumps: metas.length,
    sessions: [...new Set(metas.map((meta) => meta.session ?? null))],
    pairs,
    summary: {
      bustCandidates: pairs.filter((pair) => pair.risk === 'bust-candidate')
        .length,
      tailOnly: pairs.filter((pair) => pair.risk === 'tail-only').length,
    },
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printText(report)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
