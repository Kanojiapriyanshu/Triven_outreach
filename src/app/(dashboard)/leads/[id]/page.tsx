'use client'
import { use, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowLeft, Globe, Link2, Phone, Mail, Building2,
  MapPin, Send, Clock, Video, Calendar, DollarSign,
  MessageSquare, Plus, AlertCircle, PenLine, StopCircle, SkipForward,
} from 'lucide-react'
import ComposeEmailDialog from '@/components/email/ComposeEmailDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/leads/StatusBadge'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fmtDate, fmtDateTime, fmtCurrency, getDisplayName, STATUS_LABELS } from '@/lib/utils'
import type { LeadRow } from '@/types'
import { personaLabel, interestLabel } from '@/lib/audience/taxonomy'
import { DEFAULT_SEND_WINDOW, fmtInZone, type SendWindow } from '@/lib/send-window'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface FollowUpTaskRow {
  id: string; type: string; subject: string | null; body: string | null
  scheduledAt: string; status: string; sentAt: string | null
}

const TASK_BADGE: Record<string, { label: string; variant: 'success' | 'secondary' | 'default' | 'destructive' }> = {
  PENDING:   { label: 'Scheduled', variant: 'default' },
  SENT:      { label: 'Sent',      variant: 'success' },
  SKIPPED:   { label: 'Skipped',   variant: 'secondary' },
  CANCELLED: { label: 'Stopped',   variant: 'secondary' },
}

const ALL_STATUSES = [
  'NEW','RESEARCHING','READY_TO_CONTACT','FIRST_EMAIL_SENT',
  'FOLLOW_UP_1_DUE','FOLLOW_UP_1_SENT','FOLLOW_UP_2_DUE','FOLLOW_UP_2_SENT',
  'FOLLOW_UP_3_DUE','FOLLOW_UP_3_SENT','REPLIED','INTERESTED','DEMO_SENT',
  'MEETING_BOOKED','PROPOSAL_SENT','WON','LOST','NOT_INTERESTED',
  'UNSUBSCRIBED','INVALID_EMAIL','DO_NOT_CONTACT',
]

function ActivityIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    EMAIL_SENT: <Send className="h-3.5 w-3.5 text-indigo-600" />,
    FOLLOW_UP_SENT: <Send className="h-3.5 w-3.5 text-blue-600" />,
    EMAIL_REPLIED: <MessageSquare className="h-3.5 w-3.5 text-teal-600" />,
    CALL: <Phone className="h-3.5 w-3.5 text-green-600" />,
    DEMO_SENT: <Video className="h-3.5 w-3.5 text-purple-600" />,
    MEETING_BOOKED: <Calendar className="h-3.5 w-3.5 text-orange-600" />,
    STATUS_CHANGED: <AlertCircle className="h-3.5 w-3.5 text-amber-600" />,
    NOTE_ADDED: <MessageSquare className="h-3.5 w-3.5 text-slate-500" />,
    SALE: <DollarSign className="h-3.5 w-3.5 text-green-600" />,
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white border border-slate-200 shadow-xs">
      {icons[type] || <Clock className="h-3.5 w-3.5 text-slate-400" />}
    </span>
  )
}

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: lead, mutate } = useSWR<LeadRow & {
    activities: Array<{ id: string; type: string; title: string; body?: string; createdAt: string; user?: { name: string } }>
    followUpTasks: FollowUpTaskRow[]
  }>(
    `/api/leads/${id}`,
    fetcher
  )
  const [noteText, setNoteText]     = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTask, setComposeTask] = useState<FollowUpTaskRow | null>(null)
  const [busyTask, setBusyTask]       = useState<string | null>(null)
  const { data: settingsData } = useSWR<{ sendWindow: SendWindow }>('/api/settings', fetcher)
  const sendWindow = settingsData?.sendWindow ?? DEFAULT_SEND_WINDOW

  if (!lead) return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <div className="animate-pulse text-sm">Loading lead…</div>
    </div>
  )

  async function updateStatus(status: string) {
    await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    toast.success('Status updated')
    mutate()
  }

  async function updateField(field: string, value: unknown) {
    await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    mutate()
  }

  async function addNote() {
    if (!noteText.trim()) return
    setSavingNote(true)
    await fetch(`/api/leads/${id}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'NOTE_ADDED', title: noteText }),
    })
    toast.success('Note added')
    setNoteText('')
    setAddingNote(false)
    setSavingNote(false)
    mutate()
  }

  async function sendTaskNow(task: FollowUpTaskRow) {
    setBusyTask(task.id)
    const res = await fetch(`/api/followups/${task.id}`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusyTask(null)
    if (res.ok) toast.success('Sent')
    else toast.error(data.error || 'Failed to send')
    mutate()
  }

  async function skipTask(taskId: string) {
    await fetch(`/api/followups/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SKIPPED' }),
    })
    mutate()
  }

  async function stopFollowUps() {
    if (!confirm('Stop all scheduled follow-ups for this lead?')) return
    await fetch('/api/leads/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: [id], action: 'pause_sequence' }),
    })
    toast.success('Follow-ups stopped')
    mutate()
  }

  const displayName = getDisplayName(lead)
  const tasks = (lead.followUpTasks || []).filter((t) => t.type.startsWith('FOLLOW_UP'))
  const scheduledFirst = (lead.followUpTasks || []).find((t) => t.type === 'FIRST_EMAIL' && t.status === 'PENDING')
  const pendingTasks = (lead.followUpTasks || []).filter((t) => t.status === 'PENDING')

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Back + header */}
      <div className="flex items-center gap-4">
        <Link href="/leads" className="p-2 rounded-lg hover:bg-slate-200 text-slate-500">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900">{displayName}</h1>
          <p className="text-sm text-slate-500">{lead.companyName} {lead.jobTitle ? `· ${lead.jobTitle}` : ''}</p>
        </div>
        <div className="flex gap-2 items-center">
          <Button
            size="sm"
            onClick={() => { setComposeTask(null); setComposeOpen(true) }}
            disabled={!lead.companyEmail}
            title={!lead.companyEmail ? 'No email address on this lead' : 'Compose personalised email'}
          >
            <PenLine className="h-3.5 w-3.5" />{lead.firstEmailSentAt ? 'Email' : 'Send First Email'}
          </Button>
          <StatusBadge status={lead.status} className="text-sm px-3 py-1" />
          <Select value={lead.status} onValueChange={updateStatus}>
            <SelectTrigger className="h-8 w-auto text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-1 space-y-4">
          {/* Contact info */}
          <Card>
            <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
            <CardContent className="space-y-3 pt-0">
              {lead.companyEmail && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                  <a href={`mailto:${lead.companyEmail}`} className="text-indigo-600 hover:underline truncate">{lead.companyEmail}</a>
                </div>
              )}
              {lead.phone && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                  {lead.phone}
                </div>
              )}
              {lead.website && (
                <div className="flex items-center gap-2 text-sm">
                  <Globe className="h-4 w-4 text-slate-400 shrink-0" />
                  <a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline truncate">{lead.website}</a>
                </div>
              )}
              {lead.linkedIn && (
                <div className="flex items-center gap-2 text-sm">
                  <Link2 className="h-4 w-4 text-slate-400 shrink-0" />
                  <a href={lead.linkedIn} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline truncate">LinkedIn</a>
                </div>
              )}
              {(lead.city || lead.state || lead.country) && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                  {[lead.city, lead.state, lead.country].filter(Boolean).join(', ')}
                </div>
              )}
              {lead.industry && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                  {lead.industry}{lead.companySize ? ` · ${lead.companySize}` : ''}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Campaign & Sender */}
          <Card>
            <CardHeader><CardTitle>Assignment</CardTitle></CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">Campaign</p>
                {lead.campaign ? (
                  <Badge variant="secondary">{lead.campaign.name}</Badge>
                ) : <span className="text-sm text-slate-400">No campaign</span>}
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Sender Account</p>
                {lead.senderAccount ? (
                  <div>
                    <p className="text-sm font-medium text-slate-700">{lead.senderAccount.displayName}</p>
                    <p className="text-xs text-slate-400">{lead.senderAccount.email}</p>
                  </div>
                ) : <span className="text-sm text-slate-400">No sender assigned</span>}
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Priority</p>
                <Select value={lead.priority} onValueChange={(v) => updateField('priority', v)}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['LOW','MEDIUM','HIGH','URGENT'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Conversion */}
          <Card>
            <CardHeader><CardTitle>Conversion</CardTitle></CardHeader>
            <CardContent className="pt-0 space-y-2 text-sm">
              {[
                { label: 'Replied', checked: lead.hasReplied, field: 'hasReplied' },
                { label: 'Interested', checked: lead.isInterested, field: 'isInterested' },
                { label: 'Demo Sent', checked: lead.demoSent, field: 'demoSent' },
                { label: 'Meeting Booked', checked: lead.meetingBooked, field: 'meetingBooked' },
                { label: 'Proposal Sent', checked: lead.proposalSent, field: 'proposalSent' },
                { label: 'Sale', checked: lead.hasSale, field: 'hasSale' },
              ].map(({ label, checked, field }) => (
                <label key={field} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => updateField(field, e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className={checked ? 'text-slate-900 font-medium' : 'text-slate-500'}>{label}</span>
                </label>
              ))}
              {lead.hasSale && (
                <div className="pt-2 border-t border-slate-100">
                  <p className="text-xs text-slate-500">Deal Value</p>
                  <p className="font-semibold text-green-600">{fmtCurrency(lead.dealValue)}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Why we contacted them (YouTube audience) */}
          {(lead.sourceVideo || lead.sourceComment) && (
            <Card>
              <CardHeader><CardTitle>Found on {lead.sourcePlatform === 'HN' ? 'Hacker News' : 'YouTube'}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-slate-600">
                  {lead.sourcePlatform === 'HN'
                    ? <>Commented in the thread {lead.sourceVideo ? <>&ldquo;{lead.sourceVideo}&rdquo;</> : ''}</>
                    : <>Commented on {lead.sourceChannel ? <strong>{lead.sourceChannel}</strong> : 'a video'}{lead.sourceVideo ? <>&apos;s video &ldquo;{lead.sourceVideo}&rdquo;</> : ''}</>}
                  {lead.commentTopic && <> about <strong>{lead.commentTopic}</strong></>}.
                  {lead.sourceVideoUrl && <> <a href={lead.sourceVideoUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">Open comment ↗</a></>}
                </p>
                {lead.sourceComment && <blockquote className="border-l-2 border-slate-200 pl-3 text-slate-700 whitespace-pre-wrap">{lead.sourceComment}</blockquote>}
                <p className="text-xs text-slate-500">
                  {[lead.persona && personaLabel(lead.persona), lead.interestCategory && interestLabel(lead.interestCategory)].filter(Boolean).join(' · ')}
                  {lead.prospectId && <> · <Link href={`/audience/prospects?q=${encodeURIComponent(lead.companyEmail || '')}`} className="text-indigo-600 hover:underline">Prospect record</Link></>}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Research */}
          {(lead.personalizationNotes || lead.companyPainPoint || lead.whyThisLead) && (
            <Card>
              <CardHeader><CardTitle>Research</CardTitle></CardHeader>
              <CardContent className="pt-0 space-y-3">
                {lead.whyThisLead && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Why This Lead</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{lead.whyThisLead}</p>
                  </div>
                )}
                {lead.companyPainPoint && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Pain Point</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{lead.companyPainPoint}</p>
                  </div>
                )}
                {lead.personalizationNotes && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Personalization</p>
                    <p className="text-sm text-indigo-700 bg-indigo-50 rounded-lg p-3 whitespace-pre-wrap">{lead.personalizationNotes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Outreach sequence */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Outreach Sequence</CardTitle>
                {pendingTasks.length > 0 && (
                  <Button size="sm" variant="ghost" className="text-slate-500" onClick={stopFollowUps}>
                    <StopCircle className="h-4 w-4" />Stop follow-ups
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {/* First email */}
              <div className={`rounded-lg border p-3 ${lead.firstEmailSentAt ? 'border-slate-200 bg-slate-50' : 'border-dashed border-slate-300'}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-slate-500 uppercase">First Email</p>
                  {lead.firstEmailSentAt
                    ? <Badge variant="success" className="text-xs">Sent {fmtDate(lead.firstEmailSentAt)}</Badge>
                    : scheduledFirst
                      ? <Badge className="text-xs">Scheduled</Badge>
                      : <Badge variant="secondary" className="text-xs">Not sent</Badge>}
                </div>
                {lead.firstEmailSentAt ? (
                  <>
                    <p className="text-sm font-medium text-slate-800">{lead.firstEmailSubject}</p>
                    {lead.firstEmailBody && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{lead.firstEmailBody}</p>}
                  </>
                ) : scheduledFirst ? (
                  <>
                    <p className="text-sm font-medium text-slate-800">{scheduledFirst.subject}</p>
                    <p className="text-xs text-indigo-700 mt-1">
                      Scheduled for {fmtInZone(scheduledFirst.scheduledAt, sendWindow)}
                    </p>
                    <div className="flex gap-1 mt-2 -ml-2">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" loading={busyTask === scheduledFirst.id} onClick={() => sendTaskNow(scheduledFirst)}>
                        <Send className="h-3 w-3" />Send now
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400" onClick={stopFollowUps}>
                        <StopCircle className="h-3 w-3" />Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">Send or schedule the first email and follow-ups are planned automatically.</p>
                    <Button size="sm" onClick={() => { setComposeTask(null); setComposeOpen(true) }} disabled={!lead.companyEmail}>
                      <Send className="h-3.5 w-3.5" />Write email
                    </Button>
                  </div>
                )}
              </div>

              {/* Follow-ups */}
              {tasks.length === 0 ? (
                lead.firstEmailSentAt && <p className="text-xs text-slate-400 px-1">No follow-ups scheduled.</p>
              ) : tasks.map((task) => {
                const badge = TASK_BADGE[task.status] || TASK_BADGE.PENDING
                const pending = task.status === 'PENDING'
                return (
                  <div key={task.id} className={`rounded-lg border p-3 ${pending ? 'border-indigo-100 bg-indigo-50/40' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold text-slate-500 uppercase">{task.type.replace(/_/g, ' ').replace('FOLLOW UP', 'Follow-up')}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">
                          {task.status === 'SENT'
                            ? fmtDateTime(task.sentAt)
                            : task.status === 'PENDING' ? fmtInZone(task.scheduledAt, sendWindow) : fmtDate(task.scheduledAt, 'EEE, MMM d')}
                        </span>
                        <Badge variant={badge.variant} className="text-xs">{badge.label}</Badge>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2">
                      {task.body || <span className="italic text-slate-400">Uses your default follow-up template</span>}
                    </p>
                    {pending && (
                      <div className="flex gap-1 mt-2 -ml-2">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" loading={busyTask === task.id} onClick={() => sendTaskNow(task)}>
                          <Send className="h-3 w-3" />Send now
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setComposeTask(task); setComposeOpen(true) }}>
                          <PenLine className="h-3 w-3" />Edit &amp; send
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-400" onClick={() => skipTask(task.id)}>
                          <SkipForward className="h-3 w-3" />Skip
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {/* Dates */}
          <Card>
            <CardHeader><CardTitle>Key Dates</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Created', value: fmtDate(lead.createdAt) },
                  { label: 'Last Contacted', value: fmtDate(lead.lastContactedAt) },
                  { label: 'Next Follow-up', value: fmtDate(lead.nextFollowUpAt) },
                  { label: 'Last Response', value: fmtDate(lead.lastResponseAt) },
                  { label: 'Demo Date', value: fmtDate(lead.demoDate) },
                  { label: 'Meeting Date', value: fmtDate(lead.meetingDate) },
                  { label: 'Sale Date', value: fmtDate(lead.saleDate) },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="text-slate-700 font-medium">{value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Activity timeline */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Activity Timeline</CardTitle>
                <Button size="sm" variant="ghost" onClick={() => setAddingNote(true)}>
                  <Plus className="h-4 w-4" />Add Note
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {addingNote && (
                <div className="mb-4 space-y-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <Textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Add a note…"
                    rows={3}
                    className="text-sm"
                  />
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setAddingNote(false)}>Cancel</Button>
                    <Button size="sm" onClick={addNote} loading={savingNote}>Save Note</Button>
                  </div>
                </div>
              )}

              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-3 top-0 bottom-0 w-px bg-slate-200" />

                <div className="space-y-4">
                  {(lead.activities || []).length === 0 ? (
                    <p className="text-sm text-slate-400 pl-8">No activity yet</p>
                  ) : (lead.activities || []).map((act) => (
                    <div key={act.id} className="relative flex gap-3 pl-10">
                      <div className="absolute left-0">
                        <ActivityIcon type={act.type} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800">{act.title}</p>
                        {act.body && <p className="text-xs text-slate-500 mt-0.5">{act.body}</p>}
                        <p className="text-xs text-slate-400 mt-1">
                          {fmtDateTime(act.createdAt)}{act.user ? ` · ${act.user.name}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Compose Email dialog */}
      {composeOpen && (
        <ComposeEmailDialog
          open={composeOpen}
          onClose={() => setComposeOpen(false)}
          lead={{
            id:              lead.id,
            firstName:       lead.firstName,
            lastName:        lead.lastName,
            fullName:        lead.fullName,
            companyName:     lead.companyName,
            companyEmail:    lead.companyEmail,
            jobTitle:        lead.jobTitle,
            city:            lead.city,
            industry:        lead.industry,
            senderAccountId: lead.senderAccountId,
            campaignId:      lead.campaignId,
            firstEmailSentAt: lead.firstEmailSentAt,
            whyThisLead:     lead.whyThisLead,
            notes:           lead.notes,
            personalizationNotes: lead.personalizationNotes,
            sourcePlatform:  lead.sourcePlatform,
            sourceChannel:   lead.sourceChannel,
            sourceVideo:     lead.sourceVideo,
            commentTopic:    lead.commentTopic,
            interestCategory: lead.interestCategory,
            persona:         lead.persona,
          }}
          taskId={composeTask?.id}
          taskType={composeTask?.type}
          defaultBody={composeTask?.body ?? ''}
          onSent={() => mutate()}
        />
      )}
    </div>
  )
}
