// Home — the outcome JOURNAL. Reads like a diary of what the assistant got
// done: an app header, a "Needs you" strip for anything worth a look, then the
// entries grouped by day. Each entry is one tappable row — root task, ambient
// status, latest outcome, and helper count — that opens the layered timeline.
// Missing fields are omitted, never faked.

import React, { useState } from 'react'
import { statusDot, groupEntriesByDay } from '../domain.js'

// The strip at the top of the journal. Amber and tappable while something is
// unverified/failed/running and absent when everything is healthy. Tapping
// filters the journal rather than unexpectedly opening only the first item.
function NeedsStrip({ items, active, onToggle }) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return null
  const first = list[0]
  const n = list.length
  return (
    <button type="button" className="wf-needs" onClick={onToggle} aria-pressed={active}>
      <span className="wf-needs-ic" aria-hidden="true">!</span>
      <span className="wf-needs-tx">
        <span className="wf-needs-head">
          {active ? `Showing ${n} item${n === 1 ? '' : 's'} that need a look` : `${n} thing${n === 1 ? '' : 's'} worth a look`}
        </span>
        <span className="wf-needs-sub">
          {active ? 'Show all workflows' : (first && first.outcome) || 'Filter to unfinished work'}
        </span>
      </span>
      <span className="wf-needs-go" aria-hidden="true">{active ? '×' : '›'}</span>
    </button>
  )
}

function EntryCard({ entry, onOpen }) {
  const dot = statusDot(entry.status)
  const tasks = Number.isFinite(entry.tasks) ? entry.tasks : null
  const reco = entry.recovered === true
  const headline = entry.title || entry.outcome || 'Untitled activity'
  const context = entry.outcome && entry.outcome.trim() !== headline.trim() ? entry.outcome : ''
  return (
    <button type="button" className={`wf-entry${reco ? ' is-reco' : ''}`} onClick={() => onOpen(entry)}>
      <span className="wf-entry-title">
        <span className={`wf-stat ${dot}`} aria-hidden="true" />
        <span>{headline}</span>
      </span>
      {context && <span className="wf-entry-context">{context}</span>}
      <span className="wf-entry-meta">
        {entry.result && <span className="wf-result">{entry.result}</span>}
        {reco && <span className="wf-pill is-reco">✦ recovered</span>}
        {tasks != null && (
          <span className="wf-tasks">{tasks} helper{tasks === 1 ? '' : 's'} ›</span>
        )}
      </span>
    </button>
  )
}

export function Home({
  appId, idx, loaded, online, refreshing, updatedLabel, onRefresh, onOpenDetail,
}) {
  const entries = (idx && Array.isArray(idx.entries)) ? idx.entries : []
  const needs = (idx && Array.isArray(idx.needs_attention)) ? idx.needs_attention : []
  const [attentionOnly, setAttentionOnly] = useState(false)
  const showAttention = attentionOnly && needs.length > 0
  const attentionIds = new Set(needs.map((item) => item.chat_id))
  const visibleEntries = showAttention
    ? entries.filter((entry) => attentionIds.has(entry.chat_id))
    : entries
  const groups = groupEntriesByDay(visibleEntries)
  const isEmpty = loaded && entries.length === 0
  const omittedChats = Math.max(0, Number(idx && idx.history && idx.history.chats_omitted) || 0)

  return (
    <div className="wf-root">
      <header className="wf-header">
        <div className="wf-brand">
          <img
            src={`/api/apps/${appId}/icon?size=64`}
            alt=""
            width={30}
            height={30}
            className="wf-brand-icon"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
              const f = e.currentTarget.nextElementSibling
              if (f) f.style.display = 'flex'
            }}
          />
          <span className="wf-mark" style={{ display: 'none' }} aria-hidden="true">W</span>
          <div className="wf-heading">
            <h1 className="wf-title">Workflows</h1>
            <span className="wf-subtitle">What your assistant got done</span>
          </div>
        </div>
        <div className="wf-header-actions">
          {refreshing && <span className="wf-status-text" role="status">Updating…</span>}
          <button
            type="button"
            className={`wf-icon-btn${refreshing ? ' is-spinning' : ''}`}
            onClick={onRefresh}
            disabled={refreshing}
            title={updatedLabel}
            aria-label="Refresh"
          >
            <span className="wf-refresh-glyph" aria-hidden="true">⟳</span>
          </button>
        </div>
      </header>

      <main className="wf-scroll">
        {!loaded ? (
          <div className="wf-loading" role="status" aria-live="polite">
            <div className="wf-spinner" aria-hidden="true" />
            <span className="wf-sr-only">Loading activity</span>
          </div>
        ) : isEmpty ? (
          <div className="wf-empty">
            <div className="wf-empty-mark" aria-hidden="true">✶</div>
            <div className="wf-empty-title">Nothing here yet</div>
            <p className="wf-empty-text">
              When your assistant works on something in the background, it lands
              here as a plain-language journal — what it got done, and anything
              worth a look.
            </p>
            <div className="wf-empty-actions">
              <button type="button" className="wf-btn wf-btn-primary" onClick={onRefresh} disabled={refreshing}>
                {refreshing ? 'Checking…' : 'Refresh'}
              </button>
            </div>
          </div>
        ) : (
          <div className="wf-content">
            <NeedsStrip
              items={needs}
              active={showAttention}
              onToggle={() => setAttentionOnly((value) => !value)}
            />
            {omittedChats > 0 && (
              <p className="wf-history-note">
                Showing recent workflows · {omittedChats} older {omittedChats === 1 ? 'entry' : 'entries'} omitted
              </p>
            )}
            {groups.map((group) => {
              const groupReco = group.items.some((e) => e && e.recovered === true)
              return (
                <React.Fragment key={group.key}>
                  <h2 className="wf-daylabel">
                    {group.label}
                    {groupReco && <span className="wf-restored"> · ✦ restored</span>}
                  </h2>
                  {group.items.map((entry, i) => (
                    <EntryCard
                      key={entry.chat_id || `${group.key}:${i}`}
                      entry={entry}
                      onOpen={onOpenDetail}
                    />
                  ))}
                </React.Fragment>
              )
            })}
          </div>
        )}
      </main>

      {!online && <div className="wf-sync-pill" role="status">Offline</div>}
    </div>
  )
}
