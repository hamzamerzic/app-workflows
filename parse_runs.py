#!/usr/bin/env python3
"""Digest local agent-run traces into the Workflows app's storage documents.

This is the read side of the Workflows outcome journal: it walks the
Claude CLI and Codex SDK on-disk session traces under `/data`, reconstructs
which owner chat spawned which helper (workflow phases, Task subagents, Codex
collab agents), and writes three families of storage documents the mini-app
renders — an `index.json` roster, one `chats/<chat_id>.json` per chat, and one
`helpers/<agent_id>.json` detail page per helper. The document shapes
are the frozen schema the UI and this job both code to (see `SCHEMA_NOTES`).

Design commitments that shaped every function here:

- **Status is derived from artifacts, never model-generated.** Records sharing
  an `agent_id` are reconciled once; terminal downstream evidence supersedes an
  async launch acknowledgement. `report_full` keeps the helper's OWN words,
  scrubbed and capped, while the plain-language result is deterministic.
- **Attribution is looked up, never guessed.** A session is joined to a chat
  only through the explicit signals in `Attribution` (session-links API, then a
  Task `tool_use_id` match, then a workflow/collab parent link). We never join
  by cwd, originator, or timestamp — those rhyme by coincidence. A session that
  none of those cover lands in the `unlinked` bucket with a reason string.
- **Incremental within a hard budget.** Transcripts grow without bound; one
  invocation reads at most `BUDGET_BYTES` of new bytes and runs for at most
  `BUDGET_SECS`, persisting per-file cursors + an accumulator under the job
  state dir so the next run continues where this one stopped. See `read_delta`
  and `CursorStore`.

The job runs as the `mobius` user under app-job-runner (ordinary tier): it
reads owner chat metadata with the service token (`/data/service-token.txt`,
an owner JWT — owner routes reject the app token) and WRITES its own storage
through the HTTP storage API with the `APP_TOKEN` from the environment. It has
no dependency on any backend Python module; the one thing it borrows from the
platform — the secret-scrub regexes — is COPIED below, not imported, so the job
never couples to backend layout.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Iterable, Iterator, Optional, Protocol

# --- schema + budget + caps -------------------------------------------------

SCHEMA_VERSION = 2

# A single invocation is a slice of a possibly-huge backfill. These two caps
# are the contract with cron/run-now: never hold the flock or burn resources
# past them; persist progress and let the next run continue.
BUDGET_SECS = 10.0
BUDGET_BYTES = 25 * 1024 * 1024

# Maximum bytes a single JSONL record may occupy. A record larger than this is
# flagged and skipped rather than emitted (or, when it also exceeds the read
# window, stepped over) so one pathological line — e.g. a multi-MB tool output —
# can never wedge a file's cursor: without this bound a record with no newline
# inside the per-run byte budget consumes 0, the offset never advances, and
# every later record in that file is blocked forever. Kept well under
# BUDGET_BYTES so ordinary budget pressure (a small read window late in a run)
# is NOT mistaken for an oversized record.
MAX_RECORD_BYTES = 4 * 1024 * 1024

# Freshness window for the "working" verdict: a transcript touched within this
# is treated as a live helper, older is treated as terminal (stopped/finished).
FRESH_SECS = 15 * 60

# Structural caps applied at emit time so one runaway helper cannot produce an
# unbounded document.
FINAL_REPORT_CAP = 8 * 1024
OUTCOME_CAP = 280
DETAIL_LINE_CAP = 160

# Bound the steps retained in the persistent accumulator (before the tighter
# emit-time MAX_STEPS). Keeps job state from growing with a 5000-tool helper
# while still preserving enough head+tail to render MAX_STEPS.
ACCUM_STEP_CAP = 240

# Total self-imposed ceiling for app-side artifacts. Well under the platform's
# per-app 1 GiB storage quota; when exceeded we evict the oldest helper detail
# pages (never the roster or chat summaries) — see enforce_app_cap.
APP_ARTIFACT_CAP_BYTES = 100 * 1024 * 1024

SCHEMA_NOTES = """\
index.json  {schema, updated_at, needs_attention:[...], entries:[...]}
chats/<id> {schema, chat_id, provider, title, outcome, ts, turns:[...]}
helpers/<id> {schema, agent_id, chat_id, kind, name, ask, brief_full,
              did:[{verb,label,count}], result, report_full, next, commands}
"""


# --- secret scrubbing -------------------------------------------------------
# COPIED from backend/app/chat_log_redaction.py (`_SECRET_PATTERNS` +
# `scrub_secrets`). Copied, not imported: the job must not couple to backend
# module layout, and this is a small, stable pattern set. If the source set
# gains a pattern, mirror it here. The patterns catch token SHAPES (not a fixed
# key list) so a new provider's format is covered when it rhymes with one of
# these; ordered most-specific-first so the generic long-token rule can't
# half-eat a JWT.
#
# ONE DELIBERATE DIVERGENCE from the source set: the generic catch-all class
# below drops `/` (source uses `[A-Za-z0-9_+/=-]{32,80}`; here `[A-Za-z0-9_+=-]`).
# Chat prose almost never contains long slashed blobs except pasted secrets, but
# this job's free text is tool STEP TITLES/DETAILS, which are dominated by file
# paths (`/data/apps/.../some_long_component.json`). With `/` in the class a
# 32-80 char path segment collapsed to `[redacted-token]`, gutting the app's
# drill-down (its core value). The four specific rules above still run first and
# catch real secrets (JWTs, sk-/ghp_/AIza… keys, bearer tokens, key=val pairs);
# only the unstructured slash-containing catch-all is relaxed. The copied-set
# invariant otherwise holds.
_SECRET_PATTERNS: list[tuple[re.Pattern[str], str]] = [
  (re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b"),
   "[redacted-jwt]"),
  (re.compile(r"\b(?:sk-ant-|sk-|rk_live_|sk_live_|ghp_|gho_|ghu_|ghs_|xox[abprs]-|AIza)[A-Za-z0-9_-]{8,}\b"),
   "[redacted-key]"),
  (re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._-]{12,}"),
   r"\1 [redacted-token]"),
  (re.compile(r"(?i)\b(api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*\S+"),
   r"\1=[redacted]"),
  (re.compile(r"\b[A-Za-z0-9_+=-]{32,80}\b"),
   "[redacted-token]"),
]


def scrub(text: Optional[str]) -> str:
  """Replaces key/token/JWT-shaped substrings with labelled markers.

  Best-effort reduced exposure, not a guarantee — a regex cannot catch a pasted
  document or an encoded value; the caps bound how much survives regardless.
  Applied to every free-text fragment that leaves this job (outcomes, briefs,
  commands, and verbatim reports).
  """
  if not text:
    return ""
  for pattern, repl in _SECRET_PATTERNS:
    text = pattern.sub(repl, text)
  return text


def clip_line(text: str, cap: int = DETAIL_LINE_CAP) -> str:
  """Scrubs then truncates a single detail/title line to `cap` chars."""
  out = scrub(text).replace("\n", " ").strip()
  return out[:cap] + "…" if len(out) > cap else out


# --- incremental cursor + accumulator store ---------------------------------

class Budget:
  """Wall-clock + bytes ceiling shared across a single refresh invocation.

  `exhausted` flips once either limit is hit; the parse loops check it before
  opening the next file so a slice always stops cleanly on a file boundary and
  persists progress rather than being killed mid-record.
  """

  def __init__(self, secs: float, max_bytes: int):
    self.deadline = time.monotonic() + secs
    self.max_bytes = max_bytes
    self.bytes_read = 0

  @property
  def remaining_bytes(self) -> int:
    return max(0, self.max_bytes - self.bytes_read)

  @property
  def exhausted(self) -> bool:
    return time.monotonic() >= self.deadline or self.remaining_bytes <= 0

  def consume(self, n: int) -> None:
    self.bytes_read += n


def load_json(path: Path, default):
  try:
    return json.loads(path.read_text(encoding="utf-8"))
  except (OSError, ValueError):
    return default


def save_json(path: Path, obj) -> None:
  """Atomic write via a temp file + rename so a crash can't leave half a doc."""
  path.parent.mkdir(parents=True, exist_ok=True)
  tmp = path.with_suffix(path.suffix + ".tmp")
  tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
  os.replace(tmp, path)


class CursorStore:
  """Per-file read cursors persisted across invocations.

  A cursor is `{ino, offset, last_uuid, first_fp}`. `offset` is the byte
  position of the next unread record; `ino` and `first_fp` detect a replaced
  file. `first_fp` is a stable fingerprint of the file's first record (see
  `_first_record_fp`) — it catches a replacement that inode + size cannot:
  inode reuse, or a truncate-and-regrow that lands the new content at or above
  the old offset (so `size >= offset` and `ino` is unchanged). On the next run:
    - inode changed, current size < offset, OR the first-record fingerprint
      changed  ->  the file was replaced or truncated; rescan from 0 and let the
      caller reset that file's derived state (symmetric across the Claude and
      Codex fold paths).
    - otherwise read forward from `offset`, consuming only newline-terminated
      records so a half-written tail line is re-read intact next time.
  """

  def __init__(self, path: Path):
    self.path = path
    raw = load_json(path, {})
    self.files: dict[str, dict] = raw.get("files", {}) if isinstance(raw, dict) else {}

  def get(self, key: str) -> dict:
    return self.files.get(key, {})

  def set(self, key: str, cur: dict) -> None:
    self.files[key] = cur

  def save(self) -> None:
    save_json(self.path, {"schema": SCHEMA_VERSION, "files": self.files})


def _first_record_fp(path: Path, cap: int = 4096) -> Optional[str]:
  """Fingerprint of a file's first COMPLETE record — bytes up to the first
  newline, hashed. Used to detect a replacement the inode + size checks miss.

  Returns None until the first record is fully written (no newline in the first
  `cap` bytes yet), so a file still writing its opening line never looks
  'replaced'. Once the first record is terminated it is immutable (these files
  are append-only), so the fingerprint is stable for the file's whole life and
  changes only when the file is genuinely replaced.
  """
  try:
    with open(path, "rb") as fh:
      head = fh.read(cap)
  except OSError:
    return None
  nl = head.find(b"\n")
  if nl < 0:
    return None
  return hashlib.sha256(head[:nl]).hexdigest()[:16]


def read_delta(path: Path, cursor: dict, budget: Budget) -> tuple[bool, list[dict], dict]:
  """Reads new newline-terminated JSON records past `cursor` within `budget`.

  Returns `(rescanned, records, new_cursor)`. `rescanned` is True when the file
  was replaced/truncated and we restarted at byte 0 — the caller uses it to
  reset any state it derived from this file before folding the records back in.
  A partial tail line (no trailing newline, or budget cut the read mid-line)
  leaves `new_cursor.offset` at that line's start so it is re-read intact.

  Two robustness invariants: (1) a single record larger than `MAX_RECORD_BYTES`
  is flagged and skipped (or stepped over when it also exceeds the read window)
  so it can never wedge the cursor; (2) the byte budget is charged only for the
  bytes actually CONSUMED (advanced past), never the partial tail that gets
  re-read next run — charging the tail would double-count and shrink the budget.
  """
  try:
    st = path.stat()
  except OSError:
    return False, [], cursor
  ino, size = st.st_ino, st.st_size
  prev_off = int(cursor.get("offset", 0))
  prev_ino = cursor.get("ino")
  prev_fp = cursor.get("first_fp")
  fp = _first_record_fp(path)
  replaced = prev_fp is not None and fp is not None and prev_fp != fp
  rescanned = prev_ino is not None and (prev_ino != ino or size < prev_off or replaced)
  start = 0 if (rescanned or prev_ino is None) else prev_off

  def _cursor(off: int, uuid) -> dict:
    return {"ino": ino, "offset": off, "last_uuid": uuid, "first_fp": fp}

  if size <= start:
    return rescanned, [], _cursor(start, cursor.get("last_uuid"))
  to_read = min(size - start, budget.remaining_bytes)
  if to_read <= 0:
    return rescanned, [], _cursor(start, cursor.get("last_uuid"))
  try:
    with open(path, "rb") as fh:
      fh.seek(start)
      chunk = fh.read(to_read)
  except OSError:
    return rescanned, [], cursor
  # Keep only through the last newline: everything after it is a partial record
  # still being appended (or cut off by the byte budget).
  nl = chunk.rfind(b"\n")
  if nl < 0:
    at_eof = (start + len(chunk)) >= size
    if not at_eof and len(chunk) >= MAX_RECORD_BYTES:
      # A single record longer than both the read window AND the max allowance:
      # step the cursor past this window so it can't wedge. A later window
      # resyncs at the next newline (its leading partial line fails json.loads
      # and is dropped). Charge the bytes we advance past.
      budget.consume(len(chunk))
      return rescanned, [], _cursor(start + len(chunk), cursor.get("last_uuid"))
    # A partial tail (still being written at EOF) or ordinary budget pressure
    # mid-record: leave the offset at `start` so the record is re-read intact,
    # and charge nothing (those bytes are re-read; charging here double-counts).
    return rescanned, [], _cursor(start, cursor.get("last_uuid"))
  consumed = nl + 1
  budget.consume(consumed)
  records: list[dict] = []
  last_uuid = cursor.get("last_uuid")
  for line in chunk[:consumed].split(b"\n"):
    if not line.strip():
      continue
    if len(line) > MAX_RECORD_BYTES:
      # An oversized single record: skip rather than emit a giant step. Dropping
      # it (vs. wedging) keeps every later record in the file readable.
      continue
    try:
      rec = json.loads(line)
    except ValueError:
      continue
    if isinstance(rec, dict):
      records.append(rec)
      if rec.get("uuid"):
        last_uuid = rec["uuid"]
  return rescanned, records, _cursor(start + consumed, last_uuid)


def read_whole_if_changed(path: Path, cursor: dict) -> tuple[bool, Optional[dict], dict]:
  """Reads a whole-file JSON doc (workflow record, meta, board) if it changed.

  These files are rewritten atomically, not appended, so a mtime+size cursor is
  the right freshness signal — no byte offset. Returns `(changed, obj, cursor)`;
  `obj` is None when unchanged or unreadable.
  """
  try:
    st = path.stat()
  except OSError:
    return False, None, cursor
  sig = {"mtime": st.st_mtime, "size": st.st_size}
  if cursor.get("mtime") == sig["mtime"] and cursor.get("size") == sig["size"]:
    return False, None, cursor
  obj = load_json(path, None)
  return (obj is not None), obj, sig


# --- workflow-meta extraction ----------------------------------------------

# The workflow record embeds its meta as a JS source string
# (`export const meta = { name: '…', description: '…', phases: [{title:'…'}] }`).
# We extract with tolerant regexes and NEVER eval the script — it is arbitrary
# agent-authored JS. Missing fields degrade to empty, not an error.
_META_NAME = re.compile(r"\bname\s*:\s*(['\"])(.*?)\1", re.DOTALL)
_META_DESC = re.compile(r"\bdescription\s*:\s*(['\"])(.*?)\1", re.DOTALL)
_META_PHASES_BLOCK = re.compile(r"\bphases\s*:\s*\[(.*?)\]", re.DOTALL)
_META_PHASE_TITLE = re.compile(r"\btitle\s*:\s*(['\"])(.*?)\1", re.DOTALL)


def extract_workflow_meta(script: str) -> dict:
  """Best-effort parse of `name`, `description`, `phases[].title` from the
  workflow script string. Tolerant by design: a script that doesn't match
  yields empty fields rather than raising."""
  if not isinstance(script, str):
    return {"name": "", "description": "", "phases": []}
  name = _META_NAME.search(script)
  desc = _META_DESC.search(script)
  phases: list[dict] = []
  block = _META_PHASES_BLOCK.search(script)
  if block:
    for m in _META_PHASE_TITLE.finditer(block.group(1)):
      phases.append({"title": m.group(2), "detail": ""})
  return {
    "name": name.group(2) if name else "",
    "description": desc.group(2) if desc else "",
    "phases": phases,
  }


# --- record-shape helpers ---------------------------------------------------

def _msg_text_and_tools(msg: dict) -> tuple[Optional[str], list[tuple[str, str]]]:
  """Pulls (last_text, [(tool_name, tool_input_summary)]) from one Claude
  assistant message. Content may be a list of typed blocks or a bare string."""
  content = msg.get("content")
  if isinstance(content, str):
    return (content or None), []
  text: Optional[str] = None
  tools: list[tuple[str, str]] = []
  if isinstance(content, list):
    for block in content:
      if not isinstance(block, dict):
        continue
      if block.get("type") == "text" and block.get("text"):
        text = block["text"]
      elif block.get("type") == "tool_use":
        tools.append((str(block.get("name") or "tool"),
                      _short_input(block.get("input"))))
  return text, tools


