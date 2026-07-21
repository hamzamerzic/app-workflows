// ChatDetail — the VISUAL drill-in for one chat. A slim "‹ Activity" appbar,
// then a chat hero (title, provider chip, step count + date, and "Open chat"
// jumping to the real conversation), then the vertical turn-spine (Timeline).
//
// Owns the loading/empty states, the subscription to the chat document the job
// writes, and scroll/disclosure RESTORATION: because drilling into a subagent
// unmounts this view, the scroll position and which Technical-detail disclosures
// were open are kept in a per-chat store (owned by App) and re-applied on return.

import React, { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { providerLabel } from '../domain.js'
import { Timeline } from './Timeline.jsx'

function fmtShortDate(ts) {
  if (ts == null) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined,
    sameYear ? { day: 'numeric', month: 'short' }
             : { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ChatDetail({ storage, chatId, chatMeta, viewStates, onBack, onOpenHelper, onOpenChat }) {
  const [detail, setDetail] = useState(undefined)
  const scrollRef = useRef(null)
  // The last position we programmatically applied. Used to tell "the content
  // grew, re-apply the saved scroll" apart from "the user scrolled away, stop".
  const lastAppliedRef = useRef(-1)

  // The per-chat store: scroll position + which turns have Technical detail
  // open. Lives in a Map owned by App so it outlives this component's unmount
  // on drill-in to a subagent.
  const store = (() => {
    let s = viewStates && viewStates.get(chatId)
    if (!s) { s = { scrollTop: 0, tech: new Set() }; if (viewStates) viewStates.set(chatId, s) }
    // Guard against a store shaped by an older build.
    if (!s.tech) s.tech = new Set()
    return s
  })()

  useEffect(() => {
    lastAppliedRef.current = -1
    setDetail(undefined)
    const unsub = storage.subscribe(`chats/${chatId}.json`, setDetail)
    return () => { try { unsub && unsub() } catch (_) { /* noop */ } }
  }, [storage, chatId])

  const title = (detail && detail.title) || (chatMeta && chatMeta.title) || 'Chat'
  const provider = (detail && detail.provider) || (chatMeta && chatMeta.provider)
  const turns = (detail && Array.isArray(detail.turns)) ? detail.turns : []
  const loaded = detail !== undefined
  const isEmpty = loaded && turns.length === 0
  const when = fmtShortDate((detail && detail.ts) || (chatMeta && chatMeta.ts))

  // Restore the saved scroll after the spine mounts with its disclosures
  // re-opened (they restore synchronously via useState). Re-runs whenever the
  // chat DOCUMENT changes — a late/fuller doc can grow the scrollable range, and
  // a one-shot restore would have clamped to the earlier, shorter height and
  // landed too high. It re-applies only while the user hasn't moved from our
  // last applied position; once they scroll away, it stops fighting them.
  useLayoutEffect(() => {
    if (!loaded || isEmpty) return
    const el = scrollRef.current
    if (!el || !store.scrollTop) return
    if (lastAppliedRef.current >= 0 && Math.abs(el.scrollTop - lastAppliedRef.current) > 4) return
    const raf = requestAnimationFrame(() => {
      const target = Math.min(store.scrollTop, Math.max(0, el.scrollHeight - el.clientHeight))
      el.scrollTop = target
      lastAppliedRef.current = target
    })
    return () => cancelAnimationFrame(raf)
  }, [loaded, isEmpty, detail, store])

  // Save the user's position — but IGNORE our own programmatic restore (whose
  // resulting scroll event lands exactly on lastApplied), so the clamped-short
  // value never overwrites the real saved scrollTop and defeats the re-clamp.
  const onScroll = () => {
    const el = scrollRef.current
    if (!el || el.scrollTop === lastAppliedRef.current) return
    store.scrollTop = el.scrollTop
  }

  return (
    <div className="wf-root">
      <header className="wf-header">
        <button type="button" className="wf-back-text" onClick={onBack}>‹ Activity</button>
        <span className="wf-spacer" />
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
        <div className="wf-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="wf-chat-hero">
            <h2 className="wf-chat-title">{title}</h2>
            <div className="wf-chat-meta">
              {provider && <span className="wf-chan">{providerLabel(provider)}</span>}
              {provider && <span className="wf-sep" aria-hidden="true" />}
              <span>
                {turns.length} step{turns.length === 1 ? '' : 's'}{when ? ` · ${when}` : ''}
              </span>
              <span className="wf-hero-spacer" />
              <button type="button" className="wf-openchat" onClick={() => onOpenChat(chatId)}>
                Open chat ↗
              </button>
            </div>
          </div>
          <Timeline turns={turns} chatId={chatId} onOpenHelper={onOpenHelper} store={store} />
        </div>
      )}
    </div>
  )
}
