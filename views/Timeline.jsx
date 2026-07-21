// Timeline — a chat's turns as a git-graph. Each turn runs down its own trunk
// (time flowing down); where the agent hands a job to a helper a branch peels
// off, and HOW the branch ends is the whole story: it merges back (returned),
// runs on alone (launched), dead-ends at a failure (failed), or halts (stopped).
//
// The rail is TOPOLOGICAL — order is exact, spacing is not drawn to time (most
// helpers have no recorded finish time). Every text field is what the transcript
// stored, capped by the parser; nothing here is invented. A branch is only
// tappable when a detail page exists for it (`node.tappable`), so no tap dead-ends.
//
// Layout is drawn IMPERATIVELY off refs (never through React state), so a
// measure→draw pass can't feed back into a re-render loop: React owns the row
// DOM + text; a layout effect measures the rows and paints the SVG rail. It
// re-runs on turn identity and on any row expand/collapse (a discrete counter,
// not a measured value), plus a second settle pass after fonts/wrap land, plus a
// width-only ResizeObserver on the stable body box.

import React, { useRef, useState, useLayoutEffect, useCallback, useMemo } from 'react'

const SVGNS = 'http://www.w3.org/2000/svg'
const TRUNK = 18, LANE = 30, R = 8, MINGUT = 62
// Hard ceiling on parallel lanes so the gutter can never grow wide enough to
// clip the row content on a narrow phone. Real turns never spawn adjacent
// helpers (there is always work between them), so a single lane is the norm and
// this only bounds a pathological burst — extra branches share the last lane.
const MAX_LANES = 3
const laneX = (k) => TRUNK + LANE * (k + 1)

// state → the inline label + a class hook. Four states so nothing that halted is
// dressed up as progress; `stopped` reads neutral, not as a failure.
// The label claims only what the block records. "Returned" = the Agent tool call
// completed (control came back); it does NOT assert the result was used, so the
// wording stops at "to the turn", not "merged into" it. "Stopped" stays bare
// rather than "before it returned", which a present-but-partial output would
// contradict. The first word of each is the legend chip.
const STATE = {
  returned: { cls: 'merged', word: 'Returned to the turn' },
  launched: { cls: 'detached', word: 'Launched in the background' },
  failed: { cls: 'failed', word: 'Failed — the agent carried on' },
  stopped: { cls: 'stopped', word: 'Stopped' },
}
const STATE_ORDER = ['returned', 'launched', 'failed', 'stopped']

function ns(name, attrs) {
  const e = document.createElementNS(SVGNS, name)
  for (const k in attrs) e.setAttribute(k, attrs[k])
  return e
}

