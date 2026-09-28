'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { Lightbulb, FlaskConical } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Row { key: string; label: string; contacted: number; replied: number; positive: number; meetings: number; replyRate: number; positiveRate: number }
interface Data {
  total: { contacted: number; replied: number; positive: number; meetings: number; replyRate: number; positiveRate: number }
  dimensions: Array<{ dimension: string; rows: Row[] }>
  suggestions: string[]
  abTests: Array<{ campaignId: string; campaign: string; A: Row; B: Row; winner: string | null; note: string }>
  minSample: number
}

const p = (x: number) => `${(x * 100).toFixed(1)}%`

/** Analytics → What converts (learning loop) and A/B tests */
export default function InsightsPanel() {
  const { data } = useSWR<Data>('/api/insights', fetcher)
  const [dim, setDim] = useState(0)
  if (!data) return null
  const d = data.dimensions[dim]
  const maxRate = Math.max(0.0001, ...d.rows.map((r) => r.positiveRate))

  return (
    <div id="insights" className="grid gap-5 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-indigo-600" />What converts</span>
            <span className="text-xs font-normal text-slate-500">{data.total.contacted} contacted · {p(data.total.replyRate)} replied · {p(data.total.positiveRate)} positive</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {data.dimensions.map((x, i) => (
              <button key={x.dimension} onClick={() => setDim(i)} className={`rounded-md px-2 py-0.5 text-xs ${i === dim ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{x.dimension}</button>
            ))}
          </div>
          {!d.rows.length ? <p className="text-sm text-slate-400">No sends yet in this dimension.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500"><th className="py-1">{d.dimension}</th><th className="text-right">Sent</th><th className="text-right">Replied</th><th className="px-2">Positive</th><th className="text-right">Meetings</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.rows.slice(0, 12).map((r) => (
                  <tr key={r.key} className={r.contacted < data.minSample ? 'text-slate-400' : ''}>
                    <td className="py-1.5">{r.label}{r.contacted < data.minSample && <span className="ml-1 text-[10px]">(small sample)</span>}</td>
                    <td className="text-right tabular-nums">{r.contacted}</td>
                    <td className="text-right tabular-nums">{p(r.replyRate)}</td>
                    <td className="px-2">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-20 rounded-full bg-slate-100"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${(100 * r.positiveRate) / maxRate}%` }} /></span>
                        <span className="text-xs tabular-nums">{p(r.positiveRate)}</span>
                      </div>
                    </td>
                    <td className="text-right tabular-nums">{r.meetings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="rounded-lg bg-indigo-50/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">Suggestions</p>
            {data.suggestions.length
              ? <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-slate-700">{data.suggestions.slice(0, 6).map((s) => <li key={s}>{s}</li>)}</ul>
              : <p className="mt-1 text-sm text-slate-500">Not enough outcomes yet. Suggestions appear once a group has {data.minSample}+ sends and clearly beats or trails the average. Nothing is changed automatically.</p>}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-indigo-600" />A/B tests</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!data.abTests.length && <p className="text-sm text-slate-500">No A/B test running. Add a "variant B" first email on the Templates page and turn on A/B in the campaign's settings.</p>}
          {data.abTests.map((t) => (
            <div key={t.campaignId} className="rounded-lg border border-slate-200 p-3">
              <p className="text-sm font-medium text-slate-800">{t.campaign}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(['A', 'B'] as const).map((v) => (
                  <div key={v} className={`rounded-md p-2 ${t.winner === v ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'bg-slate-50'}`}>
                    <p className="text-[11px] text-slate-500">Variant {v}</p>
                    <p className="text-lg font-semibold tabular-nums">{p(t[v].replyRate)}</p>
                    <p className="text-[11px] text-slate-500">{t[v].replied}/{t[v].contacted} replied · {t[v].positive} positive</p>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">{t.note}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
