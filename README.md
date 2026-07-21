# Workflows

A git-graph timeline of your Möbius chats. When a chat hands work off to a
background helper — a subagent it spawns to investigate, verify, or build
something — Workflows shows it as a branch off that turn, and how the branch
ended: **merged back** (returned), **still out on its own** (launched),
**failed** (the agent carried on), or **stopped**.

It reads what already happened. Every chat records each helper it spawns as a
tool call whose input holds the brief and whose output holds what came back, so
Workflows can show helpers that predate any of this — no new instrumentation.

## What you see

- **Turn by turn, at a high level.** Each turn is one compact card: a gist of
  what the agent was doing (its own closing words) and the subagents it spawned.
  The full step-by-step trail is one tap away under **Show activity**, so a long
  turn stays a card instead of a wall of rows.
- **The subagents, foregrounded.** A turn's helpers read as a clean cluster —
  each with its type, model, and lifecycle — even when several ran in one turn.
- **The brief each was given.** Expand **Instructions** on a helper to see the
  recorded preview of its prompt.
- **Markdown** in gists, notes, instructions, and reports.
- **A helper's full record.** Tap a helper to open its page — the report it
  handed back, what the chat did next, and its metrics.

## Honesty

The timeline shows only what the transcript recorded. Text is the agent's own
words, scrubbed and capped — never a generated summary. A missing value is
omitted, never shown as a fake zero. A status the payload contradicts (a helper
written down as *done* whose payload is an API error) is corrected and flagged.
The rail is **topological** — order is exact, spacing is not drawn to time,
because most helpers carry no recorded finish time.

## How it works

A scheduled (and on-demand) job reads your chats with the owner service token
and digests them into the app's own storage — a roster, one document per chat
(its turns), and one page per helper. The mini-app reads only that storage. The
job script is `refresh.sh`; the parser is `parse_runs.py`.

## Install

Install from the Möbius **App Store**, or point an instance at the manifest:

```
https://raw.githubusercontent.com/mobius-os/app-workflows/main/mobius.json
```

MIT licensed.
