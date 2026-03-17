import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'

const SIDECAR_URL = 'http://127.0.0.1:9876'

interface InterviewPrepResult {
  company_overview: string
  role_analysis: string
  potential_questions: string
  talking_points: string
  research_links: string
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

export function useGenerateInterviewPrep() {
  return useMutation({
    mutationFn: (params: {
      company: string
      role: string
      jd_url?: string
      notes?: string
    }) =>
      sidecarFetch<InterviewPrepResult>('/ai/interview-prep', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onError: (error: unknown) => {
      logger.error('Interview prep generation failed', { error })
      toast.error('Failed to generate interview prep', {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })
}