def _short_input(inp) -> str:
  """A compact one-line description of a tool input for a step detail."""
  if isinstance(inp, dict):
    for key in ("description", "command", "file_path", "path", "pattern", "prompt", "query"):
      if inp.get(key):
        return str(inp[key])
    return ", ".join(sorted(inp.keys()))
  return "" if inp is None else str(inp)


def _usage_tokens(msg: dict) -> int:
  u = msg.get("usage")
  if not isinstance(u, dict):
    return 0
  return int(u.get("input_tokens", 0) or 0) + int(u.get("output_tokens", 0) or 0)


# --- accumulator model ------------------------------------------------------
# The accumulator is the compact, incrementally-grown model persisted between
# runs (state/model.json). It is NOT the app storage: storage documents are
# rebuilt from it each run. Keyed maps keep merge cheap and idempotent.
#
#   sessions[sid]  = {provider, last_activity_at, parent_thread_id, tool_use_ids:[]}
#   agents[akey]   = per-helper digest (akey = "<sid>::<agent_id>")
#   runs[rkey]     = per-run container (rkey = "<sid>::<run_id>")
#
# A run groups helpers: kind "workflow" (a wf_*.json with phases), "tasks" (Task
# subagents under a session), or "collab" (a Codex multi-agent turn).


def _new_model() -> dict:
  return {"schema": SCHEMA_VERSION, "sessions": {}, "agents": {}, "runs": {}}


def _session(model: dict, sid: str, provider: str) -> dict:
  s = model["sessions"].setdefault(sid, {
    "provider": provider, "last_activity_at": None,
    "parent_thread_id": None, "tool_use_ids": [],
  })
  s["provider"] = provider or s["provider"]
  return s


def _bump_activity(session: dict, iso: Optional[str]) -> None:
  if iso and (session["last_activity_at"] is None or iso > session["last_activity_at"]):
    session["last_activity_at"] = iso


def _run(model: dict, sid: str, run_id: str, kind: str, label: str) -> dict:
  rkey = f"{sid}::{run_id}"
  r = model["runs"].setdefault(rkey, {
    "sid": sid, "run_id": run_id, "kind": kind, "label": label,
    "started_at": None, "ended_at": None, "phases": [], "agent_keys": [],
  })
  if label:
    r["label"] = label
  return r


def _agent(model: dict, sid: str, run_id: str, agent_id: str, kind: str) -> dict:
  akey = f"{sid}::{agent_id}"
  a = model["agents"].setdefault(akey, {
    "sid": sid, "run_id": run_id, "run_kind": kind, "agent_id": agent_id,
    "agent_type": "", "description": "", "tool_use_id": None, "goal": "",
    "steps": [], "final_report": "", "tokens": 0, "started_at": None,
    "last_ts": None, "has_activity": False, "result": None,
    "board_status": None, "source_expired": False, "truncated": False,
  })
  a["run_id"] = run_id
  a["run_kind"] = kind
  run = _run(model, sid, run_id, kind, "")
  if akey not in run["agent_keys"]:
    run["agent_keys"].append(akey)
  return a


# --- Claude tree parsing ----------------------------------------------------

def parse_claude(cc_dir: Path, model: dict, cursors: CursorStore, budget: Budget) -> None:
  """Walks `<cc>/projects/-data` and folds every session's helper traces into
  `model`. Sessions run with cwd `/data`, so `-data` is the project dir for the
  owner's chats (the attribution scope); other project dirs are out of scope.
  """
  root = cc_dir / "projects" / "-data"
  if not root.is_dir():
    return
  tasks_root = cc_dir / "tasks"
  # Newest sessions first so a budget-limited slice covers live activity before
  # old backfill. Directories (which hold subagent traces) are the interesting
  # ones; a bare <sid>.jsonl with no dir spawned no helpers.
  for sess_dir in _sorted_by_mtime(p for p in root.iterdir() if p.is_dir()):
    if budget.exhausted:
      return
    sid = sess_dir.name
    session = _session(model, sid, "claude")
    _bump_activity(session, _mtime_iso(root / f"{sid}.jsonl"))
    _bump_activity(session, _mtime_iso(sess_dir))
    _parse_claude_workflows(sess_dir, sid, model, cursors, budget)
    _parse_claude_task_agents(sess_dir, sid, model, cursors, budget)
    _parse_task_board(tasks_root / sid, sid, model)


def _parse_claude_workflows(sess_dir: Path, sid: str, model: dict,
                            cursors: CursorStore, budget: Budget) -> None:
  wf_dir = sess_dir / "workflows"
  agents_root = sess_dir / "subagents" / "workflows"
  if not wf_dir.is_dir():
    return
  for wf_file in sorted(wf_dir.glob("wf_*.json")):
    if budget.exhausted:
      return
    changed, obj, cur = read_whole_if_changed(wf_file, cursors.get(str(wf_file)))
    cursors.set(str(wf_file), cur)
    if changed and isinstance(obj, dict):
      run_id = str(obj.get("runId") or wf_file.stem)
      meta = extract_workflow_meta(obj.get("script", ""))
      run = _run(model, sid, run_id, "workflow", meta["name"] or run_id)
      run["phases"] = meta["phases"]
      run["started_at"] = obj.get("timestamp") or run["started_at"]
      _bump_activity(_session(model, sid, "claude"), obj.get("timestamp"))
    else:
      run_id = str(wf_file.stem)
    _parse_agent_dir(agents_root / run_id, sid, run_id, "workflow", model, cursors, budget)


def _parse_claude_task_agents(sess_dir: Path, sid: str, model: dict,
                              cursors: CursorStore, budget: Budget) -> None:
  """Task-tool subagents live directly under `subagents/` (not the workflows/
  subtree). They share one synthetic per-session "tasks" run."""
  sub = sess_dir / "subagents"
  if not sub.is_dir():
    return
  has_direct = any(sub.glob("agent-*.meta.json")) or any(sub.glob("agent-*.jsonl"))
  if not has_direct:
    return
  _run(model, sid, "tasks", "tasks", "Task subagents")
  _parse_agent_dir(sub, sid, "tasks", "tasks", model, cursors, budget, journal=False)


def _parse_agent_dir(agent_dir: Path, sid: str, run_id: str, kind: str,
                     model: dict, cursors: CursorStore, budget: Budget,
                     journal: bool = True) -> None:
  """Folds every `agent-*.jsonl` (+ its `.meta.json`) in `agent_dir` into the
  model, and the sibling `journal.jsonl` results when `journal` is set."""
  if not agent_dir.is_dir():
    return
  if journal:
    _parse_journal(agent_dir / "journal.jsonl", sid, run_id, kind, model, cursors, budget)
  for tr in sorted(agent_dir.glob("agent-*.jsonl")):
    if budget.exhausted:
      return
    agent_id = tr.stem[len("agent-"):]
    agent = _agent(model, sid, run_id, agent_id, kind)
    _load_agent_meta(tr.with_name(f"agent-{agent_id}.meta.json"), agent, model, sid)
    _fold_agent_transcript(tr, agent, model, sid, cursors, budget)


def _load_agent_meta(meta_path: Path, agent: dict, model: dict, sid: str) -> None:
  meta = load_json(meta_path, None)
  if not isinstance(meta, dict):
    return
  agent["agent_type"] = str(meta.get("agentType") or agent["agent_type"] or "")
  if meta.get("description"):
    agent["description"] = str(meta["description"])
  tuid = meta.get("toolUseId")
  if tuid:
    agent["tool_use_id"] = str(tuid)
    tool_use_ids = _session(model, sid, "claude")["tool_use_ids"]
    if tuid not in tool_use_ids:
      tool_use_ids.append(str(tuid))


def _fold_agent_transcript(tr: Path, agent: dict, model: dict, sid: str,
                           cursors: CursorStore, budget: Budget) -> None:
  """Streams new transcript records into the agent digest: first user message
  is the goal, tool_use blocks become steps, the last assistant text is the
  final_report, usage accumulates into tokens. A rescanned (replaced) file
  resets the digest first so nothing double-counts."""
  rescanned, records, cur = read_delta(tr, cursors.get(str(tr)), budget)
  cursors.set(str(tr), cur)
  if rescanned:
    _reset_agent_digest(agent)
  session = _session(model, sid, "claude")
  for rec in records:
    ts = rec.get("timestamp")
    if ts:
      agent["started_at"] = agent["started_at"] or ts
      agent["last_ts"] = ts
      _bump_activity(session, ts)
    msg = rec.get("message")
    if not isinstance(msg, dict):
      continue
    role = msg.get("role")
    if role == "user" and not agent["goal"]:
      goal = msg.get("content")
      if isinstance(goal, str):
        agent["goal"] = goal
      elif isinstance(goal, list):
        agent["goal"] = next((b.get("text", "") for b in goal
                              if isinstance(b, dict) and b.get("type") == "text"), "")
    if role == "assistant":
      text, tools = _msg_text_and_tools(msg)
      agent["tokens"] += _usage_tokens(msg)
      if text:
        agent["final_report"] = text
        agent["has_activity"] = True
      for name, detail in tools:
        agent["steps"].append({"kind": "tool", "title": name, "detail": detail})
        agent["has_activity"] = True
      _trim_accum_steps(agent)


def _trim_accum_steps(agent: dict) -> None:
  steps = agent["steps"]
  if len(steps) > ACCUM_STEP_CAP:
    half = ACCUM_STEP_CAP // 2
    agent["steps"] = steps[:half] + steps[-half:]
    agent["truncated"] = True


def _reset_agent_digest(agent: dict) -> None:
  """Drops the transcript-derived fields of a helper digest so a replaced source
  file can be re-folded from scratch without double-counting. Leaves identity
  and lookup fields (agent_type, description, tool_use_id, goal, result,
  board_status) intact — only the streamed-in accumulation is reset."""
  agent.update({"steps": [], "final_report": "", "tokens": 0,
                "started_at": None, "last_ts": None, "has_activity": False})


def _parse_journal(journal_path: Path, sid: str, run_id: str, kind: str,
                   model: dict, cursors: CursorStore, budget: Budget) -> None:
  """Journal lines are `{type:started|result, agentId, result}`. A `result`
  line is the authoritative "this helper finished" signal and carries the
  helper's own reported outcome."""
  _rescanned, records, cur = read_delta(journal_path, cursors.get(str(journal_path)), budget)
  cursors.set(str(journal_path), cur)
  for rec in records:
    if rec.get("type") != "result":
      continue
    agent_id = rec.get("agentId")
    if not agent_id:
      continue
    _agent(model, sid, run_id, str(agent_id), kind)["result"] = rec.get("result")


def _parse_task_board(board_dir: Path, sid: str, model: dict) -> None:
  """Task-board cards (`tasks/<sid>/*.json` = `{subject,status}`) label the
  session's tasks run and surface a board-level failure. Board cards are the
  todo items, not the spawned agents, so they inform the run — not a 1:1 agent
  join (which we never fabricate).

  Board-derived status is recomputed from ALL current cards every run (cards are
  small, and re-reading them is cheap): a run that once had a failed card but
  whose card later completed or was deleted must be able to CLEAR the failure.
  We therefore clear the prior board-derived status first, then reapply only if
  a current card is still failing — a status set from a stale earlier run can
  never stick.
  """
  if not board_dir.is_dir():
    return
  rkey = f"{sid}::tasks"
  agent_keys = model["runs"].get(rkey, {}).get("agent_keys", [])
  # Clear any prior board-derived failure before recomputing from scratch.
  for akey in agent_keys:
    agent = model["agents"].get(akey)
    if agent and agent.get("board_status") == "failed":
      agent["board_status"] = None
  subjects: list[str] = []
  failed = False
  for card_path in sorted(board_dir.glob("*.json")):
    card = load_json(card_path, None)
    if not isinstance(card, dict):
      continue
    if card.get("subject"):
      subjects.append(str(card["subject"]))
    if str(card.get("status", "")).lower() in ("failed", "error", "blocked"):
      failed = True
  if subjects and rkey in model["runs"]:
    model["runs"][rkey]["label"] = subjects[0]
  if failed:
    for akey in agent_keys:
      if akey in model["agents"]:
        model["agents"][akey]["board_status"] = "failed"


# --- Codex tree parsing -----------------------------------------------------

def parse_codex(codex_home: Path, model: dict, cursors: CursorStore, budget: Budget) -> None:
  """Walks `<codex_home>/sessions/YYYY/MM/DD/rollout-*.jsonl`.

  A rollout is a session; its `session_meta` line carries the id + optional
  `parent_thread_id` linking a forked/collab child to its parent. We scan the
  body defensively for collab items (a helper spawned inside the turn). An
  ordinary Codex chat with no collab items and no children yields no runs — it
  is a top-level chat, not a helper, and only matters for attribution.
  """
  root = codex_home / "sessions"
  if not root.is_dir():
    return
  for rollout in _sorted_by_mtime(root.rglob("rollout-*.jsonl")):
    if budget.exhausted:
      return
    _parse_codex_rollout(rollout, model, cursors, budget)


def _parse_codex_rollout(rollout: Path, model: dict, cursors: CursorStore,
                         budget: Budget) -> None:
  rescanned, records, cur = read_delta(rollout, cursors.get(str(rollout)), budget)
  cursors.set(str(rollout), cur)
  # The session id is only known once we've seen session_meta; buffer collab
  # signals until then. Codex writes session_meta as the first record, so on a
  # fresh file this resolves immediately; a mid-file resume slice reuses the
  # sid already recorded on the file's cursor is not needed because the sid also
  # appears on later records via payload — but we key off session_meta which is
  # re-read on rescan.
  sid = _codex_sid_for(rollout, model, cursors)
  if rescanned:
    # A replaced/truncated rollout re-delivers records from byte 0. Reset the
    # digests this rollout derives so re-folding cannot double-append steps —
    # symmetric with _fold_agent_transcript's reset on the Claude side. The sid
    # is re-read from session_meta (record 0) below; prefer that, falling back
    # to the cached sid for a defensive rescan whose window somehow lost it.
    reset_sid = sid
    for rec in records:
      if rec.get("type") == "session_meta":
        p = rec.get("payload") if isinstance(rec.get("payload"), dict) else {}
        reset_sid = str(p.get("session_id") or p.get("id") or reset_sid or rollout.stem)
        break
    if reset_sid:
      _reset_codex_digests(model, reset_sid)
  session = _session(model, sid, "codex") if sid else None
  for rec in records:
    payload = rec.get("payload") if isinstance(rec.get("payload"), dict) else {}
    rtype = rec.get("type")
    if rtype == "session_meta":
      sid = str(payload.get("session_id") or payload.get("id") or sid or rollout.stem)
      session = _session(model, sid, "codex")
      spawn = _codex_spawn_info(payload)
      # session_meta is the fresh authority, including an explicit absence of a
      # parent. Do not preserve a stale accumulated parent when the current
      # metadata says this is top-level. Invariant: a session is never its own
      # parent.
      parent = (payload.get("parent_thread_id") or payload.get("parentThreadId")
                or spawn.get("parent_thread_id"))
      session["parent_thread_id"] = None if not parent or str(parent) == sid else str(parent)
      # A forked sub-agent's assignment lives in its own session_meta source, not
      # in a user_message — carry it so the helper card is labelled by the task
      # it was spawned for rather than left blank.
      if spawn.get("label") and not session.get("spawn_label"):
        session["spawn_label"] = spawn["label"]
      cursors.set(f"codex-sid::{rollout}", {"sid": sid})
    ts = rec.get("timestamp")
    if session and ts:
      _bump_activity(session, ts)
    if session and sid:
      _fold_codex_collab(payload, sid, model)
      _fold_codex_helper_activity(rtype, payload, sid, model)
  if session is not None:
    _bump_activity(session, _mtime_iso(rollout))


def _codex_spawn_info(meta_payload: dict) -> dict:
  """Pulls a forked sub-agent's parent + human label out of its session_meta.

  A spawned Codex sub-agent records its origin under
  ``source.subagent.thread_spawn`` = {parent_thread_id, agent_path,
  agent_nickname, ...}. The task it was spawned for is the ``agent_path``
  (e.g. "/root/calculate_product"); ``agent_nickname`` ("Mendel") is a fallback.
  Tolerant of camel/snake and a missing source (a top-level chat returns {}).
  """
  src = meta_payload.get("source") or meta_payload.get("threadSource") or {}
  if not isinstance(src, dict):
    return {}
  sub = src.get("subagent") or src.get("subAgent") or {}
  spawn = sub.get("thread_spawn") or sub.get("threadSpawn") or {}
  if not isinstance(spawn, dict):
    return {}
  path = spawn.get("agent_path") or spawn.get("agentPath") or ""
  nick = spawn.get("agent_nickname") or spawn.get("agentNickname") or ""
  label = str(path).lstrip("/").replace("_", " ").strip() or str(nick).strip()
  return {
    "parent_thread_id": spawn.get("parent_thread_id") or spawn.get("parentThreadId"),
    "label": label,
  }


