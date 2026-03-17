import { Loader2, BarChart3 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  useApplicationsByWeek,
  usePipelineFunnel,
  useResponseRate,
  useAvgDaysToResponse,
  useSubmissionsByAdapter,
  useTierComparison,
} from '@/services/analytics'

const PIE_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
]

function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string
  value: string
  subtitle: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  )
}

function TierStatGroup({
  label,
  stats,
}: {
  label: string
  stats: {
    applied: number
    responded: number
    interviewing: number
    response_rate: number
  }
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{label}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-2xl font-bold">{stats.applied}</p>
          <p className="text-xs text-muted-foreground">Applied</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-2xl font-bold">{stats.responded}</p>
          <p className="text-xs text-muted-foreground">Responded</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-2xl font-bold">{stats.interviewing}</p>
          <p className="text-xs text-muted-foreground">Interviewing</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-2xl font-bold">
            {(stats.response_rate * 100).toFixed(0)}%
          </p>
          <p className="text-xs text-muted-foreground">Response Rate</p>
        </div>
      </div>
    </div>
  )
}

export function Analytics() {
  const { data: weeklyData, isLoading: weeklyLoading } = useApplicationsByWeek()
  const { data: funnel, isLoading: funnelLoading } = usePipelineFunnel()
  const { data: responseRate, isLoading: rrLoading } = useResponseRate()
  const { data: avgDays, isLoading: avgLoading } = useAvgDaysToResponse()
  const { data: adapterData, isLoading: adapterLoading } =
    useSubmissionsByAdapter()
  const { data: tierData, isLoading: tierLoading } = useTierComparison()

  const isLoading =
    weeklyLoading ||
    funnelLoading ||
    rrLoading ||
    avgLoading ||
    adapterLoading ||
    tierLoading

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const funnelData = funnel
    ? [
        { stage: 'Saved', count: funnel.saved },
        { stage: 'Applied', count: funnel.applied },
        { stage: 'Interviewing', count: funnel.interviewing },
        { stage: 'Offer', count: funnel.offer },
      ]
    : []

  const totalApplied = funnel
    ? funnel.applied + funnel.interviewing + funnel.offer + funnel.rejected
    : 0

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-bold tracking-tight">Analytics</h1>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        {/* Row 1: Stat cards */}
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            title="Response Rate"
            value={`${((responseRate ?? 0) * 100).toFixed(0)}%`}
            subtitle={`of ${totalApplied} applications`}
          />
          <StatCard
            title="Avg Days to Response"
            value={`${(avgDays ?? 0).toFixed(1)}`}
            subtitle="days"
          />
        </div>

        {/* Row 2: Applications by Week */}
        {weeklyData && weeklyData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Applications by Week</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={weeklyData}>
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} />
                  <Tooltip />
                  <Bar
                    dataKey="tier1_count"
                    name="Tier 1"
                    fill="hsl(var(--chart-1))"
                    stackId="a"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="tier2_count"
                    name="Tier 2"
                    fill="hsl(var(--chart-3))"
                    stackId="a"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Row 3: Funnel + Pie */}
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Pipeline Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              {funnelData.length > 0 ? (
                <div className="space-y-3">
                  {funnelData.map(item => {
                    const maxCount = Math.max(
                      ...funnelData.map(d => d.count),
                      1
                    )
                    const pct = (item.count / maxCount) * 100
                    return (
                      <div key={item.stage} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span>{item.stage}</span>
                          <span className="font-medium">{item.count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No data yet</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Submissions by ATS</CardTitle>
            </CardHeader>
            <CardContent>
              {adapterData && adapterData.length > 0 ? (
                <div className="space-y-3">
                  {adapterData.map((item, i) => {
                    const maxCount = Math.max(
                      ...adapterData.map(d => d.count),
                      1
                    )
                    const pct = (item.count / maxCount) * 100
                    return (
                      <div key={item.adapter} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span>{item.adapter}</span>
                          <span className="font-medium">{item.count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor:
                                PIE_COLORS[i % PIE_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No submissions yet
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Row 4: Tier Comparison */}
        {tierData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Tier Comparison (T1 vs T2)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-8">
                <TierStatGroup label="Tier 1" stats={tierData.tier1} />
                <TierStatGroup label="Tier 2" stats={tierData.tier2} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
