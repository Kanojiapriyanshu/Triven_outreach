'use client'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Backlog { searches: number; research: number; total: number }
interface RunResponse {
  result: { research?: { researched: number; ready: number; errors: string[] } } & Record<string, unknown>
  backlog: Backlog
  error?: string
}

/**
 * Finishes searches and researches new businesses in ~50 s rounds until nothing is left (or Stop).
 * The 5-minute worker does the same in the background; this is for "I want the list now".
 */
export default function FinderRunner({ backlog, onProgress }: { backlog?: Backlog; onProgress?: () => void }) {
  const [running, setRunning] = useState(false)
  const [line, setLine] = useState('')
  const stop = useRef(false)

  async function run() {
    stop.current = false
    setRunning(true)
    let researched = 0, ready = 0
    try {
      for (let round = 1; round <= 60 && !stop.current; round++) {
        setLine(round === 1 ? 'Starting…' : `Round ${round}…`)
        const res = await fetch('/api/finder/run', { method: 'POST' })
        const d = await res.json().catch(() => ({})) as RunResponse
        if (!res.ok) { toast.error(d.error || 'Run failed'); break }
        researched += d.result.research?.researched || 0
        ready += d.result.research?.ready || 0
        setLine(`${researched} researched · ${ready} ready to email · ${d.backlog.total} waiting`)
        onProgress?.()
        const searched = Object.keys(d.result).some((k) => k.startsWith('search:'))
        if (!d.backlog.total || (!d.result.research?.researched && !searched)) break
      }
      toast.success(ready ? `Done: ${ready} new businesses ready to email` : 'Done')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {line && <span className="text-xs text-slate-500">{line}</span>}
      {running ? (
        <Button size="sm" variant="outline" onClick={() => { stop.current = true; setLine('Stopping after this round…') }}>
          <Square className="h-3.5 w-3.5" />Stop
        </Button>
      ) : (
        <Button size="sm" variant={backlog?.total ? 'default' : 'outline'} onClick={run}>
          <Play className="h-3.5 w-3.5" />{backlog?.total ? `Research now (${backlog.total} waiting)` : 'Run now'}
        </Button>
      )}
    </div>
  )
}