def _codex_sid_for(rollout: Path, model: dict, cursors: CursorStore) -> Optional[str]:
  """Recovers the session id for a resume slice whose current byte range does
  not re-include session_meta, from the sid cached on first parse."""
  cached = cursors.get(f"codex-sid::{rollout}")
  return cached.get("sid") if isinstance(cached, dict) else None


def _reset_codex_digests(model: dict, sid: str) -> None:
  """Resets the transcript-derived state of every collab helper this Codex
  session owns (its self-agent `sid::sid` and any collab children `sid::*`),
  so a rescanned rollout re-folds cleanly. `_fold_codex_collab` re-sets each
  child's status/goal and `_fold_codex_helper_activity` re-appends steps from
  the empty base — no duplicates."""
  for agent in model["agents"].values():
    if agent.get("sid") == sid and agent.get("run_kind") == "collab":
      _reset_agent_digest(agent)


def _enforce_parent_invariant(model: dict) -> None:
  """Repairs stale accumulators produced before the self-parent guard existed.

  Clearing only the session field is insufficient: the old fold may already
  have created a synthetic `sid::sid` helper and collab run for that fake child.
  Remove that derived self-helper while preserving any real children in the same
  run. Invariant: a session is never its own parent.
  """
  for sid, session in model.get("sessions", {}).items():
    if str(session.get("parent_thread_id") or "") != sid:
      continue
    session["parent_thread_id"] = None
    akey = f"{sid}::{sid}"
    agent = model.get("agents", {}).get(akey)
    if not agent or agent.get("run_kind") != "collab":
      continue
    model["agents"].pop(akey, None)
    for rkey, run in list(model.get("runs", {}).items()):
      if akey in run.get("agent_keys", []):
        run["agent_keys"] = [key for key in run["agent_keys"] if key != akey]
        if not run["agent_keys"]:
          model["runs"].pop(rkey, None)


def _looks_collab(payload: dict) -> bool:
  """True when a rollout payload is a Codex collab tool call — matched on the
  discriminator OR the shape (defensive: the typed field naming may be camel or
  snake across SDK versions, and no live sample exists yet)."""
  t = str(payload.get("type", ""))
  if "collabAgentToolCall" in t or "collab_agent_tool_call" in t:
    return True
  keys = set(payload.keys())
  camel = {"senderThreadId", "receiverThreadIds", "agentsStates"}
  snake = {"sender_thread_id", "receiver_thread_ids", "agents_states"}
  return bool(keys & camel) or bool(keys & snake)


def _fold_codex_collab(payload: dict, sid: str, model: dict) -> None:
  """A collab item names spawned agents in `agents_states` (thread_id -> state
  with status/model). Each becomes a helper under this session's collab run.

  CHILD LIFECYCLE IS PER-CHILD, NOT PER-CALL. A spawned child's done-ness is
  derived ONLY from ITS OWN terminal `CollabAgentState.status` (keyed here by
  the child's thread_id — the same set as `receiver_thread_ids`), NEVER from the
  collab tool-call itself completing. This matters because one collab op call
  (spawn/wait/send/close) completing says nothing about whether the child it
  targets has terminated: a wait/send/close op returns while the child is still
  inProgress. Reading the per-child status snapshot is what keeps a still-running
  child reported as `working` until its own state flips to completed/failed.

  Constraint for the RUNNER side (out of this file's scope): the emitter must
  likewise key child lifecycle by `receiver_thread_ids` + terminal child status,
  not by turning every completed collab op into a `task_done`. This parser is
  already per-child-correct; the runner's `_tool_completed_events` /
  `_tool_start_event` are where that fix lands before collab is enabled.
  """
  if not _looks_collab(payload):
    return
  states = payload.get("agents_states") or payload.get("agentsStates") or {}
  if not isinstance(states, dict):
    return
  _run(model, sid, "collab", "collab", "Codex collab")
  for thread_id, state in states.items():
    if not isinstance(state, dict):
      continue
    agent = _agent(model, sid, "collab", str(thread_id), "collab")
    agent["agent_type"] = str(state.get("model") or agent["agent_type"] or "codex")
    status = str(state.get("status", ""))
    # inProgress/completed/failed are the typed CollabAgentState values; map to
    # the frozen derived-status vocabulary. Left as a hint on the digest;
    # derive_status turns it into the final verdict. A later collab record with
    # a fresher status overwrites this, so a terminal status supersedes an
    # earlier inProgress; a status-less op leaves the last known status intact.
    agent["result"] = {"collab_status": status} if status else agent["result"]
    for field in ("prompt", "goal"):
      if state.get(field) and not agent["goal"]:
        agent["goal"] = str(state[field])
    agent["has_activity"] = True


def _fold_codex_helper_activity(rtype: Optional[str], payload: dict, sid: str,
                                model: dict) -> None:
  """When THIS session is a collab/forked CHILD (has a parent), its own turn is
  a helper's transcript: record its function calls as steps and its last agent
  message as the report, on a synthetic self-agent under the parent's link.

  This only produces a helper when the session has a parent_thread_id; a
  top-level Codex chat takes neither branch. The child is stitched to the
  parent's chat later, in attribution.
  """
  session = model["sessions"].get(sid) or {}
  if (not session.get("parent_thread_id")
      or str(session.get("parent_thread_id")) == sid):
    return
  agent = _agent(model, sid, "collab", sid, "collab")
  if not agent["agent_type"]:
    agent["agent_type"] = "codex"
  if session.get("spawn_label") and not agent["goal"]:
    agent["goal"] = str(session["spawn_label"])
  if rtype == "response_item" and payload.get("type") == "function_call":
    agent["steps"].append({"kind": "tool", "title": str(payload.get("name") or "tool"),
                           "detail": _short_input(_json_or_none(payload.get("arguments")))})
    agent["has_activity"] = True
    _trim_accum_steps(agent)
  elif rtype == "event_msg" and payload.get("type") == "agent_message":
    if payload.get("message"):
      agent["final_report"] = str(payload["message"])
      agent["has_activity"] = True
  elif rtype == "event_msg" and payload.get("type") == "user_message" and not agent["goal"]:
    agent["goal"] = str(payload.get("text") or payload.get("message") or "")


def _json_or_none(s):
  if isinstance(s, (dict, list)):
    return s
  try:
    return json.loads(s)
  except (ValueError, TypeError):
    return s


# --- attribution ------------------------------------------------------------

class Attribution:
  """Joins a session id to an owner chat id through explicit signals only.

  Priority (strict; first hit wins, never a guess):
    1. the session-links API (session_id -> chat_id, backend-authoritative);
    2. a Task `tool_use_id` seen on one of the session's subagents that also
       appears as a Task tool block in some chat's messages;
    3. a workflow/tasks run inherits its parent session's chat (same sid);
    4. a Codex child inherits its `parent_thread_id`'s chat (recursively);
    5. otherwise unlinked, with a reason string.

  Steps 1-2 are data handed in at construction; 3 is implicit (helpers key off
  their own sid); 4 is resolved in `resolve` by walking parent links.

  `links` is keyed by the backend's true link identity `(provider, session_id)`,
  not by session_id alone: a Claude session id can equal a Codex thread id, and
  keying by id alone lets whichever row the API returned last silently shadow
  the other. A legacy provider-less link shape is stored under `(None, sid)` and
  consulted only when no provider-qualified link matches.
  """

  def __init__(self, links: dict[tuple, str], tooluse_to_chat: dict[str, str],
               chats: dict[str, dict]):
    self.links = links
    self.tooluse_to_chat = tooluse_to_chat
    self.chats = chats

  def resolve(self, sid: str, sessions: dict[str, dict],
              _seen: Optional[set] = None) -> tuple[Optional[str], str]:
    session = sessions.get(sid, {})
    provider = session.get("provider")
    # 1. session-links API, looked up on the session's OWN provider so a
    #    same-id session of a different provider can never claim this link.
    if (provider, sid) in self.links:
      return self.links[(provider, sid)], "session-link"
    if (None, sid) in self.links:  # legacy provider-less link shape
      return self.links[(None, sid)], "session-link"
    # 2. Task tool_use_id match.
    for tuid in session.get("tool_use_ids", []):
      if tuid in self.tooluse_to_chat:
        return self.tooluse_to_chat[tuid], "task-tool-use"
    # 4. Codex child inherits its parent_thread_id's chat (recursively).
    parent = session.get("parent_thread_id")
    if parent == sid:
      # Defensive read-side enforcement for an accumulator created by an older
      # parser: a session is never its own parent.
      parent = None
    if parent:
      seen = _seen or set()
      if parent in seen:
        return None, "parent-cycle"
      seen.add(sid)
      chat_id, reason = self.resolve(parent, sessions, seen)
      if chat_id:
        return chat_id, "parent-thread-link"
      # Propagate the real recursive reason: a cycle deeper in the chain must
      # surface as parent-cycle, not be masked as a plain parent-unlinked.
      return None, "parent-cycle" if reason == "parent-cycle" else "parent-unlinked"
    return None, "no-link"


def fetch_session_links(base_url: str, token: str) -> tuple[bool, dict[tuple, str]]:
  """GET /api/chats/session-links with the owner service token.

  Returns `(ok, links)` where `links` maps `(provider, session_id) -> chat_id`.

  `ok` is False ONLY on a genuine fetch FAILURE (missing token, network error,
  timeout, 5xx, or a malformed 2xx body) — the caller aborts the publish so a
  transient outage can't wipe the last-good documents. A 404 (the endpoint is
  absent on older instances) or an empty 2xx body is `ok=True` with an empty
  map: attribution simply falls through to the tool_use_id / parent strategies,
  which is NOT a failure.

  Keyed by `(provider, session_id)` — the backend's true link identity — so a
  Claude session id equal to a Codex thread id cannot collide. Rows carry a
  provider; a provider-less legacy shape is keyed `(None, session_id)` and
  resolve() falls back to it only when no provider-qualified link matched.
  Tolerant of several response shapes so a minor contract drift doesn't silently
  drop every link.
  """
  status, data = _api_get_json(base_url, "/api/chats/session-links", token)
  if status == 404:
    return True, {}          # endpoint absent -> empty, fall through (not a failure)
  if status != 200:
    return False, {}         # missing token / network / 5xx / malformed -> failure
  out: dict[tuple, str] = {}
  if isinstance(data, dict) and isinstance(data.get("links"), list):
    data = data["links"]
  if isinstance(data, dict):
    for k, v in data.items():
      if isinstance(v, str):
        out[(None, str(k))] = v
      elif isinstance(v, dict) and v.get("chat_id"):
        out[(v.get("provider"), str(k))] = str(v["chat_id"])
  elif isinstance(data, list):
    for row in data:
      if isinstance(row, dict) and row.get("session_id") and row.get("chat_id"):
        out[(row.get("provider"), str(row["session_id"]))] = str(row["chat_id"])
  return True, out


def fetch_chats(base_url: str, token: str) -> tuple[bool, dict[str, dict]]:
  """GET /api/chats — the roster of chats with title + created_by_app_id. The
  list endpoint omits provider, so provider is filled from the session trace.

  Returns `(ok, chats)`. `ok` is False on any fetch FAILURE (missing token,
  network error, timeout, non-2xx, or a non-list body) — the caller must NOT
  rebuild storage from a failed roster (every session would fall to `unlinked`
  and overwrite/delete the good documents). A 2xx list body is a SUCCESS even
  when empty (a genuinely empty roster is `ok=True, {}`).
  """
  status, data = _api_get_json(base_url, "/api/chats?include_app_chats=true", token)
  if status != 200 or not isinstance(data, list):
    return False, {}
  out: dict[str, dict] = {}
  for c in data:
    if isinstance(c, dict) and c.get("id"):
      out[str(c["id"])] = {
        "title": c.get("title") or "Untitled chat",
        "provider": c.get("provider"),
        "created_by_app_id": c.get("created_by_app_id"),
        "activity_at": c.get("activity_at") or c.get("updated_at"),
      }
  return True, out


# The tool block a chat records when it spawns a background helper. The name
# is NOT stable across agent-SDK versions — the same delegation surfaces as
# "Task" on some pins and "Agent" on others — and a chat only has to disagree
# with this set once for every helper in it to fall into the unlinked bucket
# with no error anywhere. Matching the set (rather than one literal) keeps a
# transcript readable across a version bump in either direction.
SPAWNING_TOOL_NAMES = ("Task", "Agent")


def build_tooluse_map(base_url: str, token: str, chats_meta: dict[str, dict],
                      scanned: dict[str, str], budget: Budget,
                      max_fetches: int = 12) -> dict[str, str]:
  """Fallback attribution index: `Task tool_use_id -> chat_id`, built by
  scanning a BOUNDED number of chats per run for Task tool blocks. Progressive:
  `scanned` grows across runs so the whole roster is eventually covered without
  ever fetching all chats in one slice.

  `scanned` is a `chat_id -> activity_at-when-scanned` cursor, NOT a plain set,
  so two staleness bugs are avoided:
    - A chat is recorded scanned ONLY after a SUCCESSFUL fetch; a failed GET
      leaves it unscanned so a later run retries it (a transient 500 no longer
      permanently strands a chat's Task ids in the unlinked bucket).
    - A chat is RE-scanned when its `activity_at` advances past the value we
      stored: a Task helper spawned later inside an already-scanned chat is
      picked up on the next run instead of staying unlinked forever.
  Most-recently-active chats are scanned first so live activity is covered
  within the per-run fetch budget before old backfill.
  """
  out: dict[str, str] = {}
  fetched = 0
  ordered = sorted(chats_meta.items(),
                   key=lambda kv: kv[1].get("activity_at") or "", reverse=True)
  for chat_id, meta in ordered:
    if fetched >= max_fetches or budget.exhausted:
      break
    activity = meta.get("activity_at") or ""
    prev = scanned.get(chat_id)
    if prev is not None and prev >= activity:
      continue  # already scanned at this activity mark; nothing new to find
    status, payload = _api_get_json(base_url, f"/api/chats/{chat_id}?limit=400", token)
    fetched += 1
    if status != 200 or not isinstance(payload, dict):
      continue  # do NOT mark scanned on failure -> retried on a later run
    scanned[chat_id] = activity
    for msg in payload.get("messages", []):
      for block in (msg.get("blocks") or []) if isinstance(msg, dict) else []:
        if not isinstance(block, dict) or not block.get("tool_use_id"):
          continue
        if block.get("tool") in SPAWNING_TOOL_NAMES:
          out[str(block["tool_use_id"])] = chat_id
  return out


# ---------------------------------------------------------------------------
# Helpers derived from the chat's OWN Agent block
# ---------------------------------------------------------------------------
# A chat records every helper it spawns as an `Agent` tool block: the input
# carries the goal and the helper type, the output carries whatever the helper
# handed back. That is enough to answer "what ran, what did it do, how did it
# end" without any new instrumentation — and unlike the local-trace route it is
# attributed PERFECTLY, because the block is already inside a known chat. On
# this instance the trace route resolved 3 chats while the blocks cover 21.

_ERROR_HEAD = re.compile(
  r"^\s*(API Error\b|error\b|failed\b|Traceback \(most recent call last\))", re.I)


def _agent_field(text: str, name: str) -> Optional[str]:
  """One spawn argument out of an Agent block's input.

  The input reaches us as a STRING in one of two shapes — a Python-dict repr
  (`{'description': '...'}`) or comma-separated `key=value` — and either can be
  clipped mid-value because long tool inputs are truncated. Rather than commit
  to one grammar, pull each field independently and tolerate a value that runs
  off the end.
  """
  if not isinstance(text, str) or not text:
    return None
  for pattern in (
    rf"['\"]{name}['\"]\s*:\s*'((?:[^'\\]|\\.)*)'",   # quoted, closed
    rf"['\"]{name}['\"]\s*:\s*'((?:[^'\\]|\\.)*)$",   # quoted, truncated
    rf"(?:^|,\s*){name}=([\s\S]*?)(?=,\s*[A-Za-z_][A-Za-z0-9_]*=|$)",
  ):
    hit = re.search(pattern, text)
    if hit:
      value = (hit.group(1) or "")
      value = (value.replace("\\n", "\n").replace("\\t", "\t")
               .replace("\\'", "'").replace('\\"', '"').strip())
      if value:
        return value
  return None


