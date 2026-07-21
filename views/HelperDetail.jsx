// HelperDetail — one background helper's full record: its goal, the ordered
// steps it took (tool calls and notes), and the report it wrote back, rendered
// as markdown-lite. When the underlying activity has aged out we say so
// plainly rather than showing a hollow view, and a truncated record is flagged.

import React, { useState, useEffect } from 'react'
import { Markdown } from './Markdown.jsx'

function shortTitle(text, max = 52) {
  const s = (typeof text === 'string' ? text : '').trim()
  if (!s) return 'Helper'
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
}

export function HelperDetail({ storage, chatId, agentId, agentMeta, onBack }) {
  const [rec, setRec] = useState(undefined)

  useEffect(() => {
    setRec(undefined)
    const unsub = storage.subscribe(`agents/${chatId}/${agentId}.json`, setRec)
    return () => { try { unsub && unsub() } catch (_) { /* noop */ } }
  }, [storage, chatId, agentId])

  const loaded = rec !== undefined
  const goal = (rec && rec.goal) || (agentMeta && agentMeta.description) || 'Background helper'
  const steps = (rec && Array.isArray(rec.steps)) ? rec.steps : []
  const report = (rec && typeof rec.final_report === 'string') ? rec.final_report.trim() : ''
  const handback = (rec && rec.handback) || {}
  const handbackActions = Array.isArray(handback.actions) ? handback.actions : []

  return (
    <div className="wf-root">
      <header className="wf-header">
        <button type="button" className="wf-back" onClick={onBack} aria-label="Back">‹</button>
        <div className="wf-brand">
          <div className="wf-heading">
            <h1 className="wf-title wf-title-sm">{shortTitle(goal)}</h1>
            <span className="wf-subtitle">Background helper</span>
          </div>
        </div>
      </header>

      {!loaded ? (
        <div className="wf-scroll">
          <div className="wf-loading"><div className="wf-spinner" aria-label="Loading" /></div>
        </div>
      ) : rec === null ? (
        <div className="wf-scroll">
          <div className="wf-empty">
            <div className="wf-empty-mark" aria-hidden="true">✶</div>
            <div className="wf-empty-title">No activity recorded</div>
            <p className="wf-empty-text">
              This helper has no recorded activity to show.
            </p>
          </div>
        </div>
      ) : (
        <div className="wf-scroll">
          <div className="wf-goal">{goal}</div>

          {/* The chat recorded this helper as finished, but the payload it
              handed back was an error. We show the corrected reading and say
              plainly that we corrected it, rather than repeating a label the
              evidence contradicts or silently overwriting it. */}
          {rec.status_overridden && (
            <div className="wf-note is-corrected">
              <span aria-hidden="true">⚠</span>
              <span>
                The chat marked this helper finished, but it returned an error.
                Shown as failed.
              </span>
            </div>
          )}

          {rec.source_expired && (
            <div className="wf-note is-expired">
              <span aria-hidden="true">⧗</span>
              <span>Record expired — the full activity for this helper is no longer available.</span>
            </div>
          )}

          {steps.length > 0 && (
            <>
              <div className="wf-section-head">
                <h2 className="wf-section-label">Activity</h2>
              </div>
              <div className="wf-steps">
                {steps.map((step, i) => (
                  <div className="wf-step" key={i}>
                    <span className={`wf-step-glyph ${step.kind === 'tool' ? 'is-tool' : 'is-note'}`} aria-hidden="true">
                      {step.kind === 'tool' ? '▸' : '·'}
                    </span>
                    <div className="wf-step-body">
                      <div className="wf-step-title">{step.title}</div>
                      {step.detail && <div className="wf-step-detail">{step.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {report && (
            <>
              <div className="wf-section-head">
                <h2 className="wf-section-label">Report</h2>
              </div>
              <div className="wf-report">
                <Markdown text={report} />
              </div>
            </>
          )}

          {/* What the chat did once this helper reported back. Headed "What
              happened next" rather than "merged", because the transcript can
              prove the ORDER of events and not that the helper caused them —
              the wording has to stop exactly where the evidence does. */}
          {(handback.note || handbackActions.length > 0) && (
            <>
              <div className="wf-section-head">
                <h2 className="wf-section-label">What happened next</h2>
              </div>
              {handback.note && <div className="wf-handback-note"><Markdown text={handback.note} /></div>}
              {handbackActions.length > 0 && (
                <div className="wf-steps">
                  {handbackActions.map((action, i) => (
                    <div className="wf-step" key={i}>
                      <span className="wf-step-glyph is-tool" aria-hidden="true">▸</span>
                      <div className="wf-step-body">
                        <div className="wf-step-title">{action.tool}</div>
                        {action.target && <div className="wf-step-detail">{action.target}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {handback.actions_truncated && (
                <div className="wf-note">
                  <span aria-hidden="true">…</span>
                  <span>The chat kept working after these — showing the first few.</span>
                </div>
              )}
            </>
          )}

          {/* "We never had a trail" and "the trail aged out" are different
              facts and must not render the same. A block-derived helper is
              read from the chat transcript, which records the spawn and the
              result but never the helper's internal steps — so an empty
              Activity section here is the expected shape, not a loss. */}
          {rec.origin === 'block' && steps.length === 0 && (
            <div className="wf-note">
              <span aria-hidden="true">▪</span>
              <span>
                Read from the chat transcript, which records what this helper
                was asked to do and what it returned — not the individual steps
                it took along the way.
              </span>
            </div>
          )}

          {!report && steps.length === 0 && !rec.source_expired
            && rec.origin !== 'block' && (
            <div className="wf-note">
              <span>This helper recorded no steps or report.</span>
            </div>
          )}

          {rec.truncated && (
            <div className="wf-note">
              <span aria-hidden="true">…</span>
              <span>This activity was long — showing a truncated view.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
