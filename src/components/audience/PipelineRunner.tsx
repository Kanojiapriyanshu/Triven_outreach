'use client'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Backlog { videos: number; review: number; enrich: number; verify: number; total: number }
interface RunResponse {
  result: {
    collect?: { newComments: number; newProspects: number; errors: string[] }
    review?: { reviewed: number; error: string }
    enrich?: { enriched: number; emailsFound: number; errors: string[] }
    verify?: { checked: number; verified: number }
  }
  backlog: Backlog
  error?: string
}

/**
 * Runs the pipeline in ~50 s rounds until nothing is left (or Stop). The worker does the same
 * every 5 minutes in the background; this is for "I want results now".
 */
export default function PipelineRunner({ onProgress, backlog, size = 'sm' }: { onProgress?: () => void; backlog?: Backlog; size?: 'sm' | 'default' }) {
  const [running, setRunning] = useState(false)
  const [line, setLine] = useState('')
  const stop = useRef(false)
  const totals = useRef({ comments: 0, prospects: 0, reviewed: 0, enriched: 0, emails: 0, verified: 0 })

  async function run() {
    stop.current = false
    totals.current = { comments: 0, prospects: 0, reviewed: 0, enriched: 0, emails: 0, verified: 0 }
    setRunning(true)
    try {
      for (let round = 1; round <= 40 && !stop.current; round++) {
        setLine(round === 1 ? 'Starting…' : `Round ${round}…`)
        const res = await fetch('/api/audience/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        const d = await res.json().catch(() => ({})) as RunResponse
        if (!res.ok) { toast.error(d.error || 'Pipeline run failed'); break }
        const t = totals.current
        t.comments += d.result.collect?.newComments || 0
        t.prospects += d.result.collect?.newProspects || 0
        t.reviewed += d.result.review?.reviewed || 0
        t.enriched += d.result.enrich?.enriched || 0
        t.emails += d.result.enrich?.emailsFound || 0
        t.verified += d.result.verify?.verified || 0
        setLine(`${t.comments} comments · ${t.prospects} people · ${t.reviewed} reviewed · ${t.enriched} researched · ${t.emails} emails · ${t.verified} verified — ${d.backlog.total} left`)
        onProgress?.()
        const errs = [...(d.result.collect?.errors || []), d.result.review?.error || ''].filter(Boolean)
        if (errs.some((e) => /quota|YOUTUBE_API_KEY/i.test(e))) { toast.error(errs[0]); break }
        if (d.result.review?.error) toast.warning(d.result.review.error)
        const progressed = (d.result.collect?.newComments || 0) + (d.result.review?.reviewed || 0) + (d.result.enrich?.enriched || 0) + (d.result.verify?.checked || 0)
        if (!d.backlog.total || !progressed) break
      }
      toast.success('Pipeline run finished')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {running ? (
        <Button size={size} variant="outline" onClick={() => { stop.current = true; setLine('Stopping after this round…') }}>
          <Square className="h-3.5 w-3.5" />Stop
        </Button>
      ) : (
        <Button size={size} onClick={run}>
          <Play className="h-3.5 w-3.5" />Run pipeline now{backlog?.total ? ` (${backlog.total} waiting)` : ''}
        </Button>
      )}
      {line && <span className="text-xs text-slate-500">{line}</span>}
    </div>
  )
}
