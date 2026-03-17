import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { useProfile, useUpsertProfile } from '@/services/profile'
import { open } from '@tauri-apps/plugin-dialog'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { FolderOpen, Eye } from 'lucide-react'
import type { UpsertProfileInput } from '@/lib/bindings'

export function ProfileTab() {
  const { data: profile, isLoading } = useProfile()
  const upsertProfile = useUpsertProfile()

  const [form, setForm] = useState<UpsertProfileInput>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    linkedin_url: '',
    location: null,
    authorized_to_work: true,
    requires_sponsorship: false,
    preferred_name: null,
    base_resume_path: null,
    follow_up_days: null,
  })

  useEffect(() => {
    if (profile) {
      setForm({
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        phone: profile.phone,
        linkedin_url: profile.linkedin_url,
        location: profile.location,
        authorized_to_work: profile.authorized_to_work,
        requires_sponsorship: profile.requires_sponsorship,
        preferred_name: profile.preferred_name,
        base_resume_path: profile.base_resume_path,
        follow_up_days: profile.follow_up_days,
      })
    }
  }, [profile])

  function updateField<K extends keyof UpsertProfileInput>(
    key: K,
    value: UpsertProfileInput[K]
  ) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    upsertProfile.mutate(form)
  }

  async function handleBrowseResume() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (selected) {
      updateField('base_resume_path', selected)
    }
  }

  async function handleRevealResume() {
    if (!form.base_resume_path) return
    const result = await commands.revealInFinder(form.base_resume_path)
    if (result.status === 'error') {
      logger.error('Failed to reveal resume in Finder', { error: result.error })
      toast.error('Could not open Finder', { description: result.error })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="first_name">First Name</Label>
          <Input
            id="first_name"
            value={form.first_name}
            onChange={e => updateField('first_name', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="last_name">Last Name</Label>
          <Input
            id="last_name"
            value={form.last_name}
            onChange={e => updateField('last_name', e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="preferred_name">Preferred Name</Label>
        <Input
          id="preferred_name"
          value={form.preferred_name ?? ''}
          onChange={e => updateField('preferred_name', e.target.value || null)}
          placeholder="Optional"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={e => updateField('email', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            type="tel"
            value={form.phone}
            onChange={e => updateField('phone', e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="linkedin_url">LinkedIn URL</Label>
        <Input
          id="linkedin_url"
          value={form.linkedin_url}
          onChange={e => updateField('linkedin_url', e.target.value)}
          placeholder="https://linkedin.com/in/..."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          value={form.location ?? ''}
          onChange={e => updateField('location', e.target.value || null)}
          placeholder="San Francisco, CA"
        />
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <Checkbox
            id="authorized_to_work"
            checked={form.authorized_to_work ?? true}
            onCheckedChange={checked =>
              updateField('authorized_to_work', checked === true)
            }
          />
          <Label htmlFor="authorized_to_work" className="cursor-pointer">
            Authorized to work in US
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="requires_sponsorship"
            checked={form.requires_sponsorship ?? false}
            onCheckedChange={checked =>
              updateField('requires_sponsorship', checked === true)
            }
          />
          <Label htmlFor="requires_sponsorship" className="cursor-pointer">
            Requires sponsorship
          </Label>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="follow_up_days">Follow-up Interval (days)</Label>
        <Input
          id="follow_up_days"
          type="number"
          min={1}
          max={90}
          value={form.follow_up_days ?? 7}
          onChange={e => {
            const val = parseInt(e.target.value, 10)
            updateField('follow_up_days', Number.isNaN(val) ? 7 : val)
          }}
        />
        <p className="text-xs text-muted-foreground">
          Days after applying before a follow-up is auto-created
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="base_resume_path">Base Resume</Label>
        <div className="flex items-center gap-2">
          <Input
            id="base_resume_path"
            value={form.base_resume_path ?? ''}
            onChange={e =>
              updateField('base_resume_path', e.target.value || null)
            }
            placeholder="/path/to/resume.pdf"
            className="flex-1"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={handleBrowseResume}
            title="Browse for file"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
          {form.base_resume_path && (
            <Button
              variant="outline"
              size="icon"
              onClick={handleRevealResume}
              title="Reveal in Finder"
            >
              <Eye className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <Button
        onClick={handleSave}
        disabled={upsertProfile.isPending}
        className="w-full sm:w-auto"
      >
        {upsertProfile.isPending ? 'Saving...' : 'Save Profile'}
      </Button>
    </div>
  )
}
