import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { KanbanBoard } from '@/components/tracker/KanbanBoard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SubmitConsole } from '@/components/submit/SubmitConsole'
import { FollowupManager } from '@/components/followup/FollowupManager'

interface MainWindowContentProps {
  children?: React.ReactNode
  className?: string
}

function ViewPlaceholder({ name }: { name: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold tracking-tight text-foreground">
        {name}
      </h1>
      <p className="text-muted-foreground">Coming soon.</p>
    </div>
  )
}

export function MainWindowContent({
  children,
  className,
}: MainWindowContentProps) {
  const activeView = useUIStore(state => state.activeView)

  function renderView() {
    if (children) return children
    switch (activeView) {
      case 'tracker':
        return <KanbanBoard />
      case 'submit':
        return <SubmitConsole />
      case 'followups':
        return <FollowupManager />
      case 'interview':
        return <ViewPlaceholder name="Interview Prep" />
      case 'analytics':
        return <ViewPlaceholder name="Analytics" />
      case 'settings':
        return <SettingsPage />
    }
  }

  return (
    <div className={cn('flex h-full flex-col bg-background', className)}>
      {renderView()}
    </div>
  )
}
