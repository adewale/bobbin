import type { FC } from "hono/jsx";

interface ThemeRiverProps {
  data: { name: string; slug: string; values: number[] }[];
  dates: string[];
  width?: number;
  height?: number;
}

const RIVER_COLORS = [
  "#c04000", "#2d6a4f", "#4361ee", "#9b5de5", "#f77f00", "#577590",
];

export const ThemeRiver: FC<ThemeRiverProps> = ({ data, dates, width = 600, height = 180 }) => {
  if (!data.length || !dates.length) return null;

  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const totals = dates.map((_: string, i: number) => data.reduce((sum: number, d) => sum + d.values[i], 0));
  const maxTotal = Math.max(...totals, 1);

  const paths: { d: string; color: string; name: string; slug: string }[] = [];
  const baseline = new Array(dates.length).fill(0);

  for (let t = 0; t < data.length; t++) {
    const topLine: string[] = [];
    const bottomLine: string[] = [];

    for (let i = 0; i < dates.length; i++) {
      const x = dates.length === 1 ? w / 2 : (i / (dates.length - 1)) * w + pad;
      const yBottom = h + pad - (baseline[i] / maxTotal) * h;
      const yTop = h + pad - ((baseline[i] + data[t].values[i]) / maxTotal) * h;
      topLine.push(`${x},${yTop}`);
      bottomLine.unshift(`${x},${yBottom}`);
      baseline[i] += data[t].values[i];
    }

    paths.push({
      d: `M${topLine.join(" L")} L${bottomLine.join(" L")} Z`,
      color: RIVER_COLORS[t % RIVER_COLORS.length],
      name: data[t].name,
      slug: data[t].slug,
    });
  }

  return (
    <section class="theme-river">
      <svg viewBox={`0 0 ${width} ${height + 16}`} class="theme-river-svg">
        {paths.map((p, i) => (
          <a key={i} href={`/topics/${p.slug}`}>
            <path d={p.d} fill={p.color} opacity="0.6" />
            <title>{p.name}</title>
          </a>
        ))}
        <text x={pad} y={height + 12} fill="var(--text-light)" font-size="9" font-family="var(--font-ui)">{dates[0]}</text>
        <text x={width / 2} y={height + 12} text-anchor="middle" fill="var(--text-light)" font-size="9" font-family="var(--font-ui)">{dates[Math.floor(dates.length / 2)]}</text>
        <text x={width - pad} y={height + 12} text-anchor="end" fill="var(--text-light)" font-size="9" font-family="var(--font-ui)">{dates[dates.length - 1]}</text>
      </svg>
      <div class="theme-river-legend">
        {paths.map((p, i) => (
          <a key={i} href={`/topics/${p.slug}`} class="river-legend-item">
            <span class="river-legend-color" style={`background:${p.color}`} />
            {p.name}
          </a>
        ))}
      </div>
    </section>
  );
};
