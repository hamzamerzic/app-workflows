// Markdown — a tiny, SAFE renderer for the markdown-lite block structure from
// domain.js (paragraphs, headings, bullets, numbered items, fenced code, and
// inline bold / code). It maps the parsed block/span tree to React elements and
// NEVER produces HTML from the source string, so there is no injection surface —
// every user string lands as a text node. Shared by the timeline and the helper
// detail page so both render the agent's own words the same way.

import React, { useMemo } from 'react'
import { parseMarkdownLite } from '../domain.js'

function Spans({ spans }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.t === 'bold') return <strong key={i}>{s.v}</strong>
        if (s.t === 'code') return <code className="wf-md-code" key={i}>{s.v}</code>
        return <React.Fragment key={i}>{s.v}</React.Fragment>
      })}
    </>
  )
}

export function Markdown({ text, className }) {
  const blocks = useMemo(() => parseMarkdownLite(text), [text])
  if (!blocks.length) return null
  const out = []
  let i = 0
  while (i < blocks.length) {
    const b = blocks[i]
    if (b.type === 'bullet' || b.type === 'num') {
      const ordered = b.type === 'num'
      const items = []
      while (i < blocks.length && blocks[i].type === (ordered ? 'num' : 'bullet')) {
        items.push(blocks[i]); i += 1
      }
      const Tag = ordered ? 'ol' : 'ul'
      out.push(
        <Tag className="wf-md-list" key={`l${i}`}>
          {items.map((it, k) => <li className="wf-md-li" key={k}><Spans spans={it.spans} /></li>)}
        </Tag>,
      )
      continue
    }
    if (b.type === 'heading') {
      out.push(<div className={`wf-md-h wf-md-h${b.level}`} key={`h${i}`}><Spans spans={b.spans} /></div>)
    } else if (b.type === 'code') {
      out.push(<pre className="wf-md-pre" key={`c${i}`}><code>{b.text}</code></pre>)
    } else {
      out.push(<p className="wf-md-p" key={`p${i}`}><Spans spans={b.spans} /></p>)
    }
    i += 1
  }
  return <div className={className ? `wf-md ${className}` : 'wf-md'}>{out}</div>
}
