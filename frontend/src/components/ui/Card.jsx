export default function Card({ title, subtitle, actions, className = "", children }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
