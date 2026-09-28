'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { UserCog, Plus } from 'lucide-react'
import PageHeader from '@/components/layout/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ROLES, type Role } from '@/lib/roles'
import { fmtDate } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface User { id: string; name: string; email: string; role: string; isActive: boolean; createdAt: string }

export default function UsersPage() {
  const { data, mutate } = useSWR<{ users: User[]; me: string; myRole: string }>('/api/users', fetcher)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'SALES' })
  const [adding, setAdding] = useState(false)
  const isAdmin = data?.myRole === 'ADMIN'

  async function add() {
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(d.error || 'Could not add')
    toast.success(`${d.name} added. Share the password with them privately; they can change it later.`)
    setForm({ name: '', email: '', password: '', role: 'SALES' }); setAdding(false); mutate()
  }
  async function patch(id: string, body: Record<string, unknown>, msg: string) {
    const res = await fetch(`/api/users/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return toast.error(d.error || 'Could not save')
    toast.success(msg); mutate()
  }
  async function resetPassword(u: User) {
    const pw = prompt(`New password for ${u.name} (at least 10 characters)`)
    if (pw) await patch(u.id, { password: pw }, 'Password changed')
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader section="Configuration" title="Team" icon={UserCog}
        description="Who can use the CRM and what they can change. Admins manage keys, inboxes and settings; operators run prospecting and campaigns; sales work the inbox and pipeline."
        actions={isAdmin && <Button size="sm" onClick={() => setAdding((v) => !v)}><Plus className="h-3.5 w-3.5" />Add person</Button>} />

      {adding && (
        <Card><CardContent className="grid gap-2 p-4 sm:grid-cols-2">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" />
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Work email" />
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Temporary password (10+ characters)" autoComplete="new-password" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}: {v.hint}</option>)}
          </select>
          <div className="sm:col-span-2 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button size="sm" onClick={add}>Add</Button></div>
        </CardContent></Card>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500"><th className="px-5 py-2.5">Person</th><th className="px-3 py-2.5">Role</th><th className="px-3 py-2.5">Since</th><th className="px-5 py-2.5" /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(data?.users || []).map((u) => (
              <tr key={u.id} className={u.isActive ? '' : 'opacity-50'}>
                <td className="px-5 py-3"><p className="font-medium text-slate-900">{u.name}{u.id === data?.me && <span className="ml-1 text-xs text-slate-400">(you)</span>}</p><p className="text-xs text-slate-500">{u.email}</p></td>
                <td className="px-3 py-3">
                  {isAdmin ? (
                    <select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value }, 'Role updated')} className="h-8 rounded-lg border border-slate-300 px-2 text-xs">
                      {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  ) : <span className="text-xs">{ROLES[u.role as Role]?.label || u.role}</span>}
                </td>
                <td className="px-3 py-3 text-xs text-slate-500">{fmtDate(u.createdAt)}</td>
                <td className="px-5 py-3 text-right">
                  {isAdmin && <>
                    <Button size="sm" variant="ghost" onClick={() => resetPassword(u)}>Reset password</Button>
                    {u.id !== data?.me && <Button size="sm" variant="ghost" onClick={() => patch(u.id, { isActive: !u.isActive }, u.isActive ? 'Access removed' : 'Access restored')}>{u.isActive ? 'Remove access' : 'Restore'}</Button>}
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
