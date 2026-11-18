export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartSeries {
  label: string;
  color: string;
  points: ChartPoint[];
}

interface ChartProps {
  series: ChartSeries[];
  reference?: { label: string; y: number; color: string };
  height?: number;
  format?: (value: number) => string;
}

const WIDTH = 640;
const PAD_LEFT = 46;
const PAD_RIGHT = 14;
const PAD_TOP = 14;
const PAD_BOTTOM = 24;

export function moneyTick(value: number): string {
  const abs = Math.abs(value);
  return value < 0 ? `-$${abs.toFixed(0)}` : `$${abs.toFixed(0)}`;
}

export default function Chart({
  series,
  reference,
  height = 190,
  format = (value) => value.toFixed(0),
}: ChartProps) {
  const points = series.flatMap((entry) => entry.points);
  if (points.length === 0 && !reference) {
    return <div className="chart-empty">No data yet.</div>;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  if (reference) ys.push(reference.y);
  let xMin = Math.min(0, ...xs);
  let xMax = Math.max(1, ...xs);
  if (xMax - xMin < 1) xMax = xMin + 1;
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yMax - yMin < 1) {
    yMin -= 1;
    yMax += 1;
  }
  const yPad = (yMax - yMin) * 0.12;
  yMin -= yPad;
  yMax += yPad;

  const xScale = (value: number): number =>
    PAD_LEFT +
    ((value - xMin) / (xMax - xMin)) * (WIDTH - PAD_LEFT - PAD_RIGHT);
  const yScale = (value: number): number =>
    PAD_TOP +
    (1 - (value - yMin) / (yMax - yMin)) * (height - PAD_TOP - PAD_BOTTOM);

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const legend = [...series.map((entry) => ({ label: entry.label, color: entry.color }))];
  if (reference) legend.push({ label: reference.label, color: reference.color });

  return (
    <div className="chart">
      <div className="chart-legend">
        {legend.map((entry) => (
          <span key={entry.label}>
            <i style={{ background: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="profit chart">
        {gridLines.map((fraction) => {
          const y = PAD_TOP + fraction * (height - PAD_TOP - PAD_BOTTOM);
          const value = yMax - fraction * (yMax - yMin);
          return (
            <g key={fraction}>
              <line
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke="#252c3a"
              />
              <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end">
                {format(value)}
              </text>
            </g>
          );
        })}
        {reference && (
          <line
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={yScale(reference.y)}
            y2={yScale(reference.y)}
            stroke={reference.color}
            strokeDasharray="5 4"
            strokeWidth={1.2}
          />
        )}
        {series.map((entry) =>
          entry.points.length > 1 ? (
            <polyline
              key={entry.label}
              fill="none"
              stroke={entry.color}
              strokeWidth={2}
              points={entry.points
                .map((point) => `${xScale(point.x)},${yScale(point.y)}`)
                .join(" ")}
            />
          ) : entry.points.length === 1 ? (
            <circle
              key={entry.label}
              cx={xScale(entry.points[0].x)}
              cy={yScale(entry.points[0].y)}
              r={2.5}
              fill={entry.color}
            />
          ) : null
        )}
        <text x={PAD_LEFT} y={height - 6} textAnchor="start">
          {xMin === 0 ? "start" : `${xMin}`}
        </text>
        <text x={WIDTH - PAD_RIGHT} y={height - 6} textAnchor="end">
          {xMax}
        </text>
      </svg>
    </div>
  );
}
