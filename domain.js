// Pure display helpers for Workflows: derived status, rollups, ordering, and
// owner-facing formatting. No React, no I/O — this is the testable core.
//
// Product-truth rules baked in here: status is DERIVED from the stored
// artifacts (never model-generated); a missing number is OMITTED, never shown
// as a zero; a null reported_outcome renders as "No completion report" and is
// never back-filled with an invented gap.

// ---------------------------------------------------------------------------
// Provider chip
// ---------------------------------------------------------------------------

export function providerLabel(provider) {
  if (provider === 'claude') return 'CLAUDE'
  if (provider === 'codex') return 'CODEX'
  return (typeof provider === 'string' && provider ? provider.toUpperCase() : 'AGENT')
}

export function providerClass(provider) {
  if (provider === 'claude') return 'is-claude'
  if (provider === 'codex') return 'is-codex'
  return 'is-other'
}

// ---------------------------------------------------------------------------
// Helper status — the five derived states and their dot styling
// ---------------------------------------------------------------------------

const STATUS = {
  finished: { label: 'Finished', dot: 'is-finished' },
  working: { label: 'Working', dot: 'is-working' },
  failed: { label: 'Failed', dot: 'is-failed' },
  stopped: { label: 'Stopped', dot: 'is-stopped' },
  unavailable: { label: 'Unavailable', dot: 'is-unavailable' },
}

export function statusMeta(status) {
  return STATUS[status] || STATUS.unavailable
}

// The single representative state for a whole chat, from its helper tallies.
// Attention-ordered: an active helper wins, then a failure, then a stop, then
// a clean finish; nothing known reads as unavailable.
export function chatStatus(helpers) {
  const h = helpers || {}
  if ((h.working || 0) > 0) return 'working'
  if ((h.failed || 0) > 0) return 'failed'
  if ((h.finished || 0) > 0) return 'finished'
  if ((h.stopped || 0) > 0) return 'stopped'
  return 'unavailable'
}

// A one-line rollup like "5 helpers · all finished" or "3 helpers · 1 working".
export function helperRollup(helpers) {
  const h = helpers || {}
  const finished = h.finished || 0
  const working = h.working || 0
  const failed = h.failed || 0
  const stopped = h.stopped || 0
  const total = finished + working + failed + stopped
  if (total === 0) return 'No helpers yet'
  const noun = total === 1 ? 'helper' : 'helpers'
  const parts = []
  if (working) parts.push(`${working} working`)
  if (failed) parts.push(`${failed} failed`)
  if (stopped) parts.push(`${stopped} stopped`)
  let summary
  if (parts.length === 0) {
    summary = 'all finished'
  } else {
    if (finished) parts.push(`${finished} finished`)
    summary = parts.join(', ')
  }
  return `${total} ${noun} · ${summary}`
}

// ---------------------------------------------------------------------------
// Ordering — working-first, then attention (failed), then recency
// ---------------------------------------------------------------------------

function activityMs(chat) {
  const t = Date.parse((chat && chat.last_activity_at) || '')
  return Number.isFinite(t) ? t : 0
}

export function chatGroup(chat) {
  const h = (chat && chat.helpers) || {}
  if ((h.working || 0) > 0) return 0
  if ((h.failed || 0) > 0) return 1
  return 2
}

export function sortChats(chats) {
  return [...(Array.isArray(chats) ? chats : [])].sort((a, b) => {
    const ga = chatGroup(a)
    const gb = chatGroup(b)
    if (ga !== gb) return ga - gb
    return activityMs(b) - activityMs(a)
  })
}

export function hasCodexChat(chats) {
  return (Array.isArray(chats) ? chats : []).some((c) => c && c.provider === 'codex')
}

// ---------------------------------------------------------------------------
// Formatting — every one returns null for "omit", never a zero placeholder
// ---------------------------------------------------------------------------

function trimNum(value, digits) {
  return Number(value.toFixed(digits)).toString()
}

export function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return null
  if (n < 1000) return String(Math.round(n))
  if (n < 1e6) {
    const v = n / 1000
    return `${trimNum(v, v < 100 ? 1 : 0)}k`
  }
  return `${trimNum(n / 1e6, 1)}M`
}


// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

export function relativeTime(iso, now = Date.now()) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now - t)
  const s = Math.floor(diff / 1000)
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  const dt = new Date(t)
  const sameYear = dt.getFullYear() === new Date(now).getFullYear()
  return dt.toLocaleDateString(undefined,
    sameYear ? { month: 'short', day: 'numeric' }
             : { month: 'short', day: 'numeric', year: 'numeric' })
}

// True when index.json is missing or older than the freshness window, so an
// on-open auto-refresh is warranted.
export function isStale(iso, now = Date.now(), thresholdMs = 2 * 60 * 1000) {
  if (!iso) return true
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return true
  return now - t > thresholdMs
}

// ---------------------------------------------------------------------------
// Markdown-lite — a safe, tiny subset for helper final reports. Returns a plain
// block/span structure the view maps to React elements; it never produces HTML,
// so there is no injection surface.
// ---------------------------------------------------------------------------

function parseInline(text) {
  const spans = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) spans.push({ t: 'text', v: text.slice(last, m.index) })
    if (m[2] != null) spans.push({ t: 'bold', v: m[2] })
    else if (m[3] != null) spans.push({ t: 'code', v: m[3] })
    last = m.index + m[0].length
  }
  if (last < text.length) spans.push({ t: 'text', v: text.slice(last) })
  return spans.length ? spans : [{ t: 'text', v: text }]
}

export function parseMarkdownLite(text) {
  const src = typeof text === 'string' ? text : ''
  if (!src.trim()) return []
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let para = []
  let inCode = false
  let code = []
  const flush = () => {
    if (para.length) {
      blocks.push({ type: 'para', spans: parseInline(para.join(' ')) })
      para = []
    }
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    // Fenced code block — verbatim, no inline parsing inside.
    const fence = line.match(/^\s*```/)
    if (fence) {
      if (inCode) { blocks.push({ type: 'code', text: code.join('\n') }); code = []; inCode = false }
      else { flush(); inCode = true }
      continue
    }
    if (inCode) { code.push(raw); continue }
    if (!line.trim()) { flush(); continue }
    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) { flush(); blocks.push({ type: 'heading', level: heading[1].length, spans: parseInline(heading[2]) }); continue }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) { flush(); blocks.push({ type: 'bullet', spans: parseInline(bullet[1]) }); continue }
    const num = line.match(/^\s*(\d{1,3})[.)]\s+(.*)$/)
    if (num) { flush(); blocks.push({ type: 'num', n: num[1], spans: parseInline(num[2]) }); continue }
    para.push(line.trim())
  }
  if (inCode && code.length) blocks.push({ type: 'code', text: code.join('\n') })
  flush()
  return blocks
}
