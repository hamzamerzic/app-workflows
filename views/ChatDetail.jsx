// ChatDetail — one chat rendered as a git-graph timeline of its turns. The
// trunk is the agent's own turn; branches are the helpers it spawned, each
// ending by fate (merged back, still out, failed, or stopped). Tapping a branch
// opens the HelperDetail drill-down. The heavy per-turn structure lives in
// `Timeline.jsx`; this owns the header, the loading/empty states, and the
// subscription to the chat document the job writes.

import React, { useState, useEffect } from 'react'
import { providerLabel, providerClass } from '../domain.js'
import { Timeline } from './Timeline.jsx'

export function ChatDetail({ storage, chatId, chatMeta, onBack, onOpenHelper, onOpenChat }) {
  const [detail, setDetail] = useState(undefined)

  useEffect(() => {
    setDetail(undefined)
    const unsub = storage.subscribe(`chats/${chatId}.json`, setDetail)
    return () => { try { unsub && unsub() } catch (_) { /* noop */ } }
  }, [storage, chatId])

  const title = (detail && detail.title) || (chatMeta && chatMeta.title) || 'Chat'
  const provider = (detail && detail.provider) || (chatMeta && chatMeta.provider)
  const turns = (detail && Array.isArray(detail.turns)) ? detail.turns : []
  const loaded = detail !== undefined
  const isEmpty = loaded && turns.length === 0

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
          <Timeline turns={turns} chatId={chatId} onOpenHelper={onOpenHelper} />
        </div>
      )}
    </div>
  )
}
