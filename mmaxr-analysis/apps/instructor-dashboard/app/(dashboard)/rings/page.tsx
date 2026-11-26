'use client'

import { useMemo, useState } from 'react'
import { Avatar } from '@astryxdesign/core/Avatar'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { NumberInput } from '@astryxdesign/core/NumberInput'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { RING_META, WeekRings } from '@/components/WeekRings'
import { useClassRings, useRingGoals, useStudents } from '@/hooks/useSessionData'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { RingGoals, StudentRings } from '@/lib/types'
import { shiftWeek, weekKey, weekLabel } from '@/lib/weeks'

type Filter = 'all' | 'stalled' | 'closed'
const LEVEL: Record<StudentRings['level'], string> = { light: 'Light', standard: 'Standard', stretch: 'Stretch' }

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

/** The weekly goals every student's Standard level is built from. Light halves them, Stretch adds half again. */
function GoalsEditor({ onSaved }: { onSaved: () => void }) {
  const { token } = useAuth()
  const goals = useRingGoals()
  const [draft, setDraft] = useState<RingGoals | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const value = draft ?? goals.data ?? null
  if (!value) return <Spinner label="Loading goals" />

  const set = (key: keyof RingGoals) => (n: number) => {
    setSaved(false)
    setDraft({ ...value, [key]: n })
  }
  const save = async () => {
    if (!token || !draft) return
    setSaving(true)
    setError(null)
    try {
      await goals.mutate(await api.setRingGoals(draft, token), { revalidate: false })
      setDraft(null)
      setSaved(true)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padding={5}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>
            Weekly goals
          </Heading>
          <Text type="supporting" size="sm">
            The Standard goal for every student. Students who pick Light get half (at least 1); Stretch adds half again. Labs only count once a week, however often they are repeated.
          </Text>
        </VStack>
        <Grid columns={{ minWidth: 180, repeat: 'fit' }} gap={4}>
          <NumberInput label="Complete: labs finished" value={value.completeCount} onChange={set('completeCount')} min={1} max={50} isIntegerOnly />
          <NumberInput label="Master: labs at mastery" value={value.masterCount} onChange={set('masterCount')} min={1} max={50} isIntegerOnly />
          <NumberInput label="Mastery score (%)" value={value.masteryPercent} onChange={set('masteryPercent')} min={1} max={100} isIntegerOnly />
          <NumberInput label="Explore: active minutes" value={value.exploreMinutes} onChange={set('exploreMinutes')} min={1} max={1000} isIntegerOnly />
        </Grid>
        {error ? <Banner status="error" title="Could not save" description={error} collapsible={false} /> : null}
        <HStack gap={3} vAlign="center">
          <Button label="Save goals" variant="primary" isDisabled={!draft} isLoading={saving} onClick={() => void save()} />
          {draft ? <Button label="Cancel" variant="ghost" onClick={() => setDraft(null)} /> : null}
          {saved && !draft ? <Text type="supporting" size="sm">Saved. Rings update on the students’ next visit.</Text> : null}
        </HStack>
      </VStack>
    </Card>
  )
}

export default function RingsPage() {
  const thisWeek = weekKey()
  const [week, setWeek] = useState(thisWeek)
  const [filter, setFilter] = useState<Filter>('all')
  const [showGoals, setShowGoals] = useState(false)
  const rings = useClassRings(week)
  const students = useStudents()

  const names = useMemo(() => new Map((students.data ?? []).map((s) => [s.id, s.username])), [students.data])
  const rows = useMemo(
    () =>
      (rings.data?.students ?? [])
        .filter((s) => (filter === 'stalled' ? s.stalled : filter === 'closed' ? s.allClosed : true))
        // Students who need a nudge first, then by how much of the week they have done.
        .sort((a, b) => Number(b.stalled) - Number(a.stalled) || a.complete.percent + a.master.percent + a.explore.percent - (b.complete.percent + b.master.percent + b.explore.percent)),
    [rings.data, filter],
  )
  const summary = rings.data?.summary
  const error = rings.error as Error | undefined

  return (
    <VStack gap={8}>
      <VStack gap={1}>
        <Heading level={1} type="display-3" weight="semibold">
          Learning rings
        </Heading>
        <Text type="supporting">Each student’s three weekly rings: labs finished, labs mastered, and active minutes. Stalled students finished nothing this week or last.</Text>
      </VStack>

      <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
        <HStack gap={2} vAlign="center">
          <Button label="← Previous week" variant="ghost" size="sm" onClick={() => setWeek(shiftWeek(week, -1))} />
          <VStack gap={0}>
            <Text weight="semibold">{week === thisWeek ? 'This week' : weekLabel(week)}</Text>
            <Text type="supporting" size="xsm">
              {week} · {weekLabel(week)}
            </Text>
          </VStack>
          <Button label="Next week →" variant="ghost" size="sm" isDisabled={week >= thisWeek} onClick={() => setWeek(shiftWeek(week, 1))} />
        </HStack>
        <Button label={showGoals ? 'Hide weekly goals' : 'Edit weekly goals'} variant="secondary" size="sm" onClick={() => setShowGoals(!showGoals)} />
      </HStack>

      {showGoals ? <GoalsEditor onSaved={() => void rings.mutate()} /> : null}

      {error ? <Banner status="error" title="Could not load rings" description={error.message} collapsible={false} /> : null}

      <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={4}>
        <Stat label="Students" value={summary ? String(summary.students) : '–'} hint="With any lab activity" />
        <Stat label="All rings closed" value={summary ? String(summary.allClosed) : '–'} hint="Met every goal this week" />
        <Stat label="Stalled" value={summary ? String(summary.stalled) : '–'} hint="No lab finished this week or last" />
        {rings.data ? (
          <Stat
            label="Standard goal"
            value={`${rings.data.goals.completeCount} · ${rings.data.goals.masterCount} · ${rings.data.goals.exploreMinutes}`}
            hint={`labs · mastered at ${rings.data.goals.masteryPercent}% · minutes`}
          />
        ) : null}
      </Grid>

      <VStack gap={4}>
        <SegmentedControl label="Show" value={filter} onChange={(v) => setFilter(v as Filter)}>
          <SegmentedControlItem value="all" label="Everyone" />
          <SegmentedControlItem value="stalled" label={`Stalled${summary ? ` (${summary.stalled})` : ''}`} />
          <SegmentedControlItem value="closed" label={`All closed${summary ? ` (${summary.allClosed})` : ''}`} />
        </SegmentedControl>

        {rings.isLoading ? (
          <VStack hAlign="center" padding={10}>
            <Spinner label="Loading rings" />
          </VStack>
        ) : rows.length === 0 && !error ? (
          <EmptyState title={filter === 'all' ? 'No activity yet' : 'Nobody here'} description={filter === 'all' ? 'Students appear once they have run a lab.' : 'No student matches this filter for the week.'} />
        ) : rows.length > 0 ? (
          <div className="vc-hairline" style={{ overflow: 'hidden' }}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Rings</TableHeaderCell>
                  {RING_META.map((m) => (
                    <TableHeaderCell key={m.key}>
                      <span style={{ color: m.color }}>●</span> {m.name}
                    </TableHeaderCell>
                  ))}
                  <TableHeaderCell>Goal</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => {
                  const name = names.get(s.studentId) ?? 'Unknown student'
                  return (
                    <TableRow key={s.studentId}>
                      <TableCell>
                        <Link href={`/students/${encodeURIComponent(s.studentId)}`}>
                          <HStack gap={3} vAlign="center">
                            <Avatar name={name} size="sm" tooltip={false} />
                            <span>{name}</span>
                          </HStack>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <WeekRings rings={s} size={36} />
                      </TableCell>
                      {RING_META.map((m) => (
                        <TableCell key={m.key}>
                          <Text hasTabularNumbers weight={s[m.key].closed ? 'semibold' : undefined}>
                            {s[m.key].value} / {s[m.key].goal}
                          </Text>
                        </TableCell>
                      ))}
                      <TableCell>
                        <Text type="supporting">{LEVEL[s.level]}</Text>
                      </TableCell>
                      <TableCell>{s.allClosed ? <Badge label="All closed" variant="success" /> : s.stalled ? <Badge label="Stalled" variant="warning" /> : <Badge label="In progress" variant="neutral" />}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </VStack>
    </VStack>
  )
}
