// Pure display helpers for Workflows: day-grouping, owner-facing status/avatar
// mapping, and formatting. No React, no I/O — this is the testable core.
//
// Product-truth rules baked in here: status is DERIVED from the stored
// artifacts (never model-generated); a missing value is OMITTED by the view,
// never shown as a zero or a fake placeholder. The journal reads as a diary of
// outcomes, so the labels here are plain owner language, not machine vocabulary.

// ---------------------------------------------------------------------------
// Provider chip
// ---------------------------------------------------------------------------

export function providerLabel(provider) {
  if (provider === 'claude') return 'Claude'
  if (provider === 'codex') return 'Codex'
  return (typeof provider === 'string' && provider ? provider : 'Agent')
}

// ---------------------------------------------------------------------------
// Ambient status — the three journal/turn states and their dot styling.
// `done` is the quiet default; `attention` is the amber "needs a look"; `run`
// is in-progress. Anything unknown stays neutral rather than inventing success.
// ---------------------------------------------------------------------------

export function statusDot(status) {
  if (status === 'done') return 'done'
  if (status === 'attention') return 'attn'
  if (status === 'running') return 'run'
  return 'neutral'
}

// ---------------------------------------------------------------------------
// Subagent identity — kind → avatar glyph, wrapper class, default name and the
// plain one-line role. The stored `name` on a sub wins when present; this only
// fills the glyph/class and a fallback name.
// ---------------------------------------------------------------------------

const AVATARS = {
  explore: { cls: 'explore', emoji: '🔍', name: 'Explorer' },
  codex: { cls: 'codex', emoji: '◆', name: 'Codex' },
  build: { cls: 'build', emoji: '🛠', name: 'Builder' },
  general: { cls: 'build', emoji: '🛠', name: 'Helper' },
}

export function avatarFor(kind) {
  return AVATARS[kind] || AVATARS.general
}

// A subagent's fate, shown as a small badge on its card. Only `done` and `run`
// appear in the common path; `failed`/`stopped` are styled too so a drifted
// state never renders unlabelled.
export function subStateMeta(state) {
  if (state === 'done') return { cls: 'done', glyph: '✓', label: 'done' }
  if (state === 'running') return { cls: 'run', glyph: '◌', label: 'running' }
  if (state === 'failed') return { cls: 'failed', glyph: '✕', label: 'failed' }
  if (state === 'stopped') return { cls: 'stopped', glyph: '‖', label: 'stopped' }
  return { cls: 'unknown', glyph: '?', label: 'status unavailable' }
}

// ---------------------------------------------------------------------------
// Day-grouping — the journal is grouped by calendar day using each entry's ts.
// Labels: Today / Yesterday / weekday+date within the week / a plain date for
// older / "Earlier" for anything with a null or unparseable ts. Entries arrive
// newest-first; a Map keeps first-seen order so a day's entries stay together
// even if the roster ever interleaves them.
// ---------------------------------------------------------------------------

function startOfDay(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayBucket(iso, now) {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return { key: 'earlier', label: 'Earlier' }
  const today = startOfDay(now)
  const day = startOfDay(t)
  const diffDays = Math.round((today - day) / 86400000)
  const key = `d${day}`
  if (diffDays <= 0) return { key, label: 'Today' }
  if (diffDays === 1) return { key, label: 'Yesterday' }
  const d = new Date(t)
  if (diffDays < 7) {
    const weekday = d.toLocaleDateString(undefined, { weekday: 'long' })
    const md = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    return { key, label: `${weekday} · ${md}` }
  }
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const label = d.toLocaleDateString(undefined,
    sameYear ? { day: 'numeric', month: 'short' }
             : { day: 'numeric', month: 'short', year: 'numeric' })
  return { key, label }
}

export function groupEntriesByDay(entries, now = Date.now()) {
  const list = Array.isArray(entries) ? entries : []
  const groups = []
  const byKey = new Map()
  for (const e of list) {
    const { key, label } = dayBucket(e && e.ts, now)
    let g = byKey.get(key)
    if (!g) { g = { key, label, items: [] }; byKey.set(key, g); groups.push(g) }
    g.items.push(e)
  }
  return groups
}

// ---------------------------------------------------------------------------
// Relative time (used for the header "Updated …" label)
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
// Markdown-lite — a safe, tiny subset for the agent's verbatim words (turn
// `original`, helper briefs/reports). Returns a plain block/span structure the
// view maps to React elements; it never produces HTML, so there is no injection
// surface.
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
