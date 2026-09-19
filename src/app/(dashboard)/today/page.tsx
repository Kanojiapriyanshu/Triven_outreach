'use client'
import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Send, Clock, AlertTriangle, CheckCircle, SkipForward, CalendarClock,
  Mail, Users, PenLine,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/leads/StatusBadge'
import { fmtDate, getDisplayName } from '@/lib/utils'
import { differenceInDays } from 'date-fns'
import ComposeEmailDialog from '@/components/email/ComposeEmailDialog'
import type { ComposeLead } from '@/components/email/ComposeEmailDialog'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface FollowUpTask {
  id: string
  type: string
  subject: string | null
  body: string | null
  scheduledAt: string
  status: string
  lead: {
    id: string; companyName: string; fullName?: string; firstName?: string; lastName?: string
    companyEmail?: string; status: string; senderAccountId?: string
    campaign?: { name: string } | null
    senderAccount?: { id: string; displayName: string; email: string } | null
  }
  senderAccount?: { displayName: string; email: string } | null
}

interface Lead {
  id: string; companyName: string; fullName?: string; firstName?: string; lastName?: string
  companyEmail?: string; status: string; personalizationNotes?: string
  senderAccountId?: string
  campaign?: { name: string } | null
  senderAccount?: { id: string; displayName: string; email: string } | null
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────
function TaskCard({ task, onAction, overdue = false, onCompose }: {
  task: FollowUpTask
  onAction: () => void
  overdue?: boolean
  onCompose: (task: FollowUpTask) => void
}) {
  const overdueBy = overdue ? differenceInDays(new Date(), new Date(task.scheduledAt)) : 0

  async function skipTask() {
    await fetch(`/api/followups/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SKIPPED' }),
    })
    toast.success('Skipped')
    onAction()
  }

  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border ${overdue ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/leads/${task.lead.id}`} className="font-semibold text-slate-900 hover:text-indigo-600 text-sm">
            {getDisplayName(task.lead)}
          </Link>
          <span className="text-slate-300">·</span>
          <span className="text-sm text-slate-500">{task.lead.companyName}</span>
          {task.lead.campaign && <Badge variant="secondary" className="text-xs">{task.lead.campaign.name}</Badge>}
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <Badge variant={overdue ? 'destructive' : 'default'} className="text-xs">
            {task.type.replace(/_/g, ' ')}
          </Badge>
          {overdue && (
            <span className="text-xs text-red-600 font-medium flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {overdueBy === 1 ? '1 day overdue' : `${overdueBy} days overdue`}
            </span>
          )}
          <span className="text-xs text-slate-400">Due {fmtDate(task.scheduledAt)}</span>
        </div>
        {task.subject && (
          <p className="text-xs text-slate-500 mt-1.5 font-medium">📧 {task.subject}</p>
        )}
        {task.body && (
          <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{task.body}</p>
        )}
        <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
          <Mail className="h-3 w-3" />
          {task.lead.companyEmail || <span className="text-red-400">No email</span>}
          {task.senderAccount && (
            <><span className="text-slate-300">·</span>Sender: {task.senderAccount.displayName}</>
          )}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={skipTask}>
          <SkipForward className="h-3.5 w-3.5" />Skip
        </Button>
        <Button size="sm" onClick={() => onCompose(task)}>
          <PenLine className="h-3.5 w-3.5" />Send
        </Button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function TodayPage() {
  const { data: todayData,   mutate: mutateTasks }   = useSWR('/api/followups/today',   fetcher)
  const { data: overdueData, mutate: mutateOverdue } = useSWR('/api/followups/overdue', fetcher)

  // Compose dialog state
  const [composeLead,    setComposeLead]    = useState<ComposeLead | null>(null)
  const [composeTask,    setComposeTask]    = useState<FollowUpTask | null>(null)
  const [composeOpen,    setComposeOpen]    = useState(false)

  const tasks:           FollowUpTask[] = todayData?.tasks          ?? []
  const firstEmailLeads: Lead[]         = todayData?.firstEmailLeads ?? []
  const overdueTasks:    FollowUpTask[] = overdueData               ?? []

  const followUp1 = tasks.filter(t => t.type === 'FOLLOW_UP_1')
  const followUp2 = tasks.filter(t => t.type === 'FOLLOW_UP_2')
  const followUp3 = tasks.filter(t => t.type === 'FOLLOW_UP_3')

  function refresh() { mutateTasks(); mutateOverdue() }

  function openComposeForTask(task: FollowUpTask) {
    setComposeLead({
      id:              task.lead.id,
      firstName:       task.lead.firstName,
      lastName:        task.lead.lastName,
      fullName:        task.lead.fullName,
      companyName:     task.lead.companyName,
      companyEmail:    task.lead.companyEmail,
      senderAccountId: task.lead.senderAccount?.id ?? task.lead.senderAccountId,
    })
    setComposeTask(task)
    setComposeOpen(true)
  }

  function openComposeForLead(lead: Lead) {
    setComposeLead({
      id:              lead.id,
      firstName:       lead.firstName,
      lastName:        lead.lastName,
      fullName:        lead.fullName,
      companyName:     lead.companyName,
      companyEmail:    lead.companyEmail,
      senderAccountId: lead.senderAccount?.id ?? lead.senderAccountId,
    })
    setComposeTask(null)
    setComposeOpen(true)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Today&apos;s Work</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'New Outreach', value: firstEmailLeads.length,                                     icon: Users,        color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Follow-ups',   value: tasks.length,                                               icon: Clock,        color: 'text-amber-600',  bg: 'bg-amber-50'  },
          { label: 'Overdue',      value: overdueTasks.length,                                        icon: AlertTriangle,color: 'text-red-600',    bg: 'bg-red-50'    },
          { label: 'Total Due',    value: firstEmailLeads.length + tasks.length + overdueTasks.length, icon: CalendarClock,color: 'text-slate-600',  bg: 'bg-slate-100' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div>
              <p className="text-xs text-slate-400">{label}</p>
              <p className="text-xl font-bold text-slate-900">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Overdue */}
      {overdueTasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" />Overdue ({overdueTasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {overdueTasks.map(task => (
              <TaskCard key={task.id} task={task} onAction={refresh} overdue onCompose={openComposeForTask} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* New outreach — READY_TO_CONTACT leads */}
      {firstEmailLeads.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-indigo-600" />New Outreach ({firstEmailLeads.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {firstEmailLeads.map(lead => (
              <div key={lead.id} className="flex items-start gap-4 p-4 rounded-xl border border-slate-200 bg-white">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/leads/${lead.id}`} className="font-semibold text-slate-900 hover:text-indigo-600 text-sm">
                      {getDisplayName(lead)}
                    </Link>
                    <span className="text-sm text-slate-500">{lead.companyName}</span>
                    {lead.campaign && <Badge variant="secondary" className="text-xs">{lead.campaign.name}</Badge>}
                  </div>
                  {lead.personalizationNotes && (
                    <p className="text-xs text-indigo-600 bg-indigo-50 rounded-lg px-2 py-1 mt-2 line-clamp-2">
                      💡 {lead.personalizationNotes}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                    <Mail className="h-3 w-3" />
                    {lead.companyEmail || <span className="text-red-400">No email</span>}
                    {lead.senderAccount && <> · Sender: {lead.senderAccount.displayName}</>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/leads/${lead.id}`}>View</Link>
                  </Button>
                  <Button size="sm" onClick={() => openComposeForLead(lead)}>
                    <PenLine className="h-3.5 w-3.5" />Compose
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Follow-up sections */}
      {[
        { label: 'Follow-up 1', tasks: followUp1, color: 'text-yellow-700', type: 'FOLLOW_UP_1' },
        { label: 'Follow-up 2', tasks: followUp2, color: 'text-orange-700', type: 'FOLLOW_UP_2' },
        { label: 'Follow-up 3', tasks: followUp3, color: 'text-red-700',    type: 'FOLLOW_UP_3' },
      ].filter(({ tasks }) => tasks.length > 0).map(({ label, tasks, color }) => (
        <Card key={label}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 ${color}`}>
              <Clock className="h-4 w-4" />{label} ({tasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {tasks.map(task => (
              <TaskCard key={task.id} task={task} onAction={refresh} onCompose={openComposeForTask} />
            ))}
          </CardContent>
        </Card>
      ))}

      {firstEmailLeads.length === 0 && tasks.length === 0 && overdueTasks.length === 0 && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
            <h3 className="text-lg font-semibold text-slate-900">All caught up! 🎉</h3>
            <p className="text-sm text-slate-500 mt-1">No follow-ups or outreach tasks due today.</p>
          </CardContent>
        </Card>
      )}

      {/* Compose dialog */}
      {composeOpen && composeLead && (
        <ComposeEmailDialog
          open={composeOpen}
          onClose={() => { setComposeOpen(false); setComposeTask(null) }}
          lead={composeLead}
          taskId={composeTask?.id}
          defaultSubject={composeTask?.subject ?? ''}
          defaultBody={composeTask?.body ?? ''}
          templateType={composeTask?.type ?? 'FIRST_EMAIL'}
          onSent={refresh}
        />
      )}
    </div>
  )
}
