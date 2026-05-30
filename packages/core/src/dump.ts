import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { relayLog } from './logger.ts'

export const CLAUDE_DUMP_COMMAND_NAME = 'claude-dump'

const DUMP_STATUS_TITLE = '## Claude Dump Status'
const DUMP_ENABLED_TITLE = '## Claude Dump Enabled'
const DUMP_DISABLED_TITLE = '## Claude Dump Disabled'
const DUMP_USAGE_TITLE = '## Claude Dump Usage'
const DUMP_USAGE =
  'Usage: `/claude-dump`, `/claude-dump on`, or `/claude-dump off`.'
const DUMP_DIR = join(tmpdir(), 'opencode-anthropic-auth-dumps')

let dumpEnabled = false
let nextDumpId = 0

export type DumpCommandAction =
  | { type: 'status' }
  | { type: 'enable' }
  | { type: 'disable' }
  | { type: 'usage' }

export function isDumpEnabled() {
  return dumpEnabled
}

export function setDumpEnabled(enabled: boolean) {
  dumpEnabled = enabled
}

export function resetDumpState() {
  dumpEnabled = false
}

export function getDumpDirectory() {
  return DUMP_DIR
}

export function parseDumpCommandAction(
  argumentsText: string,
): DumpCommandAction {
  const normalized = argumentsText.trim().split(/\s+/).filter(Boolean)
  if (normalized.length === 0) return { type: 'status' }
  if (normalized.length === 1 && normalized[0] === 'on')
    return { type: 'enable' }
  if (normalized.length === 1 && normalized[0] === 'off')
    return { type: 'disable' }
  return { type: 'usage' }
}

export function buildDumpStatusSummary(input?: { enabled?: boolean }) {
  const enabled = input?.enabled ?? dumpEnabled
  return [
    DUMP_STATUS_TITLE,
    '',
    `- Enabled: ${enabled ? 'enabled' : 'disabled'}`,
    `- Directory: ${DUMP_DIR}`,
    '- Persisted: ~/.config/opencode/anthropic-auth.json',
    '- Captures: final rewritten Anthropic body plus redacted relay payload metadata',
    '- Warning: body dumps may contain prompt/session content; turn this off after debugging',
  ].join('\n')
}

export function executeDumpCommand(input: {
  argumentsText: string
  enabled?: boolean
}) {
  const action = parseDumpCommandAction(input.argumentsText)
  const enabled = input.enabled ?? dumpEnabled

  if (action.type === 'status') return buildDumpStatusSummary({ enabled })

  if (action.type === 'enable') {
    return [
      DUMP_ENABLED_TITLE,
      '',
      buildDumpStatusSummary({ enabled: true }),
    ].join('\n')
  }

  if (action.type === 'disable') {
    return [
      DUMP_DISABLED_TITLE,
      '',
      buildDumpStatusSummary({ enabled: false }),
    ].join('\n')
  }

  return [
    DUMP_USAGE_TITLE,
    '',
    DUMP_USAGE,
    '',
    buildDumpStatusSummary({ enabled }),
  ].join('\n')
}

