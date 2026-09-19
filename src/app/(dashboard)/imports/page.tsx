'use client'
import { useState, useRef } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import {
  Upload, FileText, CheckCircle, AlertCircle, ArrowRight,
  AlertTriangle, RefreshCw, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fmtDate } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const DB_FIELDS = [
  { value: '', label: '— Skip —' },
  { value: 'companyName', label: 'Company Name' },
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName', label: 'Last Name' },
  { value: 'fullName', label: 'Full Name' },
  { value: 'jobTitle', label: 'Job Title' },
  { value: 'companyEmail', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'website', label: 'Website' },
  { value: 'linkedIn', label: 'LinkedIn' },
  { value: 'industry', label: 'Industry' },
  { value: 'country', label: 'Country' },
  { value: 'state', label: 'State' },
  { value: 'city', label: 'City' },
  { value: 'companySize', label: 'Company Size' },
  { value: 'senderAccount', label: 'Sender Gmail (email)' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'notes', label: 'Notes' },
  { value: 'personalizationNotes', label: 'Personalization Notes' },
  { value: 'companyPainPoint', label: 'Pain Point' },
  { value: 'whyThisLead', label: 'Why This Lead' },
  { value: 'firstEmailSubject', label: 'First Email Subject' },
  { value: 'firstEmailBody', label: 'First Email Body' },
  { value: 'firstEmailSentAt', label: 'First Email Sent Date' },
  { value: 'followUp1SentAt', label: 'Follow-up 1 Sent Date' },
  { value: 'followUp2SentAt', label: 'Follow-up 2 Sent Date' },
  { value: 'followUp3SentAt', label: 'Follow-up 3 Sent Date' },
]

// Auto-detect column mapping by header name
function autoDetect(col: string): string {
  const c = col.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (/company|bizname|businessname/.test(c)) return 'companyName'
  if (/firstname|first/.test(c)) return 'firstName'
  if (/lastname|last/.test(c)) return 'lastName'
  if (/fullname|name/.test(c)) return 'fullName'
  if (/jobtitle|title|role/.test(c)) return 'jobTitle'
  if (/email/.test(c)) return 'companyEmail'
  if (/phone|mobile|cell/.test(c)) return 'phone'
  if (/website|url|domain/.test(c)) return 'website'
  if (/linkedin/.test(c)) return 'linkedIn'
  if (/industry|sector/.test(c)) return 'industry'
  if (/country/.test(c)) return 'country'
  if (/state|province/.test(c)) return 'state'
  if (/city|location/.test(c)) return 'city'
  if (/size|employees/.test(c)) return 'companySize'
  if (/sender|gmail|from/.test(c)) return 'senderAccount'
  if (/status/.test(c)) return 'status'
  if (/priority/.test(c)) return 'priority'
  if (/note/.test(c)) return 'notes'
  if (/personal|personali/.test(c)) return 'personalizationNotes'
  if (/pain/.test(c)) return 'companyPainPoint'
  if (/firstemailsentfirstsent/.test(c) || /firstdate/.test(c)) return 'firstEmailSentAt'
  if (/firstemail/.test(c)) return 'firstEmailSubject'
  if (/followup1date|fu1date|followup1sent/.test(c)) return 'followUp1SentAt'
  if (/followup2date|fu2date|followup2sent/.test(c)) return 'followUp2SentAt'
  if (/followup3date|fu3date|followup3sent/.test(c)) return 'followUp3SentAt'
  return ''
}

type Step = 'upload' | 'map' | 'validate' | 'confirm' | 'done'

