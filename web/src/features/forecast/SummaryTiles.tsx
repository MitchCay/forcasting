import { useMemo } from 'react'
import { formatUSD, type ForecastResponse } from 'shared'

// Compact stat tiles up top. Numbers come straight from the forecast points
// — the first point is "now," the last is end-of-horizon, and we scan for
// the lowest projected available balance + when it occurs.

export function SummaryTiles({ forecast }: { forecast: ForecastResponse }) {
  const stats = useMemo(() => {
    const points = forecast.points
    if (points.length === 0) return null
    const first = points[0]!
    const last = points[points.length - 1]!

    let lowestPoint = first
    for (const p of points) {
      if (p.availableBalanceCents < lowestPoint.availableBalanceCents) {
        lowestPoint = p
      }
    }
    return { first, last, lowestPoint }
  }, [forecast.points])

  if (!stats) return null

  return (
    <div className="summary-tiles">
      <Tile
        label="Available now"
        valueCents={stats.first.availableBalanceCents}
      />
      <Tile
        label="Reserved"
        valueCents={stats.first.reservedBalanceCents}
        muted
      />
      <Tile
        label="Projected at horizon"
        valueCents={stats.last.availableBalanceCents}
        delta={
          stats.last.availableBalanceCents - stats.first.availableBalanceCents
        }
      />
      <Tile
        label="Lowest projected"
        valueCents={stats.lowestPoint.availableBalanceCents}
        sub={`on ${stats.lowestPoint.date}`}
        warn={stats.lowestPoint.availableBalanceCents < 0}
      />
    </div>
  )
}

function Tile({
  label,
  valueCents,
  delta,
  sub,
  muted,
  warn,
}: {
  label: string
  valueCents: number
  delta?: number
  sub?: string
  muted?: boolean
  warn?: boolean
}) {
  const valueClass = warn
    ? 'tile__value tile__value--warn'
    : muted
    ? 'tile__value tile__value--muted'
    : 'tile__value'

  return (
    <div className="tile">
      <div className="tile__label">{label}</div>
      <div className={valueClass}>{formatUSD(valueCents)}</div>
      {delta !== undefined && (
        <div
          className={`tile__delta ${
            delta >= 0 ? 'tile__delta--positive' : 'tile__delta--negative'
          }`}
        >
          {delta >= 0 ? '+' : ''}
          {formatUSD(delta)}
        </div>
      )}
      {sub && <div className="tile__sub">{sub}</div>}
    </div>
  )
}
