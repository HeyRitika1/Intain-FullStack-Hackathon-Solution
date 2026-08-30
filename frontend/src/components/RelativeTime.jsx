import { useEffect, useState } from "react";
import { relativeTime } from "../lib/format.js";

export default function RelativeTime({ iso, className = "" }) {
  const [_, force] = useState(0);
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return <span className={className}>—</span>;
  return (
    <span title={new Date(iso).toLocaleString()} className={className}>
      {relativeTime(iso)}
    </span>
  );
}
