import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Goal, GoalInput, GoalPatch } from 'shared'
import { api } from '../../lib/api'

const goalsKey = ['goals'] as const

export function useGoals() {
  return useQuery({
    queryKey: goalsKey,
    queryFn: () => api<Goal[]>('/goals'),
  })
}

export function useCreateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: GoalInput) =>
      api<Goal>('/goals', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: goalsKey }),
  })
}

export function useUpdateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: GoalPatch & { id: string }) =>
      api<Goal>(`/goals/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: goalsKey }),
  })
}

export function useDeleteGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/goals/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: goalsKey }),
  })
}
