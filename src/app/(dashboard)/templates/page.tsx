'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Plus, Trash2, Pencil, Star, Sparkles, Layers, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { TEMPLATE_VARS, renderTemplate, buildTemplateVars } from '@/lib/template'
import { SEQUENCE_LIBRARY } from '@/lib/sequence-library'
import { SAMPLE_AUDIENCE_LEAD } from '@/lib/audience/sequences'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Template {
  id: string; name: string; subject: string; body: string; type: string
  campaignId?: string | null; isDefault: boolean; createdAt: string
  campaign?: { id: string; name: string } | null
}
interface Campaign { id: string; name: string; industry: string }

const STEPS = [
  { type: 'FIRST_EMAIL', label: 'First email', hint: 'Sent when you start outreach' },
  { type: 'FOLLOW_UP_1', label: 'Follow-up 1', hint: 'Reply in the same thread' },
  { type: 'FOLLOW_UP_2', label: 'Follow-up 2', hint: 'Reply in the same thread' },
  { type: 'FOLLOW_UP_3', label: 'Follow-up 3', hint: 'Last touch, closes the loop' },
  { type: 'OTHER', label: 'Other', hint: 'One-off emails' },
]
const STEP_LABEL = Object.fromEntries(STEPS.map((s) => [s.type, s.label]))

const GENERAL = '__general'
const SAMPLE_LEAD = { firstName: 'Sarah', companyName: 'Bright Smile Dental', city: 'Austin', industry: 'Dental' }

