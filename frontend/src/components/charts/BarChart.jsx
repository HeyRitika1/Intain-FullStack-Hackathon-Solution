// Pure-SVG horizontal + vertical bar chart. No dependency.
// Props: { data: [{ label, value, color?, meta? }], orientation?, height?, onBarClick?, valueFormat? }

const DEFAULT_COLOR = "#3b82f6";

export default function BarChart({
  data = [],
  orientation = "vertical",
  height = 160,
  onBarClick,
  valueFormat = (v) => v,
  labelClassName = "text-[10px] fill-slate-500",
  emptyText = "No data",
}) {
  if (!data.length) {
    return <div className="grid place-items-center py-6 text-xs text-slate-400">{emptyText}</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value || 0));

  if (orientation === "horizontal") {
    const rowH = 22;
    const gap = 6;
    const labelW = 130;
    const svgH = data.length * (rowH + gap);
    return (
      <svg viewBox={`0 0 300 ${svgH}`} className="w-full" role="img" aria-label="bar chart">
        {data.map((d, i) => {
          const w = ((d.value || 0) / max) * (300 - labelW - 40);
          const y = i * (rowH + gap);
          const fill = d.color || DEFAULT_COLOR;
          return (
            <g key={d.label} className={onBarClick ? "cursor-pointer" : ""} onClick={() => onBarClick?.(d)}>
              <text x={0} y={y + rowH / 2 + 3} className={labelClassName}>{d.label}</text>
              <rect x={labelW} y={y} width={Math.max(1, w)} height={rowH} fill={fill} rx={2} />
              <text x={labelW + w + 4} y={y + rowH / 2 + 3} className="fill-slate-700 text-[10px] font-mono">
                {valueFormat(d.value)}
              </text>
              <title>{`${d.label}: ${valueFormat(d.value)}`}</title>
            </g>
          );
        })}
      </svg>
    );
  }

  const colW = 40;
  const gap = 8;
  const totalW = data.length * (colW + gap);
  return (
    <svg viewBox={`0 0 ${totalW} ${height}`} className="w-full" role="img" aria-label="bar chart">
      {data.map((d, i) => {
        const barH = ((d.value || 0) / max) * (height - 30);
        const x = i * (colW + gap);
        const y = height - 20 - barH;
        const fill = d.color || DEFAULT_COLOR;
        return (
          <g key={d.label} className={onBarClick ? "cursor-pointer" : ""} onClick={() => onBarClick?.(d)}>
            <rect x={x} y={y} width={colW} height={Math.max(1, barH)} fill={fill} rx={2} />
            <text x={x + colW / 2} y={y - 3} textAnchor="middle" className="fill-slate-700 text-[9px] font-mono">
              {valueFormat(d.value)}
            </text>
            <text x={x + colW / 2} y={height - 6} textAnchor="middle" className={labelClassName}>
              {d.label}
            </text>
            <title>{`${d.label}: ${valueFormat(d.value)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
