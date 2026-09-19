'use client'
import useSWR from 'swr'
import {
  Users, Mail, Clock, MessageSquare, Heart, Video,
  Calendar, Trophy, DollarSign, AlertTriangle, TrendingUp, Activity,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fmtCurrency } from '@/lib/utils'
import type { DashboardStats } from '@/types'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function MetricCard({
  label, value, sub, icon: Icon, color = 'text-slate-600', bg = 'bg-slate-100',
}: {
  label: string; value: number | string; sub?: string
  icon: React.ElementType; color?: string; bg?: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
            {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const { data, isLoading } = useSWR<DashboardStats>('/api/dashboard', fetcher, {
    refreshInterval: 60_000,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="h-16 animate-pulse bg-slate-100 rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  const t = data?.today
  const totals = data?.totals
  const senders = data?.senderStats ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Today's metrics */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3">Today</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <MetricCard label="New Leads" value={t?.newLeads ?? 0} icon={Users} color="text-indigo-600" bg="bg-indigo-50" />
          <MetricCard label="First Emails Due" value={t?.firstEmailsDue ?? 0} icon={Mail} color="text-blue-600" bg="bg-blue-50" />
          <MetricCard label="Follow-ups Due" value={t?.followUpsDue ?? 0} icon={Clock} color="text-amber-600" bg="bg-amber-50" />
          <MetricCard label="Replies" value={t?.replies ?? 0} icon={MessageSquare} color="text-teal-600" bg="bg-teal-50" />
          <MetricCard
            label="Overdue"
            value={t?.overdue ?? 0}
            icon={AlertTriangle}
            color={t?.overdue ? 'text-red-600' : 'text-slate-400'}
            bg={t?.overdue ? 'bg-red-50' : 'bg-slate-50'}
          />
        </div>
      </div>

      {/* Conversion metrics */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3">Conversion</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard label="Interested" value={t?.interested ?? 0} icon={Heart} color="text-pink-600" bg="bg-pink-50" />
          <MetricCard label="Demos" value={t?.demos ?? 0} icon={Video} color="text-purple-600" bg="bg-purple-50" />
          <MetricCard label="Meetings" value={t?.meetings ?? 0} icon={Calendar} color="text-emerald-600" bg="bg-emerald-50" />
          <MetricCard label="Won Today" value={t?.won ?? 0} sub={fmtCurrency(t?.revenue)} icon={Trophy} color="text-amber-600" bg="bg-amber-50" />
        </div>
      </div>

      {/* Totals row */}
      <div>
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-3">All Time</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard label="Total Leads" value={totals?.leads ?? 0} icon={Users} />
          <MetricCard label="Active" value={totals?.active ?? 0} icon={Activity} color="text-blue-600" bg="bg-blue-50" />
          <MetricCard label="Replied" value={totals?.replied ?? 0} icon={MessageSquare} color="text-teal-600" bg="bg-teal-50" />
          <MetricCard label="Interested" value={totals?.interested ?? 0} icon={Heart} color="text-pink-600" bg="bg-pink-50" />
          <MetricCard label="Won" value={totals?.won ?? 0} icon={Trophy} color="text-amber-600" bg="bg-amber-50" />
          <MetricCard label="Revenue" value={fmtCurrency(totals?.revenue)} icon={DollarSign} color="text-green-600" bg="bg-green-50" />
        </div>
      </div>

      {/* Sender accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-indigo-600" />
            Sender Account Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-slate-100 bg-slate-50">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Account</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Target</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Sent Today</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Follow-ups</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Total Leads</th>
                  <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {senders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-400 text-sm">
                      No sender accounts yet. <a href="/sender-accounts" className="text-indigo-600 hover:underline">Add one →</a>
                    </td>
                  </tr>
                ) : senders.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-6 py-3">
                      <p className="font-medium text-slate-900">{s.displayName}</p>
                      <p className="text-xs text-slate-400">{s.email}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{s.dailyEmailTarget}</td>
                    <td className="px-4 py-3 text-right font-medium text-indigo-600">{s.todayNewEmails}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{s.todayFollowUps}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{s.totalLeads}</td>
                    <td className="px-6 py-3">
                      <Badge
                        variant={s.gmailStatus === 'CONNECTED' ? 'success' : s.gmailStatus === 'NOT_CONNECTED' ? 'secondary' : 'destructive'}
                      >
                        {s.gmailStatus === 'CONNECTED' ? '● Connected' : s.gmailStatus === 'NOT_CONNECTED' ? '○ Not Connected' : '⚠ Error'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
