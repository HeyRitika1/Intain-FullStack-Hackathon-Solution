export default function Spinner({ size = "md", label }) {
  const px = size === "sm" ? "h-4 w-4 border-2" : size === "lg" ? "h-8 w-8 border-4" : "h-5 w-5 border-2";
  return (
    <div className="inline-flex items-center gap-2 text-slate-500">
      <span
        className={`inline-block animate-spin rounded-full border-slate-300 border-t-slate-700 ${px}`}
        role="status"
        aria-label={label || "Loading"}
      />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
