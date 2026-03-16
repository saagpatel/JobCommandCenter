import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { commands, unwrapResult } from '@/lib/tauri-bindings'
import type { Profile, UpsertProfileInput } from '@/lib/bindings'

export const profileQueryKeys = {
  all: ['profile'] as const,
  profile: () => ['profile', 'singleton'] as const,
}

export function useProfile() {
  return useQuery({
    queryKey: profileQueryKeys.profile(),
    queryFn: async (): Promise<Profile | null> => {
      const result = await commands.getProfile()
      return unwrapResult(result)
    },
  })
}

export function useUpsertProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpsertProfileInput): Promise<Profile> => {
      const result = await commands.upsertProfile(input)
      return unwrapResult(result)
    },
    onSuccess: profile => {
      queryClient.setQueryData(profileQueryKeys.profile(), profile)
      toast.success('Profile saved')
    },
    onError: (error: unknown) => {
      logger.error('Failed to save profile', { error })
      toast.error('Failed to save profile', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}
