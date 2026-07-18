import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { SubmissionReceipt } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { commands, unwrapResult } from '@/lib/tauri-bindings'

const LEGACY_UNKNOWN_JOB_IDS_KEY = 'jcc-unknown-submission-job-ids'

export const submissionQueryKeys = {
  all: ['submission-receipts'] as const,
  unresolved: ['submission-receipts', 'unresolved'] as const,
  forJob: (jobId: string) => ['submission-receipts', 'forJob', jobId] as const,
}

export type SubmissionRecoveryStatus = 'manual_required' | 'unknown_outcome'

function readLegacyUnknownJobIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(LEGACY_UNKNOWN_JOB_IDS_KEY) ?? '[]'
    )
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function clearLegacyUnknownJobId(jobId: string) {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(LEGACY_UNKNOWN_JOB_IDS_KEY) ?? '[]'
    )
    const remaining = Array.isArray(parsed)
      ? parsed.filter(item => typeof item === 'string' && item !== jobId)
      : []
    window.localStorage.setItem(
      LEGACY_UNKNOWN_JOB_IDS_KEY,
      JSON.stringify(remaining)
    )
  } catch {
    window.localStorage.setItem(LEGACY_UNKNOWN_JOB_IDS_KEY, '[]')
  }
}

export function useSubmissionReceiptsForJob(jobId: string | null) {
  return useQuery({
    queryKey: submissionQueryKeys.forJob(jobId ?? ''),
    queryFn: async (): Promise<SubmissionReceipt[]> => {
      if (!jobId) return []
      return unwrapResult(await commands.listSubmissionReceiptsForJob(jobId))
    },
    enabled: !!jobId,
    staleTime: 30_000,
  })
}

export function useSubmissionRecoveryByJob() {
  return useQuery({
    queryKey: submissionQueryKeys.unresolved,
    queryFn: async (): Promise<
      Partial<Record<string, SubmissionRecoveryStatus>>
    > => {
      const receipts = unwrapResult(
        await commands.listUnresolvedSubmissionReceipts()
      )
      const recoveryByJob: Partial<Record<string, SubmissionRecoveryStatus>> =
        {}
      for (const receipt of receipts) {
        if (
          receipt.status === 'manual_required' ||
          receipt.status === 'unknown_outcome'
        ) {
          recoveryByJob[receipt.job_id] = receipt.status
        }
      }
      for (const jobId of readLegacyUnknownJobIds()) {
        recoveryByJob[jobId] ??= 'unknown_outcome'
      }
      return recoveryByJob
    },
    staleTime: 30_000,
  })
}

export function useResolveSubmissionReceipts() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (jobId: string): Promise<boolean> => {
      const resolved = unwrapResult(
        await commands.resolveSubmissionReceipts(jobId)
      )
      clearLegacyUnknownJobId(jobId)
      return resolved
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: submissionQueryKeys.all })
      toast.success('Submission recovery resolved')
    },
    onError: (error: unknown) => {
      logger.error('Failed to resolve submission recovery', { error })
      toast.error('Could not resolve submission recovery', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}
