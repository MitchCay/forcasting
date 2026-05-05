import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ScheduledItem, ScheduledItemInput } from 'shared'
import { api } from '../../lib/api'

const scheduledKey = ['scheduled'] as const

export function useScheduledItems() {
  return useQuery({
    queryKey: scheduledKey,
    queryFn: () => api<ScheduledItem[]>('/scheduled'),
  })
}

export function useCreateScheduledItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ScheduledItemInput) =>
      api<ScheduledItem>('/scheduled', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: scheduledKey }),
  })
}

export function useUpdateScheduledItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<ScheduledItemInput> & { id: string }) =>
      api<ScheduledItem>(`/scheduled/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: scheduledKey }),
  })
}

export function useDeleteScheduledItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/scheduled/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: scheduledKey }),
  })
}
