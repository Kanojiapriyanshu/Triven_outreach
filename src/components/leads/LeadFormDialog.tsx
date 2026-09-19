'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
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

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
  initialData?: Record<string, string>
}

export default function LeadFormDialog({ open, onClose, onSaved, initialData }: Props) {
  const { data: campaigns } = useSWR('/api/campaigns', fetcher)
  const { data: senders } = useSWR('/api/sender-accounts', fetcher)

  const [form, setForm] = useState({
    firstName: initialData?.firstName || '',
    lastName: initialData?.lastName || '',
    jobTitle: initialData?.jobTitle || '',
    companyName: initialData?.companyName || '',
    companyEmail: initialData?.companyEmail || '',
    website: initialData?.website || '',
    phone: initialData?.phone || '',
    linkedIn: initialData?.linkedIn || '',
    country: initialData?.country || '',
    state: initialData?.state || '',
    city: initialData?.city || '',
    industry: initialData?.industry || '',
    companySize: initialData?.companySize || '',
    campaignId: initialData?.campaignId || '',
    senderAccountId: initialData?.senderAccountId || '',
    priority: initialData?.priority || 'MEDIUM',
    status: initialData?.status || 'NEW',
    personalizationNotes: initialData?.personalizationNotes || '',
    companyPainPoint: initialData?.companyPainPoint || '',
    whyThisLead: initialData?.whyThisLead || '',
    notes: initialData?.notes || '',
    firstEmailSubject: initialData?.firstEmailSubject || '',
    firstEmailBody: initialData?.firstEmailBody || '',
  })
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'contact' | 'research' | 'outreach'>('contact')

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave() {
    if (!form.companyName.trim()) return toast.error('Company name is required')
    setSaving(true)
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
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
      toast.success('Lead created')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const tabCls = (t: string) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add New Lead</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 -mx-6 px-6">
          <button className={tabCls('contact')} onClick={() => setTab('contact')}>Contact</button>
          <button className={tabCls('research')} onClick={() => setTab('research')}>Research</button>
          <button className={tabCls('outreach')} onClick={() => setTab('outreach')}>Outreach</button>
        </div>

        <div className="space-y-4 py-2">
          {tab === 'contact' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>First Name</Label>
                <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="John" className="mt-1" />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="Smith" className="mt-1" />
              </div>
              <div>
                <Label>Job Title</Label>
                <Input value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} placeholder="Owner / Manager" className="mt-1" />
              </div>
              <div>
                <Label>Company Name <span className="text-red-500">*</span></Label>
                <Input value={form.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="ABC Corp" className="mt-1" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.companyEmail} onChange={(e) => set('companyEmail', e.target.value)} placeholder="contact@company.com" className="mt-1" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+1 555 000 0000" className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label>Website</Label>
                <Input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://company.com" className="mt-1" />
              </div>
              <div>
                <Label>Industry</Label>
                <Input value={form.industry} onChange={(e) => set('industry', e.target.value)} placeholder="Dental / SaaS / HVAC…" className="mt-1" />
              </div>
              <div>
                <Label>Company Size</Label>
                <Input value={form.companySize} onChange={(e) => set('companySize', e.target.value)} placeholder="1-10 / 11-50…" className="mt-1" />
              </div>
              <div>
                <Label>Country</Label>
                <Input value={form.country} onChange={(e) => set('country', e.target.value)} placeholder="USA" className="mt-1" />
              </div>
              <div>
                <Label>State</Label>
                <Input value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="Texas" className="mt-1" />
              </div>
              <div>
                <Label>Campaign</Label>
                <Select value={form.campaignId} onValueChange={(v) => set('campaignId', v === 'NONE' ? '' : v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select campaign" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No campaign</SelectItem>
                    {(campaigns || []).map((c: { id: string; name: string }) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sender Account</Label>
                <Select value={form.senderAccountId} onValueChange={(v) => set('senderAccountId', v === 'NONE' ? '' : v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Assign sender" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No sender</SelectItem>
                    {(senders || []).map((s: { id: string; displayName: string; email: string }) => (
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
                    {['LOW','MEDIUM','HIGH','URGENT'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {tab === 'research' && (
            <div className="space-y-4">
              <div>
                <Label>Why This Lead</Label>
                <Textarea value={form.whyThisLead} onChange={(e) => set('whyThisLead', e.target.value)} placeholder="Why are we reaching out to this company?" className="mt-1" rows={3} />
              </div>
              <div>
                <Label>Company Pain Point</Label>
                <Textarea value={form.companyPainPoint} onChange={(e) => set('companyPainPoint', e.target.value)} placeholder="What problem can we solve for them?" className="mt-1" rows={3} />
              </div>
              <div>
                <Label>Personalization Notes</Label>
                <Textarea value={form.personalizationNotes} onChange={(e) => set('personalizationNotes', e.target.value)} placeholder="Specific details to personalize the email…" className="mt-1" rows={3} />
              </div>
              <div>
                <Label>General Notes</Label>
                <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Any other notes…" className="mt-1" rows={3} />
              </div>
            </div>
          )}

          {tab === 'outreach' && (
            <div className="space-y-4">
              <div>
                <Label>First Email Subject</Label>
                <Input value={form.firstEmailSubject} onChange={(e) => set('firstEmailSubject', e.target.value)} placeholder="Subject line…" className="mt-1" />
              </div>
              <div>
                <Label>First Email Body</Label>
                <Textarea value={form.firstEmailBody} onChange={(e) => set('firstEmailBody', e.target.value)} placeholder="Personalized email body…" className="mt-1" rows={8} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Save Lead</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
