import { useSession } from '../../lib/auth-client'
import { Card } from '../../components/Card'

// Account settings page. Each section is a stub for now — the actual
// edit-profile, change-password, and avatar-upload flows will be wired up in
// follow-up tasks. The page is kept intentionally simple so the user-menu
// link has a real destination today.

export function AccountPage() {
  const { data: session } = useSession()
  const user = session?.user

  return (
    <div>
      <h2>Account</h2>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        Manage how you sign in and how you appear in Forecasting.
      </p>

      <Card title="Profile">
        <div className="muted" style={{ marginBottom: '0.5rem' }}>
          Signed in as <strong style={{ color: 'var(--text)' }}>{user?.email}</strong>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Editing your name and profile picture will live here. Coming soon.
        </p>
      </Card>

      <Card title="Password">
        <p className="muted" style={{ marginBottom: 0 }}>
          Change-password flow will live here. Coming soon.
        </p>
      </Card>

      <Card title="Passkeys">
        <p className="muted" style={{ marginBottom: 0 }}>
          A list of registered passkeys with the option to add or remove them
          will live here. Coming soon.
        </p>
      </Card>
    </div>
  )
}
