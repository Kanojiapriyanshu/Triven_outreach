'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Send, Eye, EyeOff, Repeat, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  TEMPLATE_VARS, FOLLOW_UP_TYPES, buildTemplateVars, renderTemplate,
  guessCompanyFromEmail, pickDefaultTemplate,
} from '@/lib/template'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ComposeLead {
  id: string
  firstName?: string | null
  lastName?: string | null
  fullName?: string | null
  companyName: string
  companyEmail?: string | null
  jobTitle?: string | null
  city?: string | null
  industry?: string | null
  senderAccountId?: string | null
  campaignId?: string | null
  firstEmailSentAt?: string | null
}

interface Template {
  id: string; name: string; subject: string; body: string; type: string
  campaignId?: string | null; isDefault?: boolean
  campaign?: { name: string } | null
}
interface Sender { id: string; displayName: string; email: string; gmailStatus: string }
interface Campaign { id: string; name: string; followUpDay1?: number; followUpDay2?: number; followUpDay3?: number }

interface Props {
  open: boolean
  onClose: () => void
  /** Omit to compose to a brand-new contact (lead is created on send) */
  lead?: ComposeLead
  /** Sending a scheduled follow-up (replies in the original thread) */
  taskId?: string
  taskType?: string
  defaultBody?: string
  onSent?: (leadId: string) => void
}

const AUTO = '__auto'
const NONE = '__none'
const DEFAULT_DELAYS = [3, 7, 14]

interface FollowUpRow { enabled: boolean; templateId: string; delayDays: number }

