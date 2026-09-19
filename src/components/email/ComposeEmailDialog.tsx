'use client'
import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Send, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ─── Personalization variables ───────────────────────────────────────────────
const VARS = [
  { label: 'First Name',   key: 'firstName' },
  { label: 'Last Name',    key: 'lastName' },
  { label: 'Company',      key: 'companyName' },
  { label: 'Job Title',    key: 'jobTitle' },
  { label: 'City',         key: 'city' },
  { label: 'Industry',     key: 'industry' },
  { label: 'Sender Name',  key: 'senderName' },
  { label: 'Sender Email', key: 'senderEmail' },
]

function applyVars(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

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
}

interface Props {
  open: boolean
  onClose: () => void
  lead: ComposeLead
  /** If provided, PATCH /api/followups/:taskId with subject/body overrides */
  taskId?: string
  defaultSubject?: string
  defaultBody?: string
  /** Filters the template dropdown */
  templateType?: string
  onSent?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ComposeEmailDialog({
  open, onClose, lead, taskId,
  defaultSubject = '', defaultBody = '',
  templateType, onSent,
}: Props) {
  const [from, setFrom]       = useState(lead.senderAccountId || '')
  const [subject, setSubject] = useState(defaultSubject)
  const [body, setBody]       = useState(defaultBody)
  const [preview, setPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const { data: senders }   = useSWR('/api/sender-accounts', fetcher)
  const { data: templates } = useSWR(
    `/api/templates${templateType ? `?type=${templateType}` : ''}`,
    fetcher,
  )

  // Reset content when dialog opens
  useEffect(() => {
    if (open) {
      setSubject(defaultSubject)
      setBody(defaultBody)
      setPreview(false)
    }
  }, [open, defaultSubject, defaultBody])

  // Pick a default sender
  useEffect(() => {
    if (lead.senderAccountId) { setFrom(lead.senderAccountId); return }
    if (senders?.length) {
      const connected = (senders as Array<{ id: string; gmailStatus: string }>)
        .find(s => s.gmailStatus === 'CONNECTED')
      if (connected) setFrom(connected.id)
    }
  }, [lead.senderAccountId, senders])

  const sender = (senders as Array<{ id: string; displayName: string; email: string; gmailStatus: string }> | undefined)
    ?.find(s => s.id === from)

  const vars: Record<string, string> = {
    firstName:   lead.firstName  || lead.fullName?.split(' ')[0]              || '',
    lastName:    lead.lastName   || lead.fullName?.split(' ').slice(1).join(' ') || '',
    companyName: lead.companyName || '',
    jobTitle:    lead.jobTitle   || '',
    city:        lead.city       || '',
    industry:    lead.industry   || '',
    senderName:  sender?.displayName || '',
    senderEmail: sender?.email       || '',
  }

  // Load a template into the editor
  function loadTemplate(id: string) {
    const t = (templates as Array<{ id: string; name: string; subject: string; body: string }> | undefined)
      ?.find(x => x.id === id)
    if (!t) return
    setSubject(t.subject)
    setBody(t.body)
    toast.success(`Loaded "${t.name}"`)
  }

  // Insert variable at cursor position in the body textarea
  function insertVar(key: string) {
    const snippet = `{{${key}}}`
    const ta = bodyRef.current
    if (!ta) { setBody(p => p + snippet); return }
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    setBody(body.slice(0, start) + snippet + body.slice(end))
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + snippet.length
      ta.focus()
    }, 0)
  }

