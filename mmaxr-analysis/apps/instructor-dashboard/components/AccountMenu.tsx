'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { useAuth } from '@/lib/auth'

export function AccountMenu() {
  const { user, logout, deleteAccount } = useAuth()
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!user) return null

  const close = () => {
    setConfirming(false)
    setPassword('')
    setError(null)
    setBusy(false)
  }

  const remove = async () => {
    if (!password) return setError('Enter your password to confirm')
    setBusy(true)
    setError(null)
    try {
      await deleteAccount(password)
      router.replace('/login')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu
        button={{ label: user.username, variant: 'ghost', size: 'sm' }}
        placement="below"
        alignment="end"
        menuWidth={220}
        items={[
          { label: user.username, description: 'Instructor', isDisabled: true },
          { label: 'Log out', onClick: () => { logout(); router.replace('/login') } },
          { label: 'Delete account…', variant: 'destructive', onClick: () => setConfirming(true) },
        ]}
      />
      <Dialog isOpen={confirming} onOpenChange={(o) => !o && close()} purpose="form" width={420}>
        <VStack gap={4} padding={2}>
          <VStack gap={1}>
            <Heading level={2}>Delete your account?</Heading>
            <Text type="supporting">This permanently removes your instructor account and sign-in. Student records are not affected.</Text>
          </VStack>
          {error ? <Banner status="error" title={error} collapsible={false} /> : null}
          <TextInput label="Confirm with your password" type="password" value={password} onChange={setPassword} onEnter={() => void remove()} autoComplete="current-password" hasAutoFocus />
          <HStack gap={2} justify="end">
            <Button label="Cancel" variant="ghost" onClick={close} />
            <Button label="Delete account" variant="destructive" onClick={() => void remove()} isLoading={busy} />
          </HStack>
        </VStack>
      </Dialog>
    </>
  )
}
