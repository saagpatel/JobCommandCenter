import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  useCredential,
  useStoreCredential,
  useDeleteCredential,
} from '@/services/credentials'
import {
  useGmailStatus,
  useGmailAuth,
  useGmailDisconnect,
} from '@/services/gmail'
import { Key, Mail, Trash2, Loader2 } from 'lucide-react'

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

      <GmailSection />
    </div>
  )
}

function GmailSection() {
  const { data: gmailStatus, isLoading } = useGmailStatus()
  const gmailAuth = useGmailAuth()
  const gmailDisconnect = useGmailDisconnect()

  const isConnected = gmailStatus?.authorized === true

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Mail className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Gmail</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Connect your Gmail account to send follow-up emails. Requires a Google
        OAuth client_secrets.json file.
      </p>

      {isLoading ? (
        <div className="h-10 w-64 animate-pulse rounded bg-muted" />
      ) : isConnected ? (
        <div className="flex items-center gap-3">
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
            Connected
          </Badge>
          {gmailStatus.email && (
            <span className="text-sm text-muted-foreground">
              {gmailStatus.email}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => gmailDisconnect.mutate()}
            disabled={gmailDisconnect.isPending}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge variant="outline">Not Connected</Badge>
            <Button
              variant="outline"
              onClick={() => gmailAuth.mutate()}
              disabled={gmailAuth.isPending}
            >
              {gmailAuth.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect Gmail'
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Place your Google OAuth client_secrets.json at{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">
              ~/.jcc/gmail/client_secrets.json
            </code>{' '}
            before connecting.
          </p>
        </div>
      )}
    </div>
  )
}