  async function handleSend() {
    if (!from)                return toast.error('Select a sender account')
    if (!lead.companyEmail)   return toast.error('This lead has no email address')
    if (!subject.trim())      return toast.error('Subject is required')
    if (!body.trim())         return toast.error('Body is required')

    setSending(true)
    try {
      const finalSubject = applyVars(subject, vars)
      const finalBody    = applyVars(body, vars)

      const res = taskId
        ? await fetch(`/api/followups/${taskId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: finalSubject, body: finalBody }),
          })
        : await fetch('/api/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              leadId: lead.id,
              senderAccountId: from,
              to: lead.companyEmail,
              subject: finalSubject,
              body: finalBody,
              emailType: templateType || 'FIRST_EMAIL',
            }),
          })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to send')
      }

      toast.success('✉️ Email sent!')
      onSent?.()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  const connectedSenders = (senders as Array<{ id: string; gmailStatus: string; displayName: string; email: string }> | undefined)
    ?.filter(s => s.gmailStatus === 'CONNECTED') ?? []

  const previewSubject = applyVars(subject, vars)
  const previewBody    = applyVars(body, vars)

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl w-full max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-slate-900">
            <Send className="h-4 w-4 text-indigo-600" />
            {taskId ? 'Send Follow-up' : 'Compose Email'}
          </DialogTitle>
          <DialogDescription className="text-slate-500 text-sm">
            To: <strong className="text-slate-700">{lead.fullName || lead.companyName}</strong>
            {lead.companyEmail && (
              <> · <span className="font-mono text-xs text-slate-500">{lead.companyEmail}</span></>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* ── Scrollable body ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* From + Template row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500">From</Label>
              {connectedSenders.length === 0 ? (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  No Gmail accounts connected — go to Sender Accounts to connect one.
                </p>
              ) : (
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select sender…" />
                  </SelectTrigger>
                  <SelectContent>
                    {connectedSenders.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.displayName} &lt;{s.email}&gt;
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-500">Load template</Label>
              <Select onValueChange={loadTemplate}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Choose a template…" />
                </SelectTrigger>
                <SelectContent>
                  {(templates as Array<{ id: string; name: string; campaign?: { name: string } | null }> | undefined)
                    ?.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.campaign && (
                          <span className="text-slate-400 ml-1 text-xs">({t.campaign.name})</span>
                        )}
                      </SelectItem>
                    )) ?? (
                    <SelectItem value="__none" disabled>No templates yet</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Personalization variable chips */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-slate-500">Insert personalization</Label>
            <div className="flex flex-wrap gap-1.5">
              {VARS.map(v => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insertVar(v.key)}
                  title={vars[v.key] ? `Will insert: ${vars[v.key]}` : '(no value for this lead)'}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 active:bg-indigo-200 transition-colors"
                >
                  {`{{${v.key}}}`}
                  {vars[v.key] && (
                    <span className="font-sans text-indigo-400 not-italic">
                      → {vars[v.key].length > 14 ? vars[v.key].slice(0, 14) + '…' : vars[v.key]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Subject line */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-slate-500">Subject</Label>
              <button
                type="button"
                onClick={() => setPreview(p => !p)}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                {preview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {preview ? 'Back to edit' : 'Preview with values'}
              </button>
            </div>

            {preview ? (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-slate-800 min-h-[38px]">
                {previewSubject || <span className="text-slate-400 italic font-normal">No subject</span>}
              </div>
            ) : (
              <Input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Subject — use {{firstName}}, {{companyName}}, etc."
                className="text-sm"
              />
            )}
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-500">Body</Label>

            {preview ? (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm whitespace-pre-wrap min-h-[200px] text-slate-800 leading-relaxed">
                {previewBody || <span className="text-slate-400 italic">No body</span>}
              </div>
            ) : (
              <textarea
                ref={bodyRef}
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder={`Hi {{firstName}},\n\nI came across ${lead.companyName} and wanted to reach out…\n\nBest,\n{{senderName}}`}
                rows={11}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
              />
            )}
          </div>

          {/* Reset to original template */}
          {taskId && (defaultSubject || defaultBody) && !preview && (
            <button
              type="button"
              onClick={() => { setSubject(defaultSubject); setBody(defaultBody) }}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              <RotateCcw className="h-3 w-3" /> Reset to original template
            </button>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-400">
            {lead.companyEmail
              ? <>Sending to <strong className="text-slate-700 font-mono">{lead.companyEmail}</strong></>
              : <span className="text-red-500 font-medium">⚠ No email address on this lead</span>
            }
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleSend}
              loading={sending}
              disabled={!lead.companyEmail || connectedSenders.length === 0}
            >
              <Send className="h-3.5 w-3.5" />
              Send Email
            </Button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  )
}