def _split_agent_output(output) -> tuple[Optional[str], Optional[str], Optional[str]]:
  """`(body, agent_id, usage)` — the helper's result separated from bookkeeping.

  A returned payload concatenates three different things: the actual result, a
  line naming the agent so it can be resumed, and a usage block. Split them so
  the result can be shown alone and the bookkeeping does not leak into a summary
  the reader is trying to skim.
  """
  raw = output if isinstance(output, str) else ""
  agent_hit = re.search(r"agentId:\s*([A-Za-z0-9_-]+)", raw)
  usage_hit = re.search(r"<usage>([\s\S]*?)</usage>", raw)
  body = re.sub(r"<usage>[\s\S]*?</usage>", "", raw)
  body = re.sub(r"^.*agentId:\s*[A-Za-z0-9_-]+.*$", "", body, flags=re.M).strip()
  return (body or None,
          agent_hit.group(1) if agent_hit else None,
          usage_hit.group(1) if usage_hit else None)


_FINISHED_WORDS = {"done", "finished", "completed", "complete", "success"}
_WORKING_WORDS = {"running", "in_progress", "in-progress", "working", "started"}
_STOPPED_WORDS = {"stopped", "cancelled", "canceled", "interrupted", "aborted"}


def helper_from_agent_block(block: dict, ordinal: int = 0,
                            scope: str = "") -> Optional[dict]:
  """One bounded helper-evidence record derived from an `Agent` tool block.

  The recorded status is NOT trustworthy on its own: in production, helpers
  whose payload is an outright API error are still written down as `done`. When
  the payload contradicts the status the payload wins, because a helper that
  returned an error did not do the work whatever the bookkeeping says. The
  payload wins, so downstream assembly never repeats a comfortable lie.
  """
  if not isinstance(block, dict):
    return None
  raw_input = block.get("input")
  raw_input = raw_input if isinstance(raw_input, str) else ""
  body, agent_id, _usage = _split_agent_output(block.get("output"))
  is_async = bool(body) and _ASYNC_ACK in body

  if body is None:
    kind = "none"
  elif _ERROR_HEAD.match(body[:200]):
    kind = "error"
  else:
    kind = "result"

  status_word = str(block.get("status") or "").strip().lower()
  if kind == "error":
    state = "failed"
  elif is_async:
    # The launch acknowledgement is not a completion report. A later result
    # block or downstream transcript may supersede this working state when all
    # evidence for the agent_id is reconciled during document assembly.
    state = "working"
  elif status_word in _FINISHED_WORDS:
    state = "finished"
  elif status_word in _WORKING_WORDS:
    state = "working"
  elif status_word in _STOPPED_WORDS:
    state = "stopped"
  else:
    state = "unavailable"

  description = _agent_field(raw_input, "description")
  prompt = _agent_field(raw_input, "prompt")
  goal = description or ((prompt or "").split("\n")[0].strip() or None)
  return {
    "agent_id": (agent_id or block.get("tool_use_id")
                 or _stable_agent_id(goal, raw_input, ordinal, scope)),
    # description + agent_type come from arbitrary tool INPUT, so they get the
    # same scrub + cap every other free-text field that leaves this job gets —
    # a spawn prompt can quote a secret just as a report can. None stays None
    # ("not recorded"), never a placeholder.
    "description": clip_line(goal) if goal else None,
    "agent_type": clip_line(_agent_field(raw_input, "subagent_type"), 48) or None,
    "status": state,
    # A helper's returned payload is arbitrary text and can quote a secret.
    "_full_outcome": _cap_report(scrub(body)) if body and not is_async else None,
    "_brief_full": clip_prompt(prompt) or "",
    # A launch hint only; joined terminal evidence supersedes it later.
    "is_async": is_async,
  }


def _handback(blocks: list, start: int, max_actions: int = 5) -> dict:
  """What the chat did with a helper's result, read from the blocks that follow
  the `Agent` block at `start`.

  This is the "how did it get merged back in" half of a helper's story, and the
  transcript already answers it: the parent's next text block is usually it
  saying what the result means, and the tool calls after that are it acting on
  the result. Scanning STOPS at the next spawn, so one helper is never credited
  with the follow-up work of another.

  Deliberately named for what it can prove — this is what the chat did NEXT,
  which is evidence of a handback, not proof of causation. The UI must not
  promise more than that, so nothing here is called "merged".
  """
  note: Optional[str] = None
  actions: list[dict] = []
  truncated = False
  for block in blocks[start + 1:]:
    if not isinstance(block, dict):
      continue
    if block.get("type") == "text":
      if note is None:
        text = clip_line(scrub(str(block.get("content") or "")).strip(), 240)
        note = text or None
      continue
    if block.get("type") != "tool":
      continue
    if block.get("tool") in SPAWNING_TOOL_NAMES:
      break
    if len(actions) >= max_actions:
      truncated = True
      break
    actions.append({
      "tool": str(block.get("tool") or "tool"),
      "target": clip_line(scrub(str(block.get("input") or "")).strip(), 90) or None,
    })
  return {"note": note, "actions": actions, "actions_truncated": truncated}


def _stable_agent_id(goal: Optional[str], raw_input: str, ordinal: int,
                     scope: str = "") -> str:
  """A deterministic id for a helper whose payload never named one, so the same
  block keeps the same identity across runs instead of churning storage.

  The block's position in the chat is part of the seed because two spawns can
  be genuinely indistinguishable — production has a pair whose input AND output
  are both empty, and content alone hashes them together. They are still two
  helpers, so they must not collapse into one record; position is the only
  thing left that separates them, and it is stable as long as the transcript is
  append-only.
  """
  # `scope` is the chat id when available. v2 helper documents are globally
  # addressed as helpers/<agent_id>.json, so identical blank/trimmed blocks in
  # two chats must not collide.
  seed = f"{scope}|{ordinal}|{goal or ''}|{raw_input[:200]}"
  return "blk" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:15]


# The payload a spawn returns when it is launched to run in the background rather
# than awaited inline. Its presence is what tells "still out this turn" apart
# from "came back with a result", and it is NOT an error.
_ASYNC_ACK = "Async agent launched successfully"

# Ceiling so a chat document cannot grow without bound. The newest tool-using
# turns are retained; helper detail remains available in its own document.
MAX_CHAT_TURNS = 40


# A spawn prompt / brief can be long; cap it generously enough to be a real
# preview (multi-paragraph) but bounded so a chat doc full of subagents can't
# bloat. Scrubbed like every other free-text field; "…" marks a cut.
PROMPT_CAP = 700


def clip_prompt(text: Optional[str]) -> Optional[str]:
  if not text:
    return None
  out = scrub(text).strip()
  if not out:
    return None
  return out[:PROMPT_CAP - 1] + "…" if len(out) > PROMPT_CAP else out


def clip_markdown(text: Optional[str], cap: int) -> Optional[str]:
  """Scrub + cap a free-text field but KEEP newlines, so the renderer can see
  markdown structure (bullets, paragraphs). `clip_line` flattens newlines to
  spaces and would collapse a list into one run-on line."""
  if not text:
    return None
  out = scrub(str(text)).strip()
  if not out:
    return None
  return out[:cap - 1] + "…" if len(out) > cap else out


def _owner_request(text: str) -> str:
  """Remove injected context envelopes before using the first user request.

  Restored legacy chats can prepend `<agent_context>...</agent_context>` to the
  owner's actual message. Treating that system-owned prelude as a title source
  produced titles such as "<agent_context> # Agent experience".
  """
  out = scrub(text).strip()
  envelope = re.compile(
    r"^\s*<(?:agent_context|environment_context|system-reminder)>[\s\S]*?"
    r"</(?:agent_context|environment_context|system-reminder)>\s*", re.I)
  while envelope.match(out):
    out = envelope.sub("", out, count=1).strip()
  return _cap_report(out)


def _walk_chat(messages: list, scope: str = "") -> tuple[list[dict], list[dict]]:
  """Collect helper evidence and every tool-using assistant turn in one pass.

  v2 deliberately includes a tool turn even when it did not spawn a helper: the
  owner's requested Beat Machine validator example is such a turn, and omitting
  it would make the outcome journal skip the exact handback that needs review.
  Private `_tools`/`_agent_ids` fields are bounded, scrubbed parse evidence; the
  public document is derived from them later after downstream helpers are joined.
  """
  helpers: list[dict] = []
  turns: list[dict] = []
  first_request = ""
  last_user_ts = None
  for msg in messages:
    if not isinstance(msg, dict):
      continue
    if msg.get("role") == "user":
      content = msg.get("content")
      if isinstance(content, str) and content.strip() and not first_request:
        first_request = _owner_request(content)
      if isinstance(msg.get("ts"), (int, float, str)):
        last_user_ts = msg.get("ts")
      continue
    blocks = msg.get("blocks") or []
    if not any(isinstance(b, dict) and b.get("type") == "tool" for b in blocks):
      continue
    note_texts: list[str] = []
    tools: list[dict] = []
    agent_ids: list[str] = []
    for index, block in enumerate(blocks):
      if not isinstance(block, dict):
        continue
      btype = block.get("type")
      if btype == "text":
        text = clip_markdown(block.get("content"), FINAL_REPORT_CAP)
        if text:
          note_texts.append(text)
      elif btype == "tool":
        if block.get("tool") in SPAWNING_TOOL_NAMES:
          record = helper_from_agent_block(
            block, ordinal=len(helpers), scope=scope)
          if not record:
            continue
          handback = _handback(blocks, index)
          record["_handback"] = handback
          helpers.append(record)
          agent_ids.append(str(record["agent_id"]))
        else:
          tools.append({
            "tool": clip_line(str(block.get("tool") or "tool"), 80),
            "status": clip_line(str(block.get("status") or ""), 40),
            "input": clip_markdown(str(block.get("input") or ""), 1600) or "",
            "output": clip_markdown(str(block.get("output") or ""), 2400) or "",
          })
    turns.append({
      "ts": msg.get("ts") if isinstance(msg.get("ts"), (int, float, str)) else last_user_ts,
      "nblocks": len(blocks),
      "_agent_ids": agent_ids,
      "_tools": tools,
      "_original": note_texts[-1] if note_texts else "",
      "_first_request": first_request,
    })
  # Messages arrive oldest-first; retain the newest bounded window.
  return helpers, turns[-MAX_CHAT_TURNS:]


def scan_chat_helpers(base_url: str, token: str, chats_meta: dict[str, dict],
                      scanned: dict[str, str], budget: Budget,
                      max_fetches: Optional[int] = None
                      ) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
  """`(chat_id -> [helper record], chat_id -> [timeline turn])` for chats whose
  transcript contains Agent blocks. Bounded and progressive on the SAME cursor
  contract as build_tooluse_map: most-recently-active first, a chat is only
  marked scanned after a successful fetch, and it is re-scanned when its activity
  advances. Helpers and turns come from one walk (`_walk_chat`) so a branch and
  its helper share an id.

  The per-run cap exists so an unattended refresh stays inside its time budget,
  but it also sets how long a first backfill takes to reach old history: the
  cap is per run, and the newest chats are not the ones that ran helpers. The
  cursor makes catching up safe to do in bigger strides, so the limit is
  overridable via `WORKFLOWS_MAX_CHAT_SCANS` for a one-time sweep.
  """
  if max_fetches is None:
    try:
      max_fetches = int(os.environ.get("WORKFLOWS_MAX_CHAT_SCANS", "") or 40)
    except ValueError:
      max_fetches = 40
  out: dict[str, list[dict]] = {}
  turns_out: dict[str, list[dict]] = {}
  rescanned: set[str] = set()
  fetched = 0
  ordered = sorted(chats_meta.items(),
                   key=lambda kv: kv[1].get("activity_at") or "", reverse=True)
  for chat_id, meta in ordered:
    if fetched >= max_fetches or budget.exhausted:
      break
    activity = meta.get("activity_at") or ""
    prev = scanned.get(chat_id)
    if prev is not None and prev >= activity:
      continue
    status, payload = _api_get_json(base_url, f"/api/chats/{chat_id}?limit=400", token)
    fetched += 1
    if status != 200 or not isinstance(payload, dict):
      continue
    scanned[chat_id] = activity
    rescanned.add(chat_id)
    helpers, turns = _walk_chat(payload.get("messages", []), scope=chat_id)
    if helpers:
      out[chat_id] = helpers
    if turns:
      turns_out[chat_id] = turns
  # `rescanned` is every chat freshly walked this slice, empty results included,
  # so the caller can DROP stale state for a chat whose spawns were later
  # compacted away — an overlay-only merge could never clear it otherwise.
  return out, turns_out, rescanned


def _api_get_json(base_url: str, path: str, token: str) -> tuple[Optional[int], object]:
  """GETs `path` with the bearer token. Returns `(status, data)`:

    - `(200, <json>)` on a 2xx with a parseable body — the only trustworthy
      SUCCESS (the body may still be an empty list/dict: an empty SUCCESS).
    - `(<code>, None)` for an HTTP error response (4xx/5xx), so a caller can
      treat a 404 as "endpoint absent" but a 500 as a failure.
    - `(None, None)` for a network-level failure (timeout, refused, DNS), a
      malformed 2xx body, or a MISSING TOKEN.

  Distinguishing a failure from an empty success is load-bearing: a caller that
  rebuilds storage from an all-empty roster would DELETE the last-good documents
  (see run_refresh). A `None` status or a non-2xx status both mean "do not trust
  this as data".
  """
  if not token:
    return None, None
  try:
    req = urllib.request.Request(
      base_url.rstrip("/") + path,
      headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=10) as resp:
      status = getattr(resp, "status", None) or 200
      try:
        return status, json.load(resp)
      except ValueError:
        return None, None
  except urllib.error.HTTPError as exc:
    return exc.code, None
  except (urllib.error.URLError, OSError):
    return None, None


# --- derived status ---------------------------------------------------------

def derive_status(agent: dict, now: float) -> str:
  """Maps a helper digest to the frozen status vocabulary from ARTIFACTS ONLY.

  Order matters: explicit terminal failure/result wins over every launch or
  freshness hint. A final report from an expired source is still terminal
  evidence; expiration only means the internal trail is no longer available.
  A fresh transcript remains working before a non-journal final note is accepted.
  """
  if agent.get("board_status") == "failed" or _result_is_failure(agent.get("result")):
    return "failed"
  if _result_is_success(agent.get("result")):
    return "finished"
  if _is_fresh(agent.get("last_ts"), now):
    return "working"
  if agent.get("final_report"):
    return "finished"
  if agent.get("source_expired"):
    return "unavailable"
  if agent.get("has_activity"):
    return "stopped"
  return "unavailable"


def _result_is_failure(result) -> bool:
  if not isinstance(result, dict):
    return False
  status = str(result.get("collab_status", "")).lower()
  if status in ("failed", "error"):
    return True
  verdict = str(result.get("verdict", "")).lower()
  return verdict in ("failed", "error")


def _result_is_success(result) -> bool:
  """A journal result (any non-failure dict) is the authoritative finished
  signal. A collab state that is still inProgress is NOT success."""
  if result is None:
    return False
  if isinstance(result, dict):
    status = str(result.get("collab_status", "")).lower()
    if status in ("inprogress", "in_progress", "working", ""):
      return status not in ("inprogress", "in_progress", "working")
    return True
  return True


def _is_fresh(ts_iso: Optional[str], now: float) -> bool:
  epoch = _iso_to_epoch(ts_iso)
  return epoch is not None and (now - epoch) < FRESH_SECS


# --- document assembly ------------------------------------------------------

_APP_NOUNS = {
  "10": "Beat Machine", "12": "News", "39": "Reflection",
  "89": "Workflows", "beat-machine": "Beat Machine",
  "beatmachine": "Beat Machine", "news": "News", "notes": "Notes",
  "workflows": "Workflows", "reflection": "Reflection",
  "habit-tracker": "Habit Tracker", "recipes": "Recipes",
  "cuberun": "CubeRun", "cube-run": "CubeRun",
}

_DELIVERY_START = re.compile(
  r"^(?:done\b|fixed\b|added\b|built\b|here(?:'|’)s\b|updated\b|replaced\b|created\b|removed\b)", re.I)
_PROCEDURAL_START = re.compile(
  r"^(?:let me\b|let(?:'|’)s\b|checking\b|server\b|now\b|next\b|then\b|first\b|curl\b|bash\b|python\b|grep\b|npm\b|pnpm\b|\$)", re.I)
