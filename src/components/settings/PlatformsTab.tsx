import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import { toast } from 'sonner'
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { SIDECAR_URL } from '@/lib/sidecar'

type SessionState = 'not_connected' | 'verification_required' | 'authenticated'
type ConnectionStatus = SessionState | 'error'
interface PlatformSession {
  platform: string
  status: SessionState
  message: string
}
type BrowserReadiness =
  | { status: 'checking'; source: null; message: string }
  | {
      status: 'ready' | 'unavailable' | 'error'
      source: 'playwright' | 'system_chrome' | null
      message: string
    }

interface PlatformCardProps {
  name: string
  platform: string
  description: string
  browserReady: boolean
}

function PlatformCard({
  name,
  platform,
  description,
  browserReady,
}: PlatformCardProps) {
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus>('not_connected')

  useEffect(() => {
    fetch(`${SIDECAR_URL}/playwright/sessions`)
      .then(r => r.json())
      .then((sessions: PlatformSession[]) => {
        const session = sessions.find(item => item.platform === platform)
        if (session) setStatus(session.status)
      })
      .catch(() => {
        /* sidecar not running */
      })
  }, [platform])

  const handleLogin = useCallback(async () => {
    setIsLoggingIn(true)
    try {
      const res = await fetch(
        `${SIDECAR_URL}/playwright/sessions/${platform}/login`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (data.status === 'logged_in') {
        setStatus('authenticated')
        toast.success(`${name} login successful`)
      } else {
        setStatus('error')
        toast.error(data.message ?? 'Login failed')
      }
    } catch {
      toast.error('Sidecar not running')
    } finally {
      setIsLoggingIn(false)
    }
  }, [name, platform])

  return (
    <div className="space-y-3 rounded-lg border p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">{name}</h3>
        </div>
        {status === 'authenticated' ? (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
            Connected
          </Badge>
        ) : status === 'verification_required' ? (
          <Badge variant="secondary">Verification required</Badge>
        ) : status === 'error' ? (
          <Badge variant="destructive">Error</Badge>
        ) : (
          <Badge variant="outline">Not Connected</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
      <Button
        variant="outline"
        onClick={handleLogin}
        disabled={isLoggingIn || status === 'authenticated' || !browserReady}
      >
        {isLoggingIn ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Logging in...
          </>
        ) : status === 'authenticated' ? (
          'Connected'
        ) : status === 'verification_required' ? (
          'Verify session'
        ) : (
          'Login'
        )}
      </Button>
    </div>
  )
}

export function PlatformsTab() {
  const [readiness, setReadiness] = useState<BrowserReadiness>({
    status: 'checking',
    source: null,
    message: 'Checking for a supported browser…',
  })

  const checkReadiness = useCallback(async () => {
    setReadiness({
      status: 'checking',
      source: null,
      message: 'Checking for a supported browser…',
    })
    try {
      const response = await fetch(`${SIDECAR_URL}/playwright/readiness`)
      if (response.ok === false) {
        throw new Error(`Browser readiness check failed (${response.status})`)
      }
      const data = (await response.json()) as BrowserReadiness
      if (
        data.status !== 'ready' &&
        data.status !== 'unavailable' &&
        data.status !== 'error'
      ) {
        throw new Error('Browser readiness response was invalid')
      }
      setReadiness(data)
    } catch {
      setReadiness({
        status: 'error',
        source: null,
        message:
          'Browser readiness could not be checked. Restart the submission engine, then check again.',
      })
    }
  }, [])

  useEffect(() => {
    void checkReadiness()
  }, [checkReadiness])

  const browserReady = readiness.status === 'ready'

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Browser profiles persist across app restarts. For accurate submission
        status, each saved platform session must be verified once per app run.
      </p>

      <Alert variant={browserReady ? 'default' : 'destructive'}>
        {readiness.status === 'checking' ? (
          <Loader2 className="animate-spin" />
        ) : browserReady ? (
          <CheckCircle2 />
        ) : (
          <AlertCircle />
        )}
        <AlertTitle>
          {readiness.status === 'checking'
            ? 'Checking browser'
            : browserReady
              ? 'Browser ready'
              : 'Browser unavailable'}
        </AlertTitle>
        <AlertDescription>
          <p>{readiness.message}</p>
          {!browserReady && readiness.status !== 'checking' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void checkReadiness()}
            >
              <RefreshCw />
              Check again
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>

      <PlatformCard
        name="LinkedIn"
        platform="linkedin"
        description="Easy Apply automation via a persistent browser profile. JCC verifies the saved session before enabling submissions."
        browserReady={browserReady}
      />

      <PlatformCard
        name="Indeed"
        platform="indeed"
        description="Indeed Apply automation via a persistent browser profile. JCC verifies visible account state before enabling submissions."
        browserReady={browserReady}
      />
    </div>
  )
}
