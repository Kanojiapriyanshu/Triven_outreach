'use client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import Image from 'next/image'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

// useSearchParams must be inside a Suspense boundary for static export
function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Login failed'); return }
      toast.success('Welcome back!')
      const from = searchParams.get('from') || '/'
      router.push(from)
      router.refresh()
    } catch {
      toast.error('Network error – please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-7 shadow-2xl shadow-black/40 backdrop-blur">
      <h2 className="text-lg font-semibold text-white">Sign in</h2>
      <p className="text-sm text-slate-400 mt-1 mb-6">Use your Triven workspace account.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Email address</label>
          <input
            type="email" required autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-white/10 bg-white/[0.04] text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-gold/60 focus:border-transparent"
            placeholder="you@company.com"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'} required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 pl-3 pr-10 rounded-lg border border-white/10 bg-white/[0.04] text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-gold/60 focus:border-transparent"
              placeholder="••••••••"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <button type="submit" disabled={loading}
          className="w-full h-10 rounded-lg bg-brand-gold text-ink text-sm font-semibold hover:bg-brand-yellow disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-ink flex items-center justify-center p-4">
      {/* soft brand glow */}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-brand-gold/10 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Image src="/brand/triven-mark.png" alt="Triven" width={56} height={56} priority className="h-14 w-14 mb-4" />
          <h1 className="text-2xl font-semibold tracking-tight text-white">Triven</h1>
          <p className="text-slate-400 text-sm mt-1">Growth suite</p>
        </div>
        <Suspense fallback={
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center text-slate-400 text-sm">
            Loading…
          </div>
        }>
          <LoginForm />
        </Suspense>
        <p className="text-center text-xs text-slate-600 mt-6">© {new Date().getFullYear()} Triven</p>
      </div>
    </div>
  )
}
