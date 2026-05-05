import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Account,
  AccountInput,
  BalanceSnapshotInput,
} from 'shared'
import { api } from '../../lib/api'

// ─── Account list ───────────────────────────────────────────────────────

const accountsKey = ['accounts'] as const

export function useAccounts() {
  return useQuery({
    queryKey: accountsKey,
    queryFn: () => api<Account[]>('/accounts'),
  })
}

export function useCreateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AccountInput) =>
      api<Account>('/accounts', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  })
}

export function useUpdateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<AccountInput> & { id: string }) =>
      api<Account>(`/accounts/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  })
}

export function useDeleteAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountsKey })
    },
  })
}

// ─── Balance snapshots ──────────────────────────────────────────────────

type SnapshotRow = {
  id: string
  accountId: string
  balanceCents: number
  recordedAt: string
  note: string | null
  createdAt: string
}

const snapshotsKey = (accountId: string) => ['accounts', accountId, 'snapshots'] as const

export function useSnapshots(accountId: string | null) {
  return useQuery({
    queryKey: snapshotsKey(accountId ?? ''),
    queryFn: () => api<SnapshotRow[]>(`/accounts/${accountId}/snapshots`),
    enabled: !!accountId,
  })
}

export function useCreateSnapshot(accountId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<BalanceSnapshotInput, 'accountId'>) =>
      api<SnapshotRow>(`/accounts/${accountId}/snapshots`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: snapshotsKey(accountId) })
      qc.invalidateQueries({ queryKey: accountsKey }) // current_balance may have changed
    },
  })
}
