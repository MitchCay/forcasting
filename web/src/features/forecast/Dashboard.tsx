import { useState } from 'react'
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
import { HorizonSelector } from './HorizonSelector'
import { OneTimeTransactionForm } from './OneTimeTransactionForm'
import { SummaryTiles } from './SummaryTiles'
import { useForecast } from './queries'

export function Dashboard() {
  const [horizon, setHorizon] = useState<ForecastHorizon>('3m')
  const [addOpen, setAddOpen] = useState(false)
  // Whether to break the reserved / available totals into per-account lines.
  const [reservedExpanded, setReservedExpanded] = useState(false)
  const [availableExpanded, setAvailableExpanded] = useState(false)
  const { data: accounts } = useAccounts()
  const { data: forecast, isLoading, error } = useForecast(horizon)

  // A breakout toggle is only worth showing when the bucket has more than one
  // (non-credit-card) account — otherwise the line already IS that account.
  const reservedCount = (accounts ?? []).filter(
    (a) => a.excludeFromForecast && a.type !== 'credit_card',
  ).length
  const availableCount = (accounts ?? []).filter(
    (a) => !a.excludeFromForecast && a.type !== 'credit_card',
  ).length

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
      {forecast && <GoalStatus forecast={forecast} />}
    </div>
  )
}
