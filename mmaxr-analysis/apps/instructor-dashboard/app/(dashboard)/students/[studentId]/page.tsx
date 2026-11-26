'use client'

import { usePathname } from 'next/navigation'
import { Avatar } from '@astryxdesign/core/Avatar'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { BackLink } from '@/components/BackLink'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { DeviceTag } from '@/components/DeviceTag'
import { useStudentSessions, useStudents } from '@/hooks/useSessionData'
import { formatDateTime, lessonLabel, relativeTime } from '@/lib/trace'

export default function StudentPage() {
  // Static export: the id is read from the URL (a rewrite serves one shell for every id).
  const studentId = usePathname().split('/').filter(Boolean).pop() ?? ''
  const id = decodeURIComponent(studentId)
  const sessions = useStudentSessions(id)
  const students = useStudents()
  const student = students.data?.find((s) => s.id === id)
  const name = student?.username ?? 'Student'
  const rows = sessions.data ?? []

  return (
    <VStack gap={8}>
      <VStack gap={4}>
        <BackLink href="/">← Students</BackLink>
        <HStack gap={4} vAlign="center">
          <Avatar name={name} size="lg" tooltip={false} />
          <VStack gap={1}>
            <Heading level={1} type="display-3" weight="semibold">
              {name}
            </Heading>
            <Text type="supporting">
              {sessions.isLoading ? 'Loading…' : `${rows.length} session${rows.length === 1 ? '' : 's'}`}
              {student ? ` · joined ${new Date(student.createdAt).toLocaleDateString()}` : ''}
            </Text>
          </VStack>
        </HStack>
      </VStack>

      {sessions.error ? <Banner status="error" title="Could not load sessions" description={(sessions.error as Error).message} collapsible={false} /> : null}

      {sessions.isLoading ? (
        <VStack hAlign="center" padding={10}>
          <Spinner label="Loading sessions" />
        </VStack>
      ) : rows.length === 0 && !sessions.error ? (
        <EmptyState title="No sessions yet" description="When this student runs a lab, the session appears here." />
      ) : rows.length > 0 ? (
        <div className="vc-hairline" style={{ overflow: 'hidden' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Lab</TableHeaderCell>
                <TableHeaderCell>Device</TableHeaderCell>
                <TableHeaderCell>Started</TableHeaderCell>
                <TableHeaderCell>Events</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell> </TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.session_id}>
                  <TableCell>
                    <Link href={`/sessions/${encodeURIComponent(s.session_id)}`}>{lessonLabel(s.lesson_id)}</Link>
                  </TableCell>
                  <TableCell>
                    <DeviceTag device={s.device} />
                  </TableCell>
                  <TableCell>
                    <span title={formatDateTime(Number(s.started_at))}>
                      <Text type="supporting">{relativeTime(Number(s.started_at))}</Text>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Text hasTabularNumbers>{String(s.event_count)}</Text>
                  </TableCell>
                  <TableCell>{(s.status ?? (s.completed ? 'completed' : 'left')) === 'left' ? <Badge label="Left early" variant="warning" /> : <Badge label="Completed" variant="success" />}</TableCell>
                  <TableCell>
                    <Link href={`/sessions/${encodeURIComponent(s.session_id)}`}>Open →</Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </VStack>
  )
}
