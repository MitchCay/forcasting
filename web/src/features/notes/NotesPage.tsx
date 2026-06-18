import { useState } from 'react'
import { LedgerNote } from './LedgerNote'
import { useNotes } from './queries'

// Lightweight client-side "draft" sentinel: when the user clicks "Add new
// note", we render a LedgerNote with null `note` and `initiallyEditing`
// true. Saving turns it into a real note on the server; cancelling drops
// the draft.

export function NotesPage() {
  const { data: notes, isLoading, error } = useNotes()
  const [drafting, setDrafting] = useState(false)

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
          <h2 style={{ margin: 0 }}>Notes</h2>
          <p className="muted" style={{ margin: '0.15rem 0 0' }}>
            Side notes that don't drive the forecast — useful for shared
            reviews, weekly spend tracking, and the like.
          </p>
        </div>
        <button
          type="button"
          className={drafting ? 'secondary' : ''}
          onClick={() => setDrafting((v) => !v)}
          disabled={drafting}
          title={drafting ? 'Already drafting a new note' : 'Add new note'}
        >
          + Add new note
        </button>
      </header>

      {drafting && (
        <LedgerNote
          note={null}
          initiallyEditing
          onCancelNew={() => setDrafting(false)}
        />
      )}

      {isLoading && <p className="muted">Loading notes…</p>}
      {error && (
        <div className="error-banner">{(error as Error).message}</div>
      )}
      {notes &&
        notes.length === 0 &&
        !drafting && <p className="muted">No notes yet.</p>}
      {notes &&
        notes.map((n) => <LedgerNote key={n.id} note={n} />)}
    </div>
  )
}
