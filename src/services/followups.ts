import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { commands, unwrapResult } from '@/lib/tauri-bindings'
import type {
  Followup,
  CreateFollowupInput,
  UpdateFollowupInput,
} from '@/lib/bindings'

export const followupQueryKeys = {
  all: ['followups'] as const,
  list: (status?: string) => ['followups', 'list', { status }] as const,
  forJob: (jobId: string) => ['followups', 'forJob', jobId] as const,
}

export function useFollowups(status?: string) {
  return useQuery({
    queryKey: followupQueryKeys.list(status),
    queryFn: async (): Promise<Followup[]> => {
      const result = await commands.listFollowups(status ?? null)
      return unwrapResult(result)
    },
  })
}

export function useFollowupsForJob(jobId: string | null) {
  return useQuery({
    queryKey: followupQueryKeys.forJob(jobId ?? ''),
    queryFn: async (): Promise<Followup[]> => {
      if (!jobId) return []
      const result = await commands.listFollowupsForJob(jobId)
      return unwrapResult(result)
    },
    enabled: !!jobId,
  })
}

export function useCreateFollowup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateFollowupInput): Promise<Followup> => {
      const result = await commands.createFollowup(input)
      return unwrapResult(result)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: followupQueryKeys.all })
      toast.success('Follow-up created')
    },
    onError: (error: unknown) => {
      logger.error('Failed to create followup', { error })
      toast.error('Failed to create follow-up', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

export function useUpdateFollowup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string
      input: UpdateFollowupInput
    }): Promise<Followup> => {
      const result = await commands.updateFollowup(id, input)
      return unwrapResult(result)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: followupQueryKeys.all })
    },
    onError: (error: unknown) => {
      logger.error('Failed to update followup', { error })
      toast.error('Failed to update follow-up', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

export function useDeleteFollowup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      const result = await commands.deleteFollowup(id)
      return unwrapResult(result)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: followupQueryKeys.all })
      toast.success('Follow-up deleted')
    },
    onError: (error: unknown) => {
      logger.error('Failed to delete followup', { error })
      toast.error('Failed to delete follow-up', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}
