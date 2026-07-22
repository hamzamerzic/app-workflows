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

/* Needs-you strip — amber when there's something to look at, a quiet "all
   caught up" otherwise. Silent-when-healthy: it never becomes a red badge. */
.wf-needs {
  display: flex; align-items: center; gap: 10px; width: auto;
  margin: 14px 14px 4px; padding: 11px 13px; border-radius: 15px;
  text-align: left; appearance: none; font: inherit; cursor: pointer;
  background: var(--wf-attn-soft);
  border: 1px solid color-mix(in srgb, var(--wf-attn) 34%, transparent);
}
.wf-needs.is-clear { background: var(--surface); border: 1px solid var(--border); cursor: default; }
.wf-needs:active:not(.is-clear) { transform: scale(0.99); }
.wf-needs-ic {
  flex: 0 0 auto; width: 24px; height: 24px; border-radius: 7px;
  display: grid; place-items: center; font-size: 13px; font-weight: 700;
  background: var(--wf-attn); color: #2b1b00;
}
.wf-needs.is-clear .wf-needs-ic { background: var(--wf-done-soft); color: var(--text); }
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
.wf-pill.is-area { background: var(--wf-accent-soft); color: var(--wf-link); }
.wf-pill.is-reco { background: var(--wf-accent-soft); color: var(--wf-link); }
.wf-sep { width: 3px; height: 3px; border-radius: 50%; background: var(--wf-line2); flex: 0 0 auto; }

/* ===== Chat drill-in ======================================================= */

.wf-chat-hero { padding: 16px 20px 8px; }
.wf-chat-title { margin: 0; font-size: 18px; letter-spacing: -0.02em; line-height: 1.25; color: var(--text); }
.wf-chat-meta {
  margin-top: 6px; font-size: 12px; color: var(--muted);
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
}
.wf-chan {
  font-size: 11.5px; font-weight: 700;
  padding: 2px 7px; border-radius: 6px; background: var(--wf-s3); color: var(--muted);
}
.wf-hero-spacer { flex: 1 1 auto; }
.wf-openchat {
  flex: 0 0 auto; appearance: none; font: inherit; font-weight: 600; font-size: 12.5px;
  min-height: 44px; padding: 8px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--wf-line2); background: var(--surface); color: var(--wf-link);
}
.wf-openchat:active { transform: scale(0.97); }

