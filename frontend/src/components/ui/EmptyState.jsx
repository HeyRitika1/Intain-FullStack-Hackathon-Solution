export default function EmptyState({ title, description, action, className = "" }) {
  return (
    <div className={`rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center ${className}`}>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
