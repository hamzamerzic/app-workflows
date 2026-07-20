// What a background helper actually was, did, and how it ended — derived from
// the single `Agent` tool block the transcript already records. No new
// instrumentation is involved: the spawn arguments and the helper's returned
// payload are both already in that block, so a chat that ran helpers before any
// observability shipped can still be read back.
//
// The cardinal rule is NEVER INVENT. Every field below is either recovered from
// the block or null, and null means the UI says "not recorded" rather than
// showing a plausible-looking zero or a summary nobody wrote. Measured against
// 39 production blocks, coverage is uneven by design: 37 carry a description,
// 32 a helper type, but only 11 carry any output at all — so an absent outcome
// is the normal case, not an error.

// The spawn arguments reach us as a STRING in one of two shapes, and either can
// be clipped mid-value because the transcript truncates long tool inputs:
//   (A) a Python-dict repr:  {'subagent_type': 'Explore', 'description': '...'}
//   (B) comma-separated kv:  description=..., subagent_type=..., prompt=...
// Rather than commit to one grammar, pull each field independently and tolerate
// a value that simply runs off the end of the string.
function field(input, name) {
  if (typeof input !== 'string' || !input) return null

  // Shape A. The value is quoted, so accept escaped quotes inside it, and also
  // accept an UNTERMINATED value (a truncated block) by falling back to "the
  // rest of the string".
  const quoted = new RegExp(`['"]${name}['"]\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'`)
  const quotedHit = input.match(quoted)
  if (quotedHit) return unescapeish(quotedHit[1])
  const quotedOpen = new RegExp(`['"]${name}['"]\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)$`)
  const quotedOpenHit = input.match(quotedOpen)
  if (quotedOpenHit) return unescapeish(quotedOpenHit[1])

  // Shape B. A value runs until the next `word=` key or the end of the string.
  const kv = new RegExp(`(?:^|,\\s*)${name}=([\\s\\S]*?)(?=,\\s*[A-Za-z_][A-Za-z0-9_]*=|$)`)
  const kvHit = input.match(kv)
  if (kvHit) return unescapeish(kvHit[1])

  return null
}

// The dict shape arrives already escaped for Python's repr, so a literal \n in
// the transcript is two characters rather than a newline. Undo just enough for
// the value to read as prose; anything we do not recognise is left alone.
function unescapeish(value) {
  const text = String(value == null ? '' : value)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .trim()
  return text || null
}

// A helper's returned payload carries three different things concatenated: the
// actual result, a line naming the agent so it can be resumed, and a usage
// block. Split them apart so the result can be shown on its own and the
// bookkeeping does not leak into a summary the reader is trying to skim.
function splitOutput(output) {
  const raw = typeof output === 'string' ? output : ''
  const agentIdHit = raw.match(/agentId:\s*([A-Za-z0-9_-]+)/)
  const usageHit = raw.match(/<usage>([\s\S]*?)<\/usage>/)

  const body = raw
    .replace(/<usage>[\s\S]*?<\/usage>/g, '')
    .replace(/^.*agentId:\s*[A-Za-z0-9_-]+.*$/gm, '')
    .trim()

  return {
    body: body || null,
    agentId: agentIdHit ? agentIdHit[1] : null,
    usage: usageHit ? usageHit[1] : null,
  }
}

// A usage counter is only meaningful when it was actually recorded. Returning
// null for a missing one keeps "we never measured this" distinguishable from a
// real zero — a helper that genuinely used no tools and a helper we have no
// metrics for are different facts and must not render the same.
function usageNumber(usage, key) {
  if (typeof usage !== 'string' || !usage) return null
  const hit = usage.match(new RegExp(`${key}\\s*:\\s*(-?\\d+)`))
  if (!hit) return null
  const value = Number(hit[1])
  return Number.isFinite(value) ? value : null
}

// An error can arrive as the whole payload, so decide from the leading text
// rather than searching the body — a result that merely discusses an error
// ("the fix for API Error 529 is…") must not be misread as one.
function looksLikeError(body) {
  if (!body) return false
  const head = body.slice(0, 200)
  return /^\s*API Error\b/i.test(head)
    || /^\s*(error|failed)\b/i.test(head)
    || /^\s*Traceback \(most recent call last\)/.test(head)
}

const FINISHED = ['done', 'finished', 'completed', 'complete', 'success']
const WORKING = ['running', 'in_progress', 'in-progress', 'working', 'started']
const STOPPED = ['stopped', 'cancelled', 'canceled', 'interrupted', 'aborted']

// The recorded status is not trustworthy on its own: in production, helpers
// whose payload is an outright API error are still written down as `done`. When
// the payload contradicts the status the PAYLOAD wins, because a helper that
// returned an error did not do the work no matter what the bookkeeping says —
// and `trustedState` is set to false so the UI can show that the label was
// overridden rather than quietly presenting it as fact.
function deriveState(status, outcomeKind) {
  const raw = String(status == null ? '' : status).toLowerCase().trim()

  if (outcomeKind === 'error') {
    const agrees = !FINISHED.includes(raw)
    return { state: 'failed', trustedState: agrees }
  }
  if (FINISHED.includes(raw)) return { state: 'finished', trustedState: true }
  if (WORKING.includes(raw)) return { state: 'working', trustedState: true }
  if (STOPPED.includes(raw)) return { state: 'stopped', trustedState: true }
  return { state: 'unknown', trustedState: true }
}

export function helperFacts(block) {
  const b = (block && typeof block === 'object') ? block : {}
  const input = typeof b.input === 'string' ? b.input : ''

  // The description is what the spawning turn called this helper, so it is the
  // best label. When it was not recorded, the first line of the prompt is the
  // closest honest substitute — it is still the author's own words.
  const description = field(input, 'description')
  const prompt = field(input, 'prompt')
  const goal = description || (prompt ? prompt.split('\n')[0].trim() || null : null)

  const { body, agentId, usage } = splitOutput(b.output)
  const outcomeKind = !body ? 'none' : (looksLikeError(body) ? 'error' : 'result')
  const { state, trustedState } = deriveState(b.status, outcomeKind)

  return {
    goal,
    helperType: field(input, 'subagent_type'),
    outcome: body,
    outcomeKind,
    agentId,
    metrics: {
      tokens: usageNumber(usage, 'subagent_tokens'),
      toolUses: usageNumber(usage, 'tool_uses'),
      durationMs: usageNumber(usage, 'duration_ms'),
    },
    state,
    trustedState,
  }
}

// A helper is dangling when it was still working and the turn ended around it:
// the parent moved on and this helper never reported back. It needs the turn's
// own end signal because a block cannot tell on its own whether "working" means
// live right now or abandoned some time ago, and guessing from a clock would
// make the same record read differently depending on when it was viewed.
export function isDangling(block, { turnEnded = false } = {}) {
  if (!turnEnded) return false
  return helperFacts(block).state === 'working'
}