/* The vertical turn-spine — one node per turn, a CSS trunk down the left. */
.wf-spine { display: flex; flex-direction: column; padding: 0; }
.wf-turn { position: relative; margin: 4px 14px 0; padding: 14px 0 6px 30px; }
.wf-turn::before {
  content: ""; position: absolute; left: 9px; top: 20px; bottom: -6px;
  width: 2px; background: var(--wf-line2);
}
.wf-turn:last-child::before { display: none; }
.wf-tnode {
  position: absolute; left: 2px; top: 15px; width: 16px; height: 16px; border-radius: 50%;
  background: var(--bg); border: 2px solid var(--accent); display: grid; place-items: center; z-index: 2;
}
.wf-tnode > i { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.wf-tnode.neutral { border-color: var(--muted); }
.wf-tnode.neutral > i { background: var(--muted); }
.wf-tnode.attn { border-color: var(--wf-attn); }
.wf-tnode.attn > i { background: var(--wf-attn); }
.wf-tnode.run { border-color: var(--wf-run); }
.wf-tnode.run > i { background: var(--wf-run); }
.wf-toutcome { font-size: 14.5px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.36; color: var(--text); }
.wf-tmeta {
  margin-top: 5px; font-size: 11.5px; color: var(--muted);
  display: flex; gap: 7px; align-items: center; flex-wrap: wrap;
}
.wf-tflag {
  margin-top: 9px; display: flex; gap: 8px; padding: 9px 11px; border-radius: 11px;
  background: var(--wf-attn-soft); border: 1px solid color-mix(in srgb, var(--wf-attn) 26%, transparent);
  font-size: 12px; line-height: 1.45; color: var(--text);
}
.wf-tflag-ic { color: var(--wf-attn); flex: 0 0 auto; }

/* Subagent card. */
.wf-sub {
  display: block; width: 100%; text-align: left; appearance: none; font: inherit;
  margin-top: 10px; padding: 11px 12px; border-radius: 14px; position: relative;
  background: var(--surface); border: 1px solid var(--border);
  transition: transform .08s ease, border-color .15s ease;
}
.wf-sub.is-tap { cursor: pointer; }
.wf-sub.is-tap:active { transform: scale(0.99); }
.wf-sub.is-tap:hover { border-color: var(--wf-line2); }
.wf-sub-top { display: flex; align-items: center; gap: 9px; }
.wf-avatar {
  flex: 0 0 auto; width: 26px; height: 26px; border-radius: 8px;
  display: grid; place-items: center; font-size: 14px; background: var(--wf-s3);
}
.wf-avatar.explore { background: color-mix(in srgb, #4f83d6 16%, var(--surface)); }
.wf-avatar.codex { background: color-mix(in srgb, #8a63d6 16%, var(--surface)); }
.wf-avatar.build { background: color-mix(in srgb, var(--green, #3f9a5a) 16%, var(--surface)); }
.wf-sub-id { min-width: 0; display: flex; flex-direction: column; }
.wf-sub-name { font-size: 13px; font-weight: 700; letter-spacing: -0.01em; color: var(--text); }
.wf-sub-kind { font-size: 11px; color: var(--wf-faint); font-weight: 500; }
.wf-sub-state {
  margin-left: auto; flex: 0 0 auto; font-size: 11px; font-weight: 600;
  padding: 3px 9px; border-radius: 999px; display: inline-flex; gap: 5px; align-items: center;
  background: var(--wf-s3); color: var(--muted);
}
.wf-sub-state.done { background: var(--wf-done-soft); color: var(--text); }
.wf-sub-state.run { background: var(--wf-run-soft); color: var(--text); }
.wf-sub-state.failed { background: color-mix(in srgb, var(--danger, #c0392b) 15%, transparent); color: var(--text); }
.wf-sub-state.stopped { background: var(--wf-s3); color: var(--muted); }
.wf-sub-state.unknown { background: var(--wf-s3); color: var(--muted); }
.wf-sub-ask { margin-top: 8px; font-size: 12.5px; color: var(--text); line-height: 1.4; }
.wf-sub-ask .k { color: var(--muted); font-weight: 600; }
.wf-strip { margin-top: 9px; display: flex; gap: 5px; flex-wrap: wrap; }
.wf-act {
  font-size: 10.5px; font-weight: 600; font-family: var(--mono, monospace);
  padding: 2px 7px; border-radius: 6px;
  background: var(--wf-s2); color: var(--muted); border: 1px solid var(--border);
}
.wf-sub-res {
  margin-top: 9px; font-size: 12.5px; color: var(--muted); line-height: 1.4;
  padding-top: 9px; border-top: 1px solid var(--wf-line2);
}
.wf-sub-open { position: absolute; right: 11px; bottom: 11px; color: var(--muted); font-size: 15px; }

/* Per-turn "Technical detail" disclosure — the raw words + commands, one tap down. */
.wf-tech { margin-top: 10px; }
.wf-tech-sum {
  list-style: none; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--muted);
  display: flex; align-items: center; gap: 6px; padding: 8px 0; min-height: 44px;
}
.wf-tech-sum::-webkit-details-marker { display: none; }
.wf-cx { display: inline-block; transition: transform .15s ease; }
.wf-tech[open] .wf-cx { transform: rotate(90deg); }
.wf-techbox { margin-top: 6px; padding: 11px 12px; border-radius: 11px; background: var(--wf-s3); border: 1px solid var(--border); }
.wf-techbox-lbl {
  font-size: 11.5px; font-weight: 700; color: var(--muted); margin-bottom: 5px;
}
.wf-orig .wf-md { font-size: 12px; color: var(--muted); line-height: 1.5; }
.wf-cmds { margin-top: 9px; display: flex; flex-direction: column; gap: 4px; }
.wf-cmd {
  font-family: var(--mono, monospace); font-size: 10.5px; color: var(--muted);
  background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 5px 7px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ===== Subagent detail ==================================================== */

.wf-sd-head { padding: 16px 20px 6px; }
.wf-sd-head .wf-avatar { width: 36px; height: 36px; font-size: 18px; border-radius: 10px; margin-bottom: 9px; }
.wf-sd-title { margin: 0; font-size: 17px; letter-spacing: -0.02em; line-height: 1.28; color: var(--text); }
.wf-sd-k { margin-top: 5px; font-size: 12px; color: var(--muted); }

.wf-sect {
  margin: 0 20px; padding: 18px 0; border-bottom: 1px solid var(--border);
}
.wf-sect-h {
  margin: 0 0 8px; font-size: 13px; font-weight: 700; color: var(--muted);
}
.wf-sect-p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text); }
.wf-sect-p .wf-md { font-size: 13px; line-height: 1.5; color: var(--text); }
.wf-sect.is-next .wf-sect-h { color: var(--text); }
.wf-sect.is-tech { border-bottom: 0; }

.wf-sd-steps { display: flex; flex-direction: column; gap: 2px; }
.wf-stp {
  display: flex; gap: 10px; align-items: flex-start; padding: 6px 0;
  font-size: 13px; border-bottom: 1px solid var(--border);
}
.wf-stp:last-child { border-bottom: 0; }
.wf-stp-ic {
  flex: 0 0 auto; width: 22px; height: 22px; border-radius: 7px;
  display: grid; place-items: center; font-size: 12px; background: var(--wf-s3);
}
.wf-stp-body { min-width: 0; display: flex; flex-direction: column; }
.wf-stp-label { color: var(--text); }
.wf-stp-sub { color: var(--muted); font-size: 11px; margin-top: 2px; }

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

/* Markdown-lite rendering (shared by the technical detail + helper detail). */
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
