import { cn } from '@/lib/utils'

interface MainWindowContentProps {
  children?: React.ReactNode
  className?: string
}

export function MainWindowContent({
  children,
  className,
}: MainWindowContentProps) {
  return (
    <div className={cn('flex h-full flex-col bg-background', className)}>
      {children || (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Job Command Center
          </h1>
          <p className="text-muted-foreground">
            Select a view from the sidebar to get started.
          </p>
        </div>
      )}
    </div>
  )
}
