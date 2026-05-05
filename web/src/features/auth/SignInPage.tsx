import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { authClient, signIn } from '../../lib/auth-client'
import { Field } from '../../components/Field'

export function SignInPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await signIn.email({ email, password })
      if (res.error) throw new Error(res.error.message ?? 'Sign-in failed')
      // The router's beforeLoad picks up the new session and redirects to /.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setSubmitting(false)
    }
  }

  const passkeySignIn = async () => {
    setError(null)
    setPasskeyBusy(true)
    try {
      const res = await authClient.signIn.passkey()
      if (res?.error) throw new Error(res.error.message ?? 'Passkey sign-in failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Passkey sign-in failed')
    } finally {
      setPasskeyBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <h2>Sign in</h2>
      <form className="stack" onSubmit={submit}>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username webauthn"
            required
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        {error && <div className="error-banner">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="auth-divider"><span>or</span></div>

      <button
        type="button"
        className="secondary"
        onClick={passkeySignIn}
        disabled={passkeyBusy}
        style={{ width: '100%' }}
      >
        {passkeyBusy ? 'Waiting for device…' : 'Sign in with passkey'}
      </button>

      <p style={{ marginTop: '1rem', fontSize: '.9rem', color: 'var(--muted)' }}>
        Don't have an account? <Link to="/sign-up">Sign up</Link>
      </p>
    </div>
  )
}
