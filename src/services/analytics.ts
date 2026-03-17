import { useQuery } from '@tanstack/react-query'
import { commands, unwrapResult } from '@/lib/tauri-bindings'
import type {
  WeeklyApplications,
  PipelineFunnel,
  AdapterCount,
  TierComparison,
  SidebarCounts,
} from '@/lib/bindings'

export const analyticsQueryKeys = {
  all: ['analytics'] as const,
  applicationsByWeek: ['analytics', 'applicationsByWeek'] as const,
  pipelineFunnel: ['analytics', 'pipelineFunnel'] as const,
  responseRate: ['analytics', 'responseRate'] as const,
  avgDaysToResponse: ['analytics', 'avgDaysToResponse'] as const,
  submissionsByAdapter: ['analytics', 'submissionsByAdapter'] as const,
  tierComparison: ['analytics', 'tierComparison'] as const,
  sidebarCounts: ['analytics', 'sidebarCounts'] as const,
}

const ANALYTICS_STALE_TIME = 30_000

export function useApplicationsByWeek() {
  return useQuery({
    queryKey: analyticsQueryKeys.applicationsByWeek,
    queryFn: async (): Promise<WeeklyApplications[]> => {
      const result = await commands.getApplicationsByWeek()
      return unwrapResult(result)
    },
    staleTime: ANALYTICS_STALE_TIME,
  })
}

export function usePipelineFunnel() {
  return useQuery({
    queryKey: analyticsQueryKeys.pipelineFunnel,
    queryFn: async (): Promise<PipelineFunnel> => {
      const result = await commands.getPipelineFunnel()
      return unwrapResult(result)
    },
    staleTime: ANALYTICS_STALE_TIME,
  })
}

export function useResponseRate() {
  return useQuery({
    queryKey: analyticsQueryKeys.responseRate,
    queryFn: async (): Promise<number> => {
      const result = await commands.getResponseRate()
      return unwrapResult(result)
    },
    staleTime: ANALYTICS_STALE_TIME,
  })
}

export function useAvgDaysToResponse() {
  return useQuery({
    queryKey: analyticsQueryKeys.avgDaysToResponse,
    queryFn: async (): Promise<number> => {
      const result = await commands.getAvgDaysToResponse()
      return unwrapResult(result)
    },
    staleTime: ANALYTICS_STALE_TIME,
  })
}

export function useSubmissionsByAdapter() {
  return useQuery({
    queryKey: analyticsQueryKeys.submissionsByAdapter,
    queryFn: async (): Promise<AdapterCount[]> => {
      const result = await commands.getSubmissionsByAdapter()
      return unwrapResult(result)
    },
    staleTime: ANALYTICS_STALE_TIME,
  })
}

export function useTierComparison() {
  return useQuery({
    queryKey: analyticsQueryKeys.tierComparison,
    queryFn: async (): Promise<TierComparison> => {
      const result = await commands.getTierComparison()
      return unwrapResult(result)
    },
    staleTime: ANALYTICS_STALE_TIME,
  })
}

export function useSidebarCounts() {
  return useQuery({
    queryKey: analyticsQueryKeys.sidebarCounts,
    queryFn: async (): Promise<SidebarCounts> => {
      const result = await commands.getSidebarCounts()
      return unwrapResult(result)
    },
    staleTime: ANALYTICS_STALE_TIME,
    refetchInterval: 30_000,
  })
}