function shortAffinity(affinity: string) {
  return affinity.length <= 16 ? affinity : `${affinity.slice(0, 12)}…`
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function cchToken(bodyText: string) {
  return bodyText.match(/\bcch=([0-9a-f]{5});/)?.[1] ?? null
}

function diffSummary(previousBodyText: string | undefined, bodyText: string) {
  if (previousBodyText == null) return null
  if (previousBodyText === bodyText) {
    return {
      changed: false,
      firstByte: -1,
      lastPreviousByte: -1,
      lastCurrentByte: -1,
      previousBytes: previousBodyText.length,
      currentBytes: bodyText.length,
    }
  }

  let firstByte = 0
  while (
    firstByte < previousBodyText.length &&
    firstByte < bodyText.length &&
    previousBodyText[firstByte] === bodyText[firstByte]
  ) {
    firstByte += 1
  }

  let previousTail = previousBodyText.length - 1
  let currentTail = bodyText.length - 1
  while (
    previousTail >= firstByte &&
    currentTail >= firstByte &&
    previousBodyText[previousTail] === bodyText[currentTail]
  ) {
    previousTail -= 1
    currentTail -= 1
  }

  return {
    changed: true,
    firstByte,
    lastPreviousByte: previousTail,
    lastCurrentByte: currentTail,
    changedPreviousBytes: previousTail - firstByte + 1,
    changedCurrentBytes: currentTail - firstByte + 1,
    previousBytes: previousBodyText.length,
    currentBytes: bodyText.length,
  }
}

function parseBody(bodyText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(bodyText)
    return parsed != null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? parsed
      : null
  } catch (error) {
    relayLog(
      `dump body parse failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

function hashJson(value: unknown) {
  return hashText(JSON.stringify(value))
}

function stableSystemBlocks(system: unknown[]) {
  const first = system[0]
  return first &&
    typeof first === 'object' &&
    'text' in first &&
    typeof first.text === 'string' &&
    first.text.startsWith('x-anthropic-billing-header:')
    ? system.slice(1)
    : system
}

function bodyStructureSummary(bodyText: string) {
  const parsed = parseBody(bodyText)
  if (!parsed) return { parseable: false as const }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : []
  const system = Array.isArray(parsed.system) ? parsed.system : []
  const message0 = messages[0]
  const messagesAfter0 = messages.slice(1)

  return {
    parseable: true as const,
    model: typeof parsed.model === 'string' ? parsed.model : undefined,
    stream: parsed.stream,
    systemCount: system.length,
    messagesCount: messages.length,
    systemHash: hashJson(system),
    // stableSystemHash excludes only the volatile x-anthropic-billing-header
    // block whose cch=<5hex> token changes on every request.
    stableSystemHash: hashJson(stableSystemBlocks(system)),
    message0Hash: message0 === undefined ? null : hashJson(message0),
    message0Bytes: message0 === undefined ? 0 : JSON.stringify(message0).length,
    messagesAfter0Hash: hashJson(messagesAfter0),
    messagesAfter0Bytes: JSON.stringify(messagesAfter0).length,
    cch: cchToken(bodyText),
  }
}

function redactForDump(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForDump)
  if (value == null || typeof value !== 'object') return value

  const redacted: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const lower = key.toLowerCase()
    if (
      lower === 'authorization' ||
      lower === 'x-api-key' ||
      lower === 'cookie' ||
      lower === 'set-cookie'
    ) {
      redacted[key] = '[redacted]'
      continue
    }
    redacted[key] = redactForDump(entry)
  }
  return redacted
}

export async function dumpDirectRequest(input: {
  affinity?: string
  mode: 'direct' | 'fallback'
  status?: number
  bodyText: string
}) {
  if (!dumpEnabled) return
  nextDumpId += 1
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(nextDumpId).padStart(5, '0')}-direct-${input.mode}`
  const prefix = join(DUMP_DIR, id)

  try {
    await mkdir(DUMP_DIR, { recursive: true })
    const metadata = {
      id,
      createdAt: new Date().toISOString(),
      session: input.affinity ? shortAffinity(input.affinity) : undefined,
      transport: 'direct',
      mode: input.mode,
      status: input.status,
      bodyBytes: input.bodyText.length,
      bodyHash: hashText(input.bodyText),
      body: bodyStructureSummary(input.bodyText),
      files: {
        body: `${prefix}.body.json`,
        metadata: `${prefix}.meta.json`,
      },
    }

    await Promise.all([
      writeFile(`${prefix}.body.json`, input.bodyText, 'utf8'),
      writeFile(
        `${prefix}.meta.json`,
        `${JSON.stringify(metadata, null, 2)}\n`,
        'utf8',
      ),
    ])

    relayLog(
      `dumped direct request id=${id} body=${prefix}.body.json meta=${prefix}.meta.json`,
    )
  } catch (error) {
    relayLog(
      `dump failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function dumpRelayRequest(input: {
  affinity: string
  transport: 'http' | 'websocket'
  protocol: 1 | 2
  mode: 'full_sync' | 'patch'
  status?: number
  bodyText: string
  previousBodyText?: string
  payload: unknown
  relayBytes: number
}) {
  if (!dumpEnabled) return
  nextDumpId += 1
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(nextDumpId).padStart(5, '0')}-${input.transport}-p${input.protocol}-${input.mode}`
  const prefix = join(DUMP_DIR, id)

  try {
    await mkdir(DUMP_DIR, { recursive: true })
    const metadata = {
      id,
      createdAt: new Date().toISOString(),
      session: shortAffinity(input.affinity),
      transport: input.transport,
      protocol: input.protocol,
      mode: input.mode,
      status: input.status,
      bodyBytes: input.bodyText.length,
      relayBytes: input.relayBytes,
      bodyHash: hashText(input.bodyText),
      diff: diffSummary(input.previousBodyText, input.bodyText),
      body: bodyStructureSummary(input.bodyText),
      files: {
        body: `${prefix}.body.json`,
        relay: `${prefix}.relay.json`,
        metadata: `${prefix}.meta.json`,
      },
    }

    await Promise.all([
      writeFile(`${prefix}.body.json`, input.bodyText, 'utf8'),
      writeFile(
        `${prefix}.relay.json`,
        `${JSON.stringify(redactForDump(input.payload), null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        `${prefix}.meta.json`,
        `${JSON.stringify(metadata, null, 2)}\n`,
        'utf8',
      ),
    ])

    relayLog(
      `dumped request id=${id} session=${shortAffinity(input.affinity)} body=${prefix}.body.json meta=${prefix}.meta.json`,
    )
  } catch (error) {
    relayLog(
      `dump failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
