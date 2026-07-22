# Workflows

Workflows is an outcome journal for the background work in your Möbius chats. The journal leads with completed outcomes and groups activity by day. A “worth a look” strip gathers unfinished, failed, or unconfirmed work.

Open an entry to see a chronological execution timeline. Time flows downward on a fixed main-agent lane; concurrent helpers occupy temporary side lanes, and nested helpers connect to the helper that launched them. Each lane shows the task and lifecycle at a glance, while the full prompt stays one click away.

## What it records

The journal records three layers of background activity:

- The outcome and status of each chat with background activity.
- A time-based main-agent timeline with concurrent and nested helper lanes.
- Each helper’s task summary, full prompt, duration, and honestly recorded lifecycle.

## Evidence and status

Workflows derives status from recorded artifacts. It never asks a model to judge whether its own work succeeded. Explicit failures override bookkeeping. A background-launch acknowledgement never counts as a completion report. A fresh unresolved launch appears as running. If it ages out without a result, it appears as stopped. Later terminal evidence can still resolve it.

The parser scrubs secret-shaped values from free text and caps it before publication. The interface omits missing fields instead of inventing values. If the storage safety cap removes an old helper page, the chat history stays visible without a broken drill-in.

## How Workflows builds the journal

The scheduled and on-demand refresh job consumes the platform’s normalized lifecycle feed and incrementally scans local Claude and Codex traces for prompt and fallback evidence. It joins sessions to chats only through explicit link evidence, then publishes bounded schema-v4 documents to the app’s storage. The interface reads only those documents. Job diagnostics retain unlinked traces instead of guessing which chat owns them.

The scan budget splits large histories across multiple runs. Separate timeouts bound metadata reads and storage writes. A full refresh can therefore take longer than the scan budget.

## Install

Install Workflows from the Möbius **App Store**, or point an instance at this manifest:

```text
https://raw.githubusercontent.com/mobius-os/app-workflows/main/mobius.json
```

MIT licensed.
