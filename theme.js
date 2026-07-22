// Workflows stylesheet — the single app <style> string, rendered once at the
// app root. Class prefix is `wf-`. The app follows the owner's theme tokens
// (--surface / --text / --accent / --border …) rather than committing its own
// brand hue, so light and dark both work; on top of those it derives a small
// surface hierarchy (--wf-s2/--wf-s3/--wf-line2) and the three semantic status
// hues the theme has no token for — done (green), attention (amber), running
// (blue) — the same ambient-status language as the redesign mockup.

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
  0%, 100% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--wf-run) 34%, transparent); }
  50% { box-shadow: 0 0 0 3px transparent; }
}
.wf-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* mobius-ui:AppShell — app-owned; a future-library candidate (no sync owed).
   Pinned header + an independently scrolling body. Keep the ".wf-scroll > *"
   flex-shrink:0 rule — without it a small-min-content child gets crushed.
   The derived tokens live here so every descendant resolves them. */
.wf-root {
  --wf-s2: color-mix(in srgb, var(--text) 4%, var(--surface));
  --wf-s3: color-mix(in srgb, var(--text) 8%, var(--surface));
  --wf-line2: color-mix(in srgb, var(--text) 16%, var(--border));
  --wf-faint: var(--muted);
  --wf-link: color-mix(in srgb, var(--accent) 35%, var(--text));
  --wf-accent-soft: color-mix(in srgb, var(--accent) 15%, transparent);
  --wf-done: var(--green, #3f9a5a);
  --wf-done-soft: color-mix(in srgb, var(--green, #3f9a5a) 15%, transparent);
  --wf-attn: var(--working, #d39a1a);
  --wf-attn-soft: color-mix(in srgb, var(--working, #d39a1a) 17%, transparent);
  --wf-run: #4f83d6;
  --wf-run-soft: color-mix(in srgb, #4f83d6 16%, transparent);

  position: relative; display: flex; flex-direction: column;
  height: 100%; width: 100%; max-width: 100%; overflow: hidden;
  padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right);
  background: var(--bg); color: var(--text); font-family: var(--font);
}
.wf-root :where(button, summary) {
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.wf-scroll {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden;
  padding: 0 0 calc(30px + env(safe-area-inset-bottom));
  display: flex; flex-direction: column;
  word-break: break-word; overflow-wrap: anywhere;
}
.wf-scroll > * { flex-shrink: 0; }
.wf-content { width: 100%; max-width: 760px; margin-inline: auto; }
/* /mobius-ui:AppShell */

/* mobius-ui:Header — app-owned; a future-library candidate (no sync owed).
   The flex shell already pins this above the scroll, so no sticky is needed. */
.wf-header {
  flex: 0 0 auto; display: flex; align-items: center; gap: 11px;
  min-height: 52px;
  padding: max(11px, env(safe-area-inset-top)) 16px 11px;
  background: var(--surface); border-bottom: 1px solid var(--border);
}
.wf-brand { display: flex; align-items: center; gap: 11px; min-width: 0; flex: 1 1 auto; }
.wf-mark {
  flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 800; letter-spacing: -0.03em; color: #2b1b00;
  background: linear-gradient(150deg, #f3d488, #b5811f);
  box-shadow: inset 0 1px 1px rgba(255,255,255,.5), 0 1px 2px rgba(120,80,0,.3);
}
.wf-brand-icon { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px; object-fit: cover; }
.wf-heading { min-width: 0; }
.wf-title {
  margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wf-subtitle {
  display: block; margin-top: 1px; font-size: 11.5px; color: var(--muted); letter-spacing: 0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wf-header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
/* /mobius-ui:Header */

.wf-status-text {
  font-size: 11.5px; color: var(--muted); white-space: nowrap;
  max-width: 42vw; overflow: hidden; text-overflow: ellipsis;
}

/* A text back-link — "‹ Activity" / "‹ Back". */
.wf-back-text {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px;
  min-height: 44px; padding: 6px 10px 6px 2px; margin-left: -2px;
  appearance: none; border: 0; background: none; color: var(--wf-link);
  font: inherit; font-size: 15px; cursor: pointer; border-radius: 8px;
}
.wf-back-text:hover { color: var(--text); text-decoration: underline; }
.wf-spacer { flex: 1 1 auto; }

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
/* /mobius-ui:Button */

.wf-icon-btn {
  flex: 0 0 auto; width: 44px; height: 44px; display: inline-flex;
  align-items: center; justify-content: center; border-radius: 10px;
  border: 0; background: none; color: var(--muted);
  font-size: 18px; line-height: 1; cursor: pointer;
  transition: color .14s ease, transform .1s ease;
}
.wf-icon-btn:hover { color: var(--text); }
.wf-icon-btn:active { transform: scale(0.94); }
.wf-icon-btn:disabled { opacity: 0.55; cursor: default; }
.wf-icon-btn .wf-refresh-glyph { display: inline-block; }
.wf-icon-btn.is-spinning .wf-refresh-glyph { animation: wf-spin 0.9s linear infinite; }

/* ===== Journal (Home) ====================================================== */

/* Needs-you filter — mounted only when something needs attention. */
.wf-needs {
  display: flex; align-items: center; gap: 10px; width: auto;
  margin: 14px 14px 4px; padding: 11px 13px; border-radius: 15px;
  text-align: left; appearance: none; font: inherit; cursor: pointer;
  background: var(--wf-attn-soft);
  border: 1px solid color-mix(in srgb, var(--wf-attn) 34%, transparent);
}
.wf-needs:active { transform: scale(0.99); }
.wf-needs-ic {
  flex: 0 0 auto; width: 24px; height: 24px; border-radius: 7px;
  display: grid; place-items: center; font-size: 13px; font-weight: 700;
  background: var(--wf-attn); color: #2b1b00;
}
.wf-needs-tx { display: flex; flex-direction: column; min-width: 0; }
.wf-needs-head { font-size: 13px; font-weight: 600; color: var(--text); }
.wf-needs-sub {
  font-size: 11.5px; color: var(--muted); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 62vw;
}
.wf-needs-go { margin-left: auto; color: var(--text); font-size: 16px; flex: 0 0 auto; }

.wf-daylabel {
  margin: 0; font-size: 12.5px; font-weight: 700; color: var(--muted);
  padding: 20px 20px 8px;
}
.wf-daylabel .wf-restored {
  color: var(--wf-link); font-weight: 700;
}

.wf-entry {
  display: block; width: calc(100% - 28px); text-align: left; appearance: none; font: inherit;
  margin: 0 14px 9px; padding: 13px 14px; border-radius: 16px; cursor: pointer;
  background: var(--surface); border: 1px solid var(--border);
  transition: transform .08s ease, border-color .15s ease; position: relative; overflow: hidden;
  content-visibility: auto; contain-intrinsic-size: auto 94px;
}
.wf-entry:active { transform: scale(0.986); }
.wf-entry:hover { border-color: var(--wf-line2); }
.wf-entry.is-reco { border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
.wf-entry-title {
  display: flex; gap: 7px; align-items: flex-start;
  font-size: 14.5px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.34; color: var(--text);
}
.wf-entry-context {
  display: -webkit-box; margin: 5px 0 0 16px; overflow: hidden;
  color: var(--muted); font-size: 12px; line-height: 1.4;
  -webkit-box-orient: vertical; -webkit-line-clamp: 2;
}
.wf-stat { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; margin-top: 5px; background: var(--muted); }
.wf-stat.done { background: var(--wf-done); }
.wf-stat.attn { background: var(--wf-attn); box-shadow: 0 0 0 3px var(--wf-attn-soft); }
.wf-stat.run { background: var(--wf-run); animation: wf-pulse 1.8s ease-in-out infinite; }
.wf-entry-meta {
  margin-top: 7px; font-size: 12px; color: var(--muted);
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
}
.wf-result { color: var(--muted); }
.wf-tasks { margin-left: auto; font-size: 11.5px; color: var(--muted); white-space: nowrap; }

/* Pills + separator dot — shared by journal entries and turn meta. */
.wf-pill {
  font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  background: var(--wf-s3); color: var(--muted);
}
.wf-pill.is-reco { background: var(--wf-accent-soft); color: var(--wf-link); }
.wf-sep { width: 3px; height: 3px; border-radius: 50%; background: var(--wf-line2); flex: 0 0 auto; }

/* ===== Layered workflow timeline ========================================== */

.wf-openchat {
  flex: 0 0 auto; appearance: none; font: inherit; font-weight: 600; font-size: 12.5px;
  min-height: 44px; padding: 7px 10px; border-radius: 9px; cursor: pointer;
  border: 0; background: transparent; color: var(--wf-link);
}
.wf-openchat:hover { background: var(--wf-s2); }
.wf-openchat:active { transform: scale(0.97); }

.wf-scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.wf-flow { width: 100%; max-width: 760px; margin-inline: auto; padding: 20px 18px 48px; }
.wf-flow-label { font-size: 11px; font-weight: 700; color: var(--muted); }
.wf-root-task { position: relative; padding: 2px 0 28px 34px; }
.wf-root-task::after {
  content: ""; position: absolute; left: 8px; top: 18px; bottom: -1px;
  width: 2px; background: var(--wf-line2);
}
.wf-root-node {
  position: absolute; left: 0; top: 3px; z-index: 2; width: 18px; height: 18px;
  border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--bg);
}
.wf-root-body { min-width: 0; }
.wf-chat-title {
  max-width: 68ch; margin: 5px 0 0; font-size: 19px; font-weight: 700;
  letter-spacing: -0.02em; line-height: 1.28; text-wrap: balance; color: var(--text);
}
.wf-chat-meta, .wf-turn-meta {
  margin-top: 8px; font-size: 11.5px; color: var(--muted);
  display: flex; gap: 7px; align-items: center; flex-wrap: wrap;
}
.wf-chat-meta .wf-sub-state { margin-left: 2px; }

.wf-prompt { margin-top: 10px; }
.wf-prompt-sum {
  width: max-content; min-height: 44px; display: flex; align-items: center; gap: 6px;
  list-style: none; cursor: pointer; color: var(--wf-link); font-size: 12px; font-weight: 650;
}
.wf-prompt-sum::-webkit-details-marker, .wf-branch-summary::-webkit-details-marker { display: none; }
.wf-cx, .wf-branch-chevron { display: inline-block; transition: transform .16s ease; }
.wf-prompt[open] .wf-cx, .wf-branch-detail[open] .wf-branch-chevron { transform: rotate(90deg); }
.wf-prompt-body {
  max-width: 70ch; margin-top: 4px; padding: 12px 14px; border-radius: 10px;
  background: var(--wf-s2); color: var(--text); font-size: 12.5px; line-height: 1.55;
}

.wf-timeline { position: relative; }
.wf-flow-turn {
  position: relative; padding: 8px 0 26px 34px;
  content-visibility: auto; contain-intrinsic-size: auto 180px;
}
.wf-flow-turn::before {
  content: ""; position: absolute; left: 8px; top: 0; bottom: -1px;
  width: 2px; background: var(--wf-line2);
}
.wf-flow-turn:last-child::before { bottom: calc(100% - 19px); }
.wf-flow-node {
  position: absolute; left: 2px; top: 12px; z-index: 2; width: 14px; height: 14px;
  border-radius: 50%; background: var(--wf-done); border: 3px solid var(--bg);
  box-shadow: 0 0 0 2px var(--wf-done);
}
.wf-flow-node.run { background: var(--wf-run); box-shadow: 0 0 0 2px var(--wf-run); }
.wf-flow-node.failed { background: var(--danger, #c0392b); box-shadow: 0 0 0 2px var(--danger, #c0392b); }
.wf-flow-node.stopped, .wf-flow-node.unknown { background: var(--wf-attn); box-shadow: 0 0 0 2px var(--wf-attn); }
.wf-turn-main { min-width: 0; }
.wf-toutcome {
  font-size: 14px; font-weight: 650; letter-spacing: -0.01em;
  line-height: 1.4; color: var(--text);
}
.wf-turn-note {
  max-width: 66ch; margin-top: 8px; color: var(--muted); font-size: 12px; line-height: 1.45;
}

.wf-branch-list { margin-top: 13px; display: flex; flex-direction: column; gap: 7px; }
.wf-branch {
  position: relative; margin-left: calc(var(--wf-branch-depth, 0) * 18px);
  padding-left: 18px; content-visibility: auto; contain-intrinsic-size: auto 72px;
}
.wf-branch-line {
  position: absolute; left: -26px; top: 23px; width: 38px; height: 12px;
  border-top: 1px solid var(--wf-line2); border-left: 1px solid var(--wf-line2);
  border-radius: 7px 0 0 0;
}
.wf-branch-detail { margin: 0; }
.wf-branch-summary {
  min-height: 50px; display: flex; align-items: center; gap: 9px; list-style: none;
  padding: 8px 10px; border-radius: 11px; cursor: pointer; background: var(--surface);
  transition: background .15s ease;
}
.wf-branch-summary:hover { background: var(--wf-s2); }
.wf-branch-summary.is-static { cursor: default; }
.wf-avatar {
  flex: 0 0 auto; width: 26px; height: 26px; border-radius: 8px;
  display: grid; place-items: center; font-size: 14px; background: var(--wf-s3);
}
.wf-avatar.explore { background: color-mix(in srgb, #4f83d6 16%, var(--surface)); }
.wf-avatar.codex { background: color-mix(in srgb, #8a63d6 16%, var(--surface)); }
.wf-avatar.build { background: color-mix(in srgb, var(--green, #3f9a5a) 16%, var(--surface)); }
.wf-branch-copy { min-width: 0; display: flex; flex: 1 1 auto; flex-direction: column; gap: 2px; }
.wf-branch-name { font-size: 11px; font-weight: 650; color: var(--muted); }
.wf-branch-ask { font-size: 13px; font-weight: 550; line-height: 1.35; color: var(--text); }
.wf-sub-state {
  flex: 0 0 auto; font-size: 10.5px; font-weight: 650;
  padding: 3px 8px; border-radius: 999px; display: inline-flex; gap: 4px; align-items: center;
  background: var(--wf-s3); color: var(--muted);
}
.wf-sub-state.done { background: var(--wf-done-soft); color: var(--text); }
.wf-sub-state.run { background: var(--wf-run-soft); color: var(--text); }
.wf-sub-state.failed { background: color-mix(in srgb, var(--danger, #c0392b) 15%, transparent); color: var(--text); }
.wf-sub-state.stopped { background: var(--wf-s3); color: var(--muted); }
.wf-sub-state.unknown { background: var(--wf-s3); color: var(--muted); }
.wf-branch-chevron { color: var(--muted); font-size: 15px; }
.wf-branch-prompt {
  margin: 5px 0 4px; padding: 12px 12px 13px; border-radius: 10px;
  background: var(--wf-s2); color: var(--text); font-size: 12.5px; line-height: 1.55;
}
.wf-branch-prompt .wf-flow-label { margin-bottom: 7px; }
.wf-prompt-loading { color: var(--muted); font-size: 12px; }
@media (max-width: 520px) {
  .wf-flow { padding-inline: 14px; }
  .wf-root-task, .wf-flow-turn { padding-left: 28px; }
  .wf-root-task::after, .wf-flow-turn::before { left: 7px; }
  .wf-root-node { left: 0; width: 16px; height: 16px; }
  .wf-flow-node { left: 1px; }
  .wf-branch { padding-left: 12px; margin-left: calc(var(--wf-branch-depth, 0) * 10px); }
  .wf-branch-line { left: -21px; width: 29px; }
  .wf-branch-summary { align-items: flex-start; }
  .wf-sub-state { margin-top: 1px; }
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
  background: var(--wf-accent-soft);
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

/* Markdown-lite rendering for expanded root and helper prompts. */
.wf-md { display: flex; flex-direction: column; gap: 6px; }
.wf-md-p { margin: 0; overflow-wrap: anywhere; }
.wf-md-h { font-weight: 700; color: var(--text); overflow-wrap: anywhere; }
.wf-md-h1 { font-size: 1.12em; }
.wf-md-h2 { font-size: 1.06em; }
.wf-md-h3 { font-size: 1em; letter-spacing: 0.01em; }
.wf-md-list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 3px; }
.wf-md-li { overflow-wrap: anywhere; }
.wf-md-code {
  font-family: var(--mono, monospace); font-size: 0.9em;
  background: color-mix(in srgb, var(--text) 8%, transparent); border-radius: 4px; padding: 0 4px;
  overflow-wrap: anywhere; border: 1px solid var(--border);
}
.wf-md-pre {
  margin: 0; padding: 8px 10px; border-radius: 8px; overflow-x: auto;
  background: color-mix(in srgb, var(--text) 7%, transparent);
  font-family: var(--mono, monospace); font-size: 11.5px; line-height: 1.45;
}
.wf-md-pre code { white-space: pre; }

`
