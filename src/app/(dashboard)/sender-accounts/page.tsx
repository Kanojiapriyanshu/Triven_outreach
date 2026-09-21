'use client'
import { Suspense, useState, useEffect } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { useSearchParams } from 'next/navigation'
import {
  Mail, Plus, CheckCircle, AlertCircle, XCircle, Wifi, WifiOff,
  Trash2, Settings, Users,
} from 'lucide-react'
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

interface SenderAccount {
  id: string; displayName: string; email: string; gmailStatus: string
  dailyEmailTarget: number; isActive: boolean; signature?: string
  timezone: string; createdAt: string
  _count: { leads: number }
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'CONNECTED') return <CheckCircle className="h-4 w-4 text-green-600" />
  if (status === 'ERROR' || status === 'EXPIRED') return <AlertCircle className="h-4 w-4 text-red-500" />
  return <XCircle className="h-4 w-4 text-slate-400" />
}

function SenderAccountsPageInner() {
  const searchParams = useSearchParams()
  const { data: accounts, mutate } = useSWR<SenderAccount[]>('/api/sender-accounts', fetcher)

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    displayName: '', email: '', dailyEmailTarget: 20,
    timezone: 'America/New_York', signature: '',
  })
  const [editAccount, setEditAccount] = useState<SenderAccount | null>(null)

  // Show toast on Gmail OAuth return
  useEffect(() => {
    if (searchParams.get('connected') === '1') toast.success('Gmail account connected!')
    if (searchParams.get('error')) toast.error(`Gmail connection failed: ${searchParams.get('error')}`)
  }, [searchParams])

  function setF(k: string, v: unknown) { setForm((p) => ({ ...p, [k]: v })) }

  async function handleCreate() {
    if (!form.displayName.trim() || !form.email.trim()) return toast.error('Name and email required')
    setSaving(true)
    try {
      const res = await fetch('/api/sender-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error)
      toast.success('Sender account created')
      setShowForm(false)
      setForm({ displayName: '', email: '', dailyEmailTarget: 20, timezone: 'America/New_York', signature: '' })
      mutate()
    } finally { setSaving(false) }
  }

  async function handleUpdate() {
    if (!editAccount) return
    setSaving(true)
    try {
      await fetch(`/api/sender-accounts/${editAccount.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      toast.success('Updated')
      setEditAccount(null)
      mutate()
    } finally { setSaving(false) }
  }

  async function connectGmail(id: string) {
    const res = await fetch(`/api/gmail/connect?senderAccountId=${id}`)
    const { url } = await res.json()
    if (url) window.location.href = url
  }

  async function deleteAccount(id: string) {
    if (!confirm('Delete this sender account? Leads assigned to it will be unlinked.')) return
    await fetch(`/api/sender-accounts/${id}`, { method: 'DELETE' })
    toast.success('Account deleted')
    mutate()
  }

  function openEdit(account: SenderAccount) {
    setEditAccount(account)
    setForm({
      displayName: account.displayName,
      email: account.email,
      dailyEmailTarget: account.dailyEmailTarget,
      timezone: account.timezone,
      signature: account.signature || '',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Sender Accounts</h1>
          <p className="text-sm text-slate-500">{accounts?.length ?? 0} accounts</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" />Add Account</Button>
      </div>

      {!accounts?.length && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-center">
            <Mail className="h-12 w-12 text-slate-300 mb-3" />
            <h3 className="text-lg font-semibold text-slate-700">No sender accounts yet</h3>
            <p className="text-sm text-slate-400 mt-1 max-w-sm">
              Add your Gmail accounts to start sending outreach emails. Each account can be connected via Google OAuth.
            </p>
            <Button size="sm" className="mt-4" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" />Add Account</Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(accounts || []).map((account) => (
          <Card key={account.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white font-semibold text-sm">
                    {account.displayName[0]}
                  </div>
                  <div>
                    <CardTitle className="text-base">{account.displayName}</CardTitle>
                    <p className="text-xs text-slate-400">{account.email}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(account)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => deleteAccount(account.id)} className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 text-slate-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <StatusIcon status={account.gmailStatus} />
                  <span className={`text-xs font-medium ${account.gmailStatus === 'CONNECTED' ? 'text-green-700' : account.gmailStatus === 'NOT_CONNECTED' ? 'text-slate-500' : 'text-red-600'}`}>
                    {account.gmailStatus === 'CONNECTED' ? 'Gmail Connected' : account.gmailStatus === 'NOT_CONNECTED' ? 'Not Connected' : 'Connection Error'}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant={account.gmailStatus === 'CONNECTED' ? 'outline' : 'default'}
                  onClick={() => connectGmail(account.id)}
                  className="text-xs h-7"
                >
                  {account.gmailStatus === 'CONNECTED' ? <><Wifi className="h-3 w-3" />Reconnect</> : <><WifiOff className="h-3 w-3" />Connect Gmail</>}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <p className="text-xs text-slate-400 mb-0.5">Daily Target</p>
                  <p className="font-semibold text-slate-900">{account.dailyEmailTarget} emails</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2.5">
                  <p className="text-xs text-slate-400 mb-0.5">Total Leads</p>
                  <p className="font-semibold text-slate-900">{account._count.leads}</p>
                </div>
              </div>

              <div className="mt-2 text-xs text-slate-400">
                Timezone: {account.timezone}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Sender Account</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Sender name *</Label>
              <Input value={form.displayName} onChange={(e) => setF('displayName', e.target.value)} placeholder="Kate Morgan" className="mt-1" />
              <p className="text-xs text-slate-400 mt-1">A real person&apos;s name. Prospects see it in the From line and sign-off, and spam filters flag names like &ldquo;Account 1&rdquo;.</p>
            </div>
            <div>
              <Label>Gmail Address *</Label>
              <Input type="email" value={form.email} onChange={(e) => setF('email', e.target.value)} placeholder="priyanshu@gmail.com" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Daily Email Target</Label>
                <Input type="number" min={1} max={500} value={form.dailyEmailTarget} onChange={(e) => setF('dailyEmailTarget', Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <Label>Timezone</Label>
                <Input value={form.timezone} onChange={(e) => setF('timezone', e.target.value)} placeholder="America/New_York" className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Email Signature</Label>
              <Textarea value={form.signature} onChange={(e) => setF('signature', e.target.value)} placeholder="Best regards,&#10;Your Name&#10;Company" className="mt-1" rows={3} />
            </div>
            <p className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg p-2">
              💡 After creating the account, click <strong>Connect Gmail</strong> to authorize sending via Google OAuth.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={saving}>Create Account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editAccount} onOpenChange={() => setEditAccount(null)} >
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Sender Account</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Sender name</Label>
              <Input value={form.displayName} onChange={(e) => setF('displayName', e.target.value)} placeholder="Kate Morgan" className="mt-1" />
              <p className="text-xs text-slate-400 mt-1">Shown as &ldquo;Kate Morgan &lt;kate@…&gt;&rdquo; and used to sign emails.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Daily Email Target</Label>
                <Input type="number" min={1} value={form.dailyEmailTarget} onChange={(e) => setF('dailyEmailTarget', Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <Label>Timezone</Label>
                <Input value={form.timezone} onChange={(e) => setF('timezone', e.target.value)} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Email Signature</Label>
              <Textarea value={form.signature} onChange={(e) => setF('signature', e.target.value)} placeholder={'Kate Morgan\nGrowth, Triven\n123 Market St, San Francisco, CA 94105'} className="mt-1" rows={4} />
              <p className="text-xs text-slate-400 mt-1">Plain text, no links or images. Include a business postal address (US law requires one in cold email). Leave it empty if your templates already sign off.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAccount(null)}>Cancel</Button>
            <Button onClick={handleUpdate} loading={saving}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function SenderAccountsPage() {
  return <Suspense fallback={<div className="p-8 text-slate-400 text-sm">Loading…</div>}><SenderAccountsPageInner /></Suspense>
}