export default function ImportsPage() {
  const { data: imports, mutate } = useSWR('/api/imports', fetcher)

  const [step, setStep] = useState<Step>('upload')
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<{ importId: string; columns: string[]; sampleRows: Record<string, string>[]; totalRows: number } | null>(null)
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [validating, setValidating] = useState(false)
  const [validation, setValidation] = useState<{ totalRows: number; validRows: number; duplicateRows: number; errorRows: number; missingEmail: number; unknownSender: number } | null>(null)
  const [importing, setImporting] = useState(false)
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'update'>('skip')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/imports', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) return toast.error(data.error || 'Upload failed')
      setPreview(data)
      // Auto-detect mappings
      const detected: Record<string, string> = {}
      for (const col of data.columns) {
        detected[col] = autoDetect(col)
      }
      setColumnMapping(detected)
      setStep('map')
      mutate()
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleValidate() {
    if (!preview) return
    setValidating(true)
    try {
      const res = await fetch(`/api/imports/${preview.importId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnMapping }),
      })
      const data = await res.json()
      if (!res.ok) return toast.error(data.error)
      setValidation(data)
      setStep('validate')
    } finally {
      setValidating(false) }
  }

  async function handleImport() {
    if (!preview) return
    setImporting(true)
    try {
      const res = await fetch(`/api/imports/${preview.importId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duplicateAction }),
      })
      const data = await res.json()
      if (!res.ok) return toast.error(data.error)
      toast.success(`Imported ${data.importedRows} leads!`)
      setStep('done')
      mutate()
    } finally {
      setImporting(false) }
  }

  function reset() {
    setStep('upload')
    setPreview(null)
    setColumnMapping({})
    setValidation(null)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Import Leads</h1>
        <p className="text-sm text-slate-500">Import from CSV or Excel (.xlsx)</p>
      </div>

      {/* Wizard steps */}
      <div className="flex items-center gap-2">
        {(['upload', 'map', 'validate', 'confirm', 'done'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
              step === s ? 'bg-indigo-600 text-white' :
              (['upload', 'map', 'validate', 'confirm', 'done'].indexOf(step) > i) ? 'bg-green-600 text-white' :
              'bg-slate-200 text-slate-500'
            }`}>
              {(['upload', 'map', 'validate', 'confirm', 'done'].indexOf(step) > i) ? '✓' : i + 1}
            </div>
            <span className="text-xs capitalize hidden sm:inline text-slate-600">{s}</span>
            {i < 4 && <ArrowRight className="h-3 w-3 text-slate-300" />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <Card>
          <CardContent className="py-12">
            <div
              className="border-2 border-dashed border-slate-300 rounded-xl p-12 flex flex-col items-center text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-12 w-12 text-slate-300 mb-3" />
              <h3 className="text-lg font-semibold text-slate-700">Upload your spreadsheet</h3>
              <p className="text-sm text-slate-400 mt-1">CSV or Excel (.xlsx) — up to 10,000 rows</p>
              <Button size="sm" className="mt-4" loading={uploading}>
                {uploading ? 'Uploading…' : 'Choose File'}
              </Button>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileUpload} />
          </CardContent>
        </Card>
      )}

      {/* Step 2: Column mapping */}
      {step === 'map' && preview && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Map Columns</CardTitle>
              <p className="text-sm text-slate-500">
                File: <strong>{preview.totalRows}</strong> rows · Map each column to a CRM field
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {preview.columns.map((col) => (
                  <div key={col} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                    <div className="w-40 shrink-0">
                      <p className="text-sm font-medium text-slate-700 truncate" title={col}>{col}</p>
                      {preview.sampleRows[0]?.[col] && (
                        <p className="text-xs text-slate-400 truncate">{preview.sampleRows[0][col]}</p>
                      )}
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-300 shrink-0" />
                    <Select value={columnMapping[col] || ''} onValueChange={(v) => setColumnMapping((prev) => ({ ...prev, [col]: v }))}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Skip this column" /></SelectTrigger>
                      <SelectContent>
                        {DB_FIELDS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {/* Preview table */}
              {preview.sampleRows.length > 0 && (
                <div className="mt-6">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Preview (first 5 rows)</p>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="bg-slate-50">
                          {preview.columns.slice(0, 6).map((col) => (
                            <th key={col} className="px-3 py-2 text-left text-slate-500 font-medium">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sampleRows.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            {preview.columns.slice(0, 6).map((col) => (
                              <td key={col} className="px-3 py-2 text-slate-600 max-w-[120px] truncate">{row[col] || ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button onClick={handleValidate} loading={validating}>Validate Mapping</Button>
          </div>
        </div>
      )}

      {/* Step 3: Validation results */}
      {step === 'validate' && validation && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Validation Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
                {[
                  { label: 'Total Rows', value: validation.totalRows, color: 'text-slate-900' },
                  { label: '✓ Valid', value: validation.validRows, color: 'text-green-600' },
                  { label: '⚠ Duplicates', value: validation.duplicateRows, color: 'text-amber-600' },
                  { label: '✗ Errors', value: validation.errorRows, color: 'text-red-600' },
                  { label: 'Missing Email', value: validation.missingEmail, color: 'text-orange-600' },
                  { label: 'Unknown Sender', value: validation.unknownSender, color: 'text-purple-600' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-slate-50 rounded-lg p-3 text-center">
                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {validation.duplicateRows > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <p className="text-sm font-medium text-amber-800 mb-2">How to handle duplicates?</p>
                  <div className="flex gap-3">
                    {(['skip', 'update'] as const).map((a) => (
                      <label key={a} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="dupAction" value={a} checked={duplicateAction === a} onChange={() => setDuplicateAction(a)} className="text-indigo-600" />
                        <span className="text-sm text-amber-800 capitalize">{a === 'skip' ? 'Skip duplicates (safe)' : 'Update existing (never overwrites outreach history)'}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {validation.errorRows > 0 && (
                <p className="text-xs text-slate-500">
                  {validation.errorRows} rows have errors and will be skipped. You can still import the {validation.validRows + validation.duplicateRows} valid rows.
                </p>
              )}
            </CardContent>
          </Card>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setStep('map')}>Back</Button>
            <Button onClick={handleImport} loading={importing}>
              Import {validation.validRows + (duplicateAction === 'update' ? validation.duplicateRows : 0)} Leads
            </Button>
          </div>
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
            <h3 className="text-xl font-bold text-slate-900">Import Complete!</h3>
            <p className="text-sm text-slate-500 mt-2">Your leads have been imported successfully.</p>
            <div className="flex gap-3 mt-6">
              <Button variant="outline" onClick={reset}><Upload className="h-4 w-4" />Import Another</Button>
              <Button asChild><a href="/leads">View Leads</a></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import history */}
      {(imports || []).length > 0 && step === 'upload' && (
        <Card>
          <CardHeader><CardTitle>Import History</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {(imports || []).map((imp: { id: string; fileName: string; fileType: string; totalRows: number; importedRows: number; status: string; createdAt: string }) => (
                <div key={imp.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-700">{imp.fileName}</p>
                      <p className="text-xs text-slate-400">{fmtDate(imp.createdAt)} · {imp.totalRows} rows</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">{imp.importedRows} imported</span>
                    <Badge variant={imp.status === 'COMPLETED' ? 'success' : imp.status === 'FAILED' ? 'destructive' : 'secondary'} className="text-xs">
                      {imp.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
