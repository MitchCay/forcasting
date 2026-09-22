import { formatUSD, type SpendingModelSummary } from 'shared'

// ── "Why this line?" ─────────────────────────────────────────────────────
// Plain-language decomposition of the predicted (adjusted) balance line, so
// the number isn't a black box: what weekly spend it assumes, which categories
// drive it, what the balance-history calibration did, and what was left out —
// either because a scheduled item covers it, or because the user excluded it
// (e.g. a category funded from a goal, which the goal already budgets for).

const MAX_DRIVERS = 6
const TREND_EPS_CENTS = 50 // ignore sub-$0.50/wk drift as "flat"

function trendNote(weeklyTrendCents: number): string | null {
  if (weeklyTrendCents > TREND_EPS_CENTS) {
    return `trending up ~${formatUSD(weeklyTrendCents)}/wk`
  }
  if (weeklyTrendCents < -TREND_EPS_CENTS) {
    return `easing ~${formatUSD(-weeklyTrendCents)}/wk`
  }
  return null
}

function calibrationSentence(model: SpendingModelSummary): string {
  if (!model.calibrationApplied) {
    return 'Not yet checked against your balance history (that needs at least two balance updates on a spending account) — this is the raw ledger estimate.'
  }
  const f = model.calibrationFactor
  if (f >= 1.02) {
    return `Your real balances have been dropping a bit faster than your ledgers alone suggest, so the estimate is nudged up about ${Math.round(
      (f - 1) * 100,
    )}%.`
  }
  if (f <= 0.98) {
    return `Your real balances held up a little better than your ledgers alone suggest, so the estimate is trimmed about ${Math.round(
      (1 - f) * 100,
    )}%.`
  }
  return 'This lines up with your real balance history, so no meaningful adjustment was needed.'
}

export function PredictionExplainer({
  model,
  excluded,
  onExclude,
  onInclude,
}: {
  model: SpendingModelSummary
  /** Categories the user has excluded from the prediction (goal-funded, etc.). */
  excluded: string[]
  onExclude: (category: string) => void
  onInclude: (category: string) => void
}) {
  const weekly = model.categories.reduce((s, c) => s + c.weeklyCents, 0)
  const monthly = Math.round((weekly * 52) / 12)
  const drivers = model.categories.slice(0, MAX_DRIVERS)
  const moreCount = model.categories.length - drivers.length
  const anyTrending = model.categories.some(
    (c) => Math.abs(c.weeklyTrendCents) > TREND_EPS_CENTS,
  )

  return (
    <details className="prediction-why">
      <summary>Why this line?</summary>
      <div className="prediction-why__body">
        <p className="prediction-why__lead">
          It assumes your everyday spending keeps running at about{' '}
          <strong>{formatUSD(weekly)}/week</strong> (~{formatUSD(monthly)}
          /month) on top of your scheduled items, so the line drops faster than
          the scheduled-only line.
        </p>

        <p className="muted">
          Built from {model.weeksObserved} weeks of your ledger history since{' '}
          {model.lookbackStart}. {calibrationSentence(model)}
        </p>

        {drivers.length > 0 && (
          <div className="prediction-why__drivers">
            <div className="prediction-why__label">Biggest drivers</div>
            <ul>
              {drivers.map((c) => {
                const note = trendNote(c.weeklyTrendCents)
                return (
                  <li key={c.category}>
                    <span className="prediction-why__cat">{c.category}</span>
                    <span className="prediction-why__amt">
                      ~{formatUSD(c.weeklyCents)}/wk
                      {note && (
                        <span
                          className={
                            c.weeklyTrendCents > 0
                              ? 'prediction-why__trend prediction-why__trend--up'
                              : 'prediction-why__trend prediction-why__trend--down'
                          }
                        >
                          {' '}
                          {c.weeklyTrendCents > 0 ? '↑' : '↓'} {note}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="prediction-why__exclude"
                      onClick={() => onExclude(c.category)}
                      title="Exclude from the prediction — use this if the category is funded from a goal, so it isn't counted twice"
                    >
                      exclude
                    </button>
                  </li>
                )
              })}
            </ul>
            {moreCount > 0 && (
              <div className="muted prediction-why__more">
                + {moreCount} smaller {moreCount === 1 ? 'category' : 'categories'}
              </div>
            )}
            <div className="muted prediction-why__hint">
              Funded from a goal? Exclude it so it isn't counted twice — the goal
              already budgets that money.
            </div>
          </div>
        )}

        {anyTrending && (
          <p className="muted">
            Trend is on: rising categories keep ramping for about a quarter, then
            level off — which is why the line steepens early rather than staying
            parallel.
          </p>
        )}

        {excluded.length > 0 && (
          <div className="prediction-why__excluded">
            <div className="prediction-why__label">
              Excluded (funded from a goal or set aside)
            </div>
            <div className="prediction-why__chips">
              {excluded.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="prediction-why__chip"
                  onClick={() => onInclude(c)}
                  title="Add back into the prediction"
                >
                  {c} <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {model.excludedCategories.length > 0 && (
          <p className="muted">
            Already handled by your scheduled items (so they're not added again):{' '}
            {model.excludedCategories.join(', ')}.
          </p>
        )}

        <p className="muted prediction-why__caveat">
          This is an estimate from your own spending history, not a scheduled
          amount — the further out you look, the fuzzier it gets.
        </p>
      </div>
    </details>
  )
}
