// Chronological workflow timeline. Time flows down; lane 0 is the main agent
// and concurrent helpers occupy reusable lanes. Connector SVG is decorative;
// the ordered event list remains the accessible source of truth.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from './Markdown.jsx'
import {
  TIMELINE_GEOMETRY, avatarFor, formatDuration, formatTimelineTime,
  layoutTimeline, subStateMeta,
} from '../domain.js'

function eventState(event, agent) {
  if (event.type === 'agent_terminal') return event.state
  if (event.type === 'agent_spawned' || event.type === 'agent_started') return 'running'
  return event.state || (agent && agent.state)
}

function stateMeta(value) {
  if (value === 'attention') return { cls: 'stopped', glyph: '!', label: 'needs a look' }
  return subStateMeta(value)
}

function eventLabel(event, agent, mainAgentId) {
  if (event.type === 'main_checkpoint') return event.summary || 'Main agent continued the task'
  if (event.subject_agent_id === mainAgentId) return event.summary || 'Main agent activity'
  const name = (agent && agent.name) || 'Helper'
  if (event.type === 'agent_spawned') return `${name} launched: ${(agent && agent.task_summary) || event.summary}`
  if (event.type === 'agent_started') return `${name} started`
  if (event.type === 'agent_terminal') return `${name} ${subStateMeta(event.state).label}`
  return event.summary || `${name} activity`
}

function xForLane(lane) {
  return TIMELINE_GEOMETRY.laneOrigin + lane * TIMELINE_GEOMETRY.laneGap
}

function EventCard({ row, agent, parentAgent, mainAgentId, span, selected, onSelect }) {
  const isHelper = row.subject_agent_id !== mainAgentId
  const state = stateMeta(eventState(row, agent))
  const finalState = subStateMeta(agent && agent.state)
  const time = row.at ? formatTimelineTime(row.at, row.time_quality) : 'Unknown'
  const parent = agent && agent.parent_agent_id
  const unknownParent = isHelper && (!parent || agent.ancestry_quality === 'unknown')
  const depth = Math.min(3, Math.max(0, Number(agent && agent.depth) || 1) - 1)
  const startAt = span && span.startEvent && span.startEvent.at
  const rawDuration = row.type === 'agent_terminal' ? formatDuration(startAt, row.at) : ''
  const duration = rawDuration && span.startEvent.time_quality === 'exact' && row.time_quality === 'exact'
    ? rawDuration : rawDuration ? `~${rawDuration}` : ''
  const canSelect = isHelper && Boolean(agent)
  const summary = (agent && agent.task_summary) || row.summary || 'No task summary was recorded'

  let content
  if (row.type === 'main_checkpoint' || !isHelper) {
    content = (
      <div className="wf-time-main-card">
        <span className="wf-time-main-head">
          <span className="wf-time-main-label">Main agent</span>
          {row.state && <span className={`wf-time-main-state ${state.cls}`}>{state.glyph} {state.label}</span>}
        </span>
        <span className="wf-time-main-copy">{row.summary || 'Continued the task'}</span>
        {row.flag && <span className="wf-time-main-flag">{row.flag}</span>}
      </div>
    )
  } else if (row.type === 'agent_spawned' || (row.type === 'agent_started' && span && span.startEvent === row)) {
    const av = avatarFor(agent && agent.kind)
    const inner = (
      <>
        <span className={`wf-avatar ${av.cls}`} aria-hidden="true">{av.emoji}</span>
        <span className="wf-time-launch-copy">
          <span className="wf-time-agent-name">{(agent && agent.name) || av.name}</span>
          <span className="wf-time-agent-task">{summary}</span>
          {unknownParent && <span className="wf-time-parent-note">Parent not recorded</span>}
          {!unknownParent && parent && parent !== mainAgentId && (
            <span className="wf-time-parent-note is-parent">Launched by {(parentAgent && parentAgent.name) || 'another helper'}</span>
          )}
          {span && !span.authoritativeEnd && (
            <span className="wf-time-end-note">
              {finalState.glyph} {finalState.label} · {agent && agent.state === 'running' ? 'no end yet' : 'end not recorded'}
            </span>
          )}
        </span>
      </>
    )
    content = canSelect ? (
      <button
        type="button"
        className={`wf-time-launch${selected ? ' is-selected' : ''}`}
        onClick={onSelect}
        aria-expanded={selected}
        aria-controls="wf-agent-inspector"
        aria-label={`${eventLabel(row, agent, mainAgentId)}. Open details.`}
      >
        {inner}
      </button>
    ) : <div className="wf-time-launch is-static">{inner}</div>
  } else if (row.type === 'agent_started') {
    content = <span className="wf-time-small-event">Started</span>
  } else if (row.type === 'agent_terminal') {
    content = (
      <span className={`wf-time-terminal-label ${state.cls}`}>
        {state.glyph} {state.label}{duration ? ` · ${duration}` : ''}
      </span>
    )
  } else {
    content = <span className="wf-time-small-event">{row.summary || 'Activity'}</span>
  }

  return (
    <li
      className={`wf-time-event is-${row.type}`}
      style={{ '--wf-y': `${row.y}px`, '--wf-x': `${xForLane(row.lane)}px`, '--wf-indent': `${depth * 12}px` }}
    >
      <time className="wf-time-clock" dateTime={row.at || undefined}>{time}</time>
      <div className="wf-time-event-body">
        {content}
      </div>
    </li>
  )
}

