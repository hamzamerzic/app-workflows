# Workflows

A read-only window onto the background helpers your chats spin up. When a chat
hands work off to background helpers — a plan with phases, a fan-out of task
helpers, a collaboration — Workflows shows what they are doing, whether they
finished, and what they reported back. Nothing here is model-generated: every
status is **derived** from the stored record, missing numbers are omitted
(never shown as a zero), and a helper with no report reads as "No completion
report" rather than an invented summary.

## Screens

- **Home** — chats that have background work, ordered working-first, then
  attention (a failed helper), then recency. Each row carries a provider chip
  (CLAUDE / CODEX), a helper rollup ("5 helpers · all finished"), relative
  time, and tokens tucked small. Unlinked work sits in its own section below.
- **Chat detail** — that chat's runs, newest first. A plan-kind run shows its
  phase plan inline, then its helper cards. Each helper card = a status dot
  (finished, working, failed, stopped, unavailable), the helper's description,
  the outcome it reported, and duration / steps / tokens as small mono stats.
  Tap a card with recorded activity to open it.
- **Helper detail** — one helper's goal, the steps it took (tool calls and
  notes), and its report rendered as light markdown. Aged-out records say so
  plainly; truncated records are flagged.

Every screen has an **Open chat** action that jumps to the real conversation,
and Home has a **Refresh** that runs the background job on demand (it also
auto-refreshes on open when the data is more than two minutes old).

## Architecture

| File | Role |
|------|------|
| `index.jsx` | App shell: navigation (home → chat → helper), refresh orchestration, `index.json` subscription |
| `storage.js` | Read-through storage reads + the run-now refresh transport |
| `domain.js` | Pure derive / format / order helpers — the testable core |
| `theme.js` | The single app stylesheet, exported as a CSS string |
| `views/Home.jsx` | Chats with background work |
| `views/ChatDetail.jsx` | Runs, plans, and helper cards for one chat |
| `views/HelperDetail.jsx` | One helper's goal, steps, and report |
| `refresh.sh` | Scheduled job that writes the storage records below (runs every 10 min, owner-reschedulable) |

The UI never writes app data — it only reads what the job produces and triggers
that job on demand.

## Storage schema (for hand-testing)

The job writes these paths through the storage API; the UI reads them. To
hand-test a screen, `PUT` sample JSON to
`/api/storage/apps/<app-id>/<path>` with an owner or app bearer.

**`index.json`**

```json
{
  "schema": 1,
  "updated_at": "2026-07-17T10:00:00Z",
  "chats": [
    {
      "chat_id": "abc123",
      "title": "Refactor the billing module",
      "provider": "claude",
      "runs": 2,
      "helpers": { "finished": 4, "working": 1, "failed": 0, "stopped": 0 },
      "last_activity_at": "2026-07-17T09:58:00Z",
      "tokens_total": 128400
    }
  ],
  "unlinked": [
    {
      "provider": "codex",
      "session_id": "sess-9",
      "reason": "Session not linked to a chat",
      "last_activity_at": "2026-07-17T08:00:00Z",
      "helpers": 2
    }
  ]
}
```

**`chats/<chat_id>.json`**

```json
{
  "schema": 1,
  "chat_id": "abc123",
  "title": "Refactor the billing module",
  "provider": "claude",
  "runs": [
    {
      "run_id": "run-1",
      "kind": "workflow",
      "label": "Migrate invoices to the new schema",
      "started_at": "2026-07-17T09:40:00Z",
      "ended_at": null,
      "phases": [
        { "title": "Map the current schema", "detail": "Read models + fixtures" },
        { "title": "Write the migration", "detail": "Add the reversible tombstone" }
      ],
      "agents": [
        {
          "agent_id": "a1",
          "description": "Audit the invoice model",
          "agent_type": "explore",
          "status": "finished",
          "reported_outcome": "Found 3 call sites that assume the old shape.",
          "started_at": "2026-07-17T09:41:00Z",
          "duration_secs": 92,
          "steps_count": 7,
          "tokens": 21400,
          "has_activity": true
        }
      ],
      "capabilities": { "has_saved_plan": true, "has_usage": true, "has_live_progress": true }
    }
  ]
}
```

`kind` is `workflow` (shows the phase plan) | `tasks` | `collab`. `status` is
one of `working` | `finished` | `failed` | `stopped` | `unavailable`.

**`agents/<chat_id>/<agent_id>.json`**

```json
{
  "schema": 1,
  "goal": "Audit the invoice model for the schema migration",
  "agent_type": "explore",
  "steps": [
    { "kind": "tool", "title": "Grep for Invoice(", "detail": "12 matches across 4 files" },
    { "kind": "note", "title": "Assumption", "detail": "Callers expect cents, not dollars" }
  ],
  "final_report": "Audited the model.\n\n- 3 call sites assume the old shape\n- `total` is stored in **cents**",
  "truncated": false,
  "source_expired": false
}
```

`source_expired: true` shows the "Record expired" note; `truncated: true` shows
the truncation note.

## Packaging notes

- `entry` is `index.jsx` (installer-managed, so it is not listed in
  `source_files`). Every relative sibling import **is** listed in
  `source_files`; `refresh.sh` is the scheduled job and is **not** listed
  (the installer registers it from `schedule.job`, and listing it there is
  rejected by the manifest contract).
- Validate before pushing:
  `python3 backend/scripts/validate-app.py <this-dir>` — it runs the same
  source-closure + production-esbuild checks the installer runs.
