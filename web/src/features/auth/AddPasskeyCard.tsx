import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authClient } from '../../lib/auth-client'
import { Card } from '../../components/Card'

type PasskeyRow = { id: string; name: string | null; createdAt: string }

const passkeysKey = ['passkeys'] as const

function usePasskeys() {
  return useQuery({
    queryKey: passkeysKey,
    queryFn: async () => {
      const res = await authClient.passkey.listUserPasskeys()
      // Better Auth's response: { data: PasskeyRow[] | null, error: ... }
      if (res.error) throw new Error(res.error.message ?? 'Failed to load passkeys')
      return (res.data ?? []) as PasskeyRow[]
    },
  })
}

export function AddPasskeyCard() {
  const { data: passkeys, isLoading } = usePasskeys()
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [registering, setRegistering] = useState(false)

  const register = async () => {
    setError(null)
    setRegistering(true)
    try {
      const res = await authClient.passkey.addPasskey()
      if (res?.error) throw new Error(res.error.message ?? 'Failed to register passkey')
      await qc.invalidateQueries({ queryKey: passkeysKey })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to register passkey')
    } finally {
      setRegistering(false)
    }
  }

  // While loading or if the user already has a passkey, don't push the prompt.
  if (isLoading) return null
  if (passkeys && passkeys.length > 0) return null

  return (
    <Card title="Sign in faster with a passkey">
      <p style={{ marginTop: 0 }}>
        Use Touch&nbsp;ID, Face&nbsp;ID, or your device's biometric to sign in
        without typing a password. Takes about 5 seconds to set up.
      </p>
      {error && <div className="error-banner" style={{ marginBottom: '0.75rem' }}>{error}</div>}
      <button onClick={register} disabled={registering}>
        {registering ? 'Waiting for device…' : 'Set up a passkey'}
      </button>
    </Card>
  )
}
