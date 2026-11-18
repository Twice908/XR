'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { Spinner } from '@astryxdesign/core/Spinner'
import { useAuth } from '@/lib/auth'
import { Wordmark } from './Wordmark'

/** Centered card on a faint grid: the signed-out pages. Redirects away once signed in. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (status === 'signedIn') router.replace('/')
  }, [status, router])

  if (status === 'loading' || status === 'signedIn') {
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <Spinner size="lg" />
      </main>
    )
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '32px 16px', position: 'relative', overflow: 'hidden' }}>
      <div className="vc-grid-bg" aria-hidden style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'relative', width: 'min(400px, 100%)' }}>
        <VStack gap={6}>
          <VStack gap={4} hAlign="center">
            <Wordmark />
            <VStack gap={1} hAlign="center">
              <Heading level={1} type="display-3" weight="semibold">
                {title}
              </Heading>
              <Text type="supporting" justify="center">
                {subtitle}
              </Text>
            </VStack>
          </VStack>
          <div className="vc-hairline" style={{ padding: 24 }}>
            {children}
          </div>
          {footer ? (
            <Text type="supporting" justify="center">
              {footer}
            </Text>
          ) : null}
        </VStack>
      </div>
    </main>
  )
}
