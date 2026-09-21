'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Plus, FileText, Trash2, Pencil, Star, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { TEMPLATE_VARS } from '@/lib/template'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Template {
  id: string; name: string; subject: string; body: string; type: string
  campaignId?: string | null; isDefault: boolean; createdAt: string
  campaign?: { id: string; name: string } | null
}

const TEMPLATE_TYPES = ['FIRST_EMAIL', 'FOLLOW_UP_1', 'FOLLOW_UP_2', 'FOLLOW_UP_3', 'OTHER']
const TYPE_LABELS: Record<string, string> = {
  FIRST_EMAIL: 'First Email',
  FOLLOW_UP_1: 'Follow-up 1',
  FOLLOW_UP_2: 'Follow-up 2',
  FOLLOW_UP_3: 'Follow-up 3',
  OTHER: 'Other',
}

const EMPTY_FORM = { name: '', subject: '', body: '', type: 'FIRST_EMAIL', campaignId: '', isDefault: true }

const STARTER_TEMPLATES = [
  {
    name: 'Intro', type: 'FIRST_EMAIL', isDefault: true,
    subject: 'Quick question about {{companyName}}',
    body: `Hi {{firstName}},

I came across {{companyName}} and had a quick question: what happens to the calls and leads that come in after hours?

We help teams like yours respond to every lead within minutes, day or night, without adding headcount.

Would it be worth a 15-minute call to see if it fits?

Best,
{{senderFirstName}}`,
  },
  {
    name: 'Gentle bump', type: 'FOLLOW_UP_1', isDefault: true, subject: '',
    body: `Hi {{firstName}},

Just bumping this to the top of your inbox in case it got buried. Would a quick call this week make sense?

{{senderFirstName}}`,
  },
  {
    name: 'Value add', type: 'FOLLOW_UP_2', isDefault: true, subject: '',
    body: `Hi {{firstName}},

One number that usually surprises people: most leads go with whoever replies first. If {{companyName}} is missing even a few after-hours enquiries a week, that adds up fast.

Happy to show you how we fix that. Open to a short call?

{{senderFirstName}}`,
  },
  {
    name: 'Break-up', type: 'FOLLOW_UP_3', isDefault: true, subject: '',
    body: `Hi {{firstName}},

I don't want to keep filling your inbox, so this will be my last note. If improving lead response at {{companyName}} becomes a priority, just reply and I'll send over the details.

All the best,
{{senderFirstName}}`,
  },
]

