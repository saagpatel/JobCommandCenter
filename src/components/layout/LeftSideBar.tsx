import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import {
  Briefcase,
  Send,
  MailCheck,
  BookOpen,
  BarChart3,
  Settings,
} from 'lucide-react'

const navItems = [
  { label: 'Tracker', icon: Briefcase, view: 'tracker' as const },
  { label: 'Submit', icon: Send, view: 'submit' as const },
  { label: 'Follow-ups', icon: MailCheck, view: 'followups' as const },
  { label: 'Interview Prep', icon: BookOpen, view: 'interview' as const },
  { label: 'Analytics', icon: BarChart3, view: 'analytics' as const },
  { label: 'Settings', icon: Settings, view: 'settings' as const },
] as const

interface LeftSideBarProps {
  children?: React.ReactNode
  className?: string
}

export function LeftSideBar({ children, className }: LeftSideBarProps) {
  const activeView = useUIStore(state => state.activeView)
  const setActiveView = useUIStore(state => state.setActiveView)

  return (
    <div
      className={cn('flex h-full flex-col border-r bg-background', className)}
    >
      <div className="flex flex-col gap-1 p-3">
        {navItems.map(({ label, icon: Icon, view }) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              activeView === view
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
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
