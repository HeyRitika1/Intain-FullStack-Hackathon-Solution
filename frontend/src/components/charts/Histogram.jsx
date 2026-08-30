import BarChart from "./BarChart.jsx";

const DEFAULT_BAND_COLORS = {
  "0-30d":   "#22c55e",
  "31-90d":  "#84cc16",
  "91-180d": "#f59e0b",
  "181-365d":"#f97316",
  "365+d":   "#ef4444",
  "90-100":  "#10b981",
  "80-89":   "#34d399",
  "70-79":   "#facc15",
  "60-69":   "#fb923c",
  "<60":     "#ef4444",
};

export default function Histogram({ bands, height = 140, valueFormat, emptyText }) {
  const data = (bands || []).map((b) => ({
    label: b.label,
    value: b.count ?? b.value ?? 0,
    color: DEFAULT_BAND_COLORS[b.label] || "#94a3b8",
  }));
  return (
    <BarChart
      data={data}
      orientation="vertical"
      height={height}
      valueFormat={valueFormat}
      emptyText={emptyText}
    />
  );
}
