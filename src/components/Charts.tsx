// 纯 SVG 轻量图表（柱状/折线），无外部依赖
interface BarDatum { label: string; value: number; color?: string; }

export function BarChart({ data, height = 240, unit = '', valueFmt }: {
  data: BarDatum[]; height?: number; unit?: string; valueFmt?: (v: number) => string;
}) {
  const w = 720, h = height, pad = { l: 48, r: 12, t: 16, b: 36 };
  const max = Math.max(...data.map(d => d.value), 1);
  const bw = (w - pad.l - pad.r) / data.length;
  const fmt = valueFmt ?? ((v: number) => v.toFixed(0));
  return (
    <svg className="svg-chart" viewBox={`0 0 ${w} ${h}`} role="img">
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const y = pad.t + (h - pad.t - pad.b) * (1 - t);
        return <g key={t}>
          <line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#e8ecf3" />
          <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#8a93a5">{fmt(max * t)}</text>
        </g>;
      })}
      {data.map((d, i) => {
        const bh = (h - pad.t - pad.b) * d.value / max;
        const x = pad.l + i * bw + bw * 0.18;
        const y = h - pad.b - bh;
        return <g key={i}>
          <rect x={x} y={y} width={bw * 0.64} height={bh} rx={3} fill={d.color ?? '#2f5fe0'} />
          <text x={x + bw * 0.32} y={y - 4} textAnchor="middle" fontSize="9.5" fill="#4a5468">{fmt(d.value)}</text>
          <text x={x + bw * 0.32} y={h - pad.b + 15} textAnchor="middle" fontSize="10" fill="#6b7588">{d.label}</text>
        </g>;
      })}
      <text x={w - pad.r} y={h - 4} textAnchor="end" fontSize="10" fill="#8a93a5">{unit}</text>
    </svg>
  );
}

interface LinePoint { x: number; y: number; label?: string; }

export function LineChart({ series, height = 240, xLabel = '', yLabel = '' }: {
  series: { name: string; color: string; points: LinePoint[] }[]; height?: number; xLabel?: string; yLabel?: string;
}) {
  const w = 720, h = height, pad = { l: 52, r: 16, t: 18, b: 40 };
  const allY = series.flatMap(s => s.points.map(p => p.y));
  const allX = series.flatMap(s => s.points.map(p => p.x));
  const minY = Math.min(...allY, 0), maxY = Math.max(...allY, 1);
  const minX = Math.min(...allX), maxX = Math.max(...allX, minX + 1);
  const sx = (x: number) => pad.l + (x - minX) / (maxX - minX) * (w - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - minY) / (maxY - minY)) * (h - pad.t - pad.b);
  return (
    <svg className="svg-chart" viewBox={`0 0 ${w} ${h}`} role="img">
      {[0, 0.25, 0.5, 0.75, 1].map(t => {
        const y = pad.t + (h - pad.t - pad.b) * (1 - t);
        const val = minY + (maxY - minY) * t;
        return <g key={t}>
          <line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#e8ecf3" />
          <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#8a93a5">{val.toFixed(1)}</text>
        </g>;
      })}
      {series.map((s, si) => (
        <polyline key={si} fill="none" stroke={s.color} strokeWidth={2}
          points={s.points.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')} />
      ))}
      {series[0]?.points.filter((_, i) => i % Math.ceil(series[0].points.length / 8) === 0).map((p, i) => (
        <text key={i} x={sx(p.x)} y={h - pad.b + 16} textAnchor="middle" fontSize="10" fill="#6b7588">{p.label ?? p.x}</text>
      ))}
      <text x={w / 2} y={h - 6} textAnchor="middle" fontSize="11" fill="#6b7588">{xLabel}</text>
      <text x={14} y={h / 2} textAnchor="middle" fontSize="11" fill="#6b7588" transform={`rotate(-90 14 ${h / 2})`}>{yLabel}</text>
      {series.map((s, i) => (
        <g key={i} transform={`translate(${pad.l + i * 110}, ${6})`}>
          <rect width={10} height={10} fill={s.color} rx={2} />
          <text x={15} y={9} fontSize="11" fill="#4a5468">{s.name}</text>
        </g>
      ))}
    </svg>
  );
}
