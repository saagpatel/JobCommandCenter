import type { FollowupEvent } from '@/lib/bindings'

export function followupHistoryLabel(event: FollowupEvent): string {
  switch (event.reason) {
    case 'legacy_state_imported':
      return `History tracking began with status ${event.to_status.replace('_', ' ')}`
    case 'draft_generated':
      return 'Draft generated'
    case 'draft_saved':
      return 'Draft saved'
    case 'send_attempted':
      return 'Send attempted'
    case 'gmail_accepted':
      return 'Gmail accepted the message'
    case 'operator_verified_sent':
      return 'Marked sent after Gmail verification'
    case 'operator_verified_not_sent':
      return 'Verified not sent; retry allowed'
    case 'operator_skipped':
      return 'Skipped'
    default:
      return event.reason.replaceAll('_', ' ')
  }
}

export function followupHistoryTime(event: FollowupEvent): string {
  return event.occurred_at.replace('T', ' ').replace('Z', ' UTC')
}
