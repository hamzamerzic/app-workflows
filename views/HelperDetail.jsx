// HelperDetail — the subagent detail (the third nav level). Its avatar + task
// title, then the plain-language record: "The task it was given" (the brief),
// "What it did" (the did[] steps as a readable list), "What it reported back"
// (its result / full report), "What happened next" (how the chat used it), and
// the raw commands under a dashed technical section.
//
// Defensive: every section is omitted when its field is absent — we never show
// a hollow section or a fake value — and an aged-out / empty record says so
// plainly rather than rendering an empty shell.

import React, { useState, useEffect } from 'react'
import { Markdown } from './Markdown.jsx'
import { avatarFor, verbIcon } from '../domain.js'

function shortTitle(text, max = 68) {
  const s = (typeof text === 'string' ? text : '').trim()
  if (!s) return 'Helper'
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
}

export function HelperDetail({ storage, chatId, agentId, agentMeta, onBack }) {
  const [rec, setRec] = useState(undefined)

  // Helpers are keyed by agent_id alone in schema v2 (helpers/<agent_id>.json).
  useEffect(() => {
    setRec(undefined)
    const unsub = storage.subscribe(`helpers/${agentId}.json`, setRec)
    return () => { try { unsub && unsub() } catch (_) { /* noop */ } }
  }, [storage, agentId])

  const loaded = rec !== undefined
  const kind = (rec && rec.kind) || (agentMeta && agentMeta.kind)
  const av = avatarFor(kind)
  const name = (rec && rec.name) || av.name
  const ask = (rec && rec.ask) || (agentMeta && agentMeta.description) || 'Background helper'
  const brief = (rec && typeof rec.brief_full === 'string') ? rec.brief_full.trim() : ''
  const did = (rec && Array.isArray(rec.did)) ? rec.did : []
  const result = (rec && typeof rec.result === 'string') ? rec.result.trim() : ''
  const report = (rec && typeof rec.report_full === 'string') ? rec.report_full.trim() : ''
  const next = (rec && typeof rec.next === 'string') ? rec.next.trim() : ''
  const commands = (rec && Array.isArray(rec.commands)) ? rec.commands : []
  const nothing = loaded && rec && !brief && did.length === 0 && !result && !report && !next && commands.length === 0

  return (
    <div className="wf-root">
      <header className="wf-header">
        <button type="button" className="wf-back-text" onClick={onBack}>‹ Back</button>
        <span className="wf-spacer" />
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
            <p className="wf-empty-text">This subagent has no recorded activity to show.</p>
          </div>
        </div>
      ) : (
        <div className="wf-scroll">
          <div className="wf-sd-head">
            <span className={`wf-avatar ${av.cls}`} aria-hidden="true">{av.emoji}</span>
            <h2 className="wf-sd-title">{shortTitle(ask)}</h2>
            <div className="wf-sd-k">{name} · {av.role}</div>
          </div>

          <div className="wf-sect">
            <h3 className="wf-sect-h">The task it was given</h3>
            {brief
              ? <div className="wf-sect-p"><Markdown text={brief} /></div>
              : <p className="wf-sect-p">{ask}</p>}
          </div>

          {did.length > 0 && (
            <div className="wf-sect">
              <h3 className="wf-sect-h">What it did</h3>
              <div className="wf-sd-steps">
                {did.map((d, i) => (
                  <div className="wf-stp" key={i}>
                    <span className="wf-stp-ic" aria-hidden="true">{verbIcon(d.verb)}</span>
                    <span className="wf-stp-body">
                      <span className="wf-stp-label">{d.label || d.verb}</span>
                      {Number.isFinite(d.count) && (
                        <span className="wf-stp-sub">{d.count} time{d.count === 1 ? '' : 's'}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(result || report) && (
            <div className="wf-sect">
              <h3 className="wf-sect-h">What it reported back</h3>
              {result && <p className="wf-sect-p">{result}</p>}
              {report && (
                <div className="wf-sect-p" style={result ? { marginTop: 8 } : undefined}>
                  <Markdown text={report} />
                </div>
              )}
            </div>
          )}

          {next && (
            <div className="wf-sect is-next">
              <h3 className="wf-sect-h">What happened next</h3>
              <div className="wf-sect-p"><Markdown text={next} /></div>
            </div>
          )}

          {commands.length > 0 && (
            <div className="wf-sect is-tech">
              <h3 className="wf-sect-h">Under the hood</h3>
              <div className="wf-cmds">
                {commands.map((c, i) => <div className="wf-cmd" key={i}>{c}</div>)}
              </div>
            </div>
          )}

          {nothing && (
            <div className="wf-sect">
              <p className="wf-sect-p">This subagent recorded no steps or report.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