// The fate glyph that sits on the branch at the helper node — shape-encoded so it
// survives greyscale / colour-blindness, not colour alone.
function drawHelper(g, x, y, state) {
  if (state === 'returned') {
    g.appendChild(ns('circle', { cx: x, cy: y, r: R, fill: 'var(--green)', stroke: 'var(--surface)', 'stroke-width': 2 }))
    g.appendChild(ns('path', { d: `M ${x - 3.6} ${y} l 2.4 2.6 l 4.4 -5`, fill: 'none', stroke: 'var(--surface)', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
  } else if (state === 'launched') {
    g.appendChild(ns('circle', { cx: x, cy: y, r: R, fill: 'var(--surface)', stroke: 'var(--working)', 'stroke-width': 2.4, 'stroke-dasharray': '4 3' }))
  } else if (state === 'stopped') {
    g.appendChild(ns('circle', { cx: x, cy: y, r: R, fill: 'var(--surface)', stroke: 'var(--muted)', 'stroke-width': 2.4 }))
    g.appendChild(ns('path', { d: `M ${x - 2.6} ${y - 3} l 0 6 M ${x + 2.6} ${y - 3} l 0 6`, stroke: 'var(--muted)', 'stroke-width': 1.7, 'stroke-linecap': 'round' }))
  } else { // failed: ring + cross
    g.appendChild(ns('circle', { cx: x, cy: y, r: R, fill: 'var(--surface)', stroke: 'var(--danger)', 'stroke-width': 2.4 }))
    g.appendChild(ns('path', { d: `M ${x - 3.4} ${y - 3.4} l 6.8 6.8 M ${x + 3.4} ${y - 3.4} l -6.8 6.8`, stroke: 'var(--danger)', 'stroke-width': 2, 'stroke-linecap': 'round' }))
  }
}

function drawTrunk(g, x, y, n) {
  if (n.t === 'note') {
    g.appendChild(ns('circle', { cx: x, cy: y, r: 5, fill: 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 2 }))
  } else { // work: hollow square
    const s = 4.6
    g.appendChild(ns('rect', { x: x - s, y: y - s, width: s * 2, height: s * 2, rx: 2, fill: 'var(--surface2)', stroke: 'var(--muted)', 'stroke-width': 1.7 }))
  }
}

// The whole imperative pass: measure rows, assign lanes, paint the rail. Reads
// the DOM, writes SVG + rows padding, touches NO React state.
function paintRail(svg, rowsEl, bodyEl, nodes) {
  if (!svg || !rowsEl || !bodyEl) return
  const bodyTop = bodyEl.getBoundingClientRect().top
  const kids = rowsEl.children
  const topY = [], midY = [], botY = []
  for (let i = 0; i < kids.length; i++) {
    const r = kids[i].getBoundingClientRect()
    topY[i] = r.top - bodyTop + 18
    midY[i] = r.top - bodyTop + Math.min(r.height / 2, 34)
    botY[i] = r.bottom - bodyTop - 12
  }
  // gather spawns, assign lanes greedily by [start, end] interval. A returned
  // branch ALWAYS shows its merge back to the trunk — its defining story — even
  // when it is the last node in a (possibly truncated) turn: it merges just
  // below the helper and the trunk is extended to meet it.
  const spawns = []
  nodes.forEach((n, i) => {
    if (n.t !== 'branch') return
    const start = topY[i]
    const tailY = Math.max(midY[i] + 26, botY[i])
    const mergeY = n.state === 'returned'
      ? (i + 1 < nodes.length ? topY[i + 1] : midY[i] + 36)
      : null
    const end = mergeY != null ? mergeY : tailY
    spawns.push({ i, n, start, helperY: midY[i], mergeY, tailY, end })
  })
  const laneEnds = []
  spawns.forEach((sp) => {
    let lane = -1
    for (let k = 0; k < laneEnds.length; k++) { if (laneEnds[k] < sp.start - 4) { lane = k; break } }
    if (lane < 0) lane = Math.min(laneEnds.length, MAX_LANES - 1)  // clamp: extra branches share the last lane
    laneEnds[lane] = sp.end; sp.lane = lane
  })
  const maxLane = laneEnds.length ? laneEnds.length - 1 : 0
  const gutter = Math.max(MINGUT, laneX(maxLane) + R + 14)
  rowsEl.style.paddingLeft = gutter + 'px'

  const H = bodyEl.clientHeight
  svg.setAttribute('width', gutter)
  svg.setAttribute('height', H)
  while (svg.firstChild) svg.removeChild(svg.firstChild)
  const gRail = ns('g', {}), gNode = ns('g', {})
  svg.appendChild(gRail); svg.appendChild(gNode)

  if (topY.length) {
    // The trunk runs from the first node to the last — or to a returned branch's
    // merge point when that sits below the last node (a branch that merges back
    // after the turn's final row).
    let trunkBottom = topY[topY.length - 1]
    spawns.forEach((sp) => { if (sp.mergeY != null && sp.mergeY > trunkBottom) trunkBottom = sp.mergeY })
    gRail.appendChild(ns('path', { d: `M ${TRUNK} ${topY[0]} L ${TRUNK} ${trunkBottom}`, class: 'wf-tl-trunk' }))
  }
  spawns.forEach((sp) => {
    const x = laneX(sp.lane), fy = sp.start, hy = sp.helperY
    const cls = 'mode-' + sp.n.state
    const d1 = (hy - fy) * 0.55
    gRail.appendChild(ns('path', { d: `M ${TRUNK} ${fy} C ${TRUNK} ${fy + d1} ${x} ${hy - d1} ${x} ${hy}`, class: 'wf-tl-peel ' + cls }))
    if (sp.n.state === 'returned' && sp.mergeY != null) {
      const my = sp.mergeY, d2 = (my - hy) * 0.55
      gRail.appendChild(ns('path', { d: `M ${x} ${hy} C ${x} ${hy + d2} ${TRUNK} ${my - d2} ${TRUNK} ${my}`, class: 'wf-tl-peel ' + cls }))
      gNode.appendChild(ns('circle', { cx: TRUNK, cy: my, r: 3.4, class: 'wf-tl-merge' }))
    } else {
      // The branch runs down its own lane past the card, then ends WITHOUT
      // rejoining: launched fades to an open arrow (still out); failed/stopped
      // dead-end at a flat stop (the trunk carried on without it).
      const ty = sp.tailY
      gRail.appendChild(ns('path', { d: `M ${x} ${hy} L ${x} ${ty}`, class: 'wf-tl-run ' + cls }))
      if (sp.n.state === 'launched') {
        gNode.appendChild(ns('path', { d: `M ${x - 4} ${ty - 5} L ${x} ${ty} L ${x + 4} ${ty - 5}`, class: 'wf-tl-arrow ' + cls }))
      } else {
        gNode.appendChild(ns('path', { d: `M ${x - 4.5} ${ty} L ${x + 4.5} ${ty}`, class: 'wf-tl-deadend ' + cls }))
      }
    }
    gNode.appendChild(ns('circle', { cx: TRUNK, cy: fy, r: 3.2, class: 'wf-tl-fork' }))
    drawHelper(gNode, x, hy, sp.n.state)
  })
  nodes.forEach((n, i) => {
    if (n.t === 'branch') return
    drawTrunk(gNode, TRUNK, topY[i], n)
  })
}

// One quiet summary line for a run of tool calls.
function segSummary(n) {
  const tot = n.steps, top = (n.tally && n.tally[0]) || { tool: 'step', n: 0 }
  if (top.n / tot >= 0.6) return { tot, lead: ['mostly', top.tool] }
  const two = (n.tally || []).slice(0, 2).map((t) => t.tool)
  return { tot, lead: ['', two.join(' & ')] }
}

function agentLabel(a) {
  if (/^codex/i.test(a || '')) return 'codex'
  if (a === 'general-purpose') return 'general'
  return a || 'agent'
}

function StateGlyph({ state }) {
  if (state === 'returned') return (
    <svg className="wf-tl-g" viewBox="0 0 15 15" aria-hidden="true"><circle cx="7.5" cy="7.5" r="6" fill="var(--green)" /><path d="M4.6 7.7l2 2 4-4.4" fill="none" stroke="var(--surface)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  )
  if (state === 'launched') return (
    <svg className="wf-tl-g" viewBox="0 0 15 15" aria-hidden="true"><circle cx="7.5" cy="7.5" r="5.6" fill="var(--surface)" stroke="var(--working)" strokeWidth="2" strokeDasharray="3 2.4" /></svg>
  )
  if (state === 'stopped') return (
    <svg className="wf-tl-g" viewBox="0 0 15 15" aria-hidden="true"><circle cx="7.5" cy="7.5" r="5.8" fill="var(--surface)" stroke="var(--muted)" strokeWidth="2" /><path d="M5.6 5v5M9.4 5v5" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" /></svg>
  )
  return (
    <svg className="wf-tl-g" viewBox="0 0 15 15" aria-hidden="true"><circle cx="7.5" cy="7.5" r="5.8" fill="var(--surface)" stroke="var(--danger)" strokeWidth="2" /><path d="M5 5l5 5M10 5l-5 5" stroke="var(--danger)" strokeWidth="1.7" strokeLinecap="round" /></svg>
  )
}

function Row({ node, open, onToggle, onOpenBranch }) {
  if (node.t === 'note') {
    const tag = node.role === 'final' ? 'Turn result' : 'Agent'
    const long = (node.text || '').length > 150
    return (
      <ExpandableRow className={`wf-tl-note${node.role === 'final' ? ' is-final' : ''}`} tappable={long} open={open} onToggle={onToggle} kind={tag}>
        <div className={`wf-tl-txt${long && !open ? ' is-clamp' : ''}`}>{node.text}</div>
      </ExpandableRow>
    )
  }
  if (node.t === 'seg') {
    const { tot, lead } = segSummary(node)
    return (
      <ExpandableRow className="wf-tl-seg" tappable open={open} onToggle={onToggle} kind="Work">
        <div className="wf-tl-sum">
          {tot} step{tot === 1 ? '' : 's'} · {lead[0] && <span>{lead[0]} </span>}<b>{lead[1]}</b>
        </div>
        {open && (
          <div className="wf-tl-detail">
            <div className="wf-tl-peeks">
              {(node.peek && node.peek.length ? node.peek : ['no targets recorded']).map((p, i) => (
                <div className="wf-tl-peek" key={i}>{p}</div>
              ))}
            </div>
            <div className="wf-tl-tally">
              {(node.tally || []).map((t, i) => (
                <span className="wf-tl-tchip" key={i}><b>{t.tool}</b>·{t.n}</span>
              ))}
            </div>
          </div>
        )}
      </ExpandableRow>
    )
  }
  // branch
  const st = STATE[node.state] || STATE.stopped
  const inner = (
    <>
      <div className="wf-tl-rk">Helper{node.tappable && <span className="wf-tl-car" aria-hidden="true">›</span>}</div>
      <div className="wf-tl-desc">{node.desc}</div>
      <div className="wf-tl-chips">
        {/* Only assert what was recorded: show the agent type / model when we
            have them, and an "async" chip only when the launch ack proves it —
            the ABSENCE of that ack is not proof the call was blocking. */}
        {node.agent && (
          <span className={`wf-tl-chip is-agent${/^codex/i.test(node.agent) ? ' is-codex' : ''}`}>{agentLabel(node.agent)}</span>
        )}
        {node.model && <span className="wf-tl-chip is-mono">{node.model}</span>}
        {node.async && <span className="wf-tl-chip">async</span>}
      </div>
      <div className={`wf-tl-state is-${st.cls}`}><StateGlyph state={node.state} /><span>{st.word}</span></div>
    </>
  )
  if (node.tappable) {
    return (
      <button type="button" className="wf-tl-row wf-tl-branch is-tap" onClick={onOpenBranch}
        aria-label={`Open helper: ${node.desc}`}>{inner}</button>
    )
  }
  return <div className="wf-tl-row wf-tl-branch">{inner}</div>
}

// A row that toggles open/closed in place (seg + long notes). Tappable rows are
// buttons so keyboard + screen-reader users can operate them.
function ExpandableRow({ className, tappable, open, onToggle, kind, children }) {
  const head = (
    <div className="wf-tl-rk">{kind}{tappable && <span className="wf-tl-car" aria-hidden="true">{open ? '▾' : '▸'}</span>}</div>
  )
  if (tappable) {
    return (
      <button type="button" className={`wf-tl-row ${className} is-tap`} onClick={onToggle} aria-expanded={open}>
        {head}{children}
      </button>
    )
  }
  return <div className={`wf-tl-row ${className}`}>{head}{children}</div>
}

function TurnCard({ turn, chatId, onOpenHelper }) {
  const bodyRef = useRef(null)
  const rowsRef = useRef(null)
  const svgRef = useRef(null)
  const [openSet, setOpenSet] = useState(() => new Set())
  const nodes = turn.nodes || []

  const toggle = useCallback((i) => {
    setOpenSet((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }, [])

  // Draw imperatively. Re-runs on turn identity and on any expand/collapse (a
  // discrete counter via openSet), never on a measured value — so it settles in
  // one pass per change instead of oscillating. Plus a deferred second pass for
  // fonts/wrap, and a WIDTH-ONLY observer on the stable body box.
  useLayoutEffect(() => {
    const draw = () => paintRail(svgRef.current, rowsRef.current, bodyRef.current, nodes)
    draw()
    const raf = requestAnimationFrame(draw)
    const t = setTimeout(draw, 90)
    let lastW = -1, deb = null
    let ro = null
    if (typeof ResizeObserver !== 'undefined' && bodyRef.current) {
      ro = new ResizeObserver((entries) => {
        const w = entries[0].contentRect.width
        if (Math.abs(w - lastW) < 1) return   // width epsilon — height changes don't retrigger
        lastW = w
        clearTimeout(deb); deb = setTimeout(draw, 120)
      })
      ro.observe(bodyRef.current)
    }
    return () => {
      cancelAnimationFrame(raf); clearTimeout(t); clearTimeout(deb)
      if (ro) ro.disconnect()
    }
  }, [nodes, openSet])

  const dt = fmtDate(turn.ts)
  return (
    <section className="wf-tl-turn">
      <div className="wf-tl-meta">
        <span className="wf-tl-pill"><b>{turn.nspawn}</b> helper{turn.nspawn === 1 ? '' : 's'}</span>
        <span className="wf-tl-pill"><b>{turn.nblocks}</b> blocks</span>
        {dt && <span className="wf-tl-pill">{dt}</span>}
      </div>
      <div className="wf-tl-body" ref={bodyRef}>
        <svg className="wf-tl-rail" ref={svgRef} aria-hidden="true" />
        <div className="wf-tl-rows" ref={rowsRef}>
          {nodes.map((n, i) => (
            <Row
              key={i}
              node={n}
              open={openSet.has(i)}
              onToggle={() => toggle(i)}
              onOpenBranch={() => onOpenHelper(chatId, { agent_id: n.agent_id, description: n.desc })}
            />
          ))}
        </div>
      </div>
      {turn.truncated && (
        <div className="wf-tl-trunc">A long turn — showing the spawns and the first steps around them.</div>
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

export function Timeline({ turns, chatId, onOpenHelper }) {
  const list = Array.isArray(turns) ? turns : []
  // Legend explains only the states actually present, so a state that never
  // occurs is never described.
  const present = useMemo(() => {
    const s = new Set()
    list.forEach((t) => (t.nodes || []).forEach((n) => { if (n.t === 'branch') s.add(n.state) }))
    return STATE_ORDER.filter((k) => s.has(k))
  }, [list])

  return (
    <div className="wf-tl-root">
      {present.length > 0 && (
        <div className="wf-tl-legend">
          {present.map((k) => (
            <span className="wf-tl-lg" key={k}><StateGlyph state={k} /><span>{STATE[k].word.split(/[ —]/)[0]}</span></span>
          ))}
        </div>
      )}
      {list.map((t, i) => (
        <TurnCard key={i} turn={t} chatId={chatId} onOpenHelper={onOpenHelper} />
      ))}
      <div className="wf-tl-foot">
        The rail is topological — order is exact, spacing is not drawn to time.
      </div>
    </div>
  )
}
