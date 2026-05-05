import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createRouter,
  createRoute,
  createRootRouteWithContext,
  Outlet,
  Link,
  redirect,
} from '@tanstack/react-router'
import { useSession, type AppSession } from './lib/auth-client'
import { SignInPage } from './features/auth/SignInPage'
import { SignUpPage } from './features/auth/SignUpPage'
import { UserMenu } from './features/auth/UserMenu'
import { Dashboard } from './features/forecast/Dashboard'
import { AccountsPage } from './features/accounts/AccountsPage'
import { ScheduledPage } from './features/scheduled/ScheduledPage'
import { GoalsPage } from './features/goals/GoalsPage'
import { AccountPage } from './features/account/AccountPage'
import './styles.css'

// ─── Router context ──────────────────────────────────────────────────────
// The session is exposed to every route's beforeLoad via context. App passes
// the latest session into <RouterProvider context={...}>; when it changes,
// beforeLoad re-runs and the appropriate redirects fire.

interface RouterContext {
  session: AppSession
}

// ─── Routes ──────────────────────────────────────────────────────────────

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div className="app">
      <Outlet />
    </div>
  ),
})

// Public routes — redirect away if already signed in.
const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: '/' })
  },
  component: SignInPage,
})

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-up',
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: '/' })
  },
  component: SignUpPage,
})

// Authed layout route — pathless wrapper that gates its children.
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authed',
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href },
      })
    }
  },
  component: AppShell,
})

const indexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: Dashboard,
})
const accountsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/accounts',
  component: AccountsPage,
})
const scheduledRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/scheduled',
  component: ScheduledPage,
})
const goalsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/goals',
  component: GoalsPage,
})
const accountRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/account',
  component: AccountPage,
})

const routeTree = rootRoute.addChildren([
  signInRoute,
  signUpRoute,
  authedRoute.addChildren([
    indexRoute,
    accountsRoute,
    scheduledRoute,
    goalsRoute,
    accountRoute,
  ]),
])

const router = createRouter({
  routeTree,
  context: { session: null },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// ─── Authed shell ────────────────────────────────────────────────────────

function AppShell() {
  return (
    <>
      <header>
        <h1>Forecasting</h1>
        <nav>
          <Link to="/" activeProps={{ className: 'active' }}>Dashboard</Link>
          <Link to="/accounts" activeProps={{ className: 'active' }}>Accounts</Link>
          <Link to="/scheduled" activeProps={{ className: 'active' }}>Scheduled</Link>
          <Link to="/goals" activeProps={{ className: 'active' }}>Goals</Link>
        </nav>
        <div className="header__user">
          <UserMenu />
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}

// ─── App ────────────────────────────────────────────────────────────────

function App() {
  const { data: session, isPending } = useSession()
  if (isPending) {
    return <div className="center">Loading…</div>
  }
  return <RouterProvider router={router} context={{ session: session ?? null }} />
}

// ─── Mount ───────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
