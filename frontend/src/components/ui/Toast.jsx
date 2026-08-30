import { useEffect, useState } from "react";

const listeners = new Set();
let nextId = 0;

function emit(t) {
  const item = { id: ++nextId, ...t };
  listeners.forEach((l) => l(item));
}

export const toast = {
  success: (msg, opts) => emit({ kind: "success", msg, ...opts }),
  error: (msg, opts) => emit({ kind: "error", msg, ...opts }),
  info: (msg, opts) => emit({ kind: "info", msg, ...opts }),
};

const styles = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-slate-200 bg-white text-slate-800",
};

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const l = (item) => {
      setItems((prev) => [...prev, item]);
      const ttl = item.durationMs ?? 4500;
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== item.id)), ttl);
    };
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-md rounded-md border px-4 py-2 text-sm shadow-md ${styles[t.kind] || styles.info}`}
          role="status"
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
