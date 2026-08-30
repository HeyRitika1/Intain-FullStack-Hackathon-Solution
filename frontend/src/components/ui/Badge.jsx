const tones = {
  slate: "bg-slate-100 text-slate-700",
  blue: "bg-blue-100 text-blue-800",
  amber: "bg-amber-100 text-amber-800",
  emerald: "bg-emerald-100 text-emerald-800",
  red: "bg-red-100 text-red-800",
  yellow: "bg-yellow-100 text-yellow-800",
  purple: "bg-purple-100 text-purple-800",
};

export default function Badge({ tone = "slate", className = "", children }) {
  const t = tones[tone] || tones.slate;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${t} ${className}`}>
      {children}
    </span>
  );
}
