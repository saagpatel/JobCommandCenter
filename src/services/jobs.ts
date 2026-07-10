import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type {
  CreateJobInput,
  ImportPacketInput,
  ImportPacketResult,
  Job,
  UpdateJobInput,
} from '@/lib/bindings'
import { logger } from '@/lib/logger'
import { commands, unwrapResult } from '@/lib/tauri-bindings'

export const jobsQueryKeys = {
  all: ['jobs'] as const,
  list: (status?: string) => ['jobs', 'list', { status }] as const,
  detail: (id: string) => ['jobs', 'detail', id] as const,
}

export function useJobs(status?: string) {
  return useQuery({
    queryKey: jobsQueryKeys.list(status),
    queryFn: async (): Promise<Job[]> => {
      const result = await commands.listJobs(status ?? null)
      return unwrapResult(result)
    },
    staleTime: 30_000,
  })
}

export function useJob(id: string | null) {
  return useQuery({
    queryKey: jobsQueryKeys.detail(id ?? ''),
    queryFn: async (): Promise<Job | null> => {
      if (!id) return null
      const result = await commands.getJob(id)
      return unwrapResult(result)
    },
    enabled: !!id,
    staleTime: 30_000,
  })
}

export function useCreateJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateJobInput): Promise<Job> => {
      const result = await commands.createJob(input)
      return unwrapResult(result)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobsQueryKeys.all })
      toast.success('Job added')
    },
    onError: (error: unknown) => {
      logger.error('Failed to create job', { error })
      toast.error('Failed to add job', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

export function useImportPacket() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      input: ImportPacketInput
    ): Promise<ImportPacketResult> => {
      const result = await commands.importPacket(input)
      return unwrapResult(result)
    },
    onSuccess: result => {
      queryClient.invalidateQueries({ queryKey: jobsQueryKeys.all })
      if (result.truth_status === 'verified') {
        toast.success('Verified packet imported', {
          description: `${result.job.company} — ${result.job.role}`,
        })
      } else {
        toast.warning(`Packet imported as ${result.truth_status}`, {
          description:
            result.stale_artifacts.length > 0
              ? `Edited after generation: ${result.stale_artifacts.join(', ')}`
              : 'Signature missing or invalid — re-run ApplyKit to restore.',
        })
      }
    },
    onError: (error: unknown) => {
      logger.error('Failed to import packet', { error })
      toast.error('Failed to import packet', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

export function useUpdateJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string
      input: UpdateJobInput
    }): Promise<Job> => {
      const result = await commands.updateJob(id, input)
      return unwrapResult(result)
    },
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: jobsQueryKeys.all })

      const previousLists = queryClient.getQueriesData<Job[]>({
        queryKey: ['jobs', 'list'],
      })

      // Optimistically update all list queries
      queryClient.setQueriesData<Job[]>({ queryKey: ['jobs', 'list'] }, old => {
        if (!old) return old
        return old.map(job => {
          if (job.id !== id) return job
          const updated = { ...job }
          for (const [key, value] of Object.entries(input)) {
            if (value !== null) {
              ;(updated as Record<string, unknown>)[key] = value
            }
          }
          return updated
        })
      })

      return { previousLists }
    },
    onError: (error, _variables, context) => {
      // Rollback on error
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          queryClient.setQueryData(queryKey, data)
        }
      }
      logger.error('Failed to update job', { error })
      toast.error('Failed to update job', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: jobsQueryKeys.all })
    },
  })
}

export function useDeleteJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      const result = await commands.deleteJob(id)
      return unwrapResult(result)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobsQueryKeys.all })
      toast.success('Job deleted')
    },
    onError: (error: unknown) => {
      logger.error('Failed to delete job', { error })
      toast.error('Failed to delete job', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}
