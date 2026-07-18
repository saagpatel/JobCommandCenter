import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { commands, unwrapResult } from '@/lib/tauri-bindings'
import { analyticsQueryKeys } from '@/services/analytics'
import type {
  Followup,
  FollowupEvent,
  CreateFollowupInput,
  UpdateFollowupInput,
} from '@/lib/bindings'

export const followupQueryKeys = {
  all: ['followups'] as const,
  list: (status?: string) => ['followups', 'list', { status }] as const,
  forJob: (jobId: string) => ['followups', 'forJob', jobId] as const,
  events: (followupId: string) => ['followups', 'events', followupId] as const,
  eventsForJob: (jobId: string) =>
    ['followups', 'eventsForJob', jobId] as const,
}

async function invalidateFollowupViews(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: followupQueryKeys.all }),
    queryClient.invalidateQueries({
      queryKey: analyticsQueryKeys.sidebarCounts,
    }),
  ])
}

export function useFollowups(status?: string) {
  return useQuery({
    queryKey: followupQueryKeys.list(status),
    queryFn: async (): Promise<Followup[]> => {
      const result = await commands.listFollowups(status ?? null)
      return unwrapResult(result)
    },
    staleTime: 30_000,
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
    staleTime: 30_000,
  })
}

export function useFollowupEvents(followupId: string, enabled = true) {
  return useQuery({
    queryKey: followupQueryKeys.events(followupId),
    queryFn: async (): Promise<FollowupEvent[]> => {
      const result = await commands.listFollowupEvents(followupId)
      return unwrapResult(result)
    },
    enabled,
    staleTime: 30_000,
  })
}

export function useFollowupEventsForJob(jobId: string) {
  return useQuery({
    queryKey: followupQueryKeys.eventsForJob(jobId),
    queryFn: async (): Promise<FollowupEvent[]> => {
      const result = await commands.listFollowupEventsForJob(jobId)
      return unwrapResult(result)
    },
    staleTime: 30_000,
  })
}

export function useCreateFollowup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateFollowupInput): Promise<Followup> => {
      const result = await commands.createFollowup(input)
      return unwrapResult(result)
    },
    onSuccess: async () => {
      await invalidateFollowupViews(queryClient)
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
    onSuccess: async () => {
      await invalidateFollowupViews(queryClient)
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
    onSuccess: async () => {
      await invalidateFollowupViews(queryClient)
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
