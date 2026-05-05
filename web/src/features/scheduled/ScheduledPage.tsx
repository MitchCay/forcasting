import { useState } from 'react'
import { Card } from '../../components/Card'
import { ScheduledItemForm } from './ScheduledItemForm'
import { ScheduledItemList } from './ScheduledItemList'

export function ScheduledPage() {
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
        <div>
          <h2 style={{ margin: 0 }}>Scheduled items</h2>
          <p className="muted" style={{ margin: '0.15rem 0 0' }}>
            Recurring or one-time income and expenses that drive the forecast.
          </p>
        </div>
        <button
          type="button"
          className={adding ? 'secondary' : ''}
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? 'Cancel' : 'Add scheduled item'}
        </button>
      </header>

      {adding && (
        <Card title="New scheduled item">
          <ScheduledItemForm onSuccess={() => setAdding(false)} />
        </Card>
      )}

      <ScheduledItemList />
    </div>
  )
}
