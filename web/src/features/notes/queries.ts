import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Note, NoteInput } from 'shared'
import { api } from '../../lib/api'

const notesKey = ['notes'] as const

export function useNotes() {
  return useQuery({
    queryKey: notesKey,
    queryFn: () => api<Note[]>('/notes'),
  })
}

export function useCreateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NoteInput) =>
      api<Note>('/notes', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKey }),
  })
}

export function useUpdateNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: NoteInput & { id: string }) =>
      api<Note>(`/notes/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKey }),
  })
}

export function useDeleteNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/notes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: notesKey }),
  })
}
