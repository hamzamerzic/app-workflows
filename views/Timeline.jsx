// Timeline — a skim-first execution tree.
//
// Main-agent turns stay on one vertical trunk. Helpers branch from the turn
// that spawned them. The closed state shows only who did what and whether it
// completed; opening a helper reveals its full assignment inline. Tool calls,
// command lists, and raw execution prose are intentionally absent here.

import React, { useEffect, useState } from 'react'
import { Markdown } from './Markdown.jsx'
import { avatarFor, subStateMeta } from '../domain.js'

function turnState(turn) {
  if (turn.status === 'running') return 'running'
  if (turn.status === 'done') return 'done'
  if (turn.result === "couldn't complete") return 'failed'
  return 'stopped'
}

function repeatsOutcome(area, outcome) {
  const normalize = (value) => String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const needle = normalize(area)
  return Boolean(needle && normalize(outcome).includes(needle))
}

function Branch({ sub, branchKey, store, storage }) {
  const av = avatarFor(sub.kind)
  const name = sub.name || av.name
  const state = subStateMeta(sub.state)
  const canOpen = sub.prompt_available !== false && Boolean(storage && sub.agent_id)
  const depth = Math.min(3, Math.max(1, Number(sub.depth) || 1))
  const [open, setOpen] = useState(() => store.prompts.has(branchKey))
  const [fullPrompt, setFullPrompt] = useState(null)

  // Chat documents intentionally carry only the one-line summary. Fetch the
  // full prompt document only after the owner opens this branch.
  useEffect(() => {
    if (!open || fullPrompt !== null || !storage || !sub.agent_id) return undefined
    let cancelled = false
    storage.getJSON(`helpers/${sub.agent_id}.json`).then((doc) => {
      if (cancelled) return
      const value = doc && typeof doc.brief_full === 'string' ? doc.brief_full.trim() : ''
      setFullPrompt(value)
    })
    return () => { cancelled = true }
  }, [open, fullPrompt, storage, sub.agent_id])

  const awaitingPrompt = open && fullPrompt === null && Boolean(storage && sub.agent_id)

  const inner = (
    <>
      <span className={`wf-avatar ${av.cls}`} aria-hidden="true">{av.emoji}</span>
      <span className="wf-branch-copy">
        <span className="wf-branch-name">{depth > 1 ? 'Nested helper' : name}</span>
        <span className="wf-branch-ask">{sub.ask || 'No task summary was recorded'}</span>
      </span>
      <span className={`wf-sub-state ${state.cls}`}>{state.glyph} {state.label}</span>
      {canOpen && <span className="wf-branch-chevron" aria-hidden="true">›</span>}
    </>
  )

  return (
    <div className="wf-branch" role="listitem" style={{ '--wf-branch-depth': depth - 1 }}>
      <span className="wf-branch-line" aria-hidden="true" />
      {canOpen ? (
        <details
          className="wf-branch-detail"
          open={open}
          onToggle={(event) => {
            const next = event.currentTarget.open
            setOpen(next)
            if (next) store.prompts.add(branchKey)
            else store.prompts.delete(branchKey)
          }}
        >
          <summary className="wf-branch-summary">{inner}</summary>
          {open && (
            <div className="wf-branch-prompt">
              <div className="wf-flow-label">Full prompt</div>
              {awaitingPrompt
                ? <div className="wf-prompt-loading" role="status">Loading full prompt…</div>
                : fullPrompt
                  ? <Markdown text={fullPrompt} />
                  : <div className="wf-prompt-loading">Prompt unavailable.</div>}
            </div>
          )}
        </details>
      ) : (
        <div className="wf-branch-summary is-static">{inner}</div>
      )}
    </div>
  )
}

function Turn({ turn, turnKey, store, storage }) {
  const subs = Array.isArray(turn.subs) ? turn.subs : []
  const state = subStateMeta(turnState(turn))
  const showArea = turn.area && !repeatsOutcome(turn.area, turn.outcome)
  return (
    <section className="wf-flow-turn">
      <span className={`wf-flow-node ${state.cls}`} aria-hidden="true" />
      <div className="wf-turn-main">
        <div className="wf-toutcome">{turn.outcome || 'Continued the task'}</div>
        <div className="wf-turn-meta">
          {showArea && <span>{turn.area}</span>}
          {showArea && <span className="wf-sep" aria-hidden="true" />}
          <span className={`wf-sub-state ${state.cls}`}>{state.glyph} {state.label}</span>
        </div>
        {turn.flag && <div className="wf-turn-note">{turn.flag}</div>}
      </div>
      {subs.length > 0 && (
        <div className="wf-branch-list" role="list" aria-label={`${subs.length} helper${subs.length === 1 ? '' : 's'}`}>
          {subs.map((sub, index) => (
            <Branch
              key={sub.agent_id || index}
              sub={sub}
              branchKey={`${turnKey}:${sub.agent_id || index}`}
              store={store}
              storage={storage}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function Timeline({ turns, store, storage }) {
  const list = Array.isArray(turns) ? turns : []
  const stableStore = store && store.prompts ? store : { prompts: new Set() }
  return (
    <div className="wf-timeline">
      {list.map((turn, index) => (
        <Turn
          key={`${turn.ts || 'turn'}:${index}`}
          turn={turn}
          turnKey={String(index)}
          store={stableStore}
          storage={storage}
        />
      ))}
    </div>
  )
}
