'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Link } from '@astryxdesign/core/Link'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { AuthShell } from '@/components/AuthShell'
import { AuthError, useAuth } from '@/lib/auth'

export default function RegisterPage() {
  const { register } = useAuth()
  const router = useRouter()
  const [form, setForm] = useState({ username: '', email: '', password: '', inviteCode: '' })
  const [error, setError] = useState<string | null>(null)
  const [errs, setErrs] = useState<Record<string, string | undefined>>({})
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    const next = {
      username: /^[a-zA-Z0-9_.-]{3,32}$/.test(form.username) ? undefined : 'Use 3–32 letters, numbers, . _ -',
      password: form.password.length >= 8 ? undefined : 'Use at least 8 characters',
      inviteCode: form.inviteCode.trim() ? undefined : 'An invite code is required',
    }
    setErrs(next)
    setError(null)
    if (Object.values(next).some(Boolean)) return
    setBusy(true)
    try {
      await register({ ...form, inviteCode: form.inviteCode.trim() })
      router.replace('/')
    } catch (e) {
      if (e instanceof AuthError && e.status === 409) setErrs({ username: e.message })
      else if (e instanceof AuthError && e.status === 403) setErrs({ inviteCode: e.message })
      else setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Create your account" subtitle="Instructor accounts need an invite code." footer={<>Already have an account? <Link href="/login">Log in</Link></>}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        noValidate
      >
        <VStack gap={4}>
          {error ? <Banner status="error" title={error} collapsible={false} /> : null}
          <TextInput label="Username" value={form.username} onChange={set('username')} autoComplete="username" hasAutoFocus status={errs.username ? { type: 'error', message: errs.username } : undefined} />
          <TextInput label="Email" isOptional type="email" value={form.email} onChange={set('email')} autoComplete="email" />
          <TextInput label="Password" type="password" description="At least 8 characters" value={form.password} onChange={set('password')} autoComplete="new-password" status={errs.password ? { type: 'error', message: errs.password } : undefined} />
          <TextInput label="Invite code" value={form.inviteCode} onChange={set('inviteCode')} onEnter={() => void submit()} status={errs.inviteCode ? { type: 'error', message: errs.inviteCode } : undefined} />
          <Button label="Create account" variant="primary" size="lg" type="submit" width="100%" isLoading={busy} />
        </VStack>
      </form>
    </AuthShell>
  )
}
