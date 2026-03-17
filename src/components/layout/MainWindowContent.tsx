import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { KanbanBoard } from '@/components/tracker/KanbanBoard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SubmitConsole } from '@/components/submit/SubmitConsole'
import { FollowupManager } from '@/components/followup/FollowupManager'
import { InterviewPrep } from '@/components/interview/InterviewPrep'
import { Analytics } from '@/components/pipeline/Analytics'

interface MainWindowContentProps {
  children?: React.ReactNode
  className?: string
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
        return <InterviewPrep />
      case 'analytics':
        return <Analytics />
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
