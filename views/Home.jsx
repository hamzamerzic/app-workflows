// Home — the outcome JOURNAL. Reads like a diary of what the assistant got
// done: an app header, a "Needs you" strip for anything worth a look, then the
// entries grouped by day. Each entry is one tappable card — an ambient status
// dot, the plain outcome, an area pill + result + task count — that opens the
// chat drill-in. No provider vocabulary and no git-graph here; the machine
// detail lives two levels down. Missing fields are omitted, never faked.

import React from 'react'
import { statusDot, groupEntriesByDay } from '../domain.js'

// The strip at the top of the journal. Amber and tappable while something is
// unverified/failed/running; a quiet "all caught up" once nothing needs a look.
// Tapping opens the first flagged chat (the count says there are more).
function NeedsStrip({ items, onOpen }) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) {
    return (
      <div className="wf-needs is-clear">
        <span className="wf-needs-ic" aria-hidden="true">✓</span>
        <span className="wf-needs-tx"><span className="wf-needs-head">All caught up</span></span>
      </div>
    )
  }
  const first = list[0]
  const n = list.length
  return (
    <button type="button" className="wf-needs" onClick={() => onOpen(first)}>
      <span className="wf-needs-ic" aria-hidden="true">!</span>
      <span className="wf-needs-tx">
        <span className="wf-needs-head">{n} thing{n === 1 ? '' : 's'} worth a look</span>
        {first && first.outcome && <span className="wf-needs-sub">{first.outcome}</span>}
      </span>
      <span className="wf-needs-go" aria-hidden="true">›</span>
    </button>
  )
}

function EntryCard({ entry, onOpen }) {
  const dot = statusDot(entry.status)
  const tasks = Number.isFinite(entry.tasks) ? entry.tasks : null
  const reco = entry.recovered === true
  const title = entry.title || entry.outcome || 'Untitled'
  return (
    <button type="button" className={`wf-entry${reco ? ' is-reco' : ''}`} onClick={() => onOpen(entry)}>
      <span className="wf-entry-title">
        <span className={`wf-stat ${dot}`} aria-hidden="true" />
        <span>{title}</span>
      </span>
      <span className="wf-entry-meta">
        {entry.area && <span className="wf-pill is-area">{entry.area}</span>}
        {entry.result && <span className="wf-sep" aria-hidden="true" />}
        {entry.result && <span className="wf-result">{entry.result}</span>}
        {reco && <span className="wf-pill is-reco">✦ recovered</span>}
        {tasks != null && (
          <span className="wf-tasks">{tasks} task{tasks === 1 ? '' : 's'} ›</span>
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
  const groups = groupEntriesByDay(entries)
  const isEmpty = loaded && entries.length === 0

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

      {!loaded ? (
        <div className="wf-scroll">
          <div className="wf-loading"><div className="wf-spinner" aria-label="Loading" /></div>
        </div>
      ) : isEmpty ? (
        <div className="wf-scroll">
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
        </div>
      ) : (
        <div className="wf-scroll">
          <NeedsStrip items={needs} onOpen={onOpenDetail} />
          {groups.map((group) => {
            const groupReco = group.items.some((e) => e && e.recovered === true)
            return (
              <React.Fragment key={group.key}>
                <div className="wf-daylabel">
                  {group.label}
                  {groupReco && <span className="wf-restored"> · ✦ restored</span>}
                </div>
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
          <div style={{ height: 20 }} />
        </div>
      )}

      {!online && <div className="wf-sync-pill" role="status">Offline</div>}
    </div>
  )
}
