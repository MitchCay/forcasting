import { useState } from 'react'
import { Card } from '../../components/Card'
import { GoalForm } from './GoalForm'
import { GoalList } from './GoalList'

export function GoalsPage() {
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
          <h2 style={{ margin: 0 }}>Goals</h2>
          <p className="muted" style={{ margin: '0.15rem 0 0' }}>
            Targets the forecast can keep you honest about.
          </p>
        </div>
        <button
          type="button"
          className={adding ? 'secondary' : ''}
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? 'Cancel' : 'Add goal'}
        </button>
      </header>

      {adding && (
        <Card title="New goal">
          <GoalForm onSuccess={() => setAdding(false)} />
        </Card>
      )}

      <GoalList />
    </div>
  )
}
