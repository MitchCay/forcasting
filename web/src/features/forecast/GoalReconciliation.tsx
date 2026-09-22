import { useMemo } from 'react'
import { formatUSD, todayISO, type Account, type Goal } from 'shared'
import { Card } from '../../components/Card'
import { useAccounts } from '../accounts/queries'
import { useGoals } from '../goals/queries'

// ── Savings reconciliation ──────────────────────────────────────────────
// Reconciles what your goals CLAIM you've saved against the money actually
// sitting in the accounts those goals point at (their target account). If two
// goals say $500 is set aside in an account, that account should hold at least
// $500. When goals claim more than the account holds, we flag the shortfall —
// the money you think is earmarked isn't actually there.

interface AccountRecon {
  account: Account
  claimedCents: number
  actualCents: number
  goals: Goal[]
}

export function GoalReconciliation() {
  const { data: goals } = useGoals()
  const { data: accounts } = useAccounts()

  const rows = useMemo<AccountRecon[]>(() => {
    if (!goals || !accounts) return []
    const accountById = new Map(accounts.map((a) => [a.id, a]))
    const today = todayISO()
    const byAccount = new Map<string, { claimed: number; goals: Goal[] }>()
    for (const g of goals) {
      // Once a goal has reached its target AND its date has passed, the money is
      // considered spent (used for its purpose), so it no longer needs backing
      // in the account and drops out of the reconciliation.
      const reached = g.savedCents >= g.targetCents
      const pastDue = g.targetDate < today
      if (reached && pastDue) continue
      const cur = byAccount.get(g.targetAccountId) ?? { claimed: 0, goals: [] }
      cur.claimed += g.savedCents
      cur.goals.push(g)
      byAccount.set(g.targetAccountId, cur)
    }
    const out: AccountRecon[] = []
    for (const [accountId, agg] of byAccount) {
      const account = accountById.get(accountId)
      if (!account) continue
      out.push({
        account,
        claimedCents: agg.claimed,
        actualCents: account.currentBalanceCents,
        goals: agg.goals,
      })
    }
    // Shortfalls first (largest shortfall on top), then backed accounts by name.
    return out.sort((a, b) => {
      const sa = a.claimedCents - a.actualCents
      const sb = b.claimedCents - b.actualCents
      if (sa > 0 || sb > 0) return sb - sa
      return a.account.name.localeCompare(b.account.name)
    })
  }, [goals, accounts])

  if (rows.length === 0) return null

  const totalClaimed = rows.reduce((s, r) => s + r.claimedCents, 0)
  const totalActual = rows.reduce((s, r) => s + r.actualCents, 0)
  const shortAccounts = rows.filter((r) => r.claimedCents > r.actualCents)

  return (
    <Card title="Savings reconciliation">
      <p className="muted recon__intro">
        Does the money your goals say is set aside actually line up with what's
        in the accounts backing them?
      </p>

      {shortAccounts.length > 0 ? (
        <div className="recon__headline recon__headline--bad">
          {shortAccounts.length === 1
            ? '1 account holds less than your goals claim is saved there.'
            : `${shortAccounts.length} accounts hold less than your goals claim is saved there.`}
        </div>
      ) : (
        <div className="recon__headline recon__headline--ok">
          Every account holds at least what your goals claim is saved there.
        </div>
      )}

      <ul className="recon__list">
        {rows.map((r) => {
          const shortfall = r.claimedCents - r.actualCents
          const isShort = shortfall > 0
          return (
            <li key={r.account.id} className="recon__row">
              <div className="recon__row-main">
                <span className="recon__name">{r.account.name}</span>
                <span
                  className={`goal-status__badge ${
                    isShort
                      ? 'goal-status__badge--bad'
                      : 'goal-status__badge--ok'
                  }`}
                >
                  {isShort ? `Short ${formatUSD(shortfall)}` : 'Backed'}
                </span>
              </div>
              <div className="recon__meta muted">
                Goals claim {formatUSD(r.claimedCents)} saved · account holds{' '}
                {formatUSD(r.actualCents)} · {r.goals.length}{' '}
                {r.goals.length === 1 ? 'goal' : 'goals'}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="recon__total">
        <span className="muted">Across these accounts</span>
        <span className={totalClaimed > totalActual ? 'negative' : 'muted'}>
          {formatUSD(totalClaimed)} claimed vs {formatUSD(totalActual)} on hand
        </span>
      </div>
    </Card>
  )
}
