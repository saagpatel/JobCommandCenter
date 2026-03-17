import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { commands, unwrapResult } from '@/lib/tauri-bindings'
import type { Note, CreateNoteInput, UpdateNoteInput } from '@/lib/bindings'

export const noteQueryKeys = {
  all: ['notes'] as const,
  forJob: (jobId: string) => ['notes', 'forJob', jobId] as const,
  detail: (id: string) => ['notes', 'detail', id] as const,
}

export function useNotesForJob(jobId: string | null) {
  return useQuery({
    queryKey: noteQueryKeys.forJob(jobId ?? ''),
    queryFn: async (): Promise<Note[]> => {
      if (!jobId) return []
      const result = await commands.listNotesForJob(jobId)
      return unwrapResult(result)
    },
    enabled: !!jobId,
    staleTime: 30_000,
  })
}

export function useNote(id: string | null) {
  return useQuery({
    queryKey: noteQueryKeys.detail(id ?? ''),
    queryFn: async (): Promise<Note | null> => {
      if (!id) return null
      const result = await commands.getNote(id)
      return unwrapResult(result)
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useCreateNote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateNoteInput): Promise<Note> => {
      const result = await commands.createNote(input)
      return unwrapResult(result)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: noteQueryKeys.all })
    },
    onError: (error: unknown) => {
      logger.error('Failed to create note', { error })
      toast.error('Failed to create note', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

export function useUpdateNote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string
      input: UpdateNoteInput
    }): Promise<Note> => {
      const result = await commands.updateNote(id, input)
      return unwrapResult(result)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: noteQueryKeys.all })
    },
    onError: (error: unknown) => {
      logger.error('Failed to update note', { error })
      toast.error('Failed to update note', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      const result = await commands.deleteNote(id)
      return unwrapResult(result)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: noteQueryKeys.all })
      toast.success('Note deleted')
    },
    onError: (error: unknown) => {
      logger.error('Failed to delete note', { error })
      toast.error('Failed to delete note', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}
