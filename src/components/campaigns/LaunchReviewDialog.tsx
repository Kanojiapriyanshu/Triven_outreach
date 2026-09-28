'use client'
import { useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Rocket, CircleAlert, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

const fetcher = (url: string) => fetch(url).then(async (r) => {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d
})

interface Sample { id: string; to: string | null; name: string; source: string; variant: string; subject: string; body: string; check: { level: string; notes: string[] } }
interface Data { samples: Sample[]; needsReview: boolean; missingAddress: boolean }

/** PRD R6.4: before a campaign goes live, read real emails it will send. Launch = "these look right". */
export default function LaunchReviewDialog({ campaign, onClose, onLaunched }: { campaign: { id: string; name: string } | null; onClose: () => void; onLaunched: () => void }) {
  const { data, error } = useSWR<Data>(campaign ? `/api/campaigns/${campaign.id}/samples` : null, fetcher)
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(false)
  const s = data?.samples[i]
  const thin = data?.samples.filter((x) => x.check.level !== 'ok').length || 0

  async function launch() {
    if (!campaign) return
    setBusy(true)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sendingStatus: 'ACTIVE', launchChecked: true }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return toast.error(d.error || 'Could not launch')
      toast.success(`${campaign.name} is live. Emails go out in each window, one at a time.`)
      onLaunched(); onClose()
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={!!campaign} onOpenChange={(v) => { if (!v) { setI(0); onClose() } }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review before launch: {campaign?.name}</DialogTitle>
          <DialogDescription>These are real emails this campaign will send, rendered with each person's own data. Read a few; if they look right, launch.</DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
        {data?.missingAddress && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Your postal address is missing. Every cold email must include one. <Link href="/settings" className="font-medium underline">Add it in Settings</Link>, then launch.</span>
          </div>
        )}
        {data && !data.samples.length && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No one to preview yet: add leads (or wait for ready prospects) first.</p>}

        {s && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{i + 1} of {data!.samples.length} · {s.source}{data!.samples.some((x) => x.variant === 'B') ? ` · variant ${s.variant}` : ''}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="outline" disabled={i >= data!.samples.length - 1} onClick={() => setI(i + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
                To <span className="text-slate-800">{s.name}</span> &lt;{s.to || 'no email'}&gt;
                <p className="mt-0.5 text-sm font-medium text-slate-900">{s.subject}</p>
              </div>
              <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-[13px] leading-relaxed text-slate-800">{s.body}</pre>
            </div>
            {s.check.level !== 'ok' && (
              <p className="text-xs text-amber-700"><CircleAlert className="mr-1 inline h-3.5 w-3.5" />Thin data: {s.check.notes.join('; ')}</p>
            )}
          </div>
        )}

        <DialogFooter className="items-center">
          {data && data.samples.length > 0 && <span className="mr-auto text-xs text-slate-500">{thin ? `${thin} of ${data.samples.length} have thin data (they still read naturally)` : <><CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />All well personalised</>}</span>}
          <Button variant="outline" onClick={onClose}>Not yet</Button>
          <Button onClick={launch} loading={busy} disabled={!data || data.missingAddress}><Rocket className="h-3.5 w-3.5" />Looks right: launch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
