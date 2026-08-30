const TONES = {
  blocking: "bg-red-100 text-red-800 ring-red-200",
  high: "bg-orange-100 text-orange-800 ring-orange-200",
  medium: "bg-yellow-100 text-yellow-800 ring-yellow-200",
  low: "bg-slate-100 text-slate-700 ring-slate-200",
};

export default function SeverityBadge({ severity, className = "" }) {
  const tone = TONES[severity] || TONES.low;
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ring-1 ${tone} ${className}`}>
      {severity}
    </span>
  );
}