_NEGATIVE_EVIDENCE = re.compile(
  r"(?:\"valid\"\s*:\s*false|\b(?:failed|failure|error|invalid)\b|won't mount|does not load|not found)", re.I)
_POSITIVE_EVIDENCE = re.compile(
  r"(?:\"valid\"\s*:\s*true|\btests? pass(?:ed)?\b|\bverified\b|\bvalidation passed\b|\bbuild succeeded\b)", re.I)
_VERIFY_COMMAND = re.compile(
  r"(?:pytest|vitest|jest|npm\s+(?:run\s+)?(?:test|build|lint)|pnpm\s+(?:test|build|lint)|/validate\b|validator\b|\btsc\b|playwright)", re.I)
_HEDGE_EVIDENCE = re.compile(
  r"(?:\bnot\s+100%\s+sure\b|\bhopefully\b|\bi\s+(?:think|believe)\b|"
  r"\bin\s+(?:theory|principle)\b|\bassuming\b|\bpresumably\b|"
  r"\b(?:should(?:\s+be)?|ought\s+to|likely(?:\s+to)?|probably(?:\s+will)?|"
  r"might|may)\s+(?:now\s+|still\s+|not\s+)*(?:be\s+)?"
  r"(?:work(?:ing)?|load(?:ing)?|open(?:ing)?|render(?:ing)?|run(?:ning)?|"
  r"show(?:ing)?|display(?:ing)?|behave|succeed|pass|survive|hold|"
  r"fine|okay|ok|ready|done|complete|correct|good|stable|safe)\b|"
  r"\b(?:i|we)\s+(?:(?:will|can)\s+|(?:'|’)ll\s+)?(?:try|attempt)\b)", re.I)
_STOPPED_EVIDENCE = re.compile(
  r"(?:\bcould(?:n(?:'|’)t| not)\s+complete\b|\bunable\s+to\s+complete\b|"
  r"\b(?:the\s+)?work\s+stopped\b|\bi\s+stopped\s+(?:the\s+)?work\b)", re.I)


def _canonical_state(value: Optional[str]) -> str:
  state = str(value or "").lower()
  if state in ("done", "finished", "returned", "complete", "completed"):
    return "done"
  if state in ("running", "working", "launched", "in_progress", "inprogress"):
    return "running"
  if state in ("failed", "error"):
    return "failed"
  return "stopped"


def _resolved_state(states: Iterable[str]) -> str:
  """One lifecycle answer for every surface.

  Evidence is joined by agent_id before this is called. Terminal evidence is
  more resolved than a launch acknowledgement: failure wins, then a returned
  result, then a terminal stop, and only then an unresolved running/launch
  record. This precedence is shared by roster, turn cards, and helper pages.
  """
  values = {_canonical_state(s) for s in states}
  for state in ("failed", "done", "stopped", "running"):
    if state in values:
      return state
  return "stopped"


def _plain_ask(text: Optional[str]) -> str:
  line = clip_line(str(text or ""), 240)
  line = re.sub(
    r"^(?:please\s+|your task is to\s+|i need you to\s+|i need to\s+)",
    "", line, flags=re.I).strip()
  return line or "No brief was recorded"


def _kind_and_name(agent_type: Optional[str], provider: str = "") -> tuple[str, str]:
  raw = f"{agent_type or ''} {provider}".lower()
  if any(word in raw for word in ("explore", "research", "search")):
    return "explore", "Explorer"
  if "codex" in raw:
    return "codex", "Codex"
  if any(word in raw for word in ("build", "implement", "frontend", "code")):
    return "build", "Helper"
  return "general", "Helper"


def _tool_verb(tool: str) -> tuple[str, str]:
  name = tool.lower().replace("-", "_")
  if name in ("read", "read_file"):
    return "read", "files"
  if name in ("edit", "multiedit", "apply_patch", "applypatch"):
    return "edited", "files"
  if name in ("write", "write_file", "create_file"):
    return "wrote", "files"
  if name in ("bash", "shell", "exec_command", "run_command"):
    return "ran", "commands"
  if name in ("grep", "glob", "rg", "search", "find"):
    return "searched", "code"
  return "used", "tools"


def _did_from_tools(tools: list[dict]) -> list[dict]:
  counts: dict[tuple[str, str], int] = {}
  for tool in tools:
    key = _tool_verb(str(tool.get("tool") or "tool"))
    counts[key] = counts.get(key, 0) + 1
  ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0][0]))[:4]
  return [{"verb": verb, "label": label, "count": count}
          for (verb, label), count in ordered]


def _acts_from_did(did: list[dict]) -> list[str]:
  return [f"{step['verb']} ×{step['count']}" for step in did]


def _commands_from_tools(tools: list[dict], cap: int = 12) -> list[str]:
  commands: list[str] = []
  for tool in tools:
    detail = clip_line(str(tool.get("input") or ""), 240)
    if detail and detail not in commands:
      commands.append(detail)
    if len(commands) >= cap:
      break
  return commands


def _trace_evidence(agent: dict, now: float, provider: str) -> dict:
  status = _canonical_state(derive_status(agent, now))
  tools = [{"tool": str(step.get("title") or "tool"),
            "input": str(step.get("detail") or ""), "output": "",
            "status": ""} for step in agent.get("steps", [])]
  result = agent.get("result")
  structured = ""
  if isinstance(result, dict):
    structured = next((str(result[k]) for k in ("summary", "message", "verdict")
                       if result.get(k)), "")
  elif isinstance(result, str):
    structured = result
  report = _cap_report(agent.get("final_report") or structured)
  brief = clip_prompt(agent.get("goal")) or ""
  return {
    "agent_id": str(agent["agent_id"]), "agent_type": agent.get("agent_type") or "",
    "ask": _plain_ask(agent.get("description") or agent.get("goal")),
    "brief_full": brief, "state": status, "report_full": report,
    "tools": tools, "next": "", "provider": provider, "origin": "trace",
    "ts": agent.get("started_at") or agent.get("last_ts"),
  }


def _next_from_handback(handback: dict) -> str:
  if not isinstance(handback, dict):
    return ""
  if handback.get("note"):
    return clip_line(str(handback["note"]), 280)
  actions = handback.get("actions") or []
  if actions:
    action = actions[0]
    tool = str(action.get("tool") or "tool").lower()
    target = str(action.get("target") or "").strip()
    return clip_line(f"Next, the chat used {tool}{' on ' + target if target else ''}.", 280)
  return ""


def _block_evidence(helper: dict, provider: str) -> dict:
  return {
    "agent_id": str(helper["agent_id"]),
    "agent_type": helper.get("agent_type") or "",
    "ask": _plain_ask(helper.get("description") or helper.get("_brief_full")),
    "brief_full": helper.get("_brief_full") or "",
    "state": _canonical_state(helper.get("status")),
    "report_full": helper.get("_full_outcome") or "",
    "tools": [], "next": _next_from_handback(helper.get("_handback") or {}),
    "provider": provider, "origin": "block", "ts": None,
  }


def _delivery_sentence(text: Optional[str]) -> Optional[str]:
  raw = scrub(str(text or "")).strip()
  if not raw:
    return None
  sentences = [clip_line(s, OUTCOME_CAP) for s in
               re.split(r"(?<=[.!?])\s+|\n+", raw) if s.strip()]
  for sentence in sentences:
    cleaned = re.sub(r"^[#>*\-\d.\s]+", "", sentence).strip()
    cleaned = cleaned.replace("**", "").replace("__", "").replace("`", "")
    empty_lead = re.match(
      r"^(?:done[.!]?|here(?:'|’)s (?:what (?:changed|i changed)|what i did):?)$",
      cleaned, re.I)
    if (_DELIVERY_START.match(cleaned) and not _PROCEDURAL_START.match(cleaned)
        and not empty_lead and not re.search(r"(?:/data/|/app/)", cleaned)):
      cleaned = cleaned.rstrip().removesuffix(":").rstrip()
      if not cleaned:
        continue
      return cleaned[:1].upper() + cleaned[1:]
  return None


def _plain_result(report: str, state: str) -> str:
  if state == "failed":
    return "A failure was recorded; the technical report has the original details."
  if not report:
    return ""
  delivery = _delivery_sentence(report)
  if delivery:
    return delivery
  for part in re.split(r"(?<=[.!?])\s+|\n+", report):
    line = clip_line(part, 240)
    if line and not _PROCEDURAL_START.match(line):
      return line
  return ""


def _merge_evidence(records: list[dict], provider: str) -> dict:
  state = _resolved_state(r.get("state", "stopped") for r in records)
  # Prefer a report attached to the resolved terminal state, then downstream
  # trace words, then any recorded report. Async acknowledgements were removed
  # at parse time and can never masquerade as a report here.
  reports = [r for r in records if r.get("report_full")]
  reports.sort(key=lambda r: (
    r.get("state") == state, r.get("origin") == "trace",
    len(r.get("report_full") or "")), reverse=True)
  report = reports[0]["report_full"] if reports else ""
  briefs = [r.get("brief_full") or "" for r in records]
  asks = [r.get("ask") or "" for r in records
          if r.get("ask") and r.get("ask") != "No brief was recorded"]
  types = [r.get("agent_type") or "" for r in records if r.get("agent_type")]
  tools = [tool for r in records for tool in r.get("tools", [])]
  next_lines = [r.get("next") or "" for r in records if r.get("next")]
  kind, name = _kind_and_name(types[0] if types else "", provider)
  did = _did_from_tools(tools)
  return {
    "agent_id": records[0]["agent_id"], "kind": kind, "name": name,
    "ask": asks[0] if asks else "No brief was recorded",
    "state": state, "acts": _acts_from_did(did),
    "result": _plain_result(report, state),
    "brief_full": max(briefs, key=len) if briefs else "",
    "tappable": True, "did": did, "report_full": report,
    "next": next_lines[-1] if next_lines else "",
    "commands": _commands_from_tools(tools), "_tools": tools,
    "ts": next((r.get("ts") for r in records if r.get("ts")), None),
  }


def _owner_noun(parts: Iterable[str]) -> str:
  text = "\n".join(str(part or "") for part in parts)
  apps: set[str] = set()
  for slug in re.findall(r"/data/apps/([A-Za-z0-9_-]+)", text):
    noun = _APP_NOUNS.get(slug.lower())
    if noun:
      apps.add(noun)
    elif not slug.isdigit() and slug.lower() not in ("shared", "state"):
      apps.add(slug.replace("_", "-").replace("-", " ").title())
  for app_id in re.findall(r"(?:/api/apps/|/data/compiled/app-)(\d+)", text):
    if app_id in _APP_NOUNS:
      apps.add(_APP_NOUNS[app_id])
  if len(apps) > 1:
    return f"{len(apps)} mini-apps"
  if apps:
    return next(iter(apps))
  low = text.lower()
  if "/data/shell/" in low:
    return "the chat UI"
  if "theme.css" in low or "/data/shared/" in low:
    return "mini-app styling"
  return "the platform"


def _request_noun(request: str) -> Optional[str]:
  """A high-confidence app/site name for a not-yet-created source directory.

  Keep this deliberately narrow: `building Name — description` is a naming
  construction, while a generic request such as `build a period tracking app`
  is a description and should not be promoted into a guessed product name.
  """
  text = scrub(request).strip()
  hit = re.search(
    r"\b(?:building|creating)\s+([A-ZÀ-ÖØ-Þ][^—–\n]{1,60}?)\s+[—–]\s+",
    text)
  if not hit:
    return None
  noun = clip_line(hit.group(1).strip(" \t.,:;\"'“”‘’"), 80)
  return noun or None


def _has_change(tools: list[dict]) -> bool:
  for tool in tools:
    name = str(tool.get("tool") or "").lower()
    detail = str(tool.get("input") or "")
    if name in ("edit", "multiedit", "write", "apply_patch", "applypatch", "create_file"):
      return True
    if re.search(r"(?:curl\b[^\n]*\s-X\s+(?:PATCH|POST|PUT|DELETE)\b|\brm\s|\bmv\s|\bcp\s|sed\s+-i\b)", detail, re.I):
      return True
  return False


def _turn_verb(tools: list[dict]) -> str:
  names = {str(t.get("tool") or "").lower() for t in tools}
  if names & {"write", "create_file", "write_file"} and not names & {"edit", "multiedit", "apply_patch"}:
    return "Built"
  if names & {"edit", "multiedit", "write", "apply_patch", "applypatch", "create_file"}:
    return "Updated"
  return "Investigated"


def _verification_signal(tools: list[dict], original: str) -> str:
  signal = "none"
  for tool in tools:
    status = str(tool.get("status") or "").lower()
    command = str(tool.get("input") or "")
    output = str(tool.get("output") or "")
    if status in ("failed", "error"):
      signal = "failed"
    elif _VERIFY_COMMAND.search(command) and _NEGATIVE_EVIDENCE.search(output):
      signal = "failed"
    elif _VERIFY_COMMAND.search(command) and _POSITIVE_EVIDENCE.search(output):
      signal = "confirmed"
  if signal != "none":
    return signal
  if (_POSITIVE_EVIDENCE.search(original)
      and not re.search(r"\b(?:should|might|could|hopefully|seems?|appears?)\b", original, re.I)):
    return "confirmed"
  return "none"


def _hedges_result(original: str) -> bool:
  """Whether the agent's own closing words express positive doubt.

  Missing test evidence is deliberately not doubt. This only examines the
  agent-authored report, never the user's request or tool output, so words such
  as "may" in a brief cannot turn an otherwise ordinary edit amber.
  """
  return bool(_HEDGE_EVIDENCE.search(original))


def _turn_stopped(original: str) -> bool:
  """An explicit owner-turn stop is doubt even without a helper lifecycle."""
  return bool(_STOPPED_EVIDENCE.search(original))


def _found_cause(original: str) -> bool:
  return bool(re.search(
    r"\b(?:root cause|the (?:issue|problem|cause) (?:is|was)|caused by|confirmed\s+.{0,30}\b(?:issue|problem))\b",
    original, re.I))


def _coerce_iso(value) -> Optional[str]:
  if isinstance(value, (int, float)):
    epoch = float(value) / 1000 if value > 10_000_000_000 else float(value)
    return _epoch_to_iso(epoch)
  if isinstance(value, str) and value.strip():
    return value.strip()
  return None


def _build_v2_turn(raw: dict, helpers: dict[str, dict],
                   request_hint: str = "") -> dict:
  subs = [helpers[aid] for aid in raw.get("_agent_ids", []) if aid in helpers]
  # Preserve one card per helper in a turn even when an async ack and later result
  # block both named the same agent_id.
  subs = list({sub["agent_id"]: sub for sub in subs}.values())
  tools = list(raw.get("_tools", [])) + [tool for sub in subs for tool in sub.get("_tools", [])]
  original = _cap_report(str(raw.get("_original") or ""))
  area = _owner_noun(
    [t.get("input", "") for t in tools] +
    [sub.get("brief_full", "") for sub in subs])
  if area == "the platform":
    area = (_request_noun(str(raw.get("_first_request") or ""))
            or _request_noun(request_hint) or area)
  verb = _turn_verb(tools)
  neutral = f"{verb} {area}"
  states = [sub["state"] for sub in subs]
  verification = _verification_signal(tools, original)
  changed = _has_change(tools)

  flag = None
  if "failed" in states:
    status, result = "attention", "couldn't complete"
    flag = "A helper reported a failure, so this turn needs a look."
  elif "running" in states:
    status, result = "running", "in progress"
  elif "stopped" in states:
    status, result = "attention", "stopped"
    flag = "The recorded work stopped without a completion result."
  elif verification == "failed":
    status, result = "attention", "not confirmed"
    flag = f"The recorded check for {area} failed, so the claimed result was not confirmed."
  elif _turn_stopped(original):
    status, result = "attention", "stopped"
    flag = "The recorded work stopped without a completion result."
  elif _hedges_result(original):
    status, result = "attention", "not confirmed"
    flag = f"The recorded report for {area} hedged the result, so it was not confirmed."
  else:
    status = "done"
    result = "found the cause" if not changed and _found_cause(original) else "done"

  delivery = _delivery_sentence(original)
  # A delivery claim is only a hero line when the evidence supports `done`.
  # Attention/running turns stay neutral and put the caveat in `flag`.
  outcome = delivery if status == "done" and delivery else neutral
  public_subs = [{k: v for k, v in sub.items() if not k.startswith("_") and
                  k not in ("did", "report_full", "next", "commands", "ts")}
                 for sub in subs]
  return {
    "outcome": clip_line(outcome, OUTCOME_CAP), "area": area,
    "result": result, "status": status, "flag": flag,
    "ts": _coerce_iso(raw.get("ts")), "subs": public_subs,
    "original": original, "commands": _commands_from_tools(tools),
    "nblocks": int(raw.get("nblocks") or 0),
  }