export default function TemplatesPage() {
  const { data, mutate } = useSWR<Template[]>('/api/templates', fetcher)
  const { data: campaigns } = useSWR('/api/campaigns', fetcher)
  const templates = Array.isArray(data) ? data : []

  const [showForm, setShowForm] = useState(false)
  const [editTemplate, setEditTemplate] = useState<Template | null>(null)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const isFollowUp = form.type.startsWith('FOLLOW_UP')

  function setF(k: string, v: unknown) { setForm((p) => ({ ...p, [k]: v })) }

  function closeForm() {
    setShowForm(false)
    setEditTemplate(null)
    setForm(EMPTY_FORM)
  }

  function openNew(type = 'FIRST_EMAIL') {
    setEditTemplate(null)
    setForm({ ...EMPTY_FORM, type, isDefault: !templates.some((t) => t.type === type) })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('Give the template a name')
    if (!isFollowUp && !form.subject.trim()) return toast.error('Subject is required')
    if (!form.body.trim()) return toast.error('Write the email body')
    setSaving(true)
    try {
      const res = await fetch(editTemplate ? `/api/templates/${editTemplate.id}` : '/api/templates', {
        method: editTemplate ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, subject: isFollowUp ? '' : form.subject, campaignId: form.campaignId || null }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Could not save template')
      toast.success(editTemplate ? 'Template updated' : 'Template created')
      closeForm()
      mutate()
    } finally { setSaving(false) }
  }

  async function makeDefault(t: Template) {
    await fetch(`/api/templates/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: t.name, subject: t.subject, body: t.body, type: t.type, campaignId: t.campaignId || null, isDefault: true }),
    })
    toast.success(`"${t.name}" is now the default ${TYPE_LABELS[t.type] || t.type}`)
    mutate()
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template?')) return
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    toast.success('Deleted')
    mutate()
  }

  async function addStarterTemplates() {
    setSeeding(true)
    try {
      for (const t of STARTER_TEMPLATES) {
        await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(t),
        })
      }
      toast.success('Starter sequence added. Edit it to match your voice.')
      mutate()
    } finally { setSeeding(false) }
  }

  function openEdit(t: Template) {
    setEditTemplate(t)
    setForm({ name: t.name, subject: t.subject, body: t.body, type: t.type, campaignId: t.campaignId || '', isDefault: t.isDefault })
    setShowForm(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Email Templates</h1>
          <p className="text-sm text-slate-500">The ★ default of each step is used automatically when you send and for follow-ups.</p>
        </div>
        <Button size="sm" onClick={() => openNew()}>
          <Plus className="h-4 w-4" />New Template
        </Button>
      </div>

      {data && templates.length === 0 && (
        <Card>
          <CardContent className="py-14 flex flex-col items-center text-center">
            <FileText className="h-12 w-12 text-slate-300 mb-3" />
            <h3 className="text-lg font-semibold text-slate-700">No templates yet</h3>
            <p className="text-sm text-slate-400 mt-1 max-w-md">
              Add a first email and three follow-ups once. After that, every email you send uses them automatically.
            </p>
            <div className="flex gap-2 mt-5">
              <Button size="sm" onClick={addStarterTemplates} loading={seeding}>
                <Sparkles className="h-4 w-4" />Add starter sequence
              </Button>
              <Button size="sm" variant="outline" onClick={() => openNew()}><Plus className="h-4 w-4" />Start from scratch</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {templates.length > 0 && TEMPLATE_TYPES.map((type) => {
        const list = templates.filter((t) => t.type === type)
        if (type === 'OTHER' && list.length === 0) return null
        return (
          <div key={type}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
                {TYPE_LABELS[type]}
                {type.startsWith('FOLLOW_UP') && <span className="ml-2 normal-case font-normal text-slate-400 tracking-normal">sent as a reply in the same thread</span>}
              </h2>
              <button onClick={() => openNew(type)} className="text-xs text-indigo-600 hover:underline">+ Add</button>
            </div>
            {list.length === 0 ? (
              <button
                onClick={() => openNew(type)}
                className="w-full rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm text-amber-700 hover:bg-amber-100"
              >
                No {TYPE_LABELS[type].toLowerCase()} template yet. Emails at this step will be skipped. Click to add one.
              </button>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {list.map((t) => (
                  <Card key={t.id} className={t.isDefault ? 'ring-1 ring-indigo-200' : ''}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CardTitle className="text-sm">{t.name}</CardTitle>
                          {t.isDefault && <Badge className="text-xs"><Star className="h-3 w-3 mr-0.5 fill-current" />Default</Badge>}
                          {t.campaign && <Badge variant="secondary" className="text-xs">{t.campaign.name}</Badge>}
                        </div>
                        <div className="flex gap-1">
                          {!t.isDefault && (
                            <button onClick={() => makeDefault(t)} title="Make default" className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-amber-500">
                              <Star className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button onClick={() => openEdit(t)} title="Edit" className="p-1.5 rounded hover:bg-slate-100 text-slate-400">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => deleteTemplate(t.id)} title="Delete" className="p-1.5 rounded hover:bg-red-50 hover:text-red-500 text-slate-400">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 cursor-pointer" onClick={() => openEdit(t)}>
                      {t.subject && <p className="text-sm font-medium text-slate-700">{t.subject}</p>}
                      <p className="text-xs text-slate-400 mt-1 line-clamp-3 whitespace-pre-line">{t.body}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <Dialog open={showForm} onOpenChange={closeForm}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editTemplate ? 'Edit Template' : 'New Template'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setF('name', e.target.value)} placeholder="Dental intro" className="mt-1" />
              </div>
              <div>
                <Label>Used for</Label>
                <Select value={form.type} onValueChange={(v) => setF('type', v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Campaign</Label>
                <Select value={form.campaignId || 'NONE'} onValueChange={(v) => setF('campaignId', v === 'NONE' ? '' : v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">All campaigns</SelectItem>
                    {(Array.isArray(campaigns) ? campaigns : []).map((c: { id: string; name: string }) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setF('isDefault', e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 mb-0.5"
                />
                Use as default for {TYPE_LABELS[form.type]}
              </label>
            </div>
            {isFollowUp ? (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Follow-ups are sent as a reply to your first email (&ldquo;Re: …&rdquo;), so no subject is needed.
              </p>
            ) : (
              <div>
                <Label>Subject</Label>
                <Input value={form.subject} onChange={(e) => setF('subject', e.target.value)} placeholder="Quick question about {{companyName}}" className="mt-1" />
              </div>
            )}
            <div>
              <Label>Body</Label>
              <Textarea value={form.body} onChange={(e) => setF('body', e.target.value)} placeholder={'Hi {{firstName}},\n\n…'} className="mt-1" rows={10} />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {TEMPLATE_VARS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setF('body', `${form.body}{{${v.key}}}`)}
                    className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                  >
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                Empty values fall back gracefully (&ldquo;Hi there&rdquo;). Custom fallback: {'{{firstName|friend}}'}.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>{editTemplate ? 'Save Changes' : 'Create Template'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
