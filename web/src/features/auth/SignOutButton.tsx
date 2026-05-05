import { signOut } from '../../lib/auth-client'

export function SignOutButton() {
  return (
    <button
      type="button"
      className="secondary"
      onClick={() => signOut()}
    >
      Sign out
    </button>
  )
}
