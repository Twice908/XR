'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { HStack } from '@astryxdesign/core/HStack'
import { Spinner } from '@astryxdesign/core/Spinner'
import { AccountMenu } from '@/components/AccountMenu'
import { Wordmark } from '@/components/Wordmark'
import { useAuth } from '@/lib/auth'
import { recordVisit } from '@/lib/navTrail'

const NAV = [
  { href: '/', label: 'Students' },
  { href: '/rings', label: 'Learning rings' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => recordVisit(pathname), [pathname])

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login')
  }, [status, router])

  if (status !== 'signedIn') {
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <Spinner size="lg" />
      </main>
    )
  }

  return (
    <div style={{ minHeight: '100dvh' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 20, borderBottom: '1px solid #ffffff1f', background: '#000000cc', backdropFilter: 'blur(12px)' }}>
        <HStack justify="between" vAlign="center" paddingInline={6} paddingBlock={3}>
          <HStack gap={6} vAlign="center">
            <Link href="/" aria-label="MMAXR home" style={{ textDecoration: 'none', color: 'inherit' }}>
              <Wordmark compact />
            </Link>
            <nav aria-label="Sections" style={{ display: 'flex', gap: 4 }}>
              {NAV.map((n) => {
                const active = n.href === '/' ? pathname === '/' || pathname.startsWith('/students') || pathname.startsWith('/sessions') : pathname.startsWith(n.href)
                return (
                  <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={active ? 'vc-nav is-active' : 'vc-nav'}>
                    {n.label}
                  </Link>
                )
              })}
            </nav>
          </HStack>
          <AccountMenu />
        </HStack>
      </header>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px 64px' }}>{children}</main>
    </div>
  )
}
