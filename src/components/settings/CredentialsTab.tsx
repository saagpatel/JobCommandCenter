import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  useCredential,
  useStoreCredential,
  useDeleteCredential,
} from '@/services/credentials'
import { Key, Mail, Trash2 } from 'lucide-react'

const ANTHROPIC_KEY = 'anthropic_api_key'

function maskApiKey(key: string): string {
  if (key.length <= 12) return '****'
  return `${key.slice(0, 7)}...${key.slice(-4)}`
}

export function CredentialsTab() {
  const { data: anthropicKey, isLoading } = useCredential(ANTHROPIC_KEY)
  const storeCredential = useStoreCredential()
  const deleteCredential = useDeleteCredential()
  const [newKey, setNewKey] = useState('')

  function handleSaveKey() {
    if (!newKey.trim()) return
    storeCredential.mutate(
      { key: ANTHROPIC_KEY, value: newKey.trim() },
      { onSuccess: () => setNewKey('') }
    )
  }

  function handleClearKey() {
    deleteCredential.mutate(ANTHROPIC_KEY)
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Anthropic API Key</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Required for AI-powered features: email drafting, interview prep, and
          smart form field mapping.
        </p>

        {isLoading ? (
          <div className="h-10 w-64 animate-pulse rounded bg-muted" />
        ) : anthropicKey ? (
          <div className="flex items-center gap-3">
            <code className="rounded bg-muted px-3 py-2 text-sm">
              {maskApiKey(anthropicKey)}
            </code>
            <Badge variant="secondary">Stored in Keychain</Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearKey}
              disabled={deleteCredential.isPending}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              type="password"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              placeholder="sk-ant-..."
              className="max-w-sm"
            />
            <Button
              onClick={handleSaveKey}
              disabled={!newKey.trim() || storeCredential.isPending}
            >
              {storeCredential.isPending ? 'Saving...' : 'Save to Keychain'}
            </Button>
          </div>
        )}
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Gmail</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect your Gmail account for automated follow-up emails.
        </p>
        <div className="flex items-center gap-3">
          <Badge variant="outline">Not Connected</Badge>
          <Button
            variant="outline"
            onClick={() => toast.info('Gmail OAuth coming in a future session')}
          >
            Connect Gmail
          </Button>
        </div>
      </div>
    </div>
  )
}
