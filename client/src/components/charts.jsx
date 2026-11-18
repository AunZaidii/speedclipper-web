// Small SVG charts. Palette = validated dark categorical slots (blue, orange, aqua, yellow) in fixed order.
import { useMemo, useRef, useState } from "react";

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];

const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

/** Stacked (or single) vertical bars with hover tooltip, legend for >= 2 series, and a table view. */
export function BarChart({ data, series, xKey = "date", xFmt = fmtDate, height = 190, title }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 640, H = height, padL = 28, padB = 22, padT = 8;
  const totals = data.map((d) => series.reduce((a, s) => a + (d[s.key] || 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const n = data.length;
  const slot = (W - padL) / n;
  const bw = Math.max(3, Math.min(28, slot - 2));            // 2px gap between adjacent bars
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const every = Math.ceil(n / 8);

  const bars = useMemo(() => data.map((d, i) => {
    let acc = 0;
    const segs = series.map((s) => {
      const v = d[s.key] || 0;
      const y0 = y(acc), y1 = y(acc + v);
      acc += v;
      return { key: s.key, color: s.color, v, top: y1, h: Math.max(0, y0 - y1 - (v ? 1 : 0)) };   // 1px+1px surface gap
    });
    return { x: padL + i * slot + (slot - bw) / 2, segs, total: acc };
  }), [data, series, max]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative" ref={ref}>
      {series.length >= 2 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}
        onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#ebe9e3" strokeWidth="1" />
            <text x={padL - 6} y={y(max * f) + 3} textAnchor="end" fontSize="10" fill="#898781">{Math.round(max * f)}</text>
          </g>
        ))}
        {bars.map((b, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={padL + i * slot} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
            {b.segs.filter((s) => s.v).map((s, j, arr) => {
              const isTop = j === arr.length - 1;
              const r = Math.min(4, bw / 2, s.h);
              const { top, h } = s;
              const x = b.x;
              const d = isTop
                ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${top + h} Z`
                : `M${x},${top + h} V${top} H${x + bw} V${top + h} Z`;
              return <path key={s.key} d={d} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
            })}
            {i % every === 0 && <text x={b.x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#898781">{xFmt(data[i][xKey])}</text>}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-6 z-10 min-w-36 rounded-xl border border-line bg-panel px-3 py-2 text-xs shadow-xl shadow-black/10"
          style={(bars[hover].x + bw / 2) / W > 0.55
            ? { right: `calc(${(1 - bars[hover].x / W) * 100}% + 10px)` }        // left of the bar, never on top of it
            : { left: `calc(${((bars[hover].x + bw) / W) * 100}% + 10px)` }}>
          <div className="mb-1 font-semibold text-ink">{xFmt(data[hover][xKey])}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-muted">
              <i className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}
              <b className="ml-auto pl-3 text-ink">{data[hover][s.key] || 0}</b>
            </div>
          ))}
          {series.length > 1 && <div className="mt-1 flex border-t border-line pt-1 text-muted">Total<b className="ml-auto text-ink">{totals[hover]}</b></div>}
        </div>
      )}
      <details className="mt-1 text-xs text-muted">
        <summary className="cursor-pointer select-none">See the numbers</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-left">
            <thead><tr><th className="py-1 pr-3 font-medium">{xKey === "date" ? "Day" : xKey}</th>{series.map((s) => <th key={s.key} className="py-1 pr-3 font-medium">{s.label}</th>)}</tr></thead>
            <tbody>{data.map((d, i) => <tr key={i} className="border-t border-line"><td className="py-1 pr-3">{xFmt(d[xKey])}</td>{series.map((s) => <td key={s.key} className="py-1 pr-3 text-ink">{d[s.key] || 0}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Tiny trend line for KPI tiles (decorative; the tile states the number). */
export function Sparkline({ values, color = SERIES[0], height = 28 }) {
  if (!values?.length) return null;
  const W = 100, max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * W},${height - 2 - (v / max) * (height - 4)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="mt-2 h-7 w-full" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
