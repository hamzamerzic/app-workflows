// Timeline — a chat as a high-level, turn-based git graph. Each turn is ONE
// compact node: a gist of what the agent did (its own closing words) and the
// subagents it spawned, shown as a git-log-style cluster — a trunk with a tee
// (├─) out to each helper and a fate glyph (merged ✓ / still-out ◌ / failed × /
// stopped �‖). The step-by-step trail is collapsed behind "Show activity" and
// carries no rail, so a long turn never becomes a wall of rows.
//
// Honesty: the gist and notes are the agent's own recorded words (scrubbed,
// capped); a helper's "Instructions" is the RECORDED PREVIEW of its brief (often
// clipped at the API's input ceiling), never presented as its full system
// prompt. Missing values are omitted, never faked.
//
// Layout is imperative off refs (never geometry-in-state), so a measure→draw
// pass can't loop. Disclosure state (which activity/instructions are open) lives
// in a passed-in per-chat store so it — and the scroll position — survive the
// drill-in to a helper and back.

import React, { useRef, useState, useLayoutEffect, useCallback } from 'react'
import { Markdown } from './Markdown.jsx'

const SVGNS = 'http://www.w3.org/2000/svg'
const TRUNK = 16, HELPER_X = 40, R = 7

const STATE_LINE = {
  returned: 'Returned & merged into the turn',
  launched: 'Launched — still out on its own',
  failed: 'Failed — the agent carried on',
  stopped: 'Stopped before it returned',
}
function ns(name, attrs) {
  const e = document.createElementNS(SVGNS, name)
  for (const k in attrs) e.setAttribute(k, attrs[k])
  return e
}