def _trace_turn(run: dict, agents: list[dict]) -> dict:
  tools = [tool for agent in agents for tool in agent.get("tools", [])]
  reports = [agent.get("report_full") or "" for agent in agents if agent.get("report_full")]
  return {
    "ts": run.get("started_at") or next((a.get("ts") for a in agents if a.get("ts")), None),
    "nblocks": len(tools), "_agent_ids": [a["agent_id"] for a in agents],
    "_tools": [], "_original": reports[-1] if reports else "",
    "_first_request": "",
  }


def _title_is_raw(title: str) -> bool:
  value = title.strip()
  if not value or value.lower() in ("new chat", "untitled chat"):
    return True
  if re.match(r"^(?:could|can|would|will) you\b|^please\b|^i (?:need|want|can't|am)\b|^so\b", value, re.I):
    return True
  if "```" in value or value.startswith("<"):
    return True
  return 36 <= len(value) <= 44 and value[-1].isalnum()


def _title_from_request(request: str, area: str, changed: bool) -> str:
  clean = clip_line(request, 180)
  clean = clean.split("```", 1)[0].strip()
  clean = re.sub(
    r"^(?:(?:could|can|would|will) you(?: please)?|please)\s+", "", clean,
    flags=re.I).strip()
  clean = re.sub(r"^(?:i (?:want|need)(?: you)? to|so)\s+", "", clean,
                 flags=re.I).strip()
  clean = re.sub(r"^(?:i(?:'|’)m|i am)\s+", "", clean, flags=re.I).strip()
  clean = re.sub(r"^build me\s+", "Build ", clean, flags=re.I).strip()
  clean = re.split(r"[.!?\n]", clean)[0].strip()
  words = clean.split()
  if words:
    candidate = " ".join(words[:10]).rstrip(" ,;:-")
    return candidate[:1].upper() + candidate[1:]
  if area == "the platform":
    return "Background work"
  return f"{area} {'update' if changed else 'investigation'}"


def _chat_status(turns: list[dict]) -> tuple[str, str]:
  if not turns:
    return "done", "done"
  running = [turn for turn in turns if turn["status"] == "running"]
  if running:
    return "running", "in progress"
  # The journal entry describes where the chat ended. Older unverified turns
  # stay visible in drill-in but do not keep a chat in "Needs you" after a later
  # turn resolved the work.
  return turns[-1]["status"], turns[-1]["result"]


def build_documents(model: dict, attribution: Attribution, now: float,
                    chat_helpers: Optional[dict[str, list[dict]]] = None,
                    chat_turns: Optional[dict[str, list[dict]]] = None
                    ) -> tuple[dict, dict[str, dict], dict[str, dict], dict[str, dict]]:
  """Rebuild schema-v2 journal, chat, and globally-addressed helper documents."""
  sessions = model["sessions"]
  evidence: dict[str, dict[str, list[dict]]] = {}
  synthetic_turns: dict[str, list[dict]] = {}
  providers: dict[str, str] = {}
  unlinked: dict[str, dict] = {}

  # Group runs by resolved chat. A session with no runs but that resolves to a
  # chat contributes nothing (it is the chat's own top-level turn); a session
  # with helpers that does NOT resolve becomes an unlinked row.
  runs_by_sid: dict[str, list[dict]] = {}
  for run in model["runs"].values():
    if run["agent_keys"]:
      runs_by_sid.setdefault(run["sid"], []).append(run)

  for sid, runs in runs_by_sid.items():
    chat_id, reason = attribution.resolve(sid, sessions)
    session = sessions.get(sid, {})
    if not chat_id:
      row = unlinked.setdefault(sid, {
        "provider": session.get("provider", "claude"),
        "session_id": sid, "reason": reason,
        "last_activity_at": session.get("last_activity_at"), "helpers": 0,
      })
      row["helpers"] += sum(len(r["agent_keys"]) for r in runs)
      continue
    provider = attribution.chats.get(chat_id, {}).get("provider") or session.get("provider") or "claude"
    providers[chat_id] = provider
    for run in runs:
      run_evidence = []
      for akey in run["agent_keys"]:
        agent = model["agents"].get(akey)
        if not agent:
          continue
        item = _trace_evidence(agent, now, provider)
        evidence.setdefault(chat_id, {}).setdefault(item["agent_id"], []).append(item)
        run_evidence.append(item)
      if run_evidence:
        synthetic_turns.setdefault(chat_id, []).append(_trace_turn(run, run_evidence))

  for chat_id, helpers in (chat_helpers or {}).items():
    provider = attribution.chats.get(chat_id, {}).get("provider") or providers.get(chat_id) or "claude"
    providers[chat_id] = provider
    for helper in helpers:
      if not helper.get("agent_id"):
        continue
      item = _block_evidence(helper, provider)
      evidence.setdefault(chat_id, {}).setdefault(item["agent_id"], []).append(item)

  chats: dict[str, dict] = {}
  helpers_out: dict[str, dict] = {}
  used_helper_ids: dict[str, str] = {}
  all_chat_ids = set(evidence) | set(chat_turns or {})
  for chat_id in all_chat_ids:
    if chat_id not in evidence or not evidence[chat_id]:
      continue  # roster contains chats with background helpers, not tool-only chats
    provider = providers.get(chat_id) or attribution.chats.get(chat_id, {}).get("provider") or "claude"
    merged: dict[str, dict] = {}
    for original_id, records in evidence[chat_id].items():
      helper = _merge_evidence(records, provider)
      public_id = original_id
      if public_id in used_helper_ids and used_helper_ids[public_id] != chat_id:
        suffix = hashlib.sha256(chat_id.encode()).hexdigest()[:6]
        public_id = f"{original_id}-{suffix}"
      used_helper_ids[public_id] = chat_id
      helper["agent_id"] = public_id
      merged[original_id] = helper

    owner_turns = list((chat_turns or {}).get(chat_id, []))
    referenced = {aid for turn in owner_turns for aid in turn.get("_agent_ids", [])}
    raw_turns = owner_turns + [turn for turn in synthetic_turns.get(chat_id, [])
                               if any(aid not in referenced for aid in turn.get("_agent_ids", []))]
    stored_title = str(attribution.chats.get(chat_id, {}).get("title") or "Untitled chat")
    turns = [_build_v2_turn(raw, merged, stored_title) for raw in raw_turns]
    turns.sort(key=lambda turn: turn.get("ts") or "")
    if not turns:
      continue

    first_request = next((raw.get("_first_request") for raw in owner_turns
                          if raw.get("_first_request")), "")
    last_turn = turns[-1]
    running_turns = [turn for turn in turns if turn["status"] == "running"]
    summary_turn = running_turns[-1] if running_turns else last_turn
    changed = any(turn["outcome"].startswith(("Updated ", "Built ")) for turn in turns)
    title = (stored_title if not _title_is_raw(stored_title)
             else _title_from_request(first_request, last_turn["area"], changed))
    status, result = _chat_status(turns)
    ts = max((turn["ts"] for turn in turns if turn.get("ts")), default=None)
    doc = {
      "schema": SCHEMA_VERSION, "chat_id": chat_id, "provider": provider,
      "title": clip_line(title, 120), "outcome": summary_turn["outcome"],
      "ts": ts, "turns": turns,
    }
    chats[chat_id] = doc
    for helper in merged.values():
      public_id = helper["agent_id"]
      helpers_out[public_id] = {
        "schema": SCHEMA_VERSION, "agent_id": public_id, "chat_id": chat_id,
        "kind": helper["kind"], "name": helper["name"], "ask": helper["ask"],
        "brief_full": helper["brief_full"], "state": helper["state"],
        "did": helper["did"], "result": helper["result"],
        "report_full": helper["report_full"], "next": helper["next"],
        "commands": helper["commands"],
      }

  index = _build_index(chats, helpers_out, now)
  return index, chats, helpers_out, unlinked


def _cap_report(text: str) -> str:
  out = scrub(text)
  if len(out.encode("utf-8")) <= FINAL_REPORT_CAP:
    return out
  # Cap on bytes (UTF-8) so a report of multibyte chars can't exceed the limit.
  return out.encode("utf-8")[:FINAL_REPORT_CAP].decode("utf-8", "ignore") + "…"


def _build_index(chats: dict[str, dict], helpers_out: dict[str, dict], now: float) -> dict:
  entries: list[dict] = []
  needs_attention: list[dict] = []
  task_counts: dict[str, int] = {}
  for helper in helpers_out.values():
    task_counts[helper["chat_id"]] = task_counts.get(helper["chat_id"], 0) + 1
  for chat_id, doc in chats.items():
    status, result = _chat_status(doc["turns"])
    last_turn = doc["turns"][-1]
    running_turns = [turn for turn in doc["turns"] if turn["status"] == "running"]
    summary_turn = running_turns[-1] if running_turns else last_turn
    row = {
      "chat_id": chat_id, "provider": doc["provider"], "title": doc["title"],
      "outcome": doc["outcome"], "area": summary_turn["area"], "result": result,
      "status": status, "tasks": task_counts.get(chat_id, 0), "ts": doc.get("ts"),
    }
    entries.append(row)
    if status != "done":
      if status == "running":
        reason = "running"
      elif result == "not confirmed":
        reason = "unverified"
      else:
        reason = "failed"
      needs_attention.append({
        "chat_id": chat_id, "title": doc["title"], "reason": reason,
        "outcome": doc["outcome"], "area": summary_turn["area"], "ts": doc.get("ts"),
      })
  entries.sort(key=lambda row: row.get("ts") or "", reverse=True)
  needs_attention.sort(key=lambda row: row.get("ts") or "", reverse=True)
  return {"schema": SCHEMA_VERSION, "updated_at": _epoch_to_iso(now),
          "needs_attention": needs_attention, "entries": entries}


# --- storage sink -----------------------------------------------------------

class StorageSink(Protocol):
  def put(self, rel_path: str, doc: dict) -> None: ...
  def delete(self, rel_path: str) -> None: ...


