'use client'
import { useState } from 'react'
import useSWR from 'swr'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, FunnelChart, Funnel, LabelList, Cell,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fmtCurrency } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const FUNNEL_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe', '#f5f3ff']

export default function AnalyticsPage() {
  const [days, setDays] = useState(30)
  const { data, isLoading } = useSWR(`/api/analytics?days=${days}`, fetcher)

  if (isLoading) return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}><CardContent className="h-48 animate-pulse bg-slate-100 rounded-lg m-4" /></Card>
      ))}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Analytics</h1>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${days === d ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Conversion Funnel */}
      <Card>
        <CardHeader><CardTitle>Conversion Funnel</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end gap-2 h-48">
            {(data?.funnel || []).map((f: { stage: string; count: number }, i: number) => {
              const max = data?.funnel?.[0]?.count || 1
              const pct = Math.max((f.count / max) * 100, 2)
              return (
                <div key={f.stage} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-semibold text-slate-700">{f.count}</span>
                  <div
                    className="w-full rounded-t-md transition-all"
                    style={{ height: `${pct * 1.6}px`, backgroundColor: FUNNEL_COLORS[i] || '#6366f1' }}
                  />
                  <span className="text-xs text-slate-500 text-center leading-tight">{f.stage}</span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Daily trend */}
      <Card>
        <CardHeader><CardTitle>Daily Email Activity</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data?.dailyTrend || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="sent" stroke="#6366f1" dot={false} name="Sent" strokeWidth={2} />
              <Line type="monotone" dataKey="replies" stroke="#10b981" dot={false} name="Replies" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Campaign Performance */}
      <Card>
        <CardHeader><CardTitle>Campaign Performance</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  {['Campaign', 'Industry', 'Leads', 'Replies', 'Reply Rate', 'Interested', 'Won', 'Revenue'].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.campaigns || []).map((c: { id: string; name: string; industry: string; totalLeads: number; replied: number; replyRate: string; interested: number; won: number; revenue: number }) => (
                  <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-900">{c.name}</td>
                    <td className="px-4 py-2.5 text-slate-500">{c.industry}</td>
                    <td className="px-4 py-2.5 text-slate-700">{c.totalLeads}</td>
                    <td className="px-4 py-2.5 text-slate-700">{c.replied}</td>
                    <td className="px-4 py-2.5 font-medium text-indigo-600">{c.replyRate}%</td>
                    <td className="px-4 py-2.5 text-slate-700">{c.interested}</td>
                    <td className="px-4 py-2.5 text-green-600 font-medium">{c.won}</td>
                    <td className="px-4 py-2.5 text-green-600 font-medium">{fmtCurrency(c.revenue)}</td>
                  </tr>
                ))}
                {!data?.campaigns?.length && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">No campaign data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Sender Performance */}
      <Card>
        <CardHeader><CardTitle>Sender Account Performance</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  {['Sender', 'Target/day', 'Sent', 'Follow-ups', 'Leads', 'Replied', 'Won', 'Revenue'].map((h) => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.senders || []).map((s: { id: string; displayName: string; email: string; dailyEmailTarget: number; emailsSent: number; followUpsSent: number; totalLeads: number; replied: number; won: number; revenue: number }) => (
                  <tr key={s.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{s.displayName}</p>
                      <p className="text-xs text-slate-400">{s.email}</p>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{s.dailyEmailTarget}</td>
                    <td className="px-4 py-2.5 text-indigo-600 font-medium">{s.emailsSent}</td>
                    <td className="px-4 py-2.5 text-slate-700">{s.followUpsSent}</td>
                    <td className="px-4 py-2.5 text-slate-700">{s.totalLeads}</td>
                    <td className="px-4 py-2.5 text-teal-600 font-medium">{s.replied}</td>
                    <td className="px-4 py-2.5 text-green-600 font-medium">{s.won}</td>
                    <td className="px-4 py-2.5 text-green-600 font-medium">{fmtCurrency(s.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Industry breakdown */}
      {data?.industries?.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Leads by Industry</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.industries.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="industry" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
