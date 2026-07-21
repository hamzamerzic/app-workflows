// Timeline — a chat rendered as a clean vertical turn-spine (replacing the old
// git-graph SVG rail). Each turn is a node on the spine with its plain outcome,
// an area/result meta line, an optional amber flag ("needs a look"), then the
// subagent cards it spawned — each with an avatar by kind, "Asked to:", a
// friendly action strip, and a one-line result — and finally a per-turn
// "Technical detail" disclosure holding the agent's own words + raw commands.
//
// Honesty: the outcome, result, and the subagents' asks/results are the parser's
// plain-language restatement; the agent's VERBATIM words live under Technical
// detail (rendered via Markdown). Missing values are omitted, never faked.
//
// Disclosure state (which turns have Technical detail open) lives in a passed-in
// per-chat store so it — and the scroll position — survive a drill-in to a
// subagent and back (see ChatDetail's scroll/disclosure restoration).

import React, { useState } from 'react'
import { Markdown } from './Markdown.jsx'
import { statusDot, avatarFor, subStateMeta } from '../domain.js'

function SubCard({ sub, onOpen }) {
  const av = avatarFor(sub.kind)
  const name = sub.name || av.name
  const st = subStateMeta(sub.state)
  const acts = Array.isArray(sub.acts) ? sub.acts : []
  const tappable = sub.tappable === true && !!sub.agent_id

  const inner = (
    <>
      <div className="wf-sub-top">
        <span className={`wf-avatar ${av.cls}`} aria-hidden="true">{av.emoji}</span>
        <span className="wf-sub-id">
          <span className="wf-sub-name">{name}</span>
          <span className="wf-sub-kind">{av.role}</span>
        </span>
        <span className={`wf-sub-state ${st.cls}`}>{st.glyph} {st.label}</span>
      </div>
      {sub.ask && <div className="wf-sub-ask"><span className="k">Asked to:</span> {sub.ask}</div>}
      {acts.length > 0 && (
        <div className="wf-strip">
          {acts.map((a, i) => <span className="wf-act" key={i}>{a}</span>)}
        </div>
      )}
      {sub.result && <div className="wf-sub-res">{sub.result}</div>}
      {tappable && <span className="wf-sub-open" aria-hidden="true">›</span>}
    </>
  )

  return tappable
    ? (
      <button type="button" className="wf-sub is-tap" onClick={onOpen} aria-label={`Open subagent: ${sub.ask || name}`}>
        {inner}
      </button>
    )
    : <div className="wf-sub">{inner}</div>
}

function TurnNode({ turn, turnKey, chatId, onOpenHelper, store }) {
  const subs = Array.isArray(turn.subs) ? turn.subs : []
  const commands = Array.isArray(turn.commands) ? turn.commands : []
  const original = (typeof turn.original === 'string') ? turn.original.trim() : ''
  const hasTech = !!original || commands.length > 0
  // A flagged turn always reads as "needs a look", even if status drifts.
  const dot = turn.flag ? 'attn' : statusDot(turn.status)

  const [techOpen, setTechOpen] = useState(() => store.tech.has(turnKey))
  const onTechToggle = (e) => {
    const open = e.currentTarget.open
    setTechOpen(open)
    if (open) store.tech.add(turnKey); else store.tech.delete(turnKey)
  }

  return (
    <div className="wf-turn">
      <span className={`wf-tnode ${dot}`} aria-hidden="true"><i /></span>
      {turn.outcome && <div className="wf-toutcome">{turn.outcome}</div>}
      {(turn.area || turn.result) && (
        <div className="wf-tmeta">
          {turn.area && <span className="wf-pill is-area">{turn.area}</span>}
          {turn.area && turn.result && <span className="wf-sep" aria-hidden="true" />}
          {turn.result && <span>{turn.result}</span>}
        </div>
      )}
      {turn.flag && (
        <div className="wf-tflag">
          <span className="wf-tflag-ic" aria-hidden="true">⚠</span>
          <span>{turn.flag}</span>
        </div>
      )}

      {subs.map((sub, si) => (
        <SubCard
          key={sub.agent_id || si}
          sub={sub}
          onOpen={() => onOpenHelper(chatId, { agent_id: sub.agent_id, description: sub.ask })}
        />
      ))}

      {hasTech && (
        <details className="wf-tech" open={techOpen} onToggle={onTechToggle}>
          <summary className="wf-tech-sum">
            <span className="wf-cx" aria-hidden="true">›</span> Technical detail
          </summary>
          <div className="wf-techbox">
            {original && (
              <>
                <div className="wf-techbox-lbl">The assistant’s own words</div>
                <div className="wf-orig"><Markdown text={original} /></div>
              </>
            )}
            {commands.length > 0 && (
              <div className="wf-cmds">
                {commands.map((c, ci) => <div className="wf-cmd" key={ci}>{c}</div>)}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

export function Timeline({ turns, chatId, onOpenHelper, store }) {
  const list = Array.isArray(turns) ? turns : []
  // Fallback store so the component still renders standalone (no drill-in
  // persistence, but no crash) if a caller omits the per-chat store.
  const s = store && store.tech ? store : { tech: new Set() }
  return (
    <div className="wf-spine">
      {list.map((t, i) => (
        <TurnNode
          key={i}
          turn={t}
          turnKey={String(i)}
          chatId={chatId}
          onOpenHelper={onOpenHelper}
          store={s}
        />
      ))}
    </div>
  )
}
