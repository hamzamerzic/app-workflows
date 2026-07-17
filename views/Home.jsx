// Home — the chats that have handed work to background helpers. Working chats
// sort first, then ones needing attention, then by recency. Each row carries a
// provider chip, a helper rollup, relative time, tokens tucked small, and a
// secondary "Open chat" that jumps to the real conversation. Unlinked work and
// the Codex empty hint sit below the list.

import React from 'react'
import {
  providerLabel, providerClass, chatStatus, statusMeta, helperRollup,
  sortChats, hasCodexChat, formatTokens, relativeTime,
} from '../domain.js'

function ChatRow({ chat, onOpenDetail, onOpenChat }) {
  const status = statusMeta(chatStatus(chat.helpers))
  const tokens = formatTokens(chat.tokens_total)
  const when = relativeTime(chat.last_activity_at)
  const title = chat.title || 'Untitled chat'
  return (
    <li className="wf-row">
      <button
        type="button"
        className="wf-row-main"
        onClick={() => onOpenDetail(chat)}
      >
        <div className="wf-row-top">
          <span className={`wf-chip ${providerClass(chat.provider)}`}>
            {providerLabel(chat.provider)}
          </span>
          <span className="wf-row-title">{title}</span>
        </div>
        <div className="wf-row-meta">
          <span className={`wf-dot ${status.dot}`} aria-hidden="true" />
          <span className="wf-row-rollup">{helperRollup(chat.helpers)}</span>
          {when && <span className="wf-row-sep" aria-hidden="true">·</span>}
          {when && <span className="wf-row-time">{when}</span>}
          {tokens && <span className="wf-row-tokens">{tokens} tokens</span>}
        </div>
      </button>
      <button
        type="button"
        className="wf-row-open"
        onClick={() => onOpenChat(chat.chat_id)}
      >
        Open chat →
      </button>
    </li>
  )
}

function UnlinkedItem({ item }) {
  const when = relativeTime(item.last_activity_at)
  const count = Number.isFinite(item.helpers) && item.helpers > 0
    ? `${item.helpers} helper${item.helpers === 1 ? '' : 's'}`
    : null
  return (
    <li className="wf-unlinked">
      <div className="wf-unlinked-top">
        <span className={`wf-chip ${providerClass(item.provider)}`}>
          {providerLabel(item.provider)}
        </span>
        <span className="wf-unlinked-reason">{item.reason || 'Not linked to a chat'}</span>
      </div>
      <div className="wf-unlinked-meta">
        {count}
        {count && when ? ' · ' : ''}
        {when}
      </div>
    </li>
  )
}

export function Home({
  appId, idx, loaded, online, refreshing, updatedLabel, onRefresh,
  onOpenDetail, onOpenChat,
}) {
  const chats = sortChats(idx && idx.chats)
  const unlinked = (idx && Array.isArray(idx.unlinked)) ? idx.unlinked : []
  const isEmpty = loaded && chats.length === 0 && unlinked.length === 0
  const showCodexHint = chats.length > 0 && !hasCodexChat(chats)

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
            <span className="wf-subtitle">Background helpers across your chats</span>
          </div>
        </div>
        <div className="wf-header-actions">
          <span className="wf-status-text" role="status">
            {refreshing ? 'Updating…' : updatedLabel}
          </span>
          <button
            type="button"
            className={`wf-icon-btn${refreshing ? ' is-spinning' : ''}`}
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh background work"
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
            <div className="wf-empty-title">No background work yet</div>
            <p className="wf-empty-text">
              When your chats hand work to background helpers, it shows up here —
              what they are doing, whether they finished, and what they reported back.
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
          <ul className="wf-list">
            {chats.map((chat) => (
              <ChatRow
                key={chat.chat_id}
                chat={chat}
                onOpenDetail={onOpenDetail}
                onOpenChat={onOpenChat}
              />
            ))}
          </ul>

          {showCodexHint && (
            <div className="wf-muted-row">
              <span className="wf-chip is-codex">CODEX</span>
              <span>No background helpers in Codex chats yet</span>
            </div>
          )}

          {unlinked.length > 0 && (
            <>
              <div className="wf-section-head">
                <h2 className="wf-section-label">Unlinked work</h2>
              </div>
              <ul className="wf-list">
                {unlinked.map((item, i) => (
                  <UnlinkedItem key={`${item.provider}:${item.session_id || i}`} item={item} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {!online && <div className="wf-sync-pill" role="status">Offline</div>}
    </div>
  )
}
