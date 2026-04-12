import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '@/store/ui-store'
import { sidecarQueryKeys } from '@/services/sidecar'
import type { SidecarStatus } from '@/lib/tauri-bindings'

export function useSidecarEvents() {
  const setSidecarStatus = useUIStore(state => state.setSidecarStatus)
  const queryClient = useQueryClient()

  useEffect(() => {
    const unlisten = listen<SidecarStatus>('sidecar-status-changed', event => {
      setSidecarStatus(event.payload.state)
      queryClient.setQueryData(sidecarQueryKeys.status(), event.payload)
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [setSidecarStatus, queryClient])
}
