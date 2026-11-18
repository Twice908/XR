'use client'

import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid } from '@astryxdesign/core/Grid'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useSessionList } from '@/hooks/useSessionData'
import { relativeTime } from '@/lib/trace'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card padding={4} variant="default">
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

export default function SessionsPage() {
  const { data, error, isLoading } = useSessionList()
  const rows = data ?? []
  const events = rows.reduce((n, s) => n + Number(s.event_count), 0)
  const latest = rows.reduce((m, s) => Math.max(m, Number(s.last_update)), 0)

  return (
    <VStack gap={8}>
      <VStack gap={1}>
        <Heading level={1} type="display-3" weight="semibold">
          Sessions
        </Heading>
        <Text type="supporting">Every lab run, newest first. Open one to see how the student worked, step by step.</Text>
      </VStack>

      {error ? <Banner status="error" title="Could not load sessions" description={(error as Error).message} collapsible={false} /> : null}

      <Grid columns={{ minWidth: 220, repeat: 'fit' }} gap={4}>
        <Stat label="Sessions" value={isLoading ? '–' : String(rows.length)} hint="Most recent 10" />
        <Stat label="Events captured" value={isLoading ? '–' : events.toLocaleString()} hint="xAPI statements" />
        <Stat label="Last activity" value={isLoading || !latest ? '–' : relativeTime(latest)} />
      </Grid>

      {isLoading ? (
        <VStack hAlign="center" padding={10}>
          <Spinner label="Loading sessions" />
        </VStack>
      ) : rows.length === 0 && !error ? (
        <EmptyState title="No sessions yet" description="When a student finishes a step in the lab, their session appears here." />
      ) : rows.length > 0 ? (
        <div className="vc-hairline" style={{ overflow: 'hidden' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Session</TableHeaderCell>
                <TableHeaderCell>Events</TableHeaderCell>
                <TableHeaderCell>Last activity</TableHeaderCell>
                <TableHeaderCell> </TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.session_id}>
                  <TableCell>
                    <Link href={`/sessions/${encodeURIComponent(s.session_id)}`}>
                      <span className="vc-mono" title={s.session_id}>{s.session_id.length > 22 ? `${s.session_id.slice(0, 19)}…` : s.session_id}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge label={String(s.event_count)} variant="neutral" />
                  </TableCell>
                  <TableCell>
                    <Text type="supporting">{relativeTime(Number(s.last_update))}</Text>
                  </TableCell>
                  <TableCell>
                    <Link href={`/sessions/${encodeURIComponent(s.session_id)}`}>View →</Link>
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
