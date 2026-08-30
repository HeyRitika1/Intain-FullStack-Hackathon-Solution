import { useCallback, useEffect, useRef, useState } from "react";

// Small helper that:
//   - loads a summary payload on mount
//   - exposes a manual refresh() function
//   - polls every 30s when enabled=true
//
// Kept out of AuthContext / global state on purpose: each dashboard owns its
// own fetcher and lifecycle. Off by default per Prompt 20 spec.

export default function useAutoRefresh(fetcher, { intervalMs = 30_000 } = {}) {
  const [data, setData] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetcher();
      if (cancelledRef.current) return;
      setData(r);
      setLoadedAt(new Date());
    } catch (e) {
      if (!cancelledRef.current) setError(e);
    } finally {
      if (!cancelledRef.current) setBusy(false);
    }
  }, [fetcher]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    return () => { cancelledRef.current = true; };
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs, refresh]);

  return { data, loadedAt, error, busy, enabled, setEnabled, refresh };
}
