# Workflows

Workflows is an outcome journal for the background work in your Möbius chats. The journal leads with completed outcomes and groups activity by day. A “worth a look” strip gathers unfinished, failed, or unconfirmed work.

Open an entry to see the chat’s recorded steps and helpers. Open a helper to see its task, tools, report, and follow-up context. Technical detail stays available without making the journal read like a machine log.

## What it records

The journal records four layers of background activity:

- The outcome and status of each chat with background activity.
- A turn-by-turn drill-in with any recorded verification concern.
- Each helper’s brief, lifecycle, tool summary, report, and follow-up context.
- The assistant’s original words and recorded commands under Technical detail.

## Evidence and status

Workflows derives status from recorded artifacts. It never asks a model to judge whether its own work succeeded. Explicit failures override bookkeeping. A background-launch acknowledgement never counts as a completion report. A fresh unresolved launch appears as running. If it ages out without a result, it appears as stopped. Later terminal evidence can still resolve it.

The parser scrubs secret-shaped values from free text and caps it before publication. The interface omits missing fields instead of inventing values. If the storage safety cap removes an old helper page, the chat history stays visible without a broken drill-in.

## How Workflows builds the journal

The scheduled and on-demand refresh job incrementally scans local Claude and Codex trace artifacts. It joins sessions to chats through explicit link evidence, then publishes schema v2 documents to the app’s storage. The interface reads only those documents. Job diagnostics retain unlinked traces instead of guessing which chat owns them.

The scan budget splits large histories across multiple runs. Separate timeouts bound metadata reads and storage writes. A full refresh can therefore take longer than the scan budget.

## Install

Install Workflows from the Möbius **App Store**, or point an instance at this manifest:

```text
https://raw.githubusercontent.com/mobius-os/app-workflows/main/mobius.json
```

MIT licensed.