class HttpSink:
  """Writes documents through the platform storage API with the app token.

  `.json` bodies are the raw document (the storage route stores a `.json` PUT
  verbatim). Every write and delete is recorded on `self.writes` for the
  cron-log summary and the caller's return value — observability the caller
  reads, not hidden mutation.
  """

  def __init__(self, base_url: str, app_id: str, token: str):
    self.base = f"{base_url.rstrip('/')}/api/storage/apps/{app_id}"
    self.token = token
    self.writes: list[str] = []

  def put(self, rel_path: str, doc: dict) -> None:
    body = json.dumps(doc, ensure_ascii=False).encode("utf-8")
    self._request("PUT", rel_path, body)
    self.writes.append(f"PUT {rel_path} ({len(body)}b)")

  def delete(self, rel_path: str) -> None:
    self._request("DELETE", rel_path, None)
    self.writes.append(f"DELETE {rel_path}")

  def _request(self, method: str, rel_path: str, body: Optional[bytes]) -> None:
    req = urllib.request.Request(
      f"{self.base}/{rel_path}", data=body, method=method,
      headers={"Authorization": f"Bearer {self.token}",
               "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15):
      pass


class DictSink:
  """In-memory sink for --selftest: collects documents so asserts can inspect
  exactly what would have been written, no network."""

  def __init__(self):
    self.docs: dict[str, dict] = {}
    self.writes: list[str] = []

  def put(self, rel_path: str, doc: dict) -> None:
    self.docs[rel_path] = doc
    self.writes.append(f"PUT {rel_path}")

  def delete(self, rel_path: str) -> None:
    self.docs.pop(rel_path, None)
    self.writes.append(f"DELETE {rel_path}")


class LocalSink:
  """Local-only dry-run sink. It never calls the app storage API.

  Paths are resolved under `root` and rejected if they would escape it. Deletes
  apply only to files generated beneath that local root, so a dry run cannot
  mutate production storage or its database.
  """

  def __init__(self, root: Path):
    self.root = root.resolve()
    self.root.mkdir(parents=True, exist_ok=True)
    self.writes: list[str] = []

  def _path(self, rel_path: str) -> Path:
    path = (self.root / rel_path).resolve()
    if self.root != path and self.root not in path.parents:
      raise ValueError(f"output path escapes dry-run directory: {rel_path}")
    return path

  def put(self, rel_path: str, doc: dict) -> None:
    path = self._path(rel_path)
    save_json(path, doc)
    self.writes.append(f"PUT {rel_path}")

  def delete(self, rel_path: str) -> None:
    path = self._path(rel_path)
    try:
      path.unlink()
    except FileNotFoundError:
      pass
    self.writes.append(f"DELETE {rel_path}")


def flush_documents(index: dict, chats: dict[str, dict],
                    helpers: dict[str, dict], sink: StorageSink,
                    digests: dict[str, str]) -> list[str]:
  """Writes only changed documents (content-hash gate) and evicts helper pages
  over the self-cap. Returns the ordered list of storage paths actually written
  so the caller can log/return exactly what happened."""
  helper_ids = enforce_app_cap(index, chats, helpers)
  written: list[str] = []

  def _put(path: str, doc: dict) -> None:
    digest = hashlib.sha256(
      json.dumps(doc, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
    if digests.get(path) == digest:
      return
    sink.put(path, doc)
    digests[path] = digest
    written.append(path)

  _put("index.json", index)
  for chat_id, doc in chats.items():
    _put(f"chats/{chat_id}.json", doc)
  for agent_id in helper_ids:
    _put(f"helpers/{agent_id}.json", helpers[agent_id])

  # A page that dropped below the cap this run (or lost its chat) is deleted so
  # the app never serves a stale detail page the roster no longer references.
  live_paths = {f"helpers/{agent_id}.json" for agent_id in helper_ids}
  live_paths.add("index.json")
  live_paths.update(f"chats/{c}.json" for c in chats)
  for stale in [p for p in digests if p not in live_paths]:
    sink.delete(stale)
    digests.pop(stale, None)
    written.append(f"(deleted) {stale}")
  return written


def enforce_app_cap(index: dict, chats: dict[str, dict],
                    helpers: dict[str, dict]) -> list[str]:
  """Returns the helper ids to keep under `APP_ARTIFACT_CAP_BYTES`.

  Roster (index) + chat summaries are never evicted — only helper detail pages,
  oldest-chat-first (LRU by the chat's last activity), so the app keeps its
  navigable shape and only loses the deepest, oldest detail."""
  activity: dict[str, str] = {r["chat_id"]: r.get("ts") or ""
                              for r in index["entries"]}
  keys = sorted(helpers.keys(),
                key=lambda key: activity.get(helpers[key].get("chat_id"), ""),
                reverse=True)
  base = len(json.dumps(index).encode()) + sum(
    len(json.dumps(d).encode()) for d in chats.values())
  kept: list[str] = []
  total = base
  for key in keys:
    size = len(json.dumps(helpers[key], ensure_ascii=False).encode("utf-8"))
    if total + size > APP_ARTIFACT_CAP_BYTES:
      continue
    kept.append(key)
    total += size
  return kept


# --- small time/fs helpers --------------------------------------------------

def _sorted_by_mtime(paths: Iterable[Path]) -> list[Path]:
  def _key(p: Path) -> float:
    try:
      return p.stat().st_mtime
    except OSError:
      return 0.0
  return sorted(paths, key=_key, reverse=True)


def _mtime_iso(path: Path) -> Optional[str]:
  try:
    return _epoch_to_iso(path.stat().st_mtime)
  except OSError:
    return None


def _epoch_to_iso(epoch: float) -> str:
  return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(epoch))


def _iso_to_epoch(ts_iso: Optional[str]) -> Optional[float]:
  if not ts_iso or not isinstance(ts_iso, str):
    return None
  s = ts_iso.strip().replace("Z", "+00:00")
  # Trim fractional seconds to 6 digits so datetime can parse them, then let a
  # cheap struct-time path handle the common no-fraction/no-offset shapes.
  try:
    from datetime import datetime
    return datetime.fromisoformat(s).timestamp()
  except ValueError:
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
      try:
        return time.mktime(time.strptime(s[:19], fmt))
      except ValueError:
        continue
  return None


# --- top-level refresh ------------------------------------------------------

def run_refresh(cc_dir: Path, codex_home: Path, state_dir: Path,
                base_url: str, app_id: str, app_token: str,
                service_token: str,
                sink: Optional[StorageSink] = None) -> dict:
  """One budgeted refresh slice: parse deltas, attribute, write changed docs.

  Returns a summary dict (also the source of the one-line cron log). When the
  owner-API inputs can't be fetched the slice is a NO-OP that preserves the
  last-good documents — see the degraded branch below."""
  budget = Budget(BUDGET_SECS, BUDGET_BYTES)
  now = time.time()
  model = load_json(state_dir / "model.json", None) or _new_model()
  migrating_v2 = model.get("schema") != SCHEMA_VERSION
  # The trace accumulator is forward-compatible, but cached chat turns are not:
  # v1 stored rail nodes/gists while v2 needs bounded raw tool evidence. Keep the
  # expensive trace model, mark it migrated, and force only owner-chat blocks to
  # be walked again below.
  model["schema"] = SCHEMA_VERSION
  cursors = CursorStore(state_dir / "cursors.json")
  digests = load_json(state_dir / "digests.json", {})
  scanned = load_json(state_dir / "scanned-chats.json", {})
  if not isinstance(scanned, dict):
    # Migrate the old list-of-ids shape: keep them scanned, but eligible to
    # rescan the moment their activity advances (the "" mark is < any real
    # activity_at) so build_tooluse_map's staleness fix covers them too.
    scanned = {str(c): "" for c in scanned} if isinstance(scanned, list) else {}

  parse_claude(cc_dir, model, cursors, budget)
  parse_codex(codex_home, model, cursors, budget)
  _enforce_parent_invariant(model)
  _mark_expired_sources(model, cc_dir, codex_home)

  # Owner-API inputs. A FETCH FAILURE (missing token, timeout, 5xx, malformed
  # body) is NOT an empty roster: rebuilding storage on top of the good docs
  # from an all-unlinked model would DELETE them. Distinguish failure from empty
  # and ABORT the publish, leaving the last-good documents untouched (finding
  # #1). We still persist the local-trace parse progress — model + cursors move
  # together, so the bytes consumed this slice are never lost — but touch NOTHING
  # owner-derived: no digests, no storage writes/deletes.
  links_ok, links = fetch_session_links(base_url, service_token)
  chats_ok, chats_meta = fetch_chats(base_url, service_token)
  if not (links_ok and chats_ok):
    reason = _degraded_reason(service_token, links_ok, chats_ok)
    save_json(state_dir / "model.json", model)
    cursors.save()
    return {
      "chats": 0, "unlinked": 0, "agents": 0, "writes": 0,
      "bytes_parsed": budget.bytes_read, "budget_exhausted": budget.exhausted,
      "written_paths": [], "degraded": True, "degraded_reason": reason,
    }

  tooluse_map = load_json(state_dir / "tooluse-map.json", {})
  if any(tuid not in tooluse_map
         for s in model["sessions"].values() for tuid in s.get("tool_use_ids", [])):
    tooluse_map.update(build_tooluse_map(
      base_url, service_token, chats_meta, scanned, budget))

  # Helpers the chats record about themselves. This runs every slice (not only
  # when the trace side wants attribution) because it is the only route that
  # covers a chat whose helper traces have already aged off disk.
  helper_scanned = load_json(state_dir / "scanned-chat-helpers.json", {})
  chat_helpers_state = load_json(state_dir / "chat-helpers.json", {})
  chat_turns_state = load_json(state_dir / "chat-turns.json", {})
  if migrating_v2:
    helper_scanned = {}
    chat_helpers_state = {}
    chat_turns_state = {}
  new_helpers, new_turns, rescanned = scan_chat_helpers(
    base_url, service_token, chats_meta, helper_scanned, budget)
  chat_helpers_state.update(new_helpers)
  # A rescanned chat replaces its turns wholesale (the transcript is append-only,
  # so the fresh walk is authoritative); chats not rescanned this slice keep the
  # turns already on disk.
  chat_turns_state.update(new_turns)
  # A chat rescanned to an EMPTY result (its spawns were compacted away) must be
  # cleared, not left as stale state an overlay-only update can never remove.
  for cid in rescanned:
    if cid not in new_helpers:
      chat_helpers_state.pop(cid, None)
    if cid not in new_turns:
      chat_turns_state.pop(cid, None)

  attribution = Attribution(links, tooluse_map, chats_meta)
  index, chats, helpers, unlinked = build_documents(
    model, attribution, now, chat_helpers=chat_helpers_state,
    chat_turns=chat_turns_state)

  output_sink: StorageSink = sink or HttpSink(base_url, app_id, app_token)
  written = flush_documents(index, chats, helpers, output_sink, digests)

  save_json(state_dir / "model.json", model)
  cursors.save()
  save_json(state_dir / "digests.json", digests)
  save_json(state_dir / "scanned-chats.json", scanned)
  save_json(state_dir / "tooluse-map.json", tooluse_map)
  save_json(state_dir / "scanned-chat-helpers.json", helper_scanned)
  save_json(state_dir / "chat-helpers.json", chat_helpers_state)
  save_json(state_dir / "chat-turns.json", chat_turns_state)

  return {
    "chats": len(index["entries"]),
    "unlinked": len(unlinked),
    "agents": len(helpers),
    "writes": len(written),
    "bytes_parsed": budget.bytes_read,
    "budget_exhausted": budget.exhausted,
    "written_paths": written,
    "degraded": False,
  }


def _degraded_reason(token: str, links_ok: bool, chats_ok: bool) -> str:
  """A one-line reason for a skipped-degraded slice (cron log + stderr)."""
  if not token:
    return ("no service token on disk; cannot read owner chats — "
            "skipped to preserve last-good documents")
  failed = [name for name, ok in (("chats-roster", chats_ok),
                                  ("session-links", links_ok)) if not ok]
  return ("owner-API fetch failed (" + ", ".join(failed) +
          "); skipped to preserve last-good documents")


def _mark_expired_sources(model: dict, cc_dir: Path, codex_home: Path) -> None:
  """Marks a helper `source_expired` when its digest exists but the raw trace
  file is gone (log rotation / cleanup). We keep the digest — the app can still
  show what it knew — but the status derivation degrades to `unavailable`."""
  for akey, agent in model["agents"].items():
    sid, agent_id = agent["sid"], agent["agent_id"]
    if agent["run_kind"] == "collab":
      # Codex helper trace is the rollout itself; presence-check is cheap enough
      # to skip here (rollouts are dated dirs), so leave collab as-is.
      continue
    if not _claude_trace_exists(cc_dir, sid, agent):
      agent["source_expired"] = True


def _claude_trace_exists(cc_dir: Path, sid: str, agent: dict) -> bool:
  base = cc_dir / "projects" / "-data" / sid / "subagents"
  agent_id = agent["agent_id"]
  if agent["run_kind"] == "tasks":
    return (base / f"agent-{agent_id}.jsonl").exists()
  return (base / "workflows" / agent["run_id"] / f"agent-{agent_id}.jsonl").exists()


# --- self-test --------------------------------------------------------------

def _write(path: Path, text: str) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(text, encoding="utf-8")


def _build_fixture(root: Path) -> tuple[Path, Path]:
  """Fabricates a Claude + Codex trace tree exercising every run kind."""
  cc = root / "claude"
  sid = "11111111-1111-1111-1111-111111111111"
  proj = cc / "projects" / "-data"
  # main session file (mtime -> last_activity) + a task subagent with a
  # toolUseId that a chat's Task block will match.
  _write(proj / f"{sid}.jsonl", json.dumps({"type": "user", "timestamp": "2026-07-17T10:00:00Z"}) + "\n")
  sub = proj / sid / "subagents"
  _write(sub / "agent-taskA.meta.json",
         json.dumps({"agentType": "general-purpose", "description": "Investigate X",
                     "toolUseId": "toolu_TASKA", "spawnDepth": 1}))
  _write(sub / "agent-taskA.jsonl", "\n".join([
    json.dumps({"type": "user", "timestamp": "2026-07-17T10:00:01Z",
                "message": {"role": "user", "content": "Investigate the flaky test"}}),
    json.dumps({"type": "assistant", "timestamp": "2026-07-17T10:00:02Z",
                "message": {"role": "assistant",
                            "content": [{"type": "tool_use", "name": "Read",
                                         "input": {"file_path": "/data/x.py"}}],
                            "usage": {"input_tokens": 100, "output_tokens": 20}}}),
    json.dumps({"type": "assistant", "timestamp": "2026-07-17T10:00:03Z",
                "message": {"role": "assistant",
                            "content": [{"type": "text", "text": "Root cause found: token sk-ant-SECRETSECRETSECRET123 in log."}],
                            "usage": {"input_tokens": 5, "output_tokens": 40}}}),
  ]) + "\n")
  # a workflow run: record + phases + one journal-completed agent.
  wf_id = "wf_abc123"
  _write(proj / sid / "workflows" / f"{wf_id}.json", json.dumps({
    "runId": wf_id, "timestamp": "2026-07-17T09:00:00Z",
    "script": "export const meta = {\n  name: 'verify-merge',\n  description: 'Adversarially verify the merge',\n  phases: [{ title: 'Verify' }, { title: 'Report' }],\n}\n",
  }))
  wdir = proj / sid / "subagents" / "workflows" / wf_id
  _write(wdir / "agent-wfB.meta.json", json.dumps({"agentType": "general-purpose", "spawnDepth": 1}))
  _write(wdir / "agent-wfB.jsonl", "\n".join([
    json.dumps({"type": "user", "timestamp": "2026-07-17T09:00:01Z",
                "message": {"role": "user", "content": "Verify the merge is coherent"}}),
    json.dumps({"type": "assistant", "timestamp": "2026-07-17T09:00:05Z",
                "message": {"role": "assistant",
                            "content": [{"type": "text", "text": "Verified: clean."}],
                            "usage": {"input_tokens": 50, "output_tokens": 10}}}),
  ]) + "\n")
  _write(wdir / "journal.jsonl",
         json.dumps({"type": "started", "agentId": "wfB", "key": "v2:k"}) + "\n" +
         json.dumps({"type": "result", "agentId": "wfB", "key": "v2:k",
                     "result": {"verdict": "clean", "summary": "Merge is coherent; no leftover markers."}}) + "\n")
  # a task board card labelling the tasks run.
  _write(cc / "tasks" / sid / "1.json",
         json.dumps({"id": "1", "subject": "Interview flaky test", "status": "completed"}))

  # Codex: a parent rollout with a synthetic collab item + a child rollout
  # whose parent_thread_id links back to the parent.
  codex = root / "codex"
  day = codex / "sessions" / "2026" / "07" / "17"
  parent_sid = "019f0000-parent"
  child_sid = "019f0000-child0"
  _write(day / f"rollout-2026-07-17T12-00-00-{parent_sid}.jsonl", "\n".join([
    json.dumps({"timestamp": "2026-07-17T12:00:00Z", "type": "session_meta",
                "payload": {"id": parent_sid, "session_id": parent_sid, "cwd": "/data"}}),
    json.dumps({"timestamp": "2026-07-17T12:00:01Z", "type": "response_item",
                "payload": {"type": "collabAgentToolCall", "senderThreadId": parent_sid,
                            "receiverThreadIds": [child_sid],
                            "agentsStates": {child_sid: {"model": "gpt-5-codex",
                                                          "status": "completed",
                                                          "prompt": "Refactor the parser"}}}}),
  ]) + "\n")
  _write(day / f"rollout-2026-07-17T12-05-00-{child_sid}.jsonl", "\n".join([
    json.dumps({"timestamp": "2026-07-17T12:05:00Z", "type": "session_meta",
                "payload": {"id": child_sid, "session_id": child_sid, "cwd": "/data",
                            "parent_thread_id": parent_sid}}),
    json.dumps({"timestamp": "2026-07-17T12:05:01Z", "type": "response_item",
                "payload": {"type": "function_call", "name": "shell",
                            "arguments": "{\"command\": \"pytest\"}"}}),
    json.dumps({"timestamp": "2026-07-17T12:05:02Z", "type": "event_msg",
                "payload": {"type": "agent_message", "message": "Refactor complete, tests pass."}}),
  ]) + "\n")
  return cc, codex


def _assert(cond: bool, msg: str) -> None:
  if not cond:
    raise AssertionError(msg)


def selftest() -> int:
  import tempfile
  with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    cc, codex = _build_fixture(root)
    state = root / "state"
    state.mkdir()
    budget = Budget(BUDGET_SECS, BUDGET_BYTES)
    now = time.time()
    model = _new_model()
    cursors = CursorStore(state / "cursors.json")
    parse_claude(cc, model, cursors, budget)
    parse_codex(codex, model, cursors, budget)
    _enforce_parent_invariant(model)
    _mark_expired_sources(model, cc, codex)

    # Attribution fixtures: session-links covers the Claude session; the Codex
    # parent is linked; the child inherits via parent_thread_id. Links are keyed
    # by (provider, session_id) — the backend's true identity (finding #2).
    claude_sid = "11111111-1111-1111-1111-111111111111"
    links = {("claude", claude_sid): "chatA", ("codex", "019f0000-parent"): "chatC"}
    chats_meta = {"chatA": {"title": "Fix flaky test", "provider": "claude"},
                  "chatC": {"title": "Refactor parser", "provider": "codex"}}
    attribution = Attribution(links, {"toolu_TASKA": "chatA"}, chats_meta)
    index, chats, helpers, unlinked = build_documents(model, attribution, now)

    sink = DictSink()
    written = flush_documents(index, chats, helpers, sink, {})

    # --- schema-shape asserts (json-schema-ish) ---
    _assert(index["schema"] == SCHEMA_VERSION, "index schema")
    _assert(isinstance(index["updated_at"], str), "index.updated_at is ISO")
    _assert(set(index) == {"schema", "updated_at", "needs_attention", "entries"},
            f"index keys: {set(index)}")
    _assert(len(index["entries"]) == 2,
            f"expected 2 chats, got {len(index['entries'])}")
    for row in index["entries"]:
      _assert(set(row) == {"chat_id", "provider", "title", "outcome", "area",
                           "result", "status", "tasks", "ts"},
              f"index entry keys: {set(row)}")

    doc_a = chats["chatA"]
    _assert(doc_a["provider"] == "claude", "chatA provider")
    _assert(set(doc_a) == {"schema", "chat_id", "provider", "title", "outcome",
                           "ts", "turns"}, f"chat keys: {set(doc_a)}")
    _assert(doc_a["turns"], "chat has derived turns")
    for turn in doc_a["turns"]:
      _assert(set(turn) == {"outcome", "area", "result", "status", "flag", "ts",
                            "subs", "original", "commands", "nblocks"},
              f"turn keys: {set(turn)}")
      for sub in turn["subs"]:
        _assert(set(sub) == {"agent_id", "kind", "name", "ask", "state", "acts",
                             "result", "brief_full", "tappable"},
                f"sub keys: {set(sub)}")

    doc_c = chats["chatC"]
    _assert(doc_c["provider"] == "codex", "chatC provider")
    _assert(any(sub["state"] == "done" for turn in doc_c["turns"]
                for sub in turn["subs"]), "collab helper done")

    # --- product-truth asserts ---
    page = sink.docs["helpers/wfB.json"]
    _assert(set(page) == {"schema", "agent_id", "chat_id", "kind", "name", "ask",
                          "brief_full", "state", "did", "result", "report_full",
                          "next", "commands"}, f"helper page keys: {set(page)}")
    for step in page["did"]:
      _assert(set(step) == {"verb", "label", "count"}, f"did keys: {set(step)}")
    # secret scrubbing reached the task agent's final report/outcome.
    task_page = sink.docs["helpers/taskA.json"]
    _assert("sk-ant-SECRET" not in json.dumps(task_page), "secret scrubbed from helper page")
    _assert("sk-ant-SECRET" not in json.dumps(index), "secret scrubbed from index")

    # child inherited the parent's chat via parent_thread_id.
    child_agent_ids = {sub["agent_id"] for turn in doc_c["turns"] for sub in turn["subs"]}
    _assert("019f0000-child0" in child_agent_ids, "codex child linked to parent chat")

    # === finding-specific asserts =========================================

    # #6: a long file path survives scrubbing (paths no longer collapse to a
    # redacted token), while structured secrets are still caught.
    long_path = "/data/apps/workflows/state/subagent_activity_digest_model.json"
    _assert("redacted" not in scrub(long_path), f"path survives scrub: {scrub(long_path)!r}")
    _assert("[redacted-token]" in scrub("blob abcdefABCDEF0123456789abcdefABCDEF01 end"),
            "unslashed 36-char token still redacted")
    _assert("[redacted-jwt]" in scrub("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123456"),
            "JWT still redacted after divergence")

    # Free-text title derivation is scrubbed and ends on a word boundary.
    derived_title = _title_from_request(
      "please update abcdefABCDEF0123456789abcdefABCDEF01 safely", "Notes", True)
    _assert("[redacted-token]" in derived_title and "abcdefABCDEF0123" not in derived_title,
            f"derived title scrubbed: {derived_title!r}")

    # #2: (provider, sid) keying — a codex link on the SAME id must not shadow
    # the claude session's own-provider link.
    coll_links = {("claude", claude_sid): "chatA", ("codex", claude_sid): "chatWRONG"}
    cid, creason = Attribution(coll_links, {}, chats_meta).resolve(claude_sid, model["sessions"])
    _assert(cid == "chatA" and creason == "session-link",
            f"provider-keyed link wins: {cid}/{creason}")

    # #10: a parent cycle surfaces as parent-cycle, not masked as parent-unlinked.
    cyc = {"A": {"provider": "codex", "parent_thread_id": "B"},
           "B": {"provider": "codex", "parent_thread_id": "A"}}
    ccid, creason = Attribution({}, {}, {}).resolve("A", cyc)
    _assert(ccid is None and creason == "parent-cycle", f"parent cycle reason: {creason}")

    # A fresh session_meta clears stale parent state, and a self-parent is always
    # normalized to no parent rather than becoming a fake helper/cycle.
    parent_root = root / "parent-invariant" / "sessions" / "2026" / "07" / "17"
    pinv = _new_model()
    _session(pinv, "fresh-top", "codex")["parent_thread_id"] = "stale-parent"
    _write(parent_root / "rollout-fresh-top.jsonl", json.dumps({
      "timestamp": "2026-07-17T00:00:00Z", "type": "session_meta",
      "payload": {"id": "fresh-top", "session_id": "fresh-top"}}) + "\n")
    _write(parent_root / "rollout-self-parent.jsonl", json.dumps({
      "timestamp": "2026-07-17T00:00:00Z", "type": "session_meta",
      "payload": {"id": "self-parent", "session_id": "self-parent",
                  "parent_thread_id": "self-parent"}}) + "\n")
    parse_codex(root / "parent-invariant", pinv, CursorStore(root / "pinv-cur.json"),
                Budget(BUDGET_SECS, BUDGET_BYTES))
    _assert(pinv["sessions"]["fresh-top"]["parent_thread_id"] is None,
            "fresh top-level metadata clears stale parent")
    _assert(pinv["sessions"]["self-parent"]["parent_thread_id"] is None,
            "session is never its own parent")
    _session(pinv, "legacy-self", "codex")["parent_thread_id"] = "legacy-self"
    _agent(pinv, "legacy-self", "collab", "legacy-self", "collab")
    _enforce_parent_invariant(pinv)
    _assert(pinv["sessions"]["legacy-self"]["parent_thread_id"] is None
            and "legacy-self::legacy-self" not in pinv["agents"],
            "stale self-parent helper removed from accumulator")

    # Terminal downstream evidence supersedes a superficial async launch ack.
    ack = helper_from_agent_block({
      "type": "tool", "tool": "Agent", "status": "done",
      "input": "{'description': 'Check parser', 'subagent_type': 'Explore'}",
      "output": "Async agent launched successfully\nagentId: joined"}, scope="chatJ")
    block_ev = _block_evidence(ack, "claude")
    trace_ev = dict(block_ev, state="done", origin="trace",
                    report_full="Done. Parser check completed.")
    joined = _merge_evidence([block_ev, trace_ev], "claude")
    _assert(joined["state"] == "done", f"terminal evidence wins: {joined['state']}")
    joined_turn = _build_v2_turn({
      "_agent_ids": ["joined"], "_tools": [], "_original": "Done.",
      "ts": 1_700_000_000_000, "nblocks": 1}, {"joined": joined})
    _assert(joined_turn["subs"][0]["state"] == "done",
            "turn and helper use the joined state")

    # Production-shaped Beat Machine validator regression: the recorded check
    # says valid=false, so a later "should work" claim cannot become green.
    beat_messages = [
      {"role": "user", "content": "Please update Beat Machine", "ts": 1775497394976},
      {"role": "assistant", "blocks": [
        {"type": "tool", "tool": "Agent", "status": "done", "input":
         "{'subagent_type': 'Explore', 'description': 'Find app build process'}", "output": ""},
        {"type": "tool", "tool": "Bash", "status": "done", "input":
         "curl -X PATCH $API_BASE_URL/api/apps/10", "output": "10"},
        {"type": "tool", "tool": "Bash", "status": "done", "input":
         "curl $API_BASE_URL/api/apps/10/validate", "output":
         '{"valid": false, "issues": ["Compiled JS has no default export — the component won\'t mount."]}'},
        {"type": "text", "content":
         "The validator checks for export default OR export{. The app should work and has been updated."},
      ]},
    ]
    beat_helpers, beat_raw_turns = _walk_chat(beat_messages, scope="beat-chat")
    beat_merged = {h["agent_id"]: _merge_evidence([_block_evidence(h, "claude")], "claude")
                   for h in beat_helpers}
    beat_turn = _build_v2_turn(beat_raw_turns[0], beat_merged)
    _assert(beat_turn["status"] == "attention" and beat_turn["result"] == "not confirmed",
            f"Beat validator truth gate: {beat_turn}")
    _assert(beat_turn["outcome"] == "Investigated Beat Machine",
            f"Beat validator neutral outcome: {beat_turn['outcome']}")
    _assert(beat_turn["original"].startswith("The validator checks for export default OR export{"),
            "Beat validator original preserved")

    # Missing verification is the normal case: a plain reported edit stays
    # done, while positive doubt in the agent's own words remains amber.
    ordinary_raw = {
      "_agent_ids": [], "_tools": [{
        "tool": "Edit", "input": "/data/apps/beat-machine/src/App.jsx",
        "output": "", "status": "done"}],
      "_original": "Updated Beat Machine with the requested controls.",
      "ts": 1_700_000_000_000, "nblocks": 1,
    }
    ordinary_turn = _build_v2_turn(ordinary_raw, {})
    _assert(ordinary_turn["status"] == "done" and ordinary_turn["result"] == "done",
            f"untested ordinary edit stays done: {ordinary_turn}")
    hedged_raw = dict(
      ordinary_raw,
      _original="Updated Beat Machine. It should load fine.")
    hedged_turn = _build_v2_turn(hedged_raw, {})
    _assert(hedged_turn["status"] == "attention"
            and hedged_turn["result"] == "not confirmed",
            f"agent hedge stays attention: {hedged_turn}")
    _assert(not _hedges_result(
      "The attempted resolver errored, so I replaced it with a deterministic path."),
      "historical attempt is not a hedge on the delivered result")
    _assert(not _hedges_result(
      "MutationObserver catches changes that ResizeObserver might miss."),
      "old failure-mode explanation is not a hedge on the delivered result")
    _assert(_request_noun(
      "building Mustafina Garaža — a 2030-aesthetic garage site in Bosnian")
      == "Mustafina Garaža", "named new-site request supplies area fallback")
    _assert(_request_noun("build a period tracking app") is None,
            "generic build request does not invent a product name")
    _assert(_delivery_sentence("Here's what's making headlines right now:")
            == "Here's what's making headlines right now",
            "selected delivery lead drops trailing colon")

    # #1: a fetch FAILURE (here: no service token) is distinguished from empty
    # success, so fetch_* report ok=False and run_refresh aborts without writing.
    lok, _ = fetch_session_links("http://127.0.0.1:1", "")
    cok, _ = fetch_chats("http://127.0.0.1:1", "")
    _assert(lok is False and cok is False, "missing token reported as fetch failure")
    deg_state = root / "deg-state"; deg_state.mkdir()
    deg = run_refresh(cc, codex, deg_state, "http://127.0.0.1:1", "appX", "apptok", "")
    _assert(deg.get("degraded") is True, "no-token run is degraded")
    _assert(deg["writes"] == 0, "degraded run writes nothing")
    _assert(not (deg_state / "digests.json").exists(),
            "degraded run leaves owner-derived state (digests) untouched")

    # #4: charge only consumed bytes; a partial tail is left for the next run.
    pf = root / "partial.jsonl"
    rec1 = json.dumps({"uuid": "r1"})
    _write(pf, rec1 + "\n" + '{"uuid": "partial-no-newline')
    pb = Budget(BUDGET_SECS, BUDGET_BYTES)
    _pr, precs, pcur = read_delta(pf, {}, pb)
    consumed = len((rec1 + "\n").encode())
    _assert([r.get("uuid") for r in precs] == ["r1"], "only the complete record is read")
    _assert(pb.bytes_read == consumed, f"budget charges only consumed bytes: {pb.bytes_read}")
    _assert(pcur["offset"] == consumed, "cursor left at the partial tail start")

    # #4: an oversized single record is flagged + skipped; later records survive.
    of = root / "oversized.jsonl"
    big_line = json.dumps({"blob": "z" * (MAX_RECORD_BYTES + 64)})
    _write(of, big_line + "\n" + json.dumps({"uuid": "after"}) + "\n")
    ob = Budget(BUDGET_SECS, BUDGET_BYTES)
    _or, orecs, _oc = read_delta(of, {}, ob)
    ouuids = [r.get("uuid") for r in orecs]
    _assert("after" in ouuids and not any(r.get("blob") for r in orecs),
            f"oversized record skipped, later record kept: {ouuids}")

    # #5a: a first-record fingerprint mismatch forces a rescan even when ino +
    # size are unchanged (inode reuse / truncate-and-regrow above the offset).
    ff = root / "fp.jsonl"
    _write(ff, json.dumps({"uuid": "u1"}) + "\n")
    fb = Budget(BUDGET_SECS, BUDGET_BYTES)
    _fr, _frecs, fcur = read_delta(ff, {}, fb)
    _assert(_fr is False and fcur.get("first_fp"), "initial read records a fingerprint")
    tampered = dict(fcur); tampered["first_fp"] = "0000000000000000"
    fr2, frecs2, _fc2 = read_delta(ff, tampered, Budget(BUDGET_SECS, BUDGET_BYTES))
    _assert(fr2 is True and [r.get("uuid") for r in frecs2] == ["u1"],
            "fingerprint mismatch triggers a full rescan")

    # #5b: a replaced (shrunk) Codex rollout resets its derived steps — no dupe.
    cx = root / "codex5b"
    day5 = cx / "sessions" / "2026" / "07" / "17"
    psid5, csid5 = "p5-thread", "c5-thread"
    def _child_rollout(n_steps: int) -> str:
      lines = [json.dumps({"timestamp": "2026-07-17T12:05:00Z", "type": "session_meta",
                           "payload": {"id": csid5, "session_id": csid5,
                                       "parent_thread_id": psid5}})]
      for i in range(n_steps):
        lines.append(json.dumps({"timestamp": "2026-07-17T12:05:%02dZ" % (i + 1),
                                 "type": "response_item",
                                 "payload": {"type": "function_call", "name": "shell",
                                             "arguments": "{}"}}))
      return "\n".join(lines) + "\n"
    rf5 = day5 / f"rollout-2026-07-17T12-05-00-{csid5}.jsonl"
    _write(rf5, _child_rollout(3))
    m5 = _new_model(); cur5 = CursorStore(root / "cx5-cur.json")
    parse_codex(cx, m5, cur5, Budget(BUDGET_SECS, BUDGET_BYTES))
    _write(rf5, _child_rollout(2))   # shrink -> size < offset -> rescan
    parse_codex(cx, m5, cur5, Budget(BUDGET_SECS, BUDGET_BYTES))
    n5 = len(m5["agents"][f"{csid5}::{csid5}"]["steps"])
    _assert(n5 == 2, f"replaced codex rollout resets steps (no dupe): got {n5}")

    # #8: a since-cleared board failure no longer sticks.
    bstate = root / "board8"; sid8 = "sid8"
    m8 = _new_model(); _run(m8, sid8, "tasks", "tasks", "t"); _agent(m8, sid8, "tasks", "a8", "tasks")
    bdir = bstate / sid8
    _write(bdir / "1.json", json.dumps({"subject": "do", "status": "failed"}))
    _parse_task_board(bdir, sid8, m8)
    _assert(m8["agents"][f"{sid8}::a8"]["board_status"] == "failed", "board failure set")
    _write(bdir / "1.json", json.dumps({"subject": "do", "status": "completed"}))
    _parse_task_board(bdir, sid8, m8)
    _assert(m8["agents"][f"{sid8}::a8"]["board_status"] is None,
            "board failure cleared once no card is failing")

    print("SELFTEST OK")
    print(f"  chats={len(index['entries'])} unlinked={len(unlinked)} "
          f"helpers={len(helpers)} writes={len(written)}")
    print(f"  helper kinds={sorted({page['kind'] for page in helpers.values()})}")
    print(f"  scrubbed report_full(taskA)={task_page['report_full']!r}")
    return 0


# --- entrypoint -------------------------------------------------------------

def main(argv: Optional[list[str]] = None) -> int:
  parser = argparse.ArgumentParser(description="Digest agent-run traces for the Workflows app.")
  parser.add_argument("--selftest", action="store_true",
                      help="run the offline fixture self-test and exit")
  parser.add_argument("--app-id", default=os.environ.get("APP_ID", ""))
  parser.add_argument("--dry-run", action="store_true",
                      help="write documents locally; never call app storage")
  parser.add_argument("--out", type=Path,
                      help="local output directory (required with --dry-run)")
  args = parser.parse_args(argv)

  if args.selftest:
    return selftest()

  data_dir = Path(os.environ.get("DATA_DIR", "/data"))
  base_url = os.environ.get("API_BASE_URL", "http://localhost:8000")
  app_token = os.environ.get("APP_TOKEN", "")
  app_id = args.app_id or os.environ.get("APP_ID", "")
  cc_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR", str(data_dir / "cli-auth" / "claude")))
  codex_home = Path(os.environ.get("CODEX_HOME", str(data_dir / "cli-auth" / "codex")))
  if args.dry_run and args.out is None:
    parser.error("--dry-run requires --out <local-directory>")
  if args.out is not None and not args.dry_run:
    parser.error("--out is only valid with --dry-run")
  state_dir = ((args.out / ".state") if args.dry_run else
               Path(os.environ.get("WORKFLOWS_STATE_DIR",
                                   str(data_dir / "apps" / "workflows" / "state"))))
  # Owner reads use the service token (owner JWT); app routes reject it and the
  # app token, symmetrically. The service token is read from disk (the job env
  # deliberately excludes it), following the Reflection precedent.
  service_token = ""
  token_file = data_dir / "service-token.txt"
  try:
    service_token = token_file.read_text(encoding="utf-8").strip()
  except OSError:
    pass

  if not args.dry_run and (not app_token or not app_id):
    print("workflows-refresh: missing APP_TOKEN/APP_ID; cannot write storage", file=sys.stderr)
    return 2

  state_dir.mkdir(parents=True, exist_ok=True)
  output_sink = LocalSink(args.out) if args.dry_run else None
  summary = run_refresh(cc_dir, codex_home, state_dir, base_url, app_id,
                        app_token, service_token, sink=output_sink)
  if summary.get("degraded"):
    # Owner-API inputs were unavailable: nothing was published or deleted, the
    # last-good documents are intact. Exit 4 (distinct from the shell wrapper's
    # 0/2/3/5) so a caller can tell a preservation skip from a real success or a
    # parser crash.
    print(f"workflows-refresh: SKIPPED (degraded): {summary['degraded_reason']}",
          file=sys.stderr)
    print(f"workflows-refresh: skipped-degraded ({summary['degraded_reason']}) "
          f"parsed={summary['bytes_parsed']}b writes=0")
    return 4
  mode = "dry-run " if args.dry_run else ""
  print(f"workflows-refresh: {mode}chats={summary['chats']} unlinked={summary['unlinked']} "
        f"agents={summary['agents']} writes={summary['writes']} "
        f"parsed={summary['bytes_parsed']}b exhausted={summary['budget_exhausted']}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())


# Smells
# - _result_is_success returns a slightly awkward double-negative for collab
#   statuses; kept for now because the collab vocabulary (inProgress/completed/
#   failed) is fixture-only until a live collab sample exists — revisit with
#   real data rather than guess more branches now.
# - The main Claude session <sid>.jsonl body is intentionally NOT streamed (only
#   its mtime is read): chat-level tokens_total aggregates helper tokens, not
#   top-level turn tokens, to stay within budget. Documented; revisit only if a
#   consumer needs true per-chat token totals.
# - build_tooluse_map is a bounded fallback that yields nothing on instances
#   whose subagents are all workflow/collab (no Task blocks in chat messages);
#   that is correct-but-untested against live Task data here — the selftest wires
#   it via fixture instead.
