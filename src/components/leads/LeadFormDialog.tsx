'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { ChevronDown, Send } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { guessCompanyFromEmail } from '@/lib/template'
import type { ComposeLead } from '@/components/email/ComposeEmailDialog'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Props {
  open: boolean
  onClose: () => void
  /** thenEmail = user clicked "Save & Email" */
  onSaved: (lead?: ComposeLead, thenEmail?: boolean) => void
  initialData?: Record<string, string>
}

export default function LeadFormDialog({ open, onClose, onSaved, initialData }: Props) {
  const { data: campaigns } = useSWR('/api/campaigns', fetcher)
  const { data: senders } = useSWR('/api/sender-accounts', fetcher)

  const [form, setForm] = useState({
    companyEmail: initialData?.companyEmail || '',
    firstName: initialData?.firstName || '',
    lastName: initialData?.lastName || '',
    companyName: initialData?.companyName || '',
    campaignId: initialData?.campaignId || '',
    jobTitle: initialData?.jobTitle || '',
    website: initialData?.website || '',
    phone: initialData?.phone || '',
    linkedIn: initialData?.linkedIn || '',
    country: initialData?.country || '',
    state: initialData?.state || '',
    city: initialData?.city || '',
    industry: initialData?.industry || '',
    companySize: initialData?.companySize || '',
    senderAccountId: initialData?.senderAccountId || '',
    priority: initialData?.priority || 'MEDIUM',
    personalizationNotes: initialData?.personalizationNotes || '',
    notes: initialData?.notes || '',
  })
  const [saving, setSaving] = useState<false | 'save' | 'email'>(false)
  const [showMore, setShowMore] = useState(false)

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const companyGuess = guessCompanyFromEmail(form.companyEmail)

  async function handleSave(thenEmail: boolean) {
    const companyName = form.companyName.trim() || companyGuess
    if (!companyName && !form.companyEmail.trim()) return toast.error('Add an email or a company name')
    if (thenEmail && !form.companyEmail.trim()) return toast.error('Add an email address to send an email')
    setSaving(thenEmail ? 'email' : 'save')
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          companyName: companyName || form.companyEmail.split('@')[1],
          fullName: [form.firstName, form.lastName].filter(Boolean).join(' ') || undefined,
          campaignId: form.campaignId || undefined,
          senderAccountId: form.senderAccountId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409) return toast.error('A lead with this email already exists')
        return toast.error(data.error || 'Failed to create lead')
      }
      toast.success('Lead added')
      onSaved(data, thenEmail)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Lead</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Email</Label>
            <Input autoFocus type="email" value={form.companyEmail} onChange={(e) => set('companyEmail', e.target.value)} placeholder="name@company.com" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First Name</Label>
              <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="John" className="mt-1" />
            </div>
            <div>
              <Label>Last Name</Label>
              <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="Smith" className="mt-1" />
            </div>
            <div>
              <Label>Company</Label>
              <Input value={form.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder={companyGuess || 'ABC Dental'} className="mt-1" />
            </div>
            <div>
              <Label>Campaign</Label>
              <Select value={form.campaignId || 'NONE'} onValueChange={(v) => set('campaignId', v === 'NONE' ? '' : v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No campaign</SelectItem>
                  {(Array.isArray(campaigns) ? campaigns : []).map((c: { id: string; name: string }) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? 'rotate-180' : ''}`} />
            {showMore ? 'Fewer details' : 'More details'}
          </button>

          {showMore && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <Label>Job Title</Label>
                <Input value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} placeholder="Owner" className="mt-1" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+1 555 000 0000" className="mt-1" />
              </div>
              <div>
                <Label>Website</Label>
                <Input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="company.com" className="mt-1" />
              </div>
              <div>
                <Label>Industry</Label>
                <Input value={form.industry} onChange={(e) => set('industry', e.target.value)} placeholder="Dental" className="mt-1" />
              </div>
              <div>
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => set('city', e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Country</Label>
                <Input value={form.country} onChange={(e) => set('country', e.target.value)} placeholder="USA" className="mt-1" />
              </div>
              <div>
                <Label>Sender Account</Label>
                <Select value={form.senderAccountId || 'NONE'} onValueChange={(v) => set('senderAccountId', v === 'NONE' ? '' : v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Pick when sending</SelectItem>
                    {(Array.isArray(senders) ? senders : []).map((s: { id: string; displayName: string; email: string }) => (
                      <SelectItem key={s.id} value={s.id}>{s.displayName} ({s.email})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => set('priority', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Personalization Notes</Label>
                <Textarea value={form.personalizationNotes} onChange={(e) => set('personalizationNotes', e.target.value)} placeholder="Anything to mention in the email…" className="mt-1" rows={2} />
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} className="mt-1" rows={2} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={() => handleSave(false)} loading={saving === 'save'} disabled={!!saving}>Save</Button>
          <Button onClick={() => handleSave(true)} loading={saving === 'email'} disabled={!!saving}>
            <Send className="h-4 w-4" />Save &amp; Email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
