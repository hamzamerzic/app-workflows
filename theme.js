// Workflows stylesheet — the single app <style> string, rendered once at the
// app root. Class prefix is `wf-`. Structural colours are theme tokens so light
// and dark both work; the app follows the owner's `--accent` rather than
// committing its own brand hue. The one hardcode is the amber "working" status,
// a semantic state colour the theme has no token for. Shared chrome blocks are
// fenced with `mobius-ui:*` markers for a future library harvest; app-specific
// blocks (rows, helper cards, phases, steps) stay unfenced below.

export const CSS = `
/* mobius-ui:Focus — app-owned; a future-library candidate (no sync owed). Required once per app. */
:where(button, a, input, textarea, select, summary, [role="button"],
       [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
/* /mobius-ui:Focus */

/* mobius-ui:ReducedMotion — app-owned; a future-library candidate (no sync owed). Required once per app. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
/* /mobius-ui:ReducedMotion */

@keyframes wf-spin { to { transform: rotate(360deg); } }
@keyframes wf-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.35; }
}
@keyframes wf-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.wf-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* mobius-ui:AppShell — app-owned; a future-library candidate (no sync owed).
   Pinned header + an independently scrolling body. Keep the ".wf-scroll > *"
   flex-shrink:0 rule — without it a small-min-content child gets crushed. */
.wf-root {
  position: relative; display: flex; flex-direction: column;
  height: 100%; width: 100%; max-width: 100%; overflow: hidden;
  padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right);
  background: var(--bg); color: var(--text); font-family: var(--font);
}
.wf-scroll {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden;
  padding: 14px 16px calc(36px + env(safe-area-inset-bottom));
  display: flex; flex-direction: column; gap: 10px;
  word-break: break-word; overflow-wrap: anywhere;
}
.wf-scroll > * { flex-shrink: 0; }
/* /mobius-ui:AppShell */

/* mobius-ui:Scrollskin — app-owned; a future-library candidate (no sync owed). */
.wf-scroll::-webkit-scrollbar { width: 9px; height: 9px; }
.wf-scroll::-webkit-scrollbar-thumb {
  background: var(--border); border-radius: 999px;
  border: 2px solid transparent; background-clip: padding-box;
}
.wf-scroll::-webkit-scrollbar-thumb:hover { background: var(--muted); background-clip: padding-box; }
.wf-scroll::-webkit-scrollbar-track { background: transparent; }
/* /mobius-ui:Scrollskin */

/* mobius-ui:Header — app-owned; a future-library candidate (no sync owed). */
.wf-header {
  flex: 0 0 auto; display: flex; align-items: center; gap: 11px;
  min-height: 52px;
  padding: max(12px, env(safe-area-inset-top)) 14px 12px;
  background: var(--surface); border-bottom: 1px solid var(--border);
}
.wf-brand { display: flex; align-items: center; gap: 11px; min-width: 0; flex: 1 1 auto; }
.wf-mark {
  flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 800; letter-spacing: -0.03em;
  background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent);
}
.wf-brand-icon { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px; object-fit: cover; }
.wf-heading { min-width: 0; }
.wf-title {
  margin: 0; font-size: 18px; font-weight: 750; letter-spacing: -0.02em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wf-title-sm { font-size: 16px; }
.wf-subtitle {
  display: block; margin-top: 1px; font-size: 12px; color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wf-header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
/* /mobius-ui:Header */

.wf-status-text {
  font-size: 11.5px; color: var(--muted); white-space: nowrap;
  max-width: 42vw; overflow: hidden; text-overflow: ellipsis;
}

/* mobius-ui:Button — app-owned; a future-library candidate (no sync owed). */
.wf-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 44px; padding: 9px 15px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
  font-family: var(--font); font-size: 14px; font-weight: 600; cursor: pointer;
  transition: background .14s ease, border-color .14s ease, transform .1s ease;
}
.wf-btn:active { transform: scale(0.97); }
.wf-btn:disabled { opacity: 0.5; cursor: default; }
.wf-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.wf-btn-ghost { background: transparent; border-color: transparent; color: var(--accent); padding: 9px 10px; }
.wf-btn-ghost:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
/* /mobius-ui:Button */

.wf-icon-btn {
  flex: 0 0 auto; width: 40px; height: 40px; display: inline-flex;
  align-items: center; justify-content: center; border-radius: 10px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
  font-size: 19px; line-height: 1; cursor: pointer;
  transition: background .14s ease, transform .1s ease;
}
.wf-icon-btn:hover { background: var(--surface2, var(--surface)); }
.wf-icon-btn:active { transform: scale(0.94); }
.wf-icon-btn:disabled { opacity: 0.55; cursor: default; }
.wf-icon-btn .wf-refresh-glyph { display: inline-block; }
.wf-icon-btn.is-spinning .wf-refresh-glyph { animation: wf-spin 0.9s linear infinite; }

.wf-back {
  flex: 0 0 auto; width: 40px; height: 40px; display: inline-flex;
  align-items: center; justify-content: center; border-radius: 10px;
  border: 1px solid transparent; background: transparent; color: var(--text);
  font-size: 26px; line-height: 1; cursor: pointer; margin-left: -4px;
  transition: background .14s ease, transform .1s ease;
}
.wf-back:hover { background: var(--surface2, var(--surface)); }
.wf-back:active { transform: scale(0.94); }

/* Provider chip -------------------------------------------------------------*/
.wf-chip {
  flex: 0 0 auto; display: inline-flex; align-items: center; height: 18px;
  padding: 0 7px; border-radius: 6px; font-size: 10px; font-weight: 800;
  letter-spacing: 0.06em; font-family: var(--mono, var(--font));
  border: 1px solid var(--border); color: var(--muted); background: transparent;
}
.wf-chip.is-claude {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.wf-chip.is-codex {
  color: var(--text);
  border-color: color-mix(in srgb, var(--text) 26%, var(--border));
  background: color-mix(in srgb, var(--text) 7%, transparent);
}

/* Status dot ----------------------------------------------------------------*/
.wf-dot {
  flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%;
  background: var(--muted); box-sizing: border-box;
}
.wf-dot.is-finished { background: var(--green); }
.wf-dot.is-working { background: #f5a623; animation: wf-pulse 1.6s ease-in-out infinite; }
.wf-dot.is-failed { background: var(--danger); }
.wf-dot.is-stopped { background: var(--muted); }
.wf-dot.is-unavailable { background: transparent; border: 1.5px solid var(--border); }

/* mobius-ui:SectionHead — app-owned; a future-library candidate (no sync owed). */
.wf-section-head { display: flex; align-items: baseline; gap: 8px; margin: 12px 2px 2px; }
.wf-section-label {
  margin: 0; font-size: 11.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--muted);
}
/* /mobius-ui:SectionHead */

/* Chat rows (Home) ----------------------------------------------------------*/
.wf-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.wf-row {
  position: relative; display: flex; flex-direction: column;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  overflow: hidden; animation: wf-rise 0.22s ease both;
}
.wf-row-main {
  display: flex; flex-direction: column; gap: 8px; text-align: left;
  padding: 13px 15px 11px; border: 0; background: transparent; color: inherit;
  font: inherit; cursor: pointer; width: 100%;
  transition: background .14s ease;
}
.wf-row-main:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
.wf-row-main:active { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.wf-row-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wf-row-title {
  min-width: 0; font-size: 15.5px; font-weight: 650; letter-spacing: -0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wf-row-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wf-row-rollup { font-size: 13px; color: var(--text); }
.wf-row-sep { color: var(--border); }
.wf-row-time { font-size: 12.5px; color: var(--muted); }
.wf-row-tokens {
  margin-left: auto; font-size: 11px; color: var(--muted);
  font-family: var(--mono, var(--font)); white-space: nowrap;
}
.wf-row-open {
  align-self: flex-start; margin: 0 8px 10px; min-height: 34px;
  padding: 5px 12px; border-radius: 8px; border: 1px solid var(--border);
  background: transparent; color: var(--accent); font: inherit; font-size: 12.5px;
  font-weight: 600; cursor: pointer; transition: background .14s ease, transform .1s ease;
}
.wf-row-open:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.wf-row-open:active { transform: scale(0.97); }

/* A muted informational row (Codex empty hint, unlinked reason) --------------*/
.wf-muted-row {
  display: flex; align-items: center; gap: 10px; padding: 13px 15px;
  background: var(--surface); border: 1px dashed var(--border); border-radius: 14px;
  color: var(--muted); font-size: 13px;
}
.wf-muted-row .wf-chip { opacity: 0.85; }

/* Unlinked work item --------------------------------------------------------*/
.wf-unlinked {
  display: flex; flex-direction: column; gap: 5px; padding: 12px 15px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
}
.wf-unlinked-top { display: flex; align-items: center; gap: 8px; }
.wf-unlinked-reason { font-size: 14px; color: var(--text); }
.wf-unlinked-meta { font-size: 12px; color: var(--muted); }

/* Helper detail — goal, steps, report --------------------------------------*/
.wf-goal {
  font-size: 16px; line-height: 1.45; font-weight: 600; letter-spacing: -0.01em;
  color: var(--text); padding: 2px 2px 4px;
}
.wf-steps { display: flex; flex-direction: column; gap: 2px; padding: 2px 0; }
.wf-step {
  display: flex; gap: 11px; padding: 9px 2px; border-bottom: 1px solid var(--border);
}
.wf-step:last-child { border-bottom: 0; }
.wf-step-glyph {
  flex: 0 0 auto; width: 18px; text-align: center; font-size: 12px; line-height: 1.5;
  color: var(--muted);
}
.wf-step-glyph.is-tool { color: var(--accent); }
.wf-step-body { min-width: 0; flex: 1 1 auto; }
.wf-step-title { font-size: 13.5px; font-weight: 600; color: var(--text); }
.wf-step-detail {
  margin-top: 2px; font-size: 12.5px; line-height: 1.5; color: var(--muted);
  white-space: pre-wrap;
}

.wf-report { display: flex; flex-direction: column; gap: 8px; }
.wf-report-p { font-size: 14px; line-height: 1.6; color: var(--text); margin: 0; }
.wf-report-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.wf-report-li { font-size: 14px; line-height: 1.55; color: var(--text); }
.wf-code {
  font-family: var(--mono, monospace); font-size: 0.88em;
  padding: 1px 5px; border-radius: 5px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

.wf-note {
  display: flex; gap: 8px; padding: 10px 12px; border-radius: 10px;
  font-size: 12.5px; line-height: 1.5; color: var(--muted);
  background: color-mix(in srgb, var(--text) 5%, transparent); border: 1px solid var(--border);
}
.wf-note.is-expired {
  color: var(--text);
  border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
  background: color-mix(in srgb, var(--danger) 8%, transparent);
}
/* A status we corrected against the recorded evidence. Warm rather than red:
   the helper failing is the finding, and the correction itself is a note about
   provenance, not a second alarm competing with the failed dot beside it. */
.wf-note.is-corrected {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.wf-handback-note {
  margin: 0 0 10px; font-size: 13px; line-height: 1.55; color: var(--text);
  padding-left: 10px; border-left: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
}

/* mobius-ui:Empty — app-owned; a future-library candidate (no sync owed). */
.wf-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; gap: 9px; flex: 1 0 auto; min-height: 58dvh; max-width: 420px;
  margin: 0 auto; padding: 44px 24px; color: var(--muted);
}
.wf-empty-mark {
  width: 62px; height: 62px; margin-bottom: 6px; border-radius: 18px; display: flex;
  align-items: center; justify-content: center; font-size: 28px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.wf-empty-title { font-size: 17px; font-weight: 700; color: var(--text); }
.wf-empty-text { margin: 0; font-size: 14px; line-height: 1.6; }
.wf-empty-actions { margin-top: 6px; }
/* /mobius-ui:Empty */

/* mobius-ui:Spinner — app-owned; a future-library candidate (no sync owed). */
.wf-loading {
  flex: 1 0 auto; min-height: 40dvh; display: flex; align-items: center; justify-content: center;
}
.wf-spinner {
  width: 26px; height: 26px; border-radius: 50%;
  border: 2.5px solid color-mix(in srgb, var(--accent) 18%, transparent); border-top-color: var(--accent);
  animation: wf-spin 0.8s linear infinite;
}
@media (prefers-reduced-motion: reduce) { .wf-spinner { animation: none; } }
/* /mobius-ui:Spinner */

/* mobius-ui:SyncPill — app-owned; a future-library candidate (no sync owed).
   SILENT WHEN HEALTHY: mounted only while offline; plain "Offline" text. */
.wf-sync-pill {
  position: absolute; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom)); z-index: 40;
  display: inline-flex; align-items: center; padding: 6px 12px; border-radius: 999px;
  background: var(--surface); border: 1px solid var(--border); color: var(--muted);
  font-size: 11px; font-weight: 600; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}
/* /mobius-ui:SyncPill */

/* ===== Timeline (the chat view) — a git-graph of turns ===================== */
.wf-tl-root { display: flex; flex-direction: column; gap: 22px; padding: 14px 14px 40px; }

.wf-tl-legend {
  display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center;
  padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px;
  background: var(--surface); font-size: 12.5px; color: var(--muted);
}
.wf-tl-lg { display: inline-flex; align-items: center; gap: 6px; }
.wf-tl-lg b { color: var(--text); }
.wf-tl-g { width: 15px; height: 15px; flex: 0 0 auto; }

.wf-tl-turn {
  border: 1px solid var(--border); border-radius: 16px; overflow: hidden;
  background: var(--surface); animation: wf-rise 0.22s ease both;
}
.wf-tl-meta {
  display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 14px 0;
}
.wf-tl-pill {
  font-size: 11px; color: var(--muted); background: var(--surface2, var(--surface));
  border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px;
}
.wf-tl-pill b { color: var(--text); font-variant-numeric: tabular-nums; }

.wf-tl-body { position: relative; padding: 12px 14px 14px; }
.wf-tl-rail {
  position: absolute; left: 14px; top: 12px; pointer-events: none; overflow: visible;
}
.wf-tl-rows { display: flex; flex-direction: column; }

.wf-tl-row {
  display: block; width: 100%; text-align: left; appearance: none;
  background: none; border: 0; color: inherit; font: inherit;
  padding: 9px 6px 9px 6px; min-height: 40px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
}
.wf-tl-rows > .wf-tl-row:last-child { border-bottom: 0; }
.wf-tl-row.is-tap { cursor: pointer; }
.wf-tl-row.is-tap:hover { background: color-mix(in srgb, var(--text) 4%, transparent); }
.wf-tl-row.is-tap:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 8px; }

.wf-tl-rk {
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
  font-weight: 700; color: var(--muted);
  display: flex; align-items: center; gap: 6px;
}
.wf-tl-car { font-size: 10px; color: var(--muted); }
.wf-tl-sum { font-size: 13.5px; color: var(--text); margin-top: 2px; }
.wf-tl-sum b { font-weight: 650; }
.wf-tl-txt { font-size: 13.5px; line-height: 1.5; color: var(--text); margin-top: 3px; }
.wf-tl-txt.is-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wf-tl-note.is-final .wf-tl-txt { color: var(--text); }

.wf-tl-desc { font-size: 14px; font-weight: 640; color: var(--text); margin-top: 2px; line-height: 1.35; overflow-wrap: anywhere; }
.wf-tl-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.wf-tl-chip {
  font-size: 10.5px; color: var(--muted); background: var(--surface2, var(--surface));
  border: 1px solid var(--border); border-radius: 6px; padding: 1px 7px;
}
.wf-tl-chip.is-agent { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
.wf-tl-chip.is-mono { font-family: var(--mono, monospace); }
.wf-tl-state { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12.5px; font-weight: 600; }
.wf-tl-state.is-merged { color: var(--green); }
.wf-tl-state.is-detached { color: var(--working, #f5a623); }
.wf-tl-state.is-failed { color: var(--danger); }
.wf-tl-state.is-stopped { color: var(--muted); }

.wf-tl-detail { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.wf-tl-peeks { display: flex; flex-direction: column; gap: 4px; }
.wf-tl-peek {
  font-family: var(--mono, monospace); font-size: 11.5px; color: var(--muted);
  background: var(--surface2, var(--surface)); border-radius: 7px; padding: 5px 8px;
  overflow-wrap: anywhere;
}
.wf-tl-tally { display: flex; flex-wrap: wrap; gap: 5px; }
.wf-tl-tchip { font-size: 11px; color: var(--muted); }
.wf-tl-tchip b { color: var(--text); }

.wf-tl-trunc { padding: 8px 14px 12px; font-size: 12px; color: var(--muted); }
.wf-tl-foot { font-size: 12px; color: var(--muted); padding: 0 4px; }

/* SVG rail strokes */
.wf-tl-trunk { stroke: var(--border); stroke-width: 2.4; fill: none; stroke-linecap: round; }
.wf-tl-peel { fill: none; stroke-width: 2.4; stroke-linecap: round; }
.wf-tl-run { fill: none; stroke-width: 2.4; stroke-linecap: round; }
.wf-tl-peel.mode-returned { stroke: var(--green); }
.wf-tl-peel.mode-launched, .wf-tl-run.mode-launched { stroke: var(--working, #f5a623); stroke-dasharray: 2 4.5; }
.wf-tl-peel.mode-failed, .wf-tl-run.mode-failed { stroke: var(--danger); stroke-dasharray: 2 4.5; }
.wf-tl-peel.mode-stopped, .wf-tl-run.mode-stopped { stroke: var(--muted); stroke-dasharray: 2 4.5; }
.wf-tl-arrow { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.wf-tl-arrow.mode-launched { stroke: var(--working, #f5a623); }
.wf-tl-deadend { fill: none; stroke-width: 2.6; stroke-linecap: round; }
.wf-tl-deadend.mode-failed { stroke: var(--danger); }
.wf-tl-deadend.mode-stopped { stroke: var(--muted); }
.wf-tl-fork { fill: var(--border); }
.wf-tl-merge { fill: var(--green); }

@media (prefers-reduced-motion: reduce) { .wf-tl-turn { animation: none; } }
`
