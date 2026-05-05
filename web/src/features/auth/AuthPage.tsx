import { useState } from 'react'
import { signIn, signUp } from '../../lib/auth-client'
import { Field } from '../../components/Field'

export function AuthPage() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
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
      if (mode === 'sign-up') {
        if (!name.trim()) throw new Error('Name is required')
        const res = await signUp.email({ email, password, name })
        if (res.error) throw new Error(res.error.message ?? 'Sign-up failed')
      } else {
        const res = await signIn.email({ email, password })
        if (res.error) throw new Error(res.error.message ?? 'Sign-in failed')
      }
      // Better Auth sets a session cookie; <App /> will re-render via useSession.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-page">
      <h2>{mode === 'sign-up' ? 'Create your account' : 'Sign in'}</h2>
      <form className="stack" onSubmit={submit}>
        {mode === 'sign-up' && (
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </Field>
        )}
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </Field>
        <Field label="Password" hint={mode === 'sign-up' ? 'Minimum 8 characters' : undefined}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            minLength={8}
            required
          />
        </Field>
        {error && <div className="error-banner">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Working…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <button
        type="button"
        className="link"
        onClick={() => {
          setError(null)
          setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up')
        }}
      >
        {mode === 'sign-up'
          ? 'Have an account? Sign in'
          : "Don't have an account? Sign up"}
      </button>
    </div>
  )
}
