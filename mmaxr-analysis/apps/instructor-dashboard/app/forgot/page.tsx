'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Link } from '@astryxdesign/core/Link'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { AuthShell } from '@/components/AuthShell'
import { useAuth } from '@/lib/auth'

export default function ForgotPage() {
  const { forgotPassword, resetPassword } = useAuth()
  const router = useRouter()
  const [step, setStep] = useState<'request' | 'reset'>('request')
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const [devNote, setDevNote] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const request = async () => {
    setError(null)
    if (!username.trim()) return setError('Enter your username')
    setBusy(true)
    try {
      const res = await forgotPassword(username.trim())
      setInfo(res.message)
      if (res.devResetToken) {
        setToken(res.devResetToken)
        setDevNote(true)
      }
      setStep('reset')
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  const reset = async () => {
    setError(null)
    if (password.length < 8) return setError('Use at least 8 characters')
    setBusy(true)
    try {
      await resetPassword(token.trim(), password)
      router.replace('/login')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Reset your password" subtitle={step === 'request' ? 'Enter your username to start a reset.' : 'Choose a new password.'} footer={<Link href="/login">Back to log in</Link>}>
      <VStack gap={4}>
        {error ? <Banner status="error" title={error} collapsible={false} /> : null}
        {step === 'request' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void request()
            }}
            noValidate
          >
            <VStack gap={4}>
              <TextInput label="Username" value={username} onChange={setUsername} autoComplete="username" hasAutoFocus />
              <Button label="Send reset link" variant="primary" size="lg" type="submit" width="100%" isLoading={busy} />
            </VStack>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void reset()
            }}
            noValidate
          >
            <VStack gap={4}>
              {info ? <Banner status="info" title={info} collapsible={false} /> : null}
              <TextInput label="Reset code" value={token} onChange={setToken} description={devNote ? 'Filled in for you: no mail server is connected in development.' : 'Paste the code from your reset message.'} />
              <TextInput label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" hasAutoFocus />
              <Button label="Set new password" variant="primary" size="lg" type="submit" width="100%" isLoading={busy} />
            </VStack>
          </form>
        )}
      </VStack>
    </AuthShell>
  )
}
