import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { SIDECAR_URL } from '@/lib/sidecar'

interface GmailStatus {
  authorized: boolean
  email: string | null
}

interface GmailSendResult {
  message_id: string
  thread_id: string
}

interface DraftFollowupResult {
  subject: string
  body: string
}

export const gmailQueryKeys = {
  status: ['gmail', 'status'] as const,
}

async function sidecarFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${SIDECAR_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Request failed: ${res.status}`)
  }
  return res.json()
}

export function useGmailStatus() {
  return useQuery({
    queryKey: gmailQueryKeys.status,
    queryFn: () => sidecarFetch<GmailStatus>('/gmail/status'),
    retry: false,
    refetchOnWindowFocus: false,
  })
}

export function useGmailAuth() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      sidecarFetch<GmailStatus>('/gmail/auth', { method: 'POST' }),
    onSuccess: data => {
      queryClient.setQueryData(gmailQueryKeys.status, data)
      if (data.authorized) {
        toast.success('Gmail connected', {
          description: data.email ?? undefined,
        })
      }
    },
    onError: (error: unknown) => {
      logger.error('Gmail auth failed', { error })
      toast.error('Failed to connect Gmail', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

export function useGmailSend() {
  return useMutation({
    mutationFn: (params: {
      to: string
      subject: string
      body_html: string
      reply_to?: string
    }) =>
      sidecarFetch<GmailSendResult>('/gmail/send', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onError: (error: unknown) => {
      logger.error('Gmail send failed', { error })
      toast.error('Failed to send email', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

export function useGmailDisconnect() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      sidecarFetch<GmailStatus>('/gmail/disconnect', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(gmailQueryKeys.status, {
        authorized: false,
        email: null,
      })
      toast.success('Gmail disconnected')
    },
    onError: (error: unknown) => {
      logger.error('Gmail disconnect failed', { error })
      toast.error('Failed to disconnect Gmail')
    },
  })
}

export function useDraftFollowup() {
  return useMutation({
    mutationFn: (params: {
      company: string
      role: string
      applied_date: string
      notes?: string
    }) =>
      sidecarFetch<DraftFollowupResult>('/ai/draft-followup', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onError: (error: unknown) => {
      logger.error('Draft followup failed', { error })
      toast.error('Failed to generate draft', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}
