import { useState } from 'react'
import { Activity, Check, ChevronsUpDown, Globe, LogOut } from 'lucide-react'
import type { Site } from '../shared/api'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { favicon } from '@/lib/format'

export function Favicon({ host, className = 'size-4' }: { host: string; className?: string }) {
  return <img src={favicon(host)} alt="" className={`${className} shrink-0 rounded-sm`} />
}

function SiteSwitcher({
  sites,
  account,
  site,
  onSelect,
}: {
  sites: Site[]
  account: string
  site: string
  onSelect: (account: string, site: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = sites.find((s) => s.accountId === account && s.siteTag === site)
  const accounts = [...new Map(sites.map((s) => [s.accountId, s.accountName]))]
  const pick = (a: string, s: string) => {
    onSelect(a, s)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium hover:bg-accent">
          {current ? <Favicon host={current.host} /> : <Globe className="size-4 text-muted-foreground" />}
          <span className="max-w-[40vw] truncate sm:max-w-none">{current?.host ?? 'All sites'}</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 rounded-xl border border-line-strong p-0 ring-0">
        <Command className="rounded-xl bg-card">
          <CommandInput placeholder="Find a site…" />
          <CommandList>
            <CommandEmpty>No sites found.</CommandEmpty>
            {accounts.map(([id, name]) => (
              <CommandGroup key={id} heading={name}>
                <CommandItem value={`${name} all sites`} onSelect={() => pick(id, 'all')}>
                  <Globe className="text-muted-foreground" />
                  All sites
                  {account === id && site === 'all' && <Check className="ml-auto" />}
                </CommandItem>
                {sites
                  .filter((s) => s.accountId === id)
                  .map((s) => (
                    <CommandItem key={s.siteTag} value={`${name} ${s.host}`} onSelect={() => pick(id, s.siteTag)}>
                      <Favicon host={s.host} />
                      <span className="truncate">{s.host}</span>
                      {account === id && site === s.siteTag && <Check className="ml-auto" />}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const TABS = [
  { label: 'Analytics', to: '/' },
  { label: 'Logs', to: '/logs' },
]

function Nav({ path, onNavigate, className }: { path: string; onNavigate: (to: string) => void; className: string }) {
  return (
    <nav className={className}>
      {TABS.map((t) => (
        <a
          key={t.to}
          href={t.to}
          onClick={(e) => {
            e.preventDefault()
            onNavigate(t.to)
          }}
          className={`flex items-center border-b-2 px-3 text-sm ${path === t.to ? 'border-[#ededed] text-[#ededed]' : 'border-transparent text-[#a1a1a1] hover:text-[#ededed]'}`}
        >
          {t.label}
        </a>
      ))}
    </nav>
  )
}

export default function Header({
  sites,
  account,
  site,
  path,
  onSelect,
  onNavigate,
  onLogout,
}: {
  sites: Site[]
  account: string
  site: string
  path: string
  onSelect: (account: string, site: string) => void
  onNavigate: (to: string) => void
  onLogout: () => void
}) {
  return (
    <>
    <header className="relative flex h-14 items-center justify-between border-b border-border bg-background px-4 sm:px-6">
      <div className="flex items-center gap-1.5">
        <div className="flex size-7 items-center justify-center rounded-md border border-border bg-card">
          <Activity className="size-4" />
        </div>
        <span className="text-lg text-line-strong">/</span>
        <SiteSwitcher sites={sites} account={account} site={site} onSelect={onSelect} />
      </div>
      <Nav path={path} onNavigate={onNavigate} className="absolute -bottom-px left-1/2 top-0 hidden -translate-x-1/2 sm:flex" />
      <Button variant="ghost" aria-label="Log out" onClick={onLogout} className="h-9 px-3 text-muted-foreground">
        <LogOut />
        <span className="hidden sm:inline">Log out</span>
      </Button>
    </header>
    <Nav path={path} onNavigate={onNavigate} className="flex h-10 shrink-0 border-b border-border bg-background px-1.5 sm:hidden [&>a]:-mb-px" />
    </>
  )
}
