import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

import { toast } from 'sonner'
import { Globe } from 'lucide-react'

interface PlatformCardProps {
  name: string
  description: string
}

function PlatformCard({ name, description }: PlatformCardProps) {
  return (
    <div className="space-y-3 rounded-lg border p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">{name}</h3>
        </div>
        <Badge variant="outline">Not Connected</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
      <Button
        variant="outline"
        onClick={() => toast.info(`${name} login coming in a future session`)}
      >
        Login
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
        description="Easy Apply automation via persistent browser session. Login once and your session is reused for all submissions."
      />

      <PlatformCard
        name="Indeed"
        description="Indeed Apply automation via persistent browser session. Supports resume upload and standard application fields."
      />
    </div>
  )
}
