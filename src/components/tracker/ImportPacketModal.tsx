import { open } from '@tauri-apps/plugin-dialog'
import { FileCheck2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useImportPacket } from '@/services/jobs'

const ATS_OPTIONS = [
  'ashby',
  'greenhouse',
  'gem',
  'workday',
  'linkedin',
  'indeed',
  'generic',
] as const

interface ImportPacketModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportPacketModal({
  open: isOpen,
  onOpenChange,
}: ImportPacketModalProps) {
  const importPacket = useImportPacket()

  const [manifestPath, setManifestPath] = useState('')
  const [applyUrl, setApplyUrl] = useState('')
  const [ats, setAts] = useState<string>('greenhouse')

  const canSubmit =
    manifestPath !== '' && applyUrl.trim() !== '' && !importPacket.isPending

  function reset() {
    setManifestPath('')
    setApplyUrl('')
    setAts('greenhouse')
  }

  async function pickManifest() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Packet manifest', extensions: ['json'] }],
    })
    if (typeof selected === 'string') {
      setManifestPath(selected)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    importPacket.mutate(
      {
        manifest_path: manifestPath,
        apply_url: applyUrl.trim(),
        ats,
        expected_public_key_id: null,
      },
      {
        onSuccess: () => {
          reset()
          onOpenChange(false)
        },
      }
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Verified Packet</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Select the <code>packet.manifest.json</code> from an ApplyKit
            packet. The signature and artifact hashes are verified before the
            job is created — importing never submits anything.
          </p>

          <div className="space-y-2">
            <Label>
              Packet manifest <span className="text-destructive">*</span>
            </Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={pickManifest}>
                <FileCheck2 className="mr-1.5 h-4 w-4" />
                Choose file
              </Button>
              {manifestPath ? (
                <span className="truncate text-sm text-muted-foreground">
                  {manifestPath}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">
                  No manifest selected
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="packet-apply-url">
              Apply URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="packet-apply-url"
              type="url"
              value={applyUrl}
              onChange={e => setApplyUrl(e.target.value)}
              placeholder="https://jobs.example.com/apply/123"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="packet-ats">ATS Platform</Label>
            <Select value={ats} onValueChange={setAts}>
              <SelectTrigger id="packet-ats">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATS_OPTIONS.map(opt => (
                  <SelectItem key={opt} value={opt}>
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {importPacket.isPending ? 'Verifying...' : 'Verify & Import'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
