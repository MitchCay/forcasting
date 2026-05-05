import { useState } from 'react'
import { accountTypeLabels, formatUSD, type Account } from 'shared'
import { Card } from '../../components/Card'
import { useAccounts, useDeleteAccount, useSnapshots } from './queries'
import { SnapshotForm } from './SnapshotForm'
import { EditAccountForm } from './EditAccountForm'

export function AccountList() {
  const { data: accounts, isLoading, error } = useAccounts()

  if (isLoading) return <p className="muted">Loading accounts…</p>
  if (error) {
    return <div className="error-banner">{(error as Error).message}</div>
  }
  if (!accounts || accounts.length === 0) {
    return <p className="muted">No accounts yet. Add one to get started.</p>
  }

  return (
    <div>
      {accounts.map((a) => (
        <AccountCard key={a.id} account={a} />
      ))}
    </div>
  )
}

function AccountCard({ account }: { account: Account }) {
  const [open, setOpen] = useState(false)
  const del = useDeleteAccount()

  const balance = formatUSD(account.currentBalanceCents)
  const isNegative = account.currentBalanceCents < 0

  const handleDelete = () => {
    if (
      confirm(
        `Delete "${account.name}"? This also removes its snapshots and transactions.`,
      )
    ) {
      del.mutate(account.id)
    }
  }

  return (
    <Card
      title={
        <span>
          {account.name}{' '}
          <span className="muted">· {accountTypeLabels[account.type]}</span>
        </span>
      }
      actions={
        <>
          <span className={`amount ${isNegative ? 'negative' : 'positive'}`}>
            {balance}
          </span>
          <button
            type="button"
            className="secondary"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide' : 'Update / history'}
          </button>
          <button
            type="button"
            className="danger"
            onClick={handleDelete}
            disabled={del.isPending}
          >
            Delete
          </button>
        </>
      }
    >
      {open && <AccountDetail account={account} />}
    </Card>
  )
}

function AccountDetail({ account }: { account: Account }) {
  const accountId = account.id
  const { data: snapshots, isLoading } = useSnapshots(accountId)

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Edit details</h4>
      <EditAccountForm account={account} />
      <h4 style={{ marginTop: '1.5rem' }}>Record new balance</h4>
      <SnapshotForm accountId={accountId} />
      <h4 style={{ marginTop: '1.5rem' }}>Snapshot history</h4>
      {isLoading ? (
        <p className="muted">Loading…</p>
      ) : !snapshots || snapshots.length === 0 ? (
        <p className="muted">No snapshots yet.</p>
      ) : (
        <ul className="list">
          {snapshots.map((s) => (
            <li key={s.id} className="list__row">
              <div>
                <div className="amount">{formatUSD(s.balanceCents)}</div>
                {s.note && <div className="muted">{s.note}</div>}
              </div>
              <div className="muted">{s.recordedAt}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
