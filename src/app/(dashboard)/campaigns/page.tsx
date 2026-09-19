'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Plus, Megaphone, Users, MoreVertical, Pencil, Trash2, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Campaign {
  id: string; name: string; industry: string; isActive: boolean; isPaused: boolean
  targetCountry?: string; targetLocation?: string; product?: string; description?: string
  followUpDay1: number; followUpDay2: number; followUpDay3: number
  timezone: string; createdAt: string
  _count: { leads: number; templates: number }
  senderAccounts: Array<{ senderAccount: { id: string; displayName: string; email: string } }>
}

export default function CampaignsPage() {
  const { data: campaigns, mutate } = useSWR<Campaign[]>('/api/campaigns', fetcher)
  const { data: senders } = useSWR('/api/sender-accounts', fetcher)

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '', industry: '', targetCountry: '', targetLocation: '',
    product: '', description: '', timezone: 'America/New_York',
    followUpDay1: 1, followUpDay2: 2, followUpDay3: 3,
    senderAccountIds: [] as string[],
  })

  function setF(k: string, v: unknown) { setForm((p) => ({ ...p, [k]: v })) }

  function toggleSender(id: string) {
    setForm((p) => ({
      ...p,
      senderAccountIds: p.senderAccountIds.includes(id)
        ? p.senderAccountIds.filter((s) => s !== id)
        : [...p.senderAccountIds, id],
    }))
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.industry.trim()) return toast.error('Name and industry are required')
    setSaving(true)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const d = await res.json(); return toast.error(d.error) }
      toast.success('Campaign created')
      setShowForm(false)
      setForm({ name: '', industry: '', targetCountry: '', targetLocation: '', product: '', description: '', timezone: 'America/New_York', followUpDay1: 1, followUpDay2: 2, followUpDay3: 3, senderAccountIds: [] })
      mutate()
    } finally { setSaving(false) }
  }

  async function togglePause(id: string, isPaused: boolean) {
    await fetch(`/api/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPaused: !isPaused }),
    })
    mutate()
  }

  async function deleteCampaign(id: string) {
    if (!confirm('Delete this campaign? Leads will remain but will be unlinked.')) return
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
    toast.success('Campaign deleted')
    mutate()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Campaigns</h1>
          <p className="text-sm text-slate-500">{campaigns?.length ?? 0} campaigns</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" />New Campaign</Button>
      </div>

      {!campaigns?.length && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-center">
            <Megaphone className="h-12 w-12 text-slate-300 mb-3" />
            <h3 className="text-lg font-semibold text-slate-700">No campaigns yet</h3>
            <p className="text-sm text-slate-400 mt-1">Create your first campaign to organize your outreach</p>
            <Button size="sm" className="mt-4" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" />Create Campaign</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(campaigns || []).map((c) => (
          <Card key={c.id} className="flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base truncate">{c.name}</CardTitle>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="secondary" className="text-xs">{c.industry}</Badge>
                    <Badge variant={c.isActive && !c.isPaused ? 'success' : 'warning'} className="text-xs">
                      {c.isPaused ? 'Paused' : c.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-1 ml-2">
                  <button onClick={() => togglePause(c.id, c.isPaused)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                    {c.isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  </button>
                  <button onClick={() => deleteCampaign(c.id)} className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 text-slate-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 flex-1">
              {c.description && <p className="text-xs text-slate-500 mb-3 line-clamp-2">{c.description}</p>}
              <div className="space-y-2 text-xs text-slate-600">
                {c.product && <p>🎯 Product: {c.product}</p>}
                {c.targetCountry && <p>🌎 Target: {[c.targetCountry, c.targetLocation].filter(Boolean).join(', ')}</p>}
                <p>📅 Follow-up: Day {c.followUpDay1}, {c.followUpDay2}, {c.followUpDay3}</p>
                <p>🕐 Timezone: {c.timezone}</p>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-1 text-sm font-medium text-slate-700">
                  <Users className="h-4 w-4 text-slate-400" />
                  {c._count.leads} leads
                </div>
                <div className="flex -space-x-1">
                  {c.senderAccounts.slice(0, 4).map(({ senderAccount: sa }) => (
                    <div key={sa.id} className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white text-xs border-2 border-white font-medium" title={sa.displayName}>
                      {sa.displayName[0]}
                    </div>
                  ))}
                  {c.senderAccounts.length > 4 && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-slate-600 text-xs border-2 border-white">
                      +{c.senderAccounts.length - 4}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Campaign Name *</Label>
                <Input value={form.name} onChange={(e) => setF('name', e.target.value)} placeholder="Dental AI Outreach" className="mt-1" />
              </div>
              <div>
                <Label>Industry *</Label>
                <Input value={form.industry} onChange={(e) => setF('industry', e.target.value)} placeholder="Dental / SaaS / HVAC…" className="mt-1" />
              </div>
              <div>
                <Label>Product / Service</Label>
                <Input value={form.product} onChange={(e) => setF('product', e.target.value)} placeholder="AI Receptionist" className="mt-1" />
              </div>
              <div>
                <Label>Target Country</Label>
                <Input value={form.targetCountry} onChange={(e) => setF('targetCountry', e.target.value)} placeholder="USA" className="mt-1" />
              </div>
              <div>
                <Label>Follow-up Day 1</Label>
                <Input type="number" min={1} value={form.followUpDay1} onChange={(e) => setF('followUpDay1', Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <Label>Follow-up Day 2</Label>
                <Input type="number" min={1} value={form.followUpDay2} onChange={(e) => setF('followUpDay2', Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <Label>Follow-up Day 3</Label>
                <Input type="number" min={1} value={form.followUpDay3} onChange={(e) => setF('followUpDay3', Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <Label>Timezone</Label>
                <Input value={form.timezone} onChange={(e) => setF('timezone', e.target.value)} placeholder="America/New_York" className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setF('description', e.target.value)} placeholder="Campaign description…" className="mt-1" rows={2} />
            </div>
            <div>
              <Label>Sender Accounts</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {(senders || []).map((s: { id: string; displayName: string; email: string }) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSender(s.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${form.senderAccountIds.includes(s.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400'}`}
                  >
                    {s.displayName}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={saving}>Create Campaign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
