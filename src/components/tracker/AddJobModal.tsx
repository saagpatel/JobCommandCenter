import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useCreateJob } from '@/services/jobs'

const ATS_OPTIONS = [
  'ashby',
  'greenhouse',
  'gem',
  'workday',
  'linkedin',
  'indeed',
  'lever',
  'other',
] as const

interface AddJobModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddJobModal({ open, onOpenChange }: AddJobModalProps) {
  const createJob = useCreateJob()

  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [ats, setAts] = useState<string>('other')
  const [applyUrl, setApplyUrl] = useState('')
  const [tier, setTier] = useState('tier1')
  const [source, setSource] = useState('Company careers page')
  const [location, setLocation] = useState('')
  const [salaryRange, setSalaryRange] = useState('')
  const [jdUrl, setJdUrl] = useState('')
  const [notes, setNotes] = useState('')

  const canSubmit =
    company.trim() !== '' &&
    role.trim() !== '' &&
    applyUrl.trim() !== '' &&
    !createJob.isPending

  function reset() {
    setCompany('')
    setRole('')
    setAts('other')
    setApplyUrl('')
    setTier('tier1')
    setSource('Company careers page')
    setLocation('')
    setSalaryRange('')
    setJdUrl('')
    setNotes('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    createJob.mutate(
      {
        company: company.trim(),
        role: role.trim(),
        ats,
        apply_url: applyUrl.trim(),
        status: null,
        tier,
        job_posting_id: null,
        board_token: null,
        source: source.trim() || null,
        resume_path: null,
        cover_letter_path: null,
        custom_fields: null,
        notes: notes.trim() || null,
        salary_range: salaryRange.trim() || null,
        location: location.trim() || null,
        jd_url: jdUrl.trim() || null,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Job</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="company">
                Company <span className="text-destructive">*</span>
              </Label>
              <Input
                id="company"
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="Acme Corp"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">
                Role <span className="text-destructive">*</span>
              </Label>
              <Input
                id="role"
                value={role}
                onChange={e => setRole(e.target.value)}
                placeholder="Senior Engineer"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ats">ATS Platform</Label>
              <Select value={ats} onValueChange={setAts}>
                <SelectTrigger id="ats">
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

            <div className="space-y-2">
              <Label htmlFor="tier">Tier</Label>
              <RadioGroup
                value={tier}
                onValueChange={setTier}
                className="flex gap-4 pt-2"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="tier1" id="tier1" />
                  <Label htmlFor="tier1" className="font-normal">
                    Tier 1
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="tier2" id="tier2" />
                  <Label htmlFor="tier2" className="font-normal">
                    Tier 2
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="applyUrl">
              Apply URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="applyUrl"
              type="url"
              value={applyUrl}
              onChange={e => setApplyUrl(e.target.value)}
              placeholder="https://jobs.example.com/apply/123"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="source">Source</Label>
              <Input
                id="source"
                value={source}
                onChange={e => setSource(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="San Francisco, CA"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="salaryRange">Salary Range</Label>
              <Input
                id="salaryRange"
                value={salaryRange}
                onChange={e => setSalaryRange(e.target.value)}
                placeholder="$150k - $200k"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="jdUrl">JD URL</Label>
              <Input
                id="jdUrl"
                type="url"
                value={jdUrl}
                onChange={e => setJdUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any notes about this role..."
              rows={3}
            />
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
              {createJob.isPending ? 'Adding...' : 'Add Job'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
