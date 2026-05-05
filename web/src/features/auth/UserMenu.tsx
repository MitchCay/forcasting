import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { authClient, useSession } from '../../lib/auth-client'

// Compute initials for the avatar fallback. Prefers name, falls back to the
// local-part of the email. Always returns at most two letters.
function initialsFor(input: string): string {
  const parts = input.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function UserMenu() {
  const { data: session } = useSession()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Close on outside click and on Escape — standard menu behaviors.
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  if (!session?.user) return null
  const { user } = session
  const display = user.name?.trim() || user.email
  const initials = initialsFor(user.name?.trim() || user.email)

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await authClient.signOut()
    } finally {
      // Drop cached app data so it's not visible on the sign-in page.
      qc.clear()
      // Hard navigation. Going through the router races with Better Auth's
      // session atom — the route guards run against the still-cached session
      // and bounce us back. Reloading at /sign-in guarantees a fresh
      // (signed-out) state.
      window.location.replace('/sign-in')
    }
  }

  return (
    <div className="user-menu" ref={wrapperRef}>
      <button
        type="button"
        ref={buttonRef}
        className="user-menu__avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${display}`}
        title={display}
        onClick={() => setOpen((v) => !v)}
      >
        {user.image ? (
          <img src={user.image} alt="" />
        ) : (
          <span aria-hidden="true">{initials}</span>
        )}
      </button>

      {open && (
        <div className="user-menu__dropdown" role="menu">
          <div className="user-menu__identity">
            <div className="user-menu__name">{user.name || '—'}</div>
            <div className="user-menu__email">{user.email}</div>
          </div>
          <div className="user-menu__divider" />
          <Link
            to="/account"
            role="menuitem"
            className="user-menu__item"
            onClick={() => setOpen(false)}
          >
            Account settings
          </Link>
          <button
            type="button"
            role="menuitem"
            className="user-menu__item user-menu__item--danger"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  )
}
