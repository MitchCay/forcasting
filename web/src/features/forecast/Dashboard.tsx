import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { ForecastHorizon } from 'shared'
import { Card } from '../../components/Card'
import { Modal } from '../../components/Modal'
import { Switch } from '../../components/Switch'
import { AddPasskeyCard } from '../auth/AddPasskeyCard'
import { useAccounts } from '../accounts/queries'
import { CategoryPieChart } from './CategoryPieChart'
import { ForecastChart } from './ForecastChart'
import { ForecastWarnings, GoalStatus } from './GoalStatus'
import { GoalReconciliation } from './GoalReconciliation'
import { PredictionExplainer } from './PredictionExplainer'
import { HorizonSelector } from './HorizonSelector'
import { OneTimeTransactionForm } from './OneTimeTransactionForm'
import { SummaryTiles } from './SummaryTiles'
import { useForecast } from './queries'

// Categories the user has excluded from the predicted-spending line — e.g.
// travel that's actually funded from a goal, so the goal already budgets it.
// Persisted per-browser. Defaults to excluding "Travel", which is usually
// goal-funded; the user can add it back or exclude others from the chart.
const PREDICT_EXCLUDE_KEY = 'forecast.predictExclude'

function readPredictExclude(): string[] {
  try {
    const raw = localStorage.getItem(PREDICT_EXCLUDE_KEY)
    if (raw == null) return ['Travel']
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return ['Travel']
  }
}

export function Dashboard() {
  const [horizon, setHorizon] = useState<ForecastHorizon>('3m')
  const [addOpen, setAddOpen] = useState(false)
  // Whether to break the reserved / available totals into per-account lines.
  const [reservedExpanded, setReservedExpanded] = useState(false)
  const [availableExpanded, setAvailableExpanded] = useState(false)
  // History-driven predicted spending line + its per-category breakout.
  const [showPredicted, setShowPredicted] = useState(false)
  const [predictedByCategory, setPredictedByCategory] = useState(false)
  // Layer a bounded spending trend on the predicted line (exploratory; off by
  // default). Changes the forecast request, so it flows through useForecast.
  const [showTrend, setShowTrend] = useState(false)
  // Categories excluded from the prediction (goal-funded, etc.), persisted.
  const [excludeCats, setExcludeCats] = useState<string[]>(readPredictExclude)
  useEffect(() => {
    try {
      localStorage.setItem(PREDICT_EXCLUDE_KEY, JSON.stringify(excludeCats))
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [excludeCats])
  const excludeCategory = (c: string) =>
    setExcludeCats((prev) =>
      prev.some((x) => x.toLowerCase() === c.toLowerCase())
        ? prev
        : [...prev, c],
    )
  const includeCategory = (c: string) =>
    setExcludeCats((prev) =>
      prev.filter((x) => x.toLowerCase() !== c.toLowerCase()),
    )
  const { data: accounts } = useAccounts()
  const { data: forecast, isLoading, error } = useForecast(
    horizon,
    excludeCats,
    showTrend,
  )

  // A breakout toggle is only worth showing when the bucket has more than one
  // (non-credit-card) account — otherwise the line already IS that account.
  const reservedCount = (accounts ?? []).filter(
    (a) => a.excludeFromForecast && a.type !== 'credit_card',
  ).length
  const availableCount = (accounts ?? []).filter(
    (a) => !a.excludeFromForecast && a.type !== 'credit_card',
  ).length

  const spendingModel = forecast?.spendingModel ?? null
  const hasSpendingModel = !!spendingModel && spendingModel.categories.length > 0

  // Empty state: brand-new user. Send them to Accounts so the rest of the
  // dashboard has something to chart.
  if (accounts && accounts.length === 0) {
    return (
      <div>
        <h2>Dashboard</h2>
        <AddPasskeyCard />
        <Card title="Welcome">
          <p>
            Add an account on the{' '}
            <Link to="/accounts">Accounts page</Link> to get started — the
            forecast will populate as soon as it has a balance to work with.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <h2 style={{ marginBottom: '0.25rem' }}>Dashboard</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: '1.25rem' }}>
        Projected forward from today, given your scheduled income, expenses,
        and goal contributions.
      </p>

      <AddPasskeyCard />

      {error && <div className="error-banner">{(error as Error).message}</div>}

      {forecast && (
        <SummaryTiles
          forecast={forecast}
          accounts={accounts}
          reservedExpanded={reservedExpanded}
          availableExpanded={availableExpanded}
        />
      )}

      <Card>
        <div className="forecast-chart-header">
          <h3 style={{ margin: 0 }}>Available balance</h3>
          <div className="forecast-chart-header__actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setAddOpen(true)}
            >
              + Add transaction
            </button>
            {reservedCount > 1 && (
              <Switch
                checked={reservedExpanded}
                onChange={setReservedExpanded}
                label="Expand reserved"
                title="Break the reserved line into one line per account"
              />
            )}
            {availableCount > 1 && (
              <Switch
                checked={availableExpanded}
                onChange={setAvailableExpanded}
                label="Expand available"
                title="Break the available line into one line per account"
              />
            )}
            {hasSpendingModel && (
              <Switch
                checked={showPredicted}
                onChange={setShowPredicted}
                label="Predicted"
                title="Overlay a history-driven prediction of your everyday spending on top of the scheduled-only line"
              />
            )}
            {hasSpendingModel && showPredicted && (
              <Switch
                checked={predictedByCategory}
                onChange={setPredictedByCategory}
                label="By category"
                title="Break the predicted spending into stacked per-category bands"
              />
            )}
            {hasSpendingModel && showPredicted && (
              <Switch
                checked={showTrend}
                onChange={setShowTrend}
                label="Trend"
                title="Layer a bounded spending trend on the prediction (ramps for ~a quarter, then holds)"
              />
            )}
            <HorizonSelector value={horizon} onChange={setHorizon} />
          </div>
        </div>
        {isLoading && <p className="muted">Loading…</p>}
        {forecast && (
          <ForecastChart
            forecast={forecast}
            horizon={horizon}
            accounts={accounts}
            reservedExpanded={reservedExpanded}
            availableExpanded={availableExpanded}
            showPredicted={showPredicted}
            predictedByCategory={predictedByCategory}
          />
        )}
        {showPredicted && hasSpendingModel && spendingModel && (
          <PredictionExplainer
            model={spendingModel}
            excluded={excludeCats}
            onExclude={excludeCategory}
            onInclude={includeCategory}
          />
        )}
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add one-time transaction"
      >
        <OneTimeTransactionForm onSuccess={() => setAddOpen(false)} />
      </Modal>

      {forecast && (
        <Card title="Spending by category">
          <CategoryPieChart
            slices={forecast.categoryBreakdown}
            emptyMessage="No expense events in the selected horizon yet."
          />
        </Card>
      )}

      {forecast && <ForecastWarnings forecast={forecast} />}
      <GoalReconciliation />
      {forecast && <GoalStatus forecast={forecast} />}
    </div>
  )
}
