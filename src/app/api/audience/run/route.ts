/**
 * POST /api/audience/run  { step?: 'collect' | 'review' | 'enrich' | 'identity' | 'finder' | 'verify' }
 * Runs the audience pipeline for ~50 s and reports what's left, so the page can call it
 * again until the backlog is empty. The 5-minute worker does the same in the background.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { runAudiencePipeline, pipelineBacklog, type PipelineStep } from '@/lib/audience/pipeline'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = await requireAuth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { step } = await req.json().catch(() => ({})) as { step?: PipelineStep }
  const result = await runAudiencePipeline(Date.now() + 48_000, step)
  return NextResponse.json({ ok: true, result, backlog: await pipelineBacklog() })
}
