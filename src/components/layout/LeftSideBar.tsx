import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { SidecarStatusIndicator } from './SidecarStatusIndicator'
import { useSidebarCounts } from '@/services/analytics'
import {
  Briefcase,
  Send,
  MailCheck,
  BookOpen,
  BarChart3,
  Settings,
} from 'lucide-react'

const navItems = [
  {
    label: 'Tracker',
    icon: Briefcase,
    view: 'tracker' as const,
    badgeKey: null,
  },
  { label: 'Submit', icon: Send, view: 'submit' as const, badgeKey: null },
  {
    label: 'Follow-ups',
    icon: MailCheck,
    view: 'followups' as const,
    badgeKey: 'followups_due' as const,
  },
  {
    label: 'Interview Prep',
    icon: BookOpen,
    view: 'interview' as const,
    badgeKey: 'prep_needed' as const,
  },
  {
    label: 'Analytics',
    icon: BarChart3,
    view: 'analytics' as const,
    badgeKey: null,
  },
  {
    label: 'Settings',
    icon: Settings,
    view: 'settings' as const,
    badgeKey: null,
  },
] as const

interface LeftSideBarProps {
  children?: React.ReactNode
  className?: string
}

export function LeftSideBar({ children, className }: LeftSideBarProps) {
  const activeView = useUIStore(state => state.activeView)
  const setActiveView = useUIStore(state => state.setActiveView)
  const { data: sidebarCounts } = useSidebarCounts()

  return (
    <div
      className={cn('flex h-full flex-col border-r bg-background', className)}
    >
      <div className="flex flex-col gap-1 p-3">
        {navItems.map(({ label, icon: Icon, view, badgeKey }) => {
          const badgeCount =
            badgeKey && sidebarCounts ? sidebarCounts[badgeKey] : 0
          return (
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
              <span className="flex-1 text-left">{label}</span>
              {badgeCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                  {badgeCount}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {children}
      <div className="mt-auto border-t p-2">
        <SidecarStatusIndicator />
      </div>
    </div>
  )
}