// Shape-encoded fate glyph, drawn on the helper node — survives greyscale.
function StateGlyph({ state, className }) {
  const c = className || 'wf-tl-g'
  if (state === 'returned') return (
    <svg className={c} viewBox="0 0 15 15" aria-hidden="true"><circle cx="7.5" cy="7.5" r="6" fill="var(--green)" /><path d="M4.6 7.7l2 2 4-4.4" fill="none" stroke="var(--surface)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  )
  if (state === 'launched') return (
    <svg className={c} viewBox="0 0 15 15" aria-hidden="true"><circle cx="7.5" cy="7.5" r="5.6" fill="var(--surface)" stroke="var(--working, #f5a623)" strokeWidth="2" strokeDasharray="3 2.4" /></svg>
  )
  if (state === 'stopped') return (
    <svg className={c} viewBox="0 0 15 15" aria-hidden="true"><circle cx="7.5" cy="7.5" r="5.8" fill="var(--surface)" stroke="var(--muted)" strokeWidth="2" /><path d="M5.6 5v5M9.4 5v5" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" /></svg>
  )
  return (
    <svg className={c} viewBox="0 0 15 15" aria-hidden="true"><circle cx="7.5" cy="7.5" r="5.8" fill="var(--surface)" stroke="var(--danger)" strokeWidth="2" /><path d="M5 5l5 5M10 5l-5 5" stroke="var(--danger)" strokeWidth="1.7" strokeLinecap="round" /></svg>
  )
}

// Draw the compact rail for a turn's summary rows (gist, helpers…, toggle). The
// trunk is one vertical line; each helper tees off it to its node, and the fate
// is a short cue past the node (merged: rejoins; launched: dashed tail + arrow;
// failed/stopped: dead-end). No per-tool-call rows here — this stays small.
function paintRail(svg, rowsEl, bodyEl, descs) {
  if (!svg || !rowsEl || !bodyEl) return
  const bodyTop = bodyEl.getBoundingClientRect().top
  const kids = rowsEl.children
  const midY = []
  for (let i = 0; i < kids.length; i++) {
    const r = kids[i].getBoundingClientRect()
    midY[i] = r.top - bodyTop + Math.min(r.height / 2, 22)
  }
  const gutter = HELPER_X + R + 12
  rowsEl.style.paddingLeft = gutter + 'px'
  svg.setAttribute('width', gutter)
  svg.setAttribute('height', bodyEl.clientHeight)
  while (svg.firstChild) svg.removeChild(svg.firstChild)
  const gRail = ns('g', {}), gNode = ns('g', {})
  svg.appendChild(gRail); svg.appendChild(gNode)

  if (!midY.length) return
  const top = midY[0], bot = midY[midY.length - 1]
  gRail.appendChild(ns('path', { d: `M ${TRUNK} ${top} L ${TRUNK} ${bot}`, class: 'wf-tl-trunk' }))

  descs.forEach((d, i) => {
    const y = midY[i]
    if (d.kind === 'helper') {
      const cls = 'mode-' + d.state
      // tee: trunk -> helper node
      gRail.appendChild(ns('path', { d: `M ${TRUNK} ${y} L ${HELPER_X} ${y}`, class: 'wf-tl-tee ' + cls }))
      gNode.appendChild(ns('circle', { cx: TRUNK, cy: y, r: 2.6, class: 'wf-tl-fork' }))
      // fate cue past the node
      if (d.state === 'launched') {
        const ty = y + 12
        gRail.appendChild(ns('path', { d: `M ${HELPER_X} ${y + R} L ${HELPER_X} ${ty}`, class: 'wf-tl-tail mode-launched' }))
        gNode.appendChild(ns('path', { d: `M ${HELPER_X - 3.5} ${ty - 4} L ${HELPER_X} ${ty} L ${HELPER_X + 3.5} ${ty - 4}`, class: 'wf-tl-arrow mode-launched' }))
      } else if (d.state === 'returned') {
        gNode.appendChild(ns('circle', { cx: TRUNK, cy: y, r: 3.2, class: 'wf-tl-merge' }))
      }
      drawHelperNode(gNode, HELPER_X, y, d.state)
    } else {
      // trunk node: gist (accent) or toggle (hollow)
      if (d.kind === 'gist') gNode.appendChild(ns('circle', { cx: TRUNK, cy: y, r: 4.5, fill: 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 2 }))
      else gNode.appendChild(ns('circle', { cx: TRUNK, cy: y, r: 3, fill: 'var(--surface)', stroke: 'var(--muted)', 'stroke-width': 1.6 }))
    }
  })
}

function drawHelperNode(g, x, y, state) {
  if (state === 'returned') {
    g.appendChild(ns('circle', { cx: x, cy: y, r: R, fill: 'var(--green)', stroke: 'var(--surface)', 'stroke-width': 2 }))
    g.appendChild(ns('path', { d: `M ${x - 3.2} ${y} l 2.2 2.4 l 4 -4.6`, fill: 'none', stroke: 'var(--surface)', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
  } else if (state === 'launched') {
    g.appendChild(ns('circle', { cx: x, cy: y, r: R, fill: 'var(--surface)', stroke: 'var(--working, #f5a623)', 'stroke-width': 2.2, 'stroke-dasharray': '4 3' }))
  } else if (state === 'stopped') {
    g.appendChild(ns('circle', { cx: x, cy: y, r: R, fill: 'var(--surface)', stroke: 'var(--muted)', 'stroke-width': 2.2 }))
    g.appendChild(ns('path', { d: `M ${x - 2.4} ${y - 2.8} l 0 5.6 M ${x + 2.4} ${y - 2.8} l 0 5.6`, stroke: 'var(--muted)', 'stroke-width': 1.5, 'stroke-linecap': 'round' }))
  } else {
    g.appendChild(ns('circle', { cx: x, cy: y, r: R, fill: 'var(--surface)', stroke: 'var(--danger)', 'stroke-width': 2.2 }))
    g.appendChild(ns('path', { d: `M ${x - 3} ${y - 3} l 6 6 M ${x + 3} ${y - 3} l -6 6`, stroke: 'var(--danger)', 'stroke-width': 1.9, 'stroke-linecap': 'round' }))
  }
}

function agentLabel(a) {
  if (/^codex/i.test(a || '')) return 'codex'
  if (a === 'general-purpose') return 'general'
  return a || null
}

function stateClass(state) {
  return state === 'returned' ? 'is-merged'
    : state === 'launched' ? 'is-detached'
    : state === 'stopped' ? 'is-stopped' : 'is-failed'
}

function HelperRow({ branch, instrOpen, onToggleInstr, onOpen }) {
  const desc = branch.desc || 'Helper'
  const agent = agentLabel(branch.agent)
  const head = (
    <>
      <div className="wf-tl-hdesc">{desc}{branch.tappable && <span className="wf-tl-car" aria-hidden="true">›</span>}</div>
      <div className="wf-tl-chips">
        {agent && <span className={`wf-tl-chip is-agent${/^codex/i.test(branch.agent) ? ' is-codex' : ''}`}>{agent}</span>}
        {branch.model && <span className="wf-tl-chip is-mono">{branch.model}</span>}
        {branch.async && <span className="wf-tl-chip">async</span>}
      </div>
      <div className={`wf-tl-state ${stateClass(branch.state)}`}>
        <StateGlyph state={branch.state} /><span>{STATE_LINE[branch.state] || 'Stopped'}</span>
      </div>
    </>
  )
  return (
    <div className="wf-tl-hrow">
      {branch.tappable
        ? <button type="button" className="wf-tl-hmain is-tap" onClick={onOpen} aria-label={`Open helper: ${desc}`}>{head}</button>
        : <div className="wf-tl-hmain">{head}</div>}
      {branch.prompt_excerpt && (
        <>
          <button type="button" className="wf-tl-disc" onClick={onToggleInstr} aria-expanded={instrOpen}>
            <span className="wf-tl-car" aria-hidden="true">{instrOpen ? '▾' : '▸'}</span> Instructions
          </button>
          {instrOpen && (
            <div className="wf-tl-instr">
              <Markdown text={branch.prompt_excerpt} />
              <div className="wf-tl-instr-note">Recorded preview of the brief — may be clipped by the transcript.</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ActivitySeg({ node, open, onToggle }) {
  const tot = node.steps
  const top = (node.tally && node.tally[0]) || { tool: 'step', n: 0 }
  const lead = (top.n / tot >= 0.6)
    ? <>mostly <b>{top.tool}</b></>
    : <b>{(node.tally || []).slice(0, 2).map((t) => t.tool).join(' & ')}</b>
  return (
    <button type="button" className="wf-tl-act-seg" onClick={onToggle} aria-expanded={open}>
      <div className="wf-tl-act-k">Work<span className="wf-tl-car" aria-hidden="true">{open ? '▾' : '▸'}</span></div>
      <div className="wf-tl-act-sum">{tot} step{tot === 1 ? '' : 's'} · {lead}</div>
      {open && (
        <div className="wf-tl-detail">
          <div className="wf-tl-peeks">
            {(node.peek && node.peek.length ? node.peek : ['no targets recorded']).map((p, i) => (
              <div className="wf-tl-peek" key={i}>{p}</div>
            ))}
          </div>
          <div className="wf-tl-tally">
            {(node.tally || []).map((t, i) => <span className="wf-tl-tchip" key={i}><b>{t.tool}</b>·{t.n}</span>)}
          </div>
        </div>
      )}
    </button>
  )
}

function TurnCard({ turn, chatId, turnKey, onOpenHelper, store }) {
  const bodyRef = useRef(null)
  const rowsRef = useRef(null)
  const svgRef = useRef(null)
  const nodes = turn.nodes || []
  const branches = nodes.filter((n) => n.t === 'branch')
  const steps = nodes.filter((n) => n.t !== 'branch')

  const [activityOpen, setActivityOpen] = useState(() => store.activity.has(turnKey))
  const [instrOpen, setInstrOpen] = useState(() => new Set(
    [...store.instr].filter((k) => k.startsWith(turnKey + '|')).map((k) => k.slice(turnKey.length + 1))))
  const [segOpen, setSegOpen] = useState(() => new Set())

  const toggleActivity = useCallback(() => {
    setActivityOpen((v) => {
      const nv = !v
      if (nv) store.activity.add(turnKey); else store.activity.delete(turnKey)
      return nv
    })
  }, [store, turnKey])
  const toggleInstr = useCallback((bkey) => {
    setInstrOpen((prev) => {
      const next = new Set(prev)
      const full = turnKey + '|' + bkey
      if (next.has(bkey)) { next.delete(bkey); store.instr.delete(full) }
      else { next.add(bkey); store.instr.add(full) }
      return next
    })
  }, [store, turnKey])
  const toggleSeg = useCallback((i) => {
    setSegOpen((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })
  }, [])

  // Descriptors for the rail rows, in the SAME order the rows render.
  const descs = []
  if (turn.gist) descs.push({ kind: 'gist' })
  branches.forEach((b) => descs.push({ kind: 'helper', state: b.state }))
  if (steps.length) descs.push({ kind: 'toggle' })

  // Imperative draw; re-runs on disclosure changes (discrete counters), plus a
  // deferred settle and a width-only observer on the stable body box.
  useLayoutEffect(() => {
    const draw = () => paintRail(svgRef.current, rowsRef.current, bodyRef.current, descs)
    draw()
    const raf = requestAnimationFrame(draw)
    const t = setTimeout(draw, 90)
    let lastW = -1, deb = null, ro = null
    if (typeof ResizeObserver !== 'undefined' && bodyRef.current) {
      ro = new ResizeObserver((es) => {
        const w = es[0].contentRect.width
        if (Math.abs(w - lastW) < 1) return
        lastW = w; clearTimeout(deb); deb = setTimeout(draw, 120)
      })
      ro.observe(bodyRef.current)
    }
    return () => { cancelAnimationFrame(raf); clearTimeout(t); clearTimeout(deb); if (ro) ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, instrOpen, activityOpen])

  const dt = fmtDate(turn.ts)
  return (
    <section className="wf-tl-turn">
      <div className="wf-tl-meta">
        {dt && <span>{dt}</span>}
        <span>{turn.nspawn} helper{turn.nspawn === 1 ? '' : 's'}</span>
      </div>
      <div className="wf-tl-body" ref={bodyRef}>
        <svg className="wf-tl-rail" ref={svgRef} aria-hidden="true" />
        <div className="wf-tl-rows" ref={rowsRef}>
          {turn.gist && <div className="wf-tl-gist"><Markdown text={turn.gist} /></div>}
          {branches.map((b, i) => {
            const bkey = b.agent_id || String(i)
            return (
              <HelperRow
                key={bkey}
                branch={b}
                instrOpen={instrOpen.has(bkey)}
                onToggleInstr={() => toggleInstr(bkey)}
                onOpen={() => onOpenHelper(chatId, { agent_id: b.agent_id, description: b.desc })}
              />
            )
          })}
          {steps.length > 0 && (
            <button type="button" className="wf-tl-activity-toggle" onClick={toggleActivity} aria-expanded={activityOpen}>
              <span className="wf-tl-car" aria-hidden="true">{activityOpen ? '▾' : '▸'}</span>
              {activityOpen ? 'Hide activity' : 'Show activity'} · {turn.nblocks} blocks
            </button>
          )}
        </div>
      </div>
      {activityOpen && steps.length > 0 && (
        <div className="wf-tl-activity">
          {turn.truncated && (
            <div className="wf-tl-trunc">A long turn — showing the activity around the spawns.</div>
          )}
          {steps.map((n, i) => (
            n.t === 'note'
              ? <div className={`wf-tl-act-note${n.role === 'final' ? ' is-final' : ''}`} key={i}><Markdown text={n.text} /></div>
              : <ActivitySeg key={i} node={n} open={segOpen.has(i)} onToggle={() => toggleSeg(i)} />
          ))}
        </div>
      )}
    </section>
  )
}

function fmtDate(ts) {
  if (ts == null) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function Timeline({ turns, chatId, onOpenHelper, store }) {
  const list = Array.isArray(turns) ? turns : []
  // A stable, private per-chat disclosure store so open activity/instructions
  // survive a drill-in to a helper and back (see ChatDetail scroll restore).
  const fallback = useRef({ activity: new Set(), instr: new Set() })
  const s = store || fallback.current
  return (
    <div className="wf-tl-root">
      {list.map((t, i) => (
        <TurnCard key={i} turn={t} turnKey={String(i)} chatId={chatId} onOpenHelper={onOpenHelper} store={s} />
      ))}
    </div>
  )
}

