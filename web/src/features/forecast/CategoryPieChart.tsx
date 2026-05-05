import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { formatUSD, type ForecastResponse } from 'shared'

// Palette for slices. Picked to read on the dark theme without colliding
// with positive/negative semantic colors used elsewhere.
const SLICE_COLORS = [
  '#6ea8ff', // accent
  '#8cb9ff',
  '#5bc0c2',
  '#a78bfa',
  '#f472b6',
  '#fbbf24',
  '#94a3b8',
  '#64748b',
]

export function CategoryPieChart({
  forecast,
}: {
  forecast: ForecastResponse
}) {
  const slices = forecast.categoryBreakdown
  const totalCents = useMemo(
    () => slices.reduce((sum, s) => sum + s.totalCents, 0),
    [slices],
  )

  if (slices.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        No expense events in the selected horizon yet.
      </p>
    )
  }

  return (
    <div className="category-breakdown">
      <div className="category-breakdown__chart">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="totalCents"
              nameKey="category"
              innerRadius="55%"
              outerRadius="85%"
              paddingAngle={1}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((_, i) => (
                <Cell
                  key={i}
                  fill={SLICE_COLORS[i % SLICE_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 13,
              }}
              formatter={(value: number, name: string) => [
                formatUSD(value),
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="category-breakdown__center">
          <div className="category-breakdown__center-label">Total</div>
          <div className="category-breakdown__center-value">
            {formatUSD(totalCents)}
          </div>
        </div>
      </div>

      <ul className="category-breakdown__legend">
        {slices.map((s, i) => {
          const pct = totalCents > 0 ? (s.totalCents / totalCents) * 100 : 0
          return (
            <li key={s.category} className="category-breakdown__legend-row">
              <span
                className="category-breakdown__swatch"
                style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
              />
              <span className="category-breakdown__legend-name">
                {s.category}
              </span>
              <span className="category-breakdown__legend-amount">
                {formatUSD(s.totalCents)}{' '}
                <span className="muted">({pct.toFixed(0)}%)</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