// ─── Component ────────────────────────────────────────────────────────────────
export default function ComposeEmailDialog({
  open, onClose, lead, taskId, taskType, defaultBody = '', onSent,
}: Props) {
  const isNewLead = !lead
  const isFollowUp = !!taskId
  const isFirstEmail = !isFollowUp && !lead?.firstEmailSentAt
  const templateType = isFollowUp ? (taskType || 'FOLLOW_UP_1') : isFirstEmail ? 'FIRST_EMAIL' : 'OTHER'

  // Recipient (new-lead mode)
  const [toEmail, setToEmail]       = useState('')
  const [toFirstName, setToFirstName] = useState('')
  const [toCompany, setToCompany]   = useState('')
  const [campaignId, setCampaignId] = useState(lead?.campaignId || '')

  const [from, setFrom]       = useState(lead?.senderAccountId || '')
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody]       = useState(defaultBody)
  const [preview, setPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [followUps, setFollowUps] = useState<FollowUpRow[]>(
    DEFAULT_DELAYS.map(d => ({ enabled: true, templateId: AUTO, delayDays: d })),
  )
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const autoLoaded = useRef(false)

  const { data: sendersData }   = useSWR<Sender[]>('/api/sender-accounts', fetcher)
  const { data: templatesData } = useSWR<Template[]>('/api/templates', fetcher)
  const { data: campaignsData } = useSWR<Campaign[]>('/api/campaigns', fetcher)
  const senders   = Array.isArray(sendersData) ? sendersData : []
  const templates = useMemo(() => Array.isArray(templatesData) ? templatesData : [], [templatesData])
  const campaigns = Array.isArray(campaignsData) ? campaignsData : []

  const connectedSenders = senders.filter(s => s.gmailStatus === 'CONNECTED')
  const sender = senders.find(s => s.id === from)
  const mainTemplates = templates.filter(t => t.type === templateType || (templateType === 'OTHER' && t.type === 'FIRST_EMAIL'))

  // Pick a default sender: the lead's own, else the first connected account
  useEffect(() => {
    if (from || !connectedSenders.length) return
    const own = connectedSenders.find(s => s.id === lead?.senderAccountId)
    setFrom((own || connectedSenders[0]).id)
  }, [connectedSenders, from, lead?.senderAccountId])

  // Follow-up timing follows the campaign schedule when there is one
  useEffect(() => {
    const c = campaigns.find(x => x.id === campaignId)
    const days = c ? [c.followUpDay1, c.followUpDay2, c.followUpDay3] : DEFAULT_DELAYS
    setFollowUps(rows => rows.map((r, i) => ({ ...r, delayDays: days[i] || DEFAULT_DELAYS[i] })))
  }, [campaignId, campaignsData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load the best matching template once, if the editor is empty
  useEffect(() => {
    if (autoLoaded.current || !templatesData || body.trim()) return
    autoLoaded.current = true
    const t = pickDefaultTemplate(mainTemplates, templateType, campaignId)
    if (t) applyTemplate(t, false)
  }, [templatesData]) // eslint-disable-line react-hooks/exhaustive-deps

  const recipient = isNewLead
    ? { firstName: toFirstName, companyName: toCompany || guessCompanyFromEmail(toEmail), companyEmail: toEmail }
    : lead
  const vars = buildTemplateVars(recipient, sender)

  function applyTemplate(t: Template, announce = true) {
    setTemplateId(t.id)
    if (t.subject) setSubject(t.subject)
    setBody(t.body)
    if (announce) toast.success(`Loaded "${t.name}"`)
  }

  function insertVar(key: string) {
    const snippet = `{{${key}}}`
    const ta = bodyRef.current
    if (!ta) { setBody(p => p + snippet); return }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    setBody(body.slice(0, start) + snippet + body.slice(end))
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + snippet.length
      ta.focus()
    }, 0)
  }

  function followUpTemplate(row: FollowUpRow, i: number) {
    if (!row.enabled || row.templateId === NONE) return undefined
    if (row.templateId === AUTO) return pickDefaultTemplate(templates, FOLLOW_UP_TYPES[i], campaignId)
    return templates.find(t => t.id === row.templateId)
  }

  function updateRow(i: number, patch: Partial<FollowUpRow>) {
    setFollowUps(rows => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  async function handleSend() {
    if (isNewLead && !/^\S+@\S+\.\S+$/.test(toEmail.trim())) return toast.error('Enter a valid email address')
    if (!from) return toast.error('Select a sender account')
    if (!isFollowUp && !subject.trim()) return toast.error('Subject is required')
    if (!body.trim()) return toast.error('Write the email or pick a template')

    setSending(true)
    try {
      let res: Response
      if (isFollowUp) {
        res = await fetch(`/api/followups/${taskId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        })
      } else {
        const plan = isFirstEmail
          ? followUps
              .map((row, i) => ({ row, i, t: followUpTemplate(row, i) }))
              .filter(({ row }) => row.enabled && row.templateId !== NONE)
              .map(({ row, i, t }) => ({ step: i + 1, delayDays: row.delayDays, body: t?.body }))
          : undefined

        res = await fetch('/api/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(isNewLead
              ? { newLead: { email: toEmail.trim(), firstName: toFirstName.trim() || undefined, companyName: toCompany.trim() || undefined, campaignId: campaignId || undefined } }
              : { leadId: lead.id }),
            senderAccountId: from,
            subject,
            body,
            type: isFirstEmail ? 'FIRST_EMAIL' : 'OTHER',
            followUps: plan,
          }),
        })
      }

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to send')

      const n = data.followUpsScheduled
      toast.success(n ? `Email sent · ${n} follow-up${n > 1 ? 's' : ''} scheduled` : 'Email sent')
      onSent?.(data.leadId || lead?.id)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  const previewSubject = renderTemplate(subject, vars)
  const previewBody = renderTemplate(body, vars)
  const displayName = lead ? (lead.fullName || [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.companyName) : ''
  const title = isFollowUp
    ? `Send ${templateType.replace(/_/g, ' ').replace('FOLLOW UP', 'Follow-up')}`
    : isNewLead ? 'New Email' : `Email ${displayName}`
  const hasFollowUpTemplates = templates.some(t => t.type.startsWith('FOLLOW_UP'))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-2xl w-full max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden"
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSend() }}
      >
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <Send className="h-4 w-4 text-indigo-600" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-slate-500 text-sm">
            {isFollowUp
              ? 'Sent as a reply in the same Gmail thread as your first email.'
              : isFirstEmail
                ? 'Send the first email and let follow-ups go out automatically.'
                : 'One-off email. Your follow-up schedule is not changed.'}
          </DialogDescription>
        </DialogHeader>

        {/* ── Scrollable body ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* To */}
          {isNewLead ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 sm:col-span-3">
                <Label className="text-xs font-medium text-slate-500">To</Label>
                <Input
                  autoFocus
                  type="email"
                  value={toEmail}
                  onChange={e => setToEmail(e.target.value)}
                  placeholder="name@company.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">First name</Label>
                <Input value={toFirstName} onChange={e => setToFirstName(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">Company</Label>
                <Input value={toCompany} onChange={e => setToCompany(e.target.value)} placeholder={guessCompanyFromEmail(toEmail) || 'Optional'} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-500">Campaign</Label>
                <Select value={campaignId || NONE} onValueChange={v => setCampaignId(v === NONE ? '' : v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No campaign</SelectItem>
                    {campaigns.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
              <span className="text-slate-500">To </span>
              <strong className="text-slate-800">{displayName}</strong>
              {lead.companyEmail
                ? <span className="font-mono text-xs text-slate-500"> &lt;{lead.companyEmail}&gt;</span>
                : <span className="text-red-500 font-medium"> — no email address on this lead</span>}
            </div>
          )}

          {/* From + Template */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500">From</Label>
              {connectedSenders.length === 0 ? (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  No Gmail connected. <Link href="/sender-accounts" className="underline font-medium">Connect one</Link>
                </p>
              ) : (
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select sender…" /></SelectTrigger>
                  <SelectContent>
                    {connectedSenders.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.displayName} &lt;{s.email}&gt;</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500">Template</Label>
              <Select
                value={templateId}
                onValueChange={id => { const t = templates.find(x => x.id === id); if (t) applyTemplate(t) }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={mainTemplates.length ? 'Choose a template…' : 'No templates yet'} />
                </SelectTrigger>
                <SelectContent>
                  {mainTemplates.length === 0 && <SelectItem value={NONE} disabled>No templates yet</SelectItem>}
                  {mainTemplates.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}{t.isDefault ? ' ★' : ''}{t.campaign ? ` (${t.campaign.name})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Subject */}
          {!isFollowUp && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-slate-500">Subject</Label>
                <button
                  type="button"
                  onClick={() => setPreview(p => !p)}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  {preview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {preview ? 'Back to edit' : 'Preview'}
                </button>
              </div>
              {preview ? (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-slate-800 min-h-[38px]">
                  {previewSubject || <span className="text-slate-400 italic font-normal">No subject</span>}
                </div>
              ) : (
                <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Quick question about {{companyName}}" className="text-sm" />
              )}
            </div>
          )}

          {/* Body */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-slate-500">Message</Label>
              {isFollowUp && (
                <button
                  type="button"
                  onClick={() => setPreview(p => !p)}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                >
                  {preview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {preview ? 'Back to edit' : 'Preview'}
                </button>
              )}
            </div>
            {preview ? (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm whitespace-pre-wrap min-h-[200px] text-slate-800 leading-relaxed">
                {previewBody || <span className="text-slate-400 italic">Empty</span>}
              </div>
            ) : (
              <textarea
                ref={bodyRef}
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={'Hi {{firstName}},\n\n…\n\nBest,\n{{senderFirstName}}'}
                rows={10}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
              />
            )}
            {!preview && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-xs text-slate-400 mr-1">Insert:</span>
                {TEMPLATE_VARS.map(v => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => insertVar(v.key)}
                    title={vars[v.key] ? `Will insert: ${vars[v.key]}` : 'No value yet — a sensible fallback is used'}
                    className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Follow-up plan */}
          {isFirstEmail && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                <Repeat className="h-4 w-4 text-indigo-600" />
                <p className="text-sm font-semibold text-slate-800 flex-1">Automatic follow-ups</p>
                <span className="text-xs text-slate-400">Stops when they reply</span>
              </div>
              <div className="divide-y divide-slate-100">
                {followUps.map((row, i) => {
                  const t = followUpTemplate(row, i)
                  const options = templates.filter(x => x.type === FOLLOW_UP_TYPES[i])
                  const missing = row.enabled && row.templateId !== NONE && !t
                  return (
                    <div key={i} className="px-4 py-3 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <label className="flex items-center gap-2 font-medium text-slate-700 w-28 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={e => updateRow(i, { enabled: e.target.checked })}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          Follow-up {i + 1}
                        </label>
                        <span className="text-slate-400">after</span>
                        <Input
                          type="number"
                          min={1}
                          max={60}
                          value={row.delayDays}
                          disabled={!row.enabled}
                          onChange={e => updateRow(i, { delayDays: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
                          className="h-8 w-16 text-sm"
                        />
                        <span className="text-slate-400">days</span>
                        <Select value={row.templateId} disabled={!row.enabled} onValueChange={v => updateRow(i, { templateId: v })}>
                          <SelectTrigger className="h-8 text-xs flex-1 min-w-[160px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={AUTO}>
                              {pickDefaultTemplate(templates, FOLLOW_UP_TYPES[i], campaignId)?.name
                                ? `Default: ${pickDefaultTemplate(templates, FOLLOW_UP_TYPES[i], campaignId)!.name}`
                                : 'Default template'}
                            </SelectItem>
                            {options.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                            <SelectItem value={NONE}>Don&apos;t send</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {row.enabled && t && (
                        <p className="text-xs text-slate-400 line-clamp-1 pl-6">{renderTemplate(t.body, vars)}</p>
                      )}
                      {missing && (
                        <p className="text-xs text-amber-600 pl-6">
                          No follow-up {i + 1} template. <Link href="/templates" className="underline">Create one</Link> before it&apos;s due, or it will be skipped.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="flex items-start gap-1.5 px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
                <Info className="h-3.5 w-3.5 mt-px shrink-0" />
                Sent as replies in the same thread, on weekdays. {!hasFollowUpTemplates && 'Tip: add Follow-up 1–3 templates once and they are used automatically.'}
              </p>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-400 hidden sm:inline">Ctrl + Enter to send</span>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleSend}
              loading={sending}
              disabled={(!isNewLead && !lead.companyEmail) || connectedSenders.length === 0}
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
