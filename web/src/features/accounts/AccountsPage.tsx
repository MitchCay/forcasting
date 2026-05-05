import { useState } from 'react'
import { Card } from '../../components/Card'
import { AccountForm } from './AccountForm'
import { AccountList } from './AccountList'

export function AccountsPage() {
  const [adding, setAdding] = useState(false)

  return (
    <div>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          border: 'none',
          padding: 0,
          marginBottom: '1rem',
        }}
      >
        <h2 style={{ margin: 0 }}>Accounts</h2>
        <button
          type="button"
          className={adding ? 'secondary' : ''}
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? 'Cancel' : 'Add account'}
        </button>
      </header>

      {adding && (
        <Card title="New account">
          <AccountForm onSuccess={() => setAdding(false)} />
        </Card>
      )}

      <AccountList />
    </div>
  )
}
