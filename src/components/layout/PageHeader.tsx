import type { LucideIcon } from 'lucide-react'

/** Consistent page heading: small section label, title, one-line description, actions on the right */
export default function PageHeader({ section, title, description, icon: Icon, actions }: {
  section?: string
  title: string
  description?: React.ReactNode
  icon?: LucideIcon
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/80 pb-5">
      <div className="min-w-0">
        {section && <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-indigo-600">{section}</p>}
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
          {Icon && <Icon className="h-5 w-5 text-slate-400" />}
          {title}
        </h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
