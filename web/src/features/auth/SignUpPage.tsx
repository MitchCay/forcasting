import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { signUp } from '../../lib/auth-client'
import { Field } from '../../components/Field'

export function SignUpPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (!name.trim()) throw new Error('Name is required')
      const res = await signUp.email({ email, password, name })
      if (res.error) throw new Error(res.error.message ?? 'Sign-up failed')
      // autoSignIn is on, so the session lands immediately and the router
      // redirects to / via beforeLoad.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-up failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <h2>Create your account</h2>
      <form className="stack" onSubmit={submit}>
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </Field>
        <Field label="Password" hint="Minimum 8 characters">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        {error && <div className="error-banner">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p style={{ marginTop: '1rem', fontSize: '.9rem', color: 'var(--muted)' }}>
        After signing up, you can register a passkey from the dashboard for
        faster sign-in next time.
      </p>

      <p style={{ marginTop: '0.5rem', fontSize: '.9rem', color: 'var(--muted)' }}>
        Have an account? <Link to="/sign-in">Sign in</Link>
      </p>
    </div>
  )
}
