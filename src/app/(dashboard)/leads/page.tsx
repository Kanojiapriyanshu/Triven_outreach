'use client'
import { Suspense, useState, useCallback } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Plus, Filter, Download, Upload, Search, ChevronLeft, ChevronRight,
  Trash2, ExternalLink, Send,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { StatusBadge, PriorityBadge } from '@/components/leads/StatusBadge'
import { Card } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fmtDate, fmtRelative, getDisplayName, isOverdue } from '@/lib/utils'
import { toast } from 'sonner'
import type { PaginatedResponse, LeadRow } from '@/types'
import LeadFormDialog from '@/components/leads/LeadFormDialog'
import ComposeEmailDialog, { type ComposeLead } from '@/components/email/ComposeEmailDialog'
import BulkSendDialog from '@/components/email/BulkSendDialog'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const ALL_STATUSES = [
  'NEW','RESEARCHING','READY_TO_CONTACT','FIRST_EMAIL_SENT',
  'FOLLOW_UP_1_DUE','FOLLOW_UP_1_SENT','FOLLOW_UP_2_DUE','FOLLOW_UP_2_SENT',
  'FOLLOW_UP_3_DUE','FOLLOW_UP_3_SENT','REPLIED','INTERESTED','DEMO_SENT',
  'MEETING_BOOKED','PROPOSAL_SENT','WON','LOST','NOT_INTERESTED',
  'UNSUBSCRIBED','INVALID_EMAIL','DO_NOT_CONTACT',
]

function LeadsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showForm, setShowForm] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  // undefined = closed, null = new contact, lead = email that lead
  const [composeFor, setComposeFor] = useState<ComposeLead | null | undefined>(undefined)

  const q = searchParams.get('q') || ''
  const [localQ, setLocalQ] = useState(q)
  const status = searchParams.get('status') || ''
  const campaignId = searchParams.get('campaignId') || ''
  const senderAccountId = searchParams.get('senderAccountId') || ''

  const apiUrl = `/api/leads?page=${page}&pageSize=${pageSize}${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}${campaignId ? `&campaignId=${campaignId}` : ''}${senderAccountId ? `&senderAccountId=${senderAccountId}` : ''}`

  const { data, mutate, isLoading } = useSWR<PaginatedResponse<LeadRow>>(apiUrl, fetcher)
  const { data: campaigns } = useSWR('/api/campaigns', fetcher)
  const { data: senders } = useSWR('/api/sender-accounts', fetcher)

  const leads = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  function updateFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (value) p.set(key, value)
    else p.delete(key)
    p.delete('page')
    router.push(`/leads?${p.toString()}`)
    setPage(1)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    updateFilter('q', localQ)
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === leads.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(leads.map((l) => l.id)))
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this lead?')) return
    await fetch(`/api/leads/${id}`, { method: 'DELETE' })
    toast.success('Lead deleted')
    mutate()
  }

  async function handleBulkAction(action: string, value?: string) {
    if (selectedIds.size === 0) return toast.error('Select leads first')
    await fetch('/api/leads/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: Array.from(selectedIds), action, value }),
    })
    toast.success(`Updated ${selectedIds.size} leads`)
    setSelectedIds(new Set())
    mutate()
  }

  function handleExport() {
    // Let the browser download the attachment directly (works in every browser, incl. Safari)
    window.location.href = `/api/leads/export?${new URLSearchParams({ q, status, campaignId, senderAccountId }).toString()}`
    toast.success(`Exporting ${total.toLocaleString()} leads…`)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Leads</h1>
          <p className="text-sm text-slate-500">{total.toLocaleString()} total leads</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4" />Export
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/imports"><Upload className="h-4 w-4" />Import</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />Add Lead
          </Button>
          <Button size="sm" onClick={() => setComposeFor(null)}>
            <Send className="h-4 w-4" />New Email
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[200px]">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={localQ}
                onChange={(e) => setLocalQ(e.target.value)}
                placeholder="Search name, company, email…"
                className="pl-8"
              />
            </div>
            <Button type="submit" variant="secondary" size="sm">Search</Button>
          </form>

          <Select value={status} onValueChange={(v) => updateFilter('status', v === 'ALL' ? '' : v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {ALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={campaignId} onValueChange={(v) => updateFilter('campaignId', v === 'ALL' ? '' : v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All campaigns</SelectItem>
              {(campaigns || []).map((c: { id: string; name: string }) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={senderAccountId} onValueChange={(v) => updateFilter('senderAccountId', v === 'ALL' ? '' : v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All senders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All senders</SelectItem>
              {(senders || []).map((s: { id: string; displayName: string }) => (
                <SelectItem key={s.id} value={s.id}>{s.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="mt-3 flex items-center gap-3 pt-3 border-t border-slate-100">
            <span className="text-sm text-slate-600 font-medium">{selectedIds.size} selected</span>
            <Button size="sm" onClick={() => setShowBulk(true)}><Send className="h-3.5 w-3.5" />Send email</Button>
            <Button size="sm" variant="outline" onClick={() => handleBulkAction('pause_sequence')}>Pause Sequence</Button>
            <Button size="sm" variant="outline" onClick={() => handleBulkAction('resume_sequence')}>Resume</Button>
            <Select onValueChange={(v) => handleBulkAction('change_status', v)}>
              <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue placeholder="Change status" /></SelectTrigger>
              <SelectContent>
                {ALL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="text-slate-400" onClick={() => setSelectedIds(new Set())}>Clear</Button>
          </div>
        )}
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === leads.length}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Lead</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Industry</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Campaign</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Sender</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Last Contact</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Next Follow-up</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Priority</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td colSpan={10} className="px-4 py-3">
                      <div className="h-4 bg-slate-100 animate-pulse rounded" />
                    </td>
                  </tr>
                ))
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-slate-400">
                    No leads found. <button onClick={() => setComposeFor(null)} className="text-indigo-600 hover:underline">Send your first email →</button>
                  </td>
                </tr>
              ) : leads.map((lead) => {
                const overdue = isOverdue(lead.nextFollowUpAt)
                return (
                  <tr key={lead.id} className="border-b border-slate-100 hover:bg-slate-50 group">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleSelect(lead.id)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/leads/${lead.id}`} className="block hover:text-indigo-600">
                        <p className="font-medium text-slate-900">{getDisplayName(lead)}</p>
                        <p className="text-xs text-slate-400">{lead.companyName}</p>
                        {lead.companyEmail && (
                          <p className="text-xs text-slate-400">{lead.companyEmail}</p>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{lead.industry || '—'}</td>
                    <td className="px-4 py-3">
                      {lead.campaign ? (
                        <Badge variant="secondary" className="text-xs">{lead.campaign.name}</Badge>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{lead.senderAccount?.displayName || '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {lead.lastContactedAt ? fmtRelative(lead.lastContactedAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {lead.nextFollowUpAt ? (
                        <span className={overdue ? 'text-red-600 font-medium' : 'text-slate-500'}>
                          {overdue ? '⚠ ' : ''}{fmtDate(lead.nextFollowUpAt)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={lead.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 items-center">
                        {lead.companyEmail && (
                          <button
                            onClick={() => setComposeFor(lead)}
                            title={lead.firstEmailSentAt ? 'Send an email' : 'Send first email'}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                          >
                            <Send className="h-3.5 w-3.5" />Email
                          </button>
                        )}
                        <Link href={`/leads/${lead.id}`} className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                        <button onClick={() => handleDelete(lead.id)} className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-500">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
            </p>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 py-1 text-sm text-slate-600">{page} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {showForm && (
        <LeadFormDialog
          open={showForm}
          onClose={() => setShowForm(false)}
          onSaved={(lead, thenEmail) => {
            setShowForm(false)
            mutate()
            if (thenEmail && lead) setComposeFor(lead)
          }}
        />
      )}

      {showBulk && (
        <BulkSendDialog
          leads={leads.filter((l) => selectedIds.has(l.id))}
          onClose={() => setShowBulk(false)}
          onDone={() => { setShowBulk(false); setSelectedIds(new Set()); mutate() }}
        />
      )}

      {composeFor !== undefined && (
        <ComposeEmailDialog
          open
          onClose={() => setComposeFor(undefined)}
          lead={composeFor ?? undefined}
          onSent={() => mutate()}
        />
      )}
    </div>
  )
}

export default function LeadsPage() {
  return <Suspense fallback={<div className="p-8 text-slate-400 text-sm">Loading…</div>}><LeadsPageInner /></Suspense>
}
