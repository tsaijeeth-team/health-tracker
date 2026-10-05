import { useId, useMemo, useState, type PointerEvent } from 'react'
import { formatDateLabel } from '../lib/dates'
import { formatNumber } from '../lib/food'

// One-series line chart over time (inline SVG).
// - 2px line, 8px markers with a 2px surface ring, hairline grid, no legend (the title names the series).
// - Missing values (null) break the line: a gap, never a fake zero.
// - Tap or hover shows a crosshair + tooltip; a table view lives next to the charts.

export type ChartPoint = { date: string; value: number | null; detail?: string }

const W = 340
const H = 180
const PAD = { top: 16, right: 46, bottom: 26, left: 40 }

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86400000
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1
    min -= pad
    max += pad
  }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return ticks
}

function LineChart({ title, unit, points }: { title: string; unit: string; points: ChartPoint[] }) {
  const id = useId()
  const [active, setActive] = useState<number | null>(null)
  const valid = points.filter((p) => p.value !== null) as (ChartPoint & { value: number })[]

  const layout = useMemo(() => {
    if (valid.length === 0) return null
    const xs = points.map((p) => dayNumber(p.date))
    const xMin = Math.min(...xs)
    const xMax = Math.max(...xs)
    const values = valid.map((p) => p.value)
    const ticks = niceTicks(Math.min(...values), Math.max(...values))
    const yMin = ticks[0]
    const yMax = ticks[ticks.length - 1]
    const plotW = W - PAD.left - PAD.right
    const plotH = H - PAD.top - PAD.bottom
    const x = (date: string) => PAD.left + (xMax === xMin ? plotW / 2 : ((dayNumber(date) - xMin) / (xMax - xMin)) * plotW)
    const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH
    // Line segments split at missing values.
    const segments: string[] = []
    let current: string[] = []
    for (const p of points) {
      if (p.value === null) {
        if (current.length) segments.push(current.join(' '))
        current = []
      } else {
        current.push(`${current.length ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`)
      }
    }
    if (current.length) segments.push(current.join(' '))
    return { x, y, ticks, segments }
  }, [points, valid])

  const gaps = points.length - valid.length
  const last = valid.at(-1)

  if (!layout) {
    return (
      <figure className="chart">
        <figcaption className="chart-title">{title}</figcaption>
        <p className="muted small">No values yet.</p>
      </figure>
    )
  }

  function nearest(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * W
    let best = 0
    let bestDist = Infinity
    points.forEach((p, i) => {
      const d = Math.abs(layout!.x(p.date) - px)
      if (d < bestDist) { bestDist = d; best = i }
    })
    setActive(best)
  }

  const activePoint = active === null ? null : points[active]
  const tipX = activePoint ? layout.x(activePoint.date) : 0

  return (
    <figure className="chart">
      <figcaption className="chart-title">
        {title}
        {gaps > 0 && <span className="muted small"> · {gaps} gap{gaps === 1 ? '' : 's'}</span>}
      </figcaption>
      <div className="chart-box">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={`${id}-desc`}
          onPointerMove={nearest}
          onPointerDown={nearest}
          onPointerLeave={() => setActive(null)}
        >
          <desc id={`${id}-desc`}>
            {title}: {valid.length} values from {formatDateLabel(points[0].date)} to {formatDateLabel(points.at(-1)!.date)}.
            {last ? ` Latest ${formatNumber(last.value)} ${unit}.` : ''}
          </desc>
          {layout.ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={layout.y(t)} y2={layout.y(t)} />
              <text className="chart-axis" x={PAD.left - 6} y={layout.y(t)} textAnchor="end" dominantBaseline="middle">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          <text className="chart-axis" x={PAD.left} y={H - 6} textAnchor="start">{formatDateLabel(points[0].date).replace(/^\w+, /, '')}</text>
          {points.length > 1 && (
            <text className="chart-axis" x={W - PAD.right} y={H - 6} textAnchor="end">{formatDateLabel(points.at(-1)!.date).replace(/^\w+, /, '')}</text>
          )}
          {activePoint && <line className="chart-crosshair" x1={tipX} x2={tipX} y1={PAD.top} y2={H - PAD.bottom} />}
          {layout.segments.map((d, i) => <path key={i} className="chart-line" d={d} />)}
          {valid.map((p) => (
            <circle key={p.date} className="chart-dot" cx={layout.x(p.date)} cy={layout.y(p.value)} r={4} />
          ))}
          {last && (
            <text className="chart-end-label" x={layout.x(last.date) + 8} y={layout.y(last.value)} dominantBaseline="middle">
              {formatNumber(last.value)}
            </text>
          )}
        </svg>
        {activePoint && (
          <div className="chart-tooltip" role="status" style={{ left: `${Math.min(70, Math.max(30, (tipX / W) * 100))}%` }}>
            <strong>{formatDateLabel(activePoint.date)}</strong>
            <span>{activePoint.value === null ? 'no value (gap)' : `${formatNumber(activePoint.value)} ${unit}`}</span>
            {activePoint.detail && <span className="muted">{activePoint.detail}</span>}
          </div>
        )}
      </div>
    </figure>
  )
}

export default LineChart
