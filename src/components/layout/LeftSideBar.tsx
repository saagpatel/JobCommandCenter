import { cn } from '@/lib/utils'
import {
  Briefcase,
  Send,
  MailCheck,
  BookOpen,
  BarChart3,
  Settings,
} from 'lucide-react'

const navItems = [
  { label: 'Tracker', icon: Briefcase },
  { label: 'Submit', icon: Send },
  { label: 'Follow-ups', icon: MailCheck },
  { label: 'Interview Prep', icon: BookOpen },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Settings', icon: Settings },
] as const

interface LeftSideBarProps {
  children?: React.ReactNode
  className?: string
}

export function LeftSideBar({ children, className }: LeftSideBarProps) {
  return (
    <div
      className={cn('flex h-full flex-col border-r bg-background', className)}
    >
      <div className="flex flex-col gap-1 p-3">
        {navItems.map(({ label, icon: Icon }) => (
          <button
            key={label}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}
