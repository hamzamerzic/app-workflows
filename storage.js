// Storage + refresh transport for Workflows. Reads go through the runtime
// read-through cache (`window.mobius.storage`) so the dashboard fills instantly
// and repaints when the background job writes under it; a raw-fetch fallback
// keeps the standalone launch working. The job itself is triggered through the
// app's own run-now endpoint.

import { useEffect, useState } from 'react'

export function makeStorage(appId, token) {
  const ms = (typeof window !== 'undefined' && window.mobius && window.mobius.storage) || null
  const headers = { Authorization: `Bearer ${token}` }
  const base = `/api/storage/apps/${appId}`

  // Read a JSON path. Returns the parsed value, or null when absent (a fresh
  // install with no job output yet is the normal null case) or on any error —
  // the UI treats null as "nothing here", never as a crash.
  async function getJSON(path) {
    try {
      if (ms && typeof ms.get === 'function') {
        const data = await ms.get(path)
        return data == null ? null : data
      }
      // Bounded so a hung request can't leave the refresh poll waiting forever.
      const r = await fetch(`${base}/${path}`, { headers, signal: timeoutSignal(10000) })
      if (!r.ok) return null
      return await r.json()
    } catch {
      return null
    }
  }

  // Reactive read: `cb` fires with the current value, then again whenever the
  // background job rewrites the path. This is required for every view the job
  // populates, so the dashboard never shows stale state while it sits open.
  function subscribe(path, cb) {
    if (ms && typeof ms.subscribe === 'function') {
      return ms.subscribe(path, (v) => cb(v == null ? null : v))
    }
    let cancelled = false
    getJSON(path).then((v) => { if (!cancelled) cb(v) })
    return () => { cancelled = true }
  }

  // Trigger the app's own scheduled job on demand (the same script cron runs).
  // Returns true on the 202 accept. The endpoint authorises an app-scoped
  // token for its own app id, so no owner JWT is needed.
  async function runJob() {
    try {
      const r = await fetch(`/api/apps/${appId}/run-job`, {
        method: 'POST', headers, signal: timeoutSignal(10000),
      })
      return r.ok
    } catch {
      return false
    }
  }

  return { appId, getJSON, subscribe, runJob }
}

// An abort signal that fires after `ms`, so no single fetch can hang the refresh
// flow. Falls back to undefined (no timeout) on older engines without
// AbortSignal.timeout — the caller's try/catch still bounds the failure.
function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms)
    }
  } catch { /* noop */ }
  return undefined
}

// Online/offline signal — mirrors window.mobius.online with a native fallback.
export function useOnline() {
  const initial = typeof navigator !== 'undefined' ? navigator.onLine : true
  const [online, setOnline] = useState(initial)
  useEffect(() => {
    const read = () => {
      const val = (typeof window !== 'undefined' && window.mobius && typeof window.mobius.online === 'boolean')
        ? window.mobius.online
        : (typeof navigator !== 'undefined' ? navigator.onLine : true)
      setOnline(val)
    }
    read()
    window.addEventListener('online', read)
    window.addEventListener('offline', read)
    return () => {
      window.removeEventListener('online', read)
      window.removeEventListener('offline', read)
    }
  }, [])
  return online
}
