// HelperDetail — one background helper's full record: its goal, the ordered
// steps it took (tool calls and notes), and the report it wrote back, rendered
// as markdown-lite. When the underlying activity has aged out we say so
// plainly rather than showing a hollow view, and a truncated record is flagged.

import React, { useState, useEffect, useMemo } from 'react'
import { parseMarkdownLite } from '../domain.js'

function shortTitle(text, max = 52) {
  const s = (typeof text === 'string' ? text : '').trim()
  if (!s) return 'Helper'
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
}

function ReportBlocks({ blocks }) {
  const rendered = []
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]
    if (block.type === 'bullet') {
      const items = []
      while (i < blocks.length && blocks[i].type === 'bullet') {
        items.push(blocks[i])
        i += 1
      }
      rendered.push(
        <ul className="wf-report-list" key={`ul-${i}`}>
          {items.map((it, k) => (
            <li className="wf-report-li" key={k}><Spans spans={it.spans} /></li>
          ))}
        </ul>,
      )
    } else {
      rendered.push(
        <p className="wf-report-p" key={`p-${i}`}><Spans spans={block.spans} /></p>,
      )
      i += 1
    }
  }
  return <>{rendered}</>
}

function Spans({ spans }) {
  return (
    <>
      {spans.map((span, k) => {
        if (span.t === 'bold') return <strong key={k}>{span.v}</strong>
        if (span.t === 'code') return <code className="wf-code" key={k}>{span.v}</code>
        return <React.Fragment key={k}>{span.v}</React.Fragment>
      })}
    </>
  )
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
  const blocks = useMemo(() => parseMarkdownLite(report), [report])

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
                <ReportBlocks blocks={blocks} />
              </div>
            </>
          )}

          {!report && steps.length === 0 && !rec.source_expired && (
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
