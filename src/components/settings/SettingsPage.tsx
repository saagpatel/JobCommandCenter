import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProfileTab } from './ProfileTab'
import { CredentialsTab } from './CredentialsTab'
import { PlatformsTab } from './PlatformsTab'

export function SettingsPage() {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b px-8 py-6">
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile, credentials, and platform connections.
        </p>
      </div>

      <div className="flex-1 px-8 py-6">
        <Tabs defaultValue="profile" className="w-full max-w-2xl">
          <TabsList className="mb-6">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="credentials">Credentials</TabsTrigger>
            <TabsTrigger value="platforms">Platforms</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileTab />
          </TabsContent>

          <TabsContent value="credentials">
            <CredentialsTab />
          </TabsContent>

          <TabsContent value="platforms">
            <PlatformsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
