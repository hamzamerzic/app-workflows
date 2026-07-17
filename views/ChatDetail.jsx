// ChatDetail — one chat's background work, newest run first. A workflow-kind
// run shows its plan (label + phases) inline above its helper cards. Each helper
// card renders a derived status dot, its description, the outcome it reported
// back (or "No completion report"), and duration/steps/tokens as small mono
// stats. Cards with recorded activity open the HelperDetail drill-down.

import React, { useState, useEffect, useMemo } from 'react'
import {
  providerLabel, providerClass, statusMeta, sortRuns, runKindLabel,
  formatDuration, formatSteps, formatTokens, relativeTime,
} from '../domain.js'

function HelperCard({ agent, onOpen }) {
  const meta = statusMeta(agent.status)
  const outcome = (typeof agent.reported_outcome === 'string' && agent.reported_outcome.trim())
    ? agent.reported_outcome.trim()
    : null
  const dur = formatDuration(agent.duration_secs)
  const steps = formatSteps(agent.steps_count)
  const tokens = formatTokens(agent.tokens)
  const hasStats = dur || steps || tokens
  const tappable = agent.has_activity === true
  const desc = agent.description || 'Background helper'

  const inner = (
    <>
      <div className="wf-helper-head">
        <span className={`wf-dot ${meta.dot}`} aria-hidden="true" />
        <span className="wf-helper-desc">{desc}</span>
        {tappable && <span className="wf-helper-chevron" aria-hidden="true">›</span>}
      </div>
      <div className={`wf-helper-outcome${outcome ? '' : ' is-empty'}`}>
        {outcome || 'No completion report'}
      </div>
      {hasStats && (
        <div className="wf-helper-stats">
          {dur && <span className="wf-stat">{dur}</span>}
          {steps && <span className="wf-stat">{steps}</span>}
          {tokens && <span className="wf-stat">{tokens} tok</span>}
        </div>
      )}
    </>
  )

  if (tappable) {
    return (
      <button
        type="button"
        className="wf-helper is-tappable"
        onClick={onOpen}
        aria-label={`Open helper: ${desc}`}
      >
        {inner}
      </button>
    )
  }
  return <div className="wf-helper">{inner}</div>
}

function RunSection({ run, chatId, onOpenHelper }) {
  const agents = Array.isArray(run.agents) ? run.agents : []
  const phases = Array.isArray(run.phases) ? run.phases : []
  const showPlan = run.kind === 'workflow' && phases.length > 0
  const when = relativeTime(run.started_at)
  return (
    <section className="wf-run">
      <div className="wf-run-head">
        <span className="wf-run-kind">{runKindLabel(run.kind)}</span>
        <span className="wf-run-label">{run.label || runKindLabel(run.kind)}</span>
        {when && <span className="wf-run-time">{when}</span>}
      </div>

      {showPlan && (
        <ol className="wf-phases">
          {phases.map((phase, i) => (
            <li className="wf-phase" key={i}>
              <div className="wf-phase-title">{phase.title}</div>
              {phase.detail && <div className="wf-phase-detail">{phase.detail}</div>}
            </li>
          ))}
        </ol>
      )}

      {agents.length > 0 && (
        <div className="wf-helpers">
          {agents.map((agent) => (
            <HelperCard
              key={agent.agent_id}
              agent={agent}
              onOpen={() => onOpenHelper(chatId, agent)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function ChatDetail({ storage, chatId, chatMeta, onBack, onOpenHelper, onOpenChat }) {
  const [detail, setDetail] = useState(undefined)

  useEffect(() => {
    setDetail(undefined)
    const unsub = storage.subscribe(`chats/${chatId}.json`, setDetail)
    return () => { try { unsub && unsub() } catch (_) { /* noop */ } }
  }, [storage, chatId])

  const title = (detail && detail.title) || (chatMeta && chatMeta.title) || 'Chat'
  const provider = (detail && detail.provider) || (chatMeta && chatMeta.provider)
  const runs = useMemo(() => sortRuns(detail && detail.runs), [detail])
  const loaded = detail !== undefined
  const isEmpty = loaded && runs.length === 0

  return (
    <div className="wf-root">
      <header className="wf-header">
        <button type="button" className="wf-back" onClick={onBack} aria-label="Back">‹</button>
        <div className="wf-brand">
          <span className={`wf-chip ${providerClass(provider)}`}>{providerLabel(provider)}</span>
          <div className="wf-heading">
            <h1 className="wf-title wf-title-sm">{title}</h1>
          </div>
        </div>
        <button
          type="button"
          className="wf-btn wf-btn-ghost"
          onClick={() => onOpenChat(chatId)}
        >
          Open chat →
        </button>
      </header>

      {!loaded ? (
        <div className="wf-scroll">
          <div className="wf-loading"><div className="wf-spinner" aria-label="Loading" /></div>
        </div>
      ) : isEmpty ? (
        <div className="wf-scroll">
          <div className="wf-empty">
            <div className="wf-empty-mark" aria-hidden="true">✶</div>
            <div className="wf-empty-title">No recorded activity</div>
            <p className="wf-empty-text">
              This chat has no background work recorded yet. It will appear here the
              next time its helpers run.
            </p>
          </div>
        </div>
      ) : (
        <div className="wf-scroll">
          {runs.map((run) => (
            <RunSection
              key={run.run_id}
              run={run}
              chatId={chatId}
              onOpenHelper={onOpenHelper}
            />
          ))}
        </div>
      )}
    </div>
  )
}
