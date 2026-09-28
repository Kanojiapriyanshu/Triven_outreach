'use client'
import { useState } from 'react'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { Upload, CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Row { name: string; profileUrl?: string; post: string; email?: string; website?: string; postedAt?: string }

// Column names people's exports actually use
const PICK: Record<keyof Row, RegExp> = {
  name: /^(name|member|author|user(name)?|display.?name|full.?name)$/i,
  profileUrl: /^(profile|profile.?url|url|link|member.?url)$/i,
  post: /^(post|content|text|message|body|comment)$/i,
  email: /^(e.?mail|email.?address)$/i,
  website: /^(website|site|web|homepage)$/i,
  postedAt: /^(date|posted|posted.?at|created|created.?at|time(stamp)?)$/i,
}

/** Import members + posts from a community export you run or may use (PRD R1.4) */
export default function CommunityImport({ onDone }: { onDone: () => void }) {
  const [community, setCommunity] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [cols, setCols] = useState<Record<string, string>>({})
  const [permission, setPermission] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ rows: number; newPosts: number; newPeople: number; emails: number } | null>(null)

  function load(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const headers = res.meta.fields || []
        const map: Record<string, string> = {}
        for (const [k, re] of Object.entries(PICK)) { const h = headers.find((x) => re.test(x.trim())); if (h) map[k] = h }
        if (!map.name || !map.post) return toast.error('The file needs at least a name column and a post/content column')
        setCols(map)
        setRows(res.data.map((d) => ({
          name: d[map.name] || '', post: d[map.post] || '',
          profileUrl: map.profileUrl ? d[map.profileUrl] : undefined, email: map.email ? d[map.email] : undefined,
          website: map.website ? d[map.website] : undefined, postedAt: map.postedAt ? d[map.postedAt] : undefined,
        })).filter((r) => r.name.trim() && r.post.trim()))
        setResult(null)
      },
      error: () => toast.error('Could not read that file'),
    })
  }

  async function submit() {
    if (!community.trim()) return toast.error('Name the community')
    if (!permission) return toast.error('Confirm you run this community or have permission to use its data')
    setBusy(true)
    try {
      const res = await fetch('/api/audience/community', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ community: community.trim(), rows, permission, consentToContact: consent }) })
      const d = await res.json()
      if (!res.ok) return toast.error(d.error || 'Import failed')
      setResult(d); toast.success(`${d.newPeople} new people imported`); onDone()
    } finally { setBusy(false) }
  }

  const people = new Set(rows.map((r) => r.profileUrl || r.name)).size
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-xs text-slate-500">
          Import members and their posts from a community you run (or have written permission to use), using the platform's own export as CSV.
          Posts are scored like comments; people get a use case, fit and evidence. Nothing is scraped.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={community} onChange={(e) => setCommunity(e.target.value)} placeholder="Community name" className="w-60" />
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-indigo-400">
            <Upload className="h-4 w-4" />Choose CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          </label>
          {rows.length > 0 && <span className="text-sm text-slate-600">{rows.length.toLocaleString('en-US')} posts from {people.toLocaleString('en-US')} people · columns: {Object.entries(cols).map(([k, v]) => `${k}=${v}`).join(', ')}</span>}
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={permission} onChange={(e) => setPermission(e.target.checked)} /><span>I run this community or have written permission to use its members' data for outreach.</span></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>Members agreed to be contacted by email (only then are the export's email addresses kept).</span></label>
        <Button onClick={submit} loading={busy} disabled={!rows.length}>Import</Button>
        {result && <p className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{result.newPosts} new posts, {result.newPeople} new people, {result.emails} emails. They appear in Prospects once scored.</p>}
      </CardContent>
    </Card>
  )
}
