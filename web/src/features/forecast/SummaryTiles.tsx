import { useMemo } from 'react'
import { formatUSD, type Account, type ForecastResponse } from 'shared'
import { availableColor, reservedColor } from './palette'

// Compact stat tiles up top. Numbers come straight from the forecast points
// — the first point is "now," the last is end-of-horizon, and we scan for
// the lowest projected available balance + when it occurs.
//
// When the chart's available / reserved lines are expanded, the matching
// "now" tile splits into one tile per account (with a color swatch that ties
// back to its chart line) instead of a single summed figure.

export function SummaryTiles({
  forecast,
  accounts,
  reservedExpanded = false,
  availableExpanded = false,
}: {
  forecast: ForecastResponse
  accounts?: Account[]
  reservedExpanded?: boolean
  availableExpanded?: boolean
}) {
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

  const reservedAccounts = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) => a.excludeFromForecast && a.type !== 'credit_card',
      ),
    [accounts],
  )
  const availableAccounts = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) => !a.excludeFromForecast && a.type !== 'credit_card',
      ),
    [accounts],
  )

  if (!stats) return null

  const showAvailableBreakout =
    availableExpanded && availableAccounts.length > 1
  const showReservedBreakout = reservedExpanded && reservedAccounts.length > 1

  return (
    <div className="summary-tiles">
      {showAvailableBreakout ? (
        availableAccounts.map((a, i) => (
          <Tile
            key={a.id}
            label={a.name}
            valueCents={stats.first.byAccount[a.id] ?? 0}
            swatch={availableColor(i)}
          />
        ))
      ) : (
        <Tile
          label="Available now"
          valueCents={stats.first.availableBalanceCents}
        />
      )}

      {showReservedBreakout ? (
        reservedAccounts.map((a, i) => (
          <Tile
            key={a.id}
            label={a.name}
            valueCents={stats.first.byAccount[a.id] ?? 0}
            swatch={reservedColor(i)}
            muted
          />
        ))
      ) : (
        <Tile
          label="Reserved"
          valueCents={stats.first.reservedBalanceCents}
          muted
        />
      )}

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
  swatch,
}: {
  label: string
  valueCents: number
  delta?: number
  sub?: string
  muted?: boolean
  warn?: boolean
  /** Optional color dot tying the tile to its chart line. */
  swatch?: string
}) {
  const valueClass = warn
    ? 'tile__value tile__value--warn'
    : muted
    ? 'tile__value tile__value--muted'
    : 'tile__value'

  return (
    <div className="tile">
      <div className="tile__label">
        {swatch && (
          <span className="tile__swatch" style={{ background: swatch }} />
        )}
        {label}
      </div>
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
