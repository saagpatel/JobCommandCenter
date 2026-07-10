import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import { SettingsField, SettingsSection } from '../shared/SettingsComponents'

export function AdvancedPane() {
  const { t } = useTranslation()
  // Example local state - these are NOT persisted to disk
  // To add persistent preferences:
  // 1. Add the field to AppPreferences in both Rust and TypeScript
  // 2. Use usePreferencesManager() and updatePreferences()
  const [exampleAdvancedToggle, setExampleAdvancedToggle] = useState(false)
  const [exampleDropdown, setExampleDropdown] = useState('option1')
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()

  function saveApplyKitPublicKeyId(event: React.FocusEvent<HTMLInputElement>) {
    if (!preferences) return

    const value = event.currentTarget.value.trim()
    if (value === (preferences.applykit_public_key_id ?? '')) return

    savePreferences.mutate({
      ...preferences,
      applykit_public_key_id: value || null,
    })
  }

  return (
    <div className="space-y-6">
      <SettingsSection title={t('preferences.advanced.applykit.title')}>
        <SettingsField
          label={t('preferences.advanced.applykit.publicKeyId')}
          description={t(
            'preferences.advanced.applykit.publicKeyIdDescription'
          )}
        >
          <Input
            id="applykit-public-key-id"
            key={preferences?.applykit_public_key_id ?? 'unconfigured'}
            defaultValue={preferences?.applykit_public_key_id ?? ''}
            onBlur={saveApplyKitPublicKeyId}
            placeholder={t(
              'preferences.advanced.applykit.publicKeyIdPlaceholder'
            )}
            disabled={!preferences || savePreferences.isPending}
          />
        </SettingsField>
      </SettingsSection>

      <SettingsSection title={t('preferences.advanced.title')}>
        <SettingsField
          label={t('preferences.advanced.toggle')}
          description={t('preferences.advanced.toggleDescription')}
        >
          <div className="flex items-center space-x-2">
            <Switch
              id="example-advanced-toggle"
              checked={exampleAdvancedToggle}
              onCheckedChange={setExampleAdvancedToggle}
            />
            <Label htmlFor="example-advanced-toggle" className="text-sm">
              {exampleAdvancedToggle
                ? t('common.enabled')
                : t('common.disabled')}
            </Label>
          </div>
        </SettingsField>

        <SettingsField
          label={t('preferences.advanced.dropdown')}
          description={t('preferences.advanced.dropdownDescription')}
        >
          <Select value={exampleDropdown} onValueChange={setExampleDropdown}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="option1">
                {t('preferences.advanced.option1')}
              </SelectItem>
              <SelectItem value="option2">
                {t('preferences.advanced.option2')}
              </SelectItem>
              <SelectItem value="option3">
                {t('preferences.advanced.option3')}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingsField>
      </SettingsSection>
    </div>
  )
}
