'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Link } from '@astryxdesign/core/Link'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { AuthShell } from '@/components/AuthShell'
import { useAuth } from '@/lib/auth'

export default function LoginPage() {
  const { login } = useAuth()
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({})
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const errs = { username: username.trim() ? undefined : 'Enter your username', password: password ? undefined : 'Enter your password' }
    setFieldErrors(errs)
    setError(null)
    if (errs.username || errs.password) return
    setBusy(true)
    try {
      await login(username.trim(), password)
      router.replace('/')
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Log in to MMAXR" subtitle="See how students think, not just what they answer." footer={<>No account? <Link href="/register">Create an instructor account</Link></>}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        noValidate
      >
        <VStack gap={4}>
          {error ? <Banner status="error" title={error} collapsible={false} /> : null}
          <TextInput label="Username" value={username} onChange={setUsername} autoComplete="username" hasAutoFocus status={fieldErrors.username ? { type: 'error', message: fieldErrors.username } : undefined} />
          <TextInput label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" onEnter={() => void submit()} status={fieldErrors.password ? { type: 'error', message: fieldErrors.password } : undefined} />
          <HStack justify="end">
            <Link href="/forgot">Forgot password?</Link>
          </HStack>
          <Button label="Sign In" variant="primary" size="lg" type="submit" width="100%" isLoading={busy} />
        </VStack>
      </form>
    </AuthShell>
  )
}
