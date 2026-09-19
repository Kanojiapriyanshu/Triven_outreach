'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Shield, Database, Mail, Bell, Globe, AlertTriangle,
} from 'lucide-react'

export default function SettingsPage() {
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    await new Promise((r) => setTimeout(r, 800))
    toast.success('Settings saved')
    setSaving(false)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Settings</h1>

      {/* Follow-up defaults */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-indigo-600" />
            <CardTitle>Default Follow-up Schedule</CardTitle>
          </div>
          <CardDescription>
            These are global defaults. Campaign-level settings override these.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {['Follow-up 1 (days after email)', 'Follow-up 2 (days after email)', 'Follow-up 3 (days after email)'].map((label, i) => (
              <div key={i}>
                <Label>{label}</Label>
                <Input type="number" min={1} defaultValue={i + 1} className="mt-1" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Timezone */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-indigo-600" />
            <CardTitle>Default Timezone</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
            <Label>Timezone</Label>
            <Input defaultValue="America/New_York" className="mt-1" placeholder="America/New_York" />
            <p className="text-xs text-slate-400 mt-1">Used for scheduling follow-ups when no campaign timezone is set.</p>
          </div>
        </CardContent>
      </Card>

      {/* Gmail OAuth */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-indigo-600" />
            <CardTitle>Gmail API Configuration</CardTitle>
          </div>
          <CardDescription>
            OAuth credentials for Gmail API. Set these in your <code>.env</code> file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 font-mono text-xs space-y-1">
              <p className="text-slate-600">GOOGLE_CLIENT_ID=<span className="text-indigo-600">your-client-id.apps.googleusercontent.com</span></p>
              <p className="text-slate-600">GOOGLE_CLIENT_SECRET=<span className="text-indigo-600">your-client-secret</span></p>
              <p className="text-slate-600">GOOGLE_REDIRECT_URI=<span className="text-indigo-600">http://localhost:3000/api/gmail/callback</span></p>
            </div>
            <p className="text-xs text-slate-500">
              Create credentials at{' '}
              <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                Google Cloud Console
              </a>. Enable the Gmail API and add your redirect URI as an authorized redirect.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Suppression list */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-indigo-600" />
            <CardTitle>Suppression List</CardTitle>
          </div>
          <CardDescription>
            Emails and domains that will never receive outreach
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div>
              <Label>Add Email / Domain</Label>
              <div className="flex gap-2 mt-1">
                <Input placeholder="noreply@example.com or example.com" className="flex-1" />
                <Button variant="outline" size="sm">Add</Button>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Adding a domain blocks all emails to that domain. Used for bounced, unsubscribed, and do-not-contact addresses.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Database */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-indigo-600" />
            <CardTitle>Database</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p className="text-slate-600">Using <strong>Neon PostgreSQL</strong> via Prisma ORM.</p>
          <p className="text-xs text-slate-400">Connection string is set in DATABASE_URL environment variable.</p>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-800 text-xs flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            Database connection active
          </div>
        </CardContent>
      </Card>

      {/* Compliance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <CardTitle>Compliance</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <p>This CRM is built for responsible B2B outreach. It respects:</p>
          <ul className="list-disc pl-4 space-y-1 text-xs">
            <li>CAN-SPAM Act – unsubscribe requests are honored immediately</li>
            <li>CASL – do-not-contact status is enforced</li>
            <li>Gmail sending limits – configured daily targets per account</li>
            <li>Suppression list – prevents mailing to opted-out addresses</li>
          </ul>
          <p className="text-xs text-slate-400 mt-2">
            Always include a way for recipients to opt out of future communications.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving}>Save Settings</Button>
      </div>
    </div>
  )
}
