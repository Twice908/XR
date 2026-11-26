'use client'

import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useStudentCollection } from '@/hooks/useSessionData'
import { relativeTime } from '@/lib/trace'
import type { CardRarity } from '@/lib/types'

const SUBJECTS = [
  { id: 'chemistry', label: 'Chemistry' },
  { id: 'physics', label: 'Physics' },
  { id: 'mathematics', label: 'Mathematics' },
  { id: 'biology', label: 'Biology' },
]
const RARITY: Record<CardRarity, { label: string; variant: 'neutral' | 'info' | 'success' | 'warning' }> = {
  common: { label: 'Common', variant: 'neutral' },
  rare: { label: 'Rare', variant: 'info' },
  epic: { label: 'Epic', variant: 'success' },
  legendary: { label: 'Legendary', variant: 'warning' },
}

/**
 * A student's card collection, read as topic coverage: each set is a slice of the syllabus, so the bars show which
 * areas they have explored. Cards come only from finished labs.
 */
export function StudentCollection({ studentId }: { studentId: string }) {
  const col = useStudentCollection(studentId)
  if (col.isLoading) {
    return (
      <VStack hAlign="center" padding={10}>
        <Spinner label="Loading collection" />
      </VStack>
    )
  }
  if (col.error) return <Banner status="error" title="Could not load the collection" description={(col.error as Error).message} collapsible={false} />
  const data = col.data
  if (!data || data.totals.owned === 0) return <EmptyState title="No cards yet" description="Students earn a card pack each time they finish a lab." />

  const recent = data.cards
    .filter((c) => c.owned && c.firstObtainedAt)
    .sort((a, b) => new Date(b.firstObtainedAt!).getTime() - new Date(a.firstObtainedAt!).getTime())
    .slice(0, 12)

  return (
    <VStack gap={6}>
      <Text type="supporting">
        {data.totals.owned} of {data.totals.total} cards collected · {data.shards} shards. Each set covers one strand of the syllabus.
      </Text>
      <Grid columns={{ minWidth: 210, repeat: "fit" }} gap={4}>
        {SUBJECTS.map((subject) => {
          const sets = data.sets.filter((s) => s.subject === subject.id)
          const owned = sets.reduce((n, s) => n + s.owned, 0)
          const total = sets.reduce((n, s) => n + s.total, 0)
          return (
            <Card key={subject.id} padding={4}>
              <VStack gap={3}>
                <HStack justify="between" vAlign="center">
                  <Heading level={3}>{subject.label}</Heading>
                  <Text type="supporting" size="sm" hasTabularNumbers>
                    {owned} / {total}
                  </Text>
                </HStack>
                {sets.map((s) => (
                  <ProgressBar key={s.set} label={s.title} value={s.owned} max={s.total} hasValueLabel formatValueLabel={(v, m) => `${v} / ${m}`} />
                ))}
              </VStack>
            </Card>
          )
        })}
      </Grid>
      <VStack gap={3}>
        <Heading level={3}>Most recent cards</Heading>
        <div className="vc-hairline" style={{ overflow: 'hidden' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Card</TableHeaderCell>
                <TableHeaderCell>Set</TableHeaderCell>
                <TableHeaderCell>Rarity</TableHeaderCell>
                <TableHeaderCell>Copies</TableHeaderCell>
                <TableHeaderCell>First found</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Text weight="semibold">{c.title}</Text> <Text type="supporting">{c.subtitle}</Text>
                  </TableCell>
                  <TableCell>
                    <Text type="supporting">{data.sets.find((s) => s.set === c.set)?.title ?? c.set}</Text>
                  </TableCell>
                  <TableCell>
                    <HStack gap={1}>
                      <Badge label={RARITY[c.rarity].label} variant={RARITY[c.rarity].variant} />
                      {c.foil ? <Badge label="Foil" variant="neutral" /> : null}
                    </HStack>
                  </TableCell>
                  <TableCell>
                    <Text hasTabularNumbers>{c.count ?? 1}</Text>
                  </TableCell>
                  <TableCell>
                    <Text type="supporting">{relativeTime(new Date(c.firstObtainedAt!).getTime())}</Text>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </VStack>
    </VStack>
  )
}
