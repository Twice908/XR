'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HStack } from '@astryxdesign/core/HStack'
import { Spinner } from '@astryxdesign/core/Spinner'
import { AccountMenu } from '@/components/AccountMenu'
import { Wordmark } from '@/components/Wordmark'
import { useAuth } from '@/lib/auth'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()

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
          <Link href="/" aria-label="MMAXR home" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Wordmark compact />
          </Link>
          <AccountMenu />
        </HStack>
      </header>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px 64px' }}>{children}</main>
    </div>
  )
}