function TimelineDrawing({ model }) {
  const mainX = xForLane(0)
  const firstY = model.rows.length ? model.rows[0].y : 0
  const lastY = model.rows.length ? model.rows[model.rows.length - 1].y : firstY
  return (
    <svg
      className="wf-time-drawing"
      width={model.width}
      height={model.height}
      viewBox={`0 0 ${model.width} ${model.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {model.rows.length > 0 && <path className="wf-main-lifeline" d={`M ${mainX} ${firstY - 22} V ${lastY + 24}`} />}
      {model.spans.map((span) => {
        const x = xForLane(span.lane)
        const parentId = span.agent.parent_agent_id
        const parentLane = parentId ? model.laneByAgent.get(parentId) : 0
        const parentX = xForLane(parentLane == null ? 0 : parentLane)
        const unknownParent = !parentId || span.agent.ancestry_quality === 'unknown'
        const ragY = span.endY
        return (
          <g key={span.agent.agent_id}>
            <path className="wf-connector-under" d={`M ${parentX} ${span.startY} H ${x}`} />
            <path className={`wf-spawn-connector${unknownParent ? ' is-unknown' : ''}`} d={`M ${parentX} ${span.startY} H ${x}`} />
            <path className={`wf-agent-lifeline${span.authoritativeEnd ? '' : ' is-open'}`} d={`M ${x} ${span.startY} V ${span.endY}`} />
            <circle className="wf-agent-start-node" cx={x} cy={span.startY} r="5" />
            {span.authoritativeEnd
              ? <circle className={`wf-agent-end-node ${subStateMeta(span.terminal.state).cls}`} cx={x} cy={span.endY} r="5" />
              : <path className="wf-agent-ragged" d={`M ${x - 5} ${ragY - 3} l 5 3 l 5 -3 M ${x - 5} ${ragY + 4} l 5 3 l 5 -3`} />}
          </g>
        )
      })}
      {model.rows.filter((row) => row.type === 'main_checkpoint').map((row) => (
        <circle key={row.event_id} className="wf-main-event-node" cx={mainX} cy={row.y} r="5" />
      ))}
    </svg>
  )
}

function Inspector({ agent, model, storage, onClose }) {
  const [prompt, setPrompt] = useState(undefined)
  const headingRef = useRef(null)
  const dialogRef = useRef(null)
  const span = model.spansByAgent.get(agent.agent_id)
  const start = span && model.rows.find((row) => row.subject_agent_id === agent.agent_id
    && (row.type === 'agent_spawned' || row.type === 'agent_started'))
  const started = span && model.rows.find((row) => row.subject_agent_id === agent.agent_id
    && row.type === 'agent_started')
  const end = span && span.terminal
  const state = subStateMeta(agent.state)
  const parent = agent.parent_agent_id === model.mainAgentId
    ? 'Main agent'
    : agent.parent_agent_id
      ? ((model.agentsById.get(agent.parent_agent_id) || {}).name || 'Another helper')
      : 'Not recorded'
  const rawDuration = start && end ? formatDuration(start.at, end.at) : ''
  const duration = rawDuration && start.time_quality === 'exact' && end.time_quality === 'exact'
    ? rawDuration : rawDuration ? `~${rawDuration}` : ''

  useEffect(() => {
    let cancelled = false
    setPrompt(undefined)
    if (!storage || agent.prompt_available === false) { setPrompt(null); return undefined }
    storage.getJSON(`helpers/${agent.agent_id}.json`).then((doc) => {
      if (cancelled) return
      setPrompt(doc && typeof doc.brief_full === 'string' ? doc.brief_full.trim() : null)
    })
    return () => { cancelled = true }
  }, [agent.agent_id, agent.prompt_available, storage])

  useEffect(() => {
    const raf = requestAnimationFrame(() => headingRef.current && headingRef.current.focus())
    return () => cancelAnimationFrame(raf)
  }, [agent.agent_id])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((element) => !element.hidden)
      if (!focusable.length) { event.preventDefault(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === headingRef.current) {
        event.preventDefault(); first.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => dialog.removeEventListener('keydown', onKeyDown)
  }, [agent.agent_id, prompt])

  return (
    <div
      ref={dialogRef}
      className="wf-agent-inspector"
      id="wf-agent-inspector"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wf-inspector-title"
    >
      <header className="wf-inspector-head">
        <div>
          <div className="wf-flow-label">Helper details</div>
          <h2 id="wf-inspector-title" ref={headingRef} tabIndex={-1}>{agent.name || 'Helper'}</h2>
        </div>
        <button type="button" className="wf-inspector-close" onClick={onClose} aria-label="Close helper details">×</button>
      </header>
      <div className="wf-inspector-scroll">
        <p className="wf-inspector-task">{agent.task_summary}</p>
        <dl className="wf-inspector-facts">
          <div><dt>Status</dt><dd><span className={`wf-sub-state ${state.cls}`}>{state.glyph} {state.label}</span></dd></div>
          <div><dt>Launched by</dt><dd>{parent}</dd></div>
          {start && <div><dt>{start.type === 'agent_spawned' ? 'Launched' : 'Started'}</dt><dd><time dateTime={start.at || undefined}>{formatTimelineTime(start.at, start.time_quality)}</time></dd></div>}
          {started && started !== start && <div><dt>Started</dt><dd><time dateTime={started.at || undefined}>{formatTimelineTime(started.at, started.time_quality)}</time></dd></div>}
          {end && <div><dt>Finished</dt><dd><time dateTime={end.at || undefined}>{formatTimelineTime(end.at, end.time_quality)}</time></dd></div>}
          {duration && <div><dt>Duration</dt><dd>{duration}</dd></div>}
          {!end && agent.state !== 'running' && <div><dt>Finished</dt><dd>End time not recorded</dd></div>}
          {agent.timing_conflict && <div><dt>Timing</dt><dd>Recorded times conflict</dd></div>}
        </dl>
        {agent.outcome_summary && <section className="wf-inspector-section"><h3>Outcome</h3><p>{agent.outcome_summary}</p></section>}
        <section className="wf-inspector-section">
          <h3>Full prompt</h3>
          {prompt === undefined
            ? <div className="wf-prompt-loading" role="status">Loading full prompt…</div>
            : prompt
              ? <Markdown text={prompt} />
              : <div className="wf-prompt-loading">Prompt unavailable.</div>}
        </section>
      </div>
    </div>
  )
}

export function Timeline({ timeline, turns, store, storage }) {
  const model = useMemo(() => layoutTimeline(timeline, turns), [timeline, turns])
  const [selectedId, setSelectedId] = useState(() => store && store.selectedAgentId || null)
  const triggerRef = useRef(null)
  const timelineRef = useRef(null)
  const selected = selectedId && model.agentsById.get(selectedId)
  const omittedAgents = model.retention.agents_omitted
  const omittedEvents = model.retention.events_omitted

  useEffect(() => {
    if (selectedId && !model.agentsById.has(selectedId)) {
      setSelectedId(null)
      if (store) store.selectedAgentId = null
      triggerRef.current = null
      requestAnimationFrame(() => timelineRef.current && timelineRef.current.focus())
    }
  }, [model, selectedId])

  useEffect(() => {
    if (!selected) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') closeInspector() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [selected])

  const selectAgent = (agentId, trigger) => {
    triggerRef.current = trigger
    setSelectedId(agentId)
    if (store) store.selectedAgentId = agentId
  }
  const closeInspector = () => {
    setSelectedId(null)
    if (store) store.selectedAgentId = null
    const trigger = triggerRef.current
    const destination = trigger && trigger.isConnected ? trigger : timelineRef.current
    requestAnimationFrame(() => destination && destination.focus())
  }

  if (!model.rows.length) return null
  return (
    <>
      <section ref={timelineRef} className="wf-time-section" aria-label="Chronological agent timeline" tabIndex={-1}>
        <div className="wf-time-summary">
          {model.agents.length
            ? `${model.agents.length} helper${model.agents.length === 1 ? '' : 's'} · up to ${model.maxLane} at once`
            : 'Main agent only'}
          {omittedAgents > 0 && ` · ${omittedAgents} earlier helper${omittedAgents === 1 ? '' : 's'} omitted`}
          {omittedEvents > 0 && ` · ${omittedEvents} lower-level event${omittedEvents === 1 ? '' : 's'} omitted`}
        </div>
        <div className="wf-time-scroll" tabIndex={model.maxLane > 3 ? 0 : undefined} aria-label={model.maxLane > 3 ? 'Scrollable workflow lanes' : undefined}>
          <div className="wf-time-canvas" style={{ width: `${model.width}px`, height: `${model.height}px` }}>
            <TimelineDrawing model={model} />
            <ol className="wf-time-events">
              {model.rows.map((row) => {
                const agent = model.agentsById.get(row.subject_agent_id)
                const parentAgent = agent && agent.parent_agent_id
                  ? model.agentsById.get(agent.parent_agent_id) : null
                const span = model.spansByAgent.get(row.subject_agent_id)
                return (
                  <EventCard
                    key={row.event_id}
                    row={row}
                    agent={agent}
                    parentAgent={parentAgent}
                    mainAgentId={model.mainAgentId}
                    span={span}
                    selected={selectedId === row.subject_agent_id}
                    onSelect={(event) => selectAgent(row.subject_agent_id, event.currentTarget)}
                  />
                )
              })}
            </ol>
          </div>
        </div>
      </section>
      {selected && (
        <>
          <button type="button" className="wf-inspector-backdrop" onClick={closeInspector} tabIndex={-1} aria-hidden="true" />
          <Inspector agent={selected} model={model} storage={storage} onClose={closeInspector} />
        </>
      )}
    </>
  )
}
