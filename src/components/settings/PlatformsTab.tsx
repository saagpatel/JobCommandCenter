import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

import { toast } from 'sonner'
import { Globe, Loader2 } from 'lucide-react'
import { SIDECAR_URL } from '@/lib/sidecar'

type ConnectionStatus = 'none' | 'active' | 'error'

interface PlatformCardProps {
  name: string
  platform: string
  description: string
}

function PlatformCard({ name, platform, description }: PlatformCardProps) {
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus>('none')

  useEffect(() => {
    fetch(`${SIDECAR_URL}/playwright/sessions`)
      .then(r => r.json())
      .then((sessions: { platform: string; has_session: boolean }[]) => {
        const s = sessions.find(s => s.platform === platform)
        if (s?.has_session) setStatus('active')
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
        setStatus('active')
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
        {status === 'active' ? (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
            Connected
          </Badge>
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
        disabled={isLoggingIn || status === 'active'}
      >
        {isLoggingIn ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Logging in...
          </>
        ) : status === 'active' ? (
          'Connected'
        ) : (
          'Login'
        )}
      </Button>
    </div>
  )
}

export function PlatformsTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Platform sessions persist via Playwright browser profiles. Once logged
        in, your session stays active across app restarts.
      </p>

      <PlatformCard
        name="LinkedIn"
        platform="linkedin"
        description="Easy Apply automation via persistent browser session. Login once and your session is reused for all submissions."
      />

      <PlatformCard
        name="Indeed"
        platform="indeed"
        description="Indeed Apply automation via persistent browser session. Supports resume upload and standard application fields."
      />
    </div>
  )
}
