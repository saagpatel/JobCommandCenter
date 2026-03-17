import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { commands, unwrapResult } from '@/lib/tauri-bindings'

export const credentialQueryKeys = {
  all: ['credentials'] as const,
  key: (key: string) => ['credentials', key] as const,
}

export function useCredential(key: string) {
  return useQuery({
    queryKey: credentialQueryKeys.key(key),
    queryFn: async (): Promise<string | null> => {
      const result = await commands.getCredential(key)
      return unwrapResult(result)
    },
  })
}

export function useStoreCredential() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const result = await commands.storeCredential(key, value)
      return unwrapResult(result)
    },
    onSuccess: (_data, { key }) => {
      queryClient.invalidateQueries({ queryKey: credentialQueryKeys.key(key) })
      toast.success('Credential saved to Keychain')
    },
    onError: (error: unknown) => {
      logger.error('Failed to store credential', { error })
      toast.error('Failed to store credential', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

export function useDeleteCredential() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (key: string) => {
      const result = await commands.deleteCredential(key)
      return unwrapResult(result)
    },
    onSuccess: (_data, key) => {
      queryClient.invalidateQueries({ queryKey: credentialQueryKeys.key(key) })
      toast.success('Credential removed from Keychain')
    },
    onError: (error: unknown) => {
      logger.error('Failed to delete credential', { error })
      toast.error('Failed to delete credential', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}
