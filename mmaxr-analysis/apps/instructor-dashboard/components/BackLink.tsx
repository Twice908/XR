'use client'

import { useRouter } from 'next/navigation'
import { Link } from '@astryxdesign/core/Link'
import { previousPath } from '@/lib/navTrail'

/** A "← parent" link. If the parent is the page we just came from it goes back; otherwise it replaces this page. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter()
  return (
    <Link
      href={href}
      onClick={(e: React.MouseEvent) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        if (previousPath() === href) router.back()
        else router.replace(href)
      }}
    >
      {children}
    </Link>
  )
}
