'use client'

import { useMemo, useState } from 'react'
import { Avatar } from '@astryxdesign/core/Avatar'
import { Banner } from '@astryxdesign/core/Banner'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { DeviceTag } from '@/components/DeviceTag'
import { useStudentActivity, useStudents } from '@/hooks/useSessionData'
import { relativeTime } from '@/lib/trace'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card padding={4}>
      <VStack gap={1}>
        <Text type="supporting" size="sm">
          {label}
        </Text>
        <Text size="3xl" weight="semibold" hasTabularNumbers>
          {value}
        </Text>
        {hint ? (
          <Text type="supporting" size="xsm">
            {hint}
          </Text>
        ) : null}
      </VStack>
    </Card>
  )
}

export default function StudentsPage() {
  const students = useStudents()
  const activity = useStudentActivity()
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const byId = new Map((activity.data ?? []).map((a) => [a.student_id, a]))
    return (students.data ?? [])
      .map((s) => {
        const a = byId.get(s.id)
        return { ...s, sessions: a ? Number(a.sessions) : 0, lastUpdate: a ? Number(a.last_update) : 0, usedWeb: !!a?.used_web, usedVr: !!a?.used_vr }
      })
      .filter((s) => s.username.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => b.lastUpdate - a.lastUpdate || a.username.localeCompare(b.username))
  }, [students.data, activity.data, query])

  const loading = students.isLoading
  const error = students.error as Error | undefined
  const all = students.data ?? []
  const active = rows.filter((r) => r.sessions > 0).length
  const totalSessions = rows.reduce((n, r) => n + r.sessions, 0)

  return (
    <VStack gap={8}>
      <VStack gap={1}>
        <Heading level={1} type="display-3" weight="semibold">
          Students
        </Heading>
        <Text type="supporting">Pick a student to see the labs they have run and how they worked.</Text>
      </VStack>

      {error ? <Banner status="error" title="Could not load students" description={error.message} collapsible={false} /> : null}

      <Grid columns={{ minWidth: 220, repeat: 'fit' }} gap={4}>
        <Stat label="Students" value={loading ? '–' : String(all.length)} hint="Enrolled accounts" />
        <Stat label="With sessions" value={loading ? '–' : String(active)} hint="Have run at least one lab" />
        <Stat label="Sessions" value={loading ? '–' : String(totalSessions)} hint="Across all students" />
      </Grid>

      <VStack gap={4}>
        <div style={{ maxWidth: 360 }}>
          <TextInput label="Search students" isLabelHidden placeholder="Search by username" value={query} onChange={setQuery} hasClear />
        </div>

        {loading ? (
          <VStack hAlign="center" padding={10}>
            <Spinner label="Loading students" />
          </VStack>
        ) : rows.length === 0 && !error ? (
          <EmptyState title={all.length === 0 ? 'No students yet' : 'No match'} description={all.length === 0 ? 'Students appear here once they create an account in the lab app.' : 'Try a different name.'} />
        ) : rows.length > 0 ? (
          <div className="vc-hairline" style={{ overflow: 'hidden' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Sessions</TableHeaderCell>
                  <TableHeaderCell>Devices</TableHeaderCell>
                  <TableHeaderCell>Last active</TableHeaderCell>
                  <TableHeaderCell> </TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/students/${encodeURIComponent(s.id)}`}>
                        <HStack gap={3} vAlign="center">
                          <Avatar name={s.username} size="sm" tooltip={false} />
                          <span>{s.username}</span>
                        </HStack>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Text hasTabularNumbers>{s.sessions}</Text>
                    </TableCell>
                    <TableCell>
                      <HStack gap={1}>
                        {s.usedWeb ? <DeviceTag device="web" /> : null}
                        {s.usedVr ? <DeviceTag device="vr" /> : null}
                        {!s.usedWeb && !s.usedVr ? <Text type="supporting">–</Text> : null}
                      </HStack>
                    </TableCell>
                    <TableCell>
                      <Text type="supporting">{s.lastUpdate ? relativeTime(s.lastUpdate) : 'No sessions yet'}</Text>
                    </TableCell>
                    <TableCell>
                      <Link href={`/students/${encodeURIComponent(s.id)}`}>Sessions →</Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </VStack>
    </VStack>
  )
}
