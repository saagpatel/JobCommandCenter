import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { commands, unwrapResult } from '@/lib/tauri-bindings'
import type { SidecarStatus } from '@/lib/tauri-bindings'

export const sidecarQueryKeys = {
  all: ['sidecar'] as const,
  status: () => ['sidecar', 'status'] as const,
}

export function useSidecarStatus() {
  return useQuery({
    queryKey: sidecarQueryKeys.status(),
    queryFn: async (): Promise<SidecarStatus> => {
      const result = await commands.getSidecarStatus()
      return unwrapResult(result)
    },
    staleTime: 5000,
  })
}

export function useStartSidecar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<SidecarStatus> => {
      const result = await commands.startSidecar()
      return unwrapResult(result)
    },
    onSuccess: data => {
      queryClient.setQueryData(sidecarQueryKeys.status(), data)
      toast.success('Submission engine started')
    },
    onError: (error: unknown) => {
      logger.error('Failed to start sidecar', { error })
      toast.error('Failed to start engine', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

export function useStopSidecar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<SidecarStatus> => {
      const result = await commands.stopSidecar()
      return unwrapResult(result)
    },
    onSuccess: data => {
      queryClient.setQueryData(sidecarQueryKeys.status(), data)
      toast.success('Submission engine stopped')
    },
    onError: (error: unknown) => {
      logger.error('Failed to stop sidecar', { error })
      toast.error('Failed to stop engine', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}
