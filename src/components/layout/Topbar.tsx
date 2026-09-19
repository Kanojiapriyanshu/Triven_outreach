'use client'
import { useState } from 'react'
import { Search, Bell, User } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface TopbarProps {
  title?: string
  userName?: string
}

export default function Topbar({ title, userName }: TopbarProps) {
  const [query, setQuery] = useState('')
  const router = useRouter()

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) {
      router.push(`/leads?q=${encodeURIComponent(query.trim())}`)
    }
  }

  return (
    <header className="fixed top-0 right-0 left-60 z-30 h-14 border-b border-slate-200 bg-white/90 backdrop-blur-sm flex items-center px-6 gap-4">
      {title && (
        <h1 className="text-base font-semibold text-slate-900 mr-4 shrink-0">{title}</h1>
      )}

      {/* Search */}
      <form onSubmit={handleSearch} className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads, companies, emails…"
            className="w-full h-8 pl-9 pr-4 rounded-lg border border-slate-200 bg-slate-50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
      </form>

      <div className="flex items-center gap-2 ml-auto">
        {/* Notifications */}
        <button className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500" />
        </button>

        {/* User */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-white text-xs font-semibold">
            {userName ? userName[0].toUpperCase() : <User className="h-4 w-4" />}
          </div>
          {userName && <span className="text-sm font-medium text-slate-700">{userName}</span>}
        </div>
      </div>
    </header>
  )
}