export default function TemplatesPage() {
  const { data, mutate } = useSWR<Template[]>('/api/templates', fetcher)
  const { data: campaignsData, mutate: mutateCampaigns } = useSWR<Campaign[]>('/api/campaigns', fetcher)
  const { data: settingsData } = useSWR<{ demoPhone?: string; builderUrl?: string; senderAddress?: string }>('/api/settings', fetcher)
  const templates = Array.isArray(data) ? data : []
  const campaigns = Array.isArray(campaignsData) ? campaignsData : []

  const [niche, setNiche] = useState(GENERAL)
  const nicheId = niche === GENERAL ? null : niche
  const nicheName = niche === GENERAL ? 'General' : campaigns.find((c) => c.id === niche)?.name || 'Niche'
  const inNiche = templates.filter((t) => (t.campaignId || null) === nicheId)

  // Editor
  const [editing, setEditing] = useState<Template | null>(null)
  const [form, setForm] = useState({ name: '', subject: '', body: '', type: 'FIRST_EMAIL', isDefault: true })
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  const isFollowUp = form.type.startsWith('FOLLOW_UP')

  // Library + new niche
  const [showLibrary, setShowLibrary] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [showNewNiche, setShowNewNiche] = useState(false)
  const [newNiche, setNewNiche] = useState({ name: '', industry: '' })

  function openNew(type: string) {
    setEditing(null)
    setForm({ name: '', subject: '', body: '', type, isDefault: !inNiche.some((t) => t.type === type) })
    setPreview(false)
    setShowForm(true)
  }

  function openEdit(t: Template) {
    setEditing(t)
    setForm({ name: t.name, subject: t.subject, body: t.body, type: t.type, isDefault: t.isDefault })
    setPreview(false)
    setShowForm(true)
  }

  async function save(payload: Record<string, unknown>, id?: string) {
    const res = await fetch(id ? `/api/templates/${id}` : '/api/templates', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(d.error || 'Could not save template')
    return d
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('Give the template a name')
    if (!isFollowUp && !form.subject.trim()) return toast.error('Subject is required')
    if (!form.body.trim()) return toast.error('Write the email body')
    setSaving(true)
    try {
      await save({ ...form, subject: isFollowUp ? '' : form.subject, campaignId: editing ? editing.campaignId || null : nicheId }, editing?.id)
      toast.success(editing ? 'Template updated' : 'Template created')
      setShowForm(false)
      mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save template')
    } finally { setSaving(false) }
  }

  async function makeDefault(t: Template) {
    await save({ name: t.name, subject: t.subject, body: t.body, type: t.type, campaignId: t.campaignId || null, isDefault: true }, t.id)
    toast.success(`"${t.name}" is now the default ${STEP_LABEL[t.type]}`)
    mutate()
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template?')) return
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    toast.success('Deleted')
    mutate()
  }

  async function installSequence(seqId: string) {
    const seq = SEQUENCE_LIBRARY.find((s) => s.id === seqId)
    if (!seq) return
    setInstalling(seqId)
    try {
      for (const step of seq.steps) {
        await save({ ...step, campaignId: nicheId, isDefault: true })
      }
      toast.success(`${seq.niche} sequence added to ${nicheName} and set as default`)
      setShowLibrary(false)
      mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add sequence')
    } finally { setInstalling(null) }
  }

  async function createNiche() {
    if (!newNiche.name.trim()) return toast.error('Name the niche')
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newNiche.name.trim(), industry: newNiche.industry.trim() || newNiche.name.trim(), followUpDay1: 3, followUpDay2: 7, followUpDay3: 14 }),
    })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(d.error || 'Could not create niche')
    toast.success(`Niche "${d.name}" created`)
    setShowNewNiche(false)
    setNewNiche({ name: '', industry: '' })
    await mutateCampaigns()
    setNiche(d.id)
  }

  const extras = { demoPhone: settingsData?.demoPhone || '(555) 010-2030', builderUrl: settingsData?.builderUrl, senderAddress: settingsData?.senderAddress }
  const localVars = buildTemplateVars(SAMPLE_LEAD, { displayName: 'Priyanshu' }, extras)
  // AI Builder templates talk about a YouTube comment: preview them with a YouTube prospect
  const audienceSample = buildTemplateVars(SAMPLE_AUDIENCE_LEAD, { displayName: 'Priyanshu' }, extras)
  const varsFor = (body: string) => (/commentHook|commentTopic|useCase|sourceVideo/.test(body) || nicheName.startsWith('AI Builder') ? audienceSample : localVars)
  const hasSequence = STEPS.slice(0, 4).every((s) => inNiche.some((t) => t.type === s.type))

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Email Templates</h1>
          <p className="text-sm text-slate-500">
            Each niche has its own sequence. Leads in a campaign use that niche&apos;s ★ defaults, and anything missing falls back to General.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowLibrary(true)}>
            <Sparkles className="h-4 w-4" />Sequence library
          </Button>
          <Button size="sm" onClick={() => openNew('FIRST_EMAIL')}>
            <Plus className="h-4 w-4" />New Template
          </Button>
        </div>
      </div>

      {/* Niche switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="h-4 w-4 text-slate-400" />
        {[{ id: GENERAL, name: 'General' }, ...campaigns].map((c) => {
          const count = templates.filter((t) => (t.campaignId || null) === (c.id === GENERAL ? null : c.id)).length
          return (
            <button
              key={c.id}
              onClick={() => setNiche(c.id)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                niche === c.id
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'
              }`}
            >
              {c.name}<span className={`ml-1.5 text-xs ${niche === c.id ? 'text-indigo-200' : 'text-slate-400'}`}>{count}</span>
            </button>
          )
        })}
        <button onClick={() => setShowNewNiche(true)} className="px-3 py-1.5 rounded-full text-sm border border-dashed border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600">
          + New niche
        </button>
      </div>

      {data && !hasSequence && (
        <Card className="border-indigo-200 bg-indigo-50/50">
          <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-indigo-900">
              {inNiche.length === 0
                ? <><strong>{nicheName}</strong> has no templates yet{nicheId ? ', so its leads use General' : ''}. Start from a proven sequence and edit it to your voice.</>
                : <><strong>{nicheName}</strong> is missing some steps. Missing steps fall back to General, or are skipped.</>}
            </p>
            <Button size="sm" onClick={() => setShowLibrary(true)}><Sparkles className="h-4 w-4" />Add a ready-made sequence</Button>
          </CardContent>
        </Card>
      )}

      {/* Sequence steps */}
      <div className="space-y-5">
        {STEPS.map((step, idx) => {
          const list = inNiche.filter((t) => t.type === step.type)
          if (step.type === 'OTHER' && list.length === 0) return null
          return (
            <div key={step.type}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {idx < 4 && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">{idx + 1}</span>}
                  <h2 className="text-sm font-semibold text-slate-700">{step.label}</h2>
                  <span className="text-xs text-slate-400">{step.hint}</span>
                </div>
                <button onClick={() => openNew(step.type)} className="text-xs text-indigo-600 hover:underline">+ Add</button>
              </div>
              {list.length === 0 ? (
                <button
                  onClick={() => openNew(step.type)}
                  className="w-full rounded-xl border border-dashed border-slate-300 px-4 py-3 text-left text-sm text-slate-400 hover:border-indigo-300 hover:text-indigo-600"
                >
                  {nicheId ? `Uses the General ${step.label.toLowerCase()}. Click to write one for ${nicheName}.` : `No ${step.label.toLowerCase()} yet. Click to add one.`}
                </button>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {list.map((t) => (
                    <Card key={t.id} className={`group ${t.isDefault ? 'ring-1 ring-indigo-300' : ''}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                            {t.isDefault && <Badge className="text-xs"><Star className="h-3 w-3 mr-0.5 fill-current" />Default</Badge>}
                          </div>
                          <div className="flex gap-0.5 shrink-0">
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
                        <button onClick={() => openEdit(t)} className="block text-left w-full mt-2">
                          {t.subject && <p className="text-sm text-slate-700"><span className="text-slate-400">Subject:</span> {t.subject}</p>}
                          <p className="text-xs text-slate-500 mt-1 line-clamp-4 whitespace-pre-line">{t.body}</p>
                        </button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Editor */}
      <Dialog open={showForm} onOpenChange={() => setShowForm(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Template' : `New ${STEP_LABEL[form.type]}`}</DialogTitle>
            <DialogDescription>Niche: {editing ? (editing.campaign?.name || 'General') : nicheName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Dental: missed calls" className="mt-1" />
              </div>
              <div>
                <Label>Step</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STEPS.map((s) => <SelectItem key={s.type} value={s.type}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {isFollowUp ? (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Follow-ups are sent as a reply to your first email (&ldquo;Re: …&rdquo;), so no subject is needed.
              </p>
            ) : (
              <div>
                <Label>Subject</Label>
                <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="quick question about {{companyName}}" className="mt-1" />
                <p className="text-xs text-slate-400 mt-1">Short, lowercase and specific subjects look personal and get opened more.</p>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between">
                <Label>Body</Label>
                <button type="button" onClick={() => setPreview((p) => !p)} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800">
                  <Eye className="h-3 w-3" />{preview ? 'Edit' : 'Preview with a sample lead'}
                </button>
              </div>
              {preview ? (
                <div className="mt-1 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm whitespace-pre-wrap text-slate-800 leading-relaxed min-h-[240px]">
                  {!isFollowUp && <p className="font-semibold mb-3">{renderTemplate(form.subject, varsFor(form.body))}</p>}
                  {renderTemplate(form.body, varsFor(form.body))}
                </div>
              ) : (
                <Textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder={'Hi {{firstName}},\n\n…'} className="mt-1 font-normal" rows={12} />
              )}
              {!preview && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {TEMPLATE_VARS.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, body: `${f.body}{{${v.key}}}` }))}
                      className="px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-400 mt-1.5">
                No first name? &ldquo;Hi {'{{firstName}}'}&rdquo; becomes &ldquo;Hi Bright Smile Dental team&rdquo;. Empty personal notes are removed cleanly.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Default {STEP_LABEL[form.type].toLowerCase()} for this niche
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>{editing ? 'Save Changes' : 'Create Template'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Library */}
      <Dialog open={showLibrary} onOpenChange={setShowLibrary}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Sequence library</DialogTitle>
            <DialogDescription>
              Proven 4-email sequences. Adding one puts it in <strong>{nicheName}</strong> and makes it the default. You can edit every word afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {SEQUENCE_LIBRARY.map((seq) => {
              return (
                <div key={seq.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-800">{seq.niche}</p>
                      <p className="text-xs text-slate-500">{seq.description}</p>
                    </div>
                    <Button size="sm" onClick={() => installSequence(seq.id)} loading={installing === seq.id} disabled={!!installing}>
                      Use this
                    </Button>
                  </div>
                  <details className="mt-3 group">
                    <summary className="text-xs text-indigo-600 cursor-pointer select-none">Read the emails</summary>
                    <div className="mt-2 space-y-3">
                      {seq.steps.map((s) => (
                        <div key={s.type} className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">{STEP_LABEL[s.type]}</p>
                          {s.subject && <p className="text-sm font-medium text-slate-800 mb-1">{renderTemplate(s.subject, varsFor(s.body))}</p>}
                          <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{renderTemplate(s.body, varsFor(s.body))}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* New niche */}
      <Dialog open={showNewNiche} onOpenChange={setShowNewNiche}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New niche</DialogTitle>
            <DialogDescription>A niche is a campaign. Leads you put in it get this niche&apos;s templates automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input autoFocus value={newNiche.name} onChange={(e) => setNewNiche((n) => ({ ...n, name: e.target.value }))} placeholder="Dentists – Texas" className="mt-1" />
            </div>
            <div>
              <Label>Industry</Label>
              <Input value={newNiche.industry} onChange={(e) => setNewNiche((n) => ({ ...n, industry: e.target.value }))} placeholder="Dental" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewNiche(false)}>Cancel</Button>
            <Button onClick={createNiche}>Create niche</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
