'use client'

import { usePathname } from 'next/navigation'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { BackLink } from '@/components/BackLink'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { DeviceTag } from '@/components/DeviceTag'
import { ScoreRing } from '@/components/ScoreRing'
import { useSessionData, useStudents } from '@/hooks/useSessionData'
import { VERB_VARIANT, describeEvent, formatClock, formatDateTime, lessonLabel } from '@/lib/trace'

export default function SessionPage() {
  // Static export: the id is read from the URL (a rewrite serves one shell for every id).
  const sessionId = usePathname().split('/').filter(Boolean).pop() ?? ''
  const id = decodeURIComponent(sessionId)
  const { data, error, isLoading } = useSessionData(id)
  const students = useStudents()

  if (isLoading) {
    return (
      <VStack hAlign="center" padding={10}>
        <Spinner label="Loading session" />
      </VStack>
    )
  }
  if (error || !data) {
    return (
      <VStack gap={4}>
        <BackLink href="/">← Students</BackLink>
        <Banner status="error" title="Could not load this session" description={(error as Error | undefined)?.message ?? 'Session not found'} collapsible={false} />
      </VStack>
    )
  }

  const student = students.data?.find((s) => s.id === data.studentId)
  const t0 = data.trace[0]?.timestamp ?? 0
  const tEnd = data.trace[data.trace.length - 1]?.timestamp ?? t0
  const lesson = data.trace.find((e) => e.object_data?.action === 'enter_lab')?.object_data?.target
  const assessed = data.dimensions.filter((d) => d.score !== null)
  const deviceName = data.device === 'vr' ? 'VR headset' : data.device === 'web' ? 'Web browser' : 'an unknown device'

  return (
    <VStack gap={8}>
      <VStack gap={3}>
        <BackLink href={student ? `/students/${encodeURIComponent(student.id)}` : '/'}>← {student ? student.username : 'Students'}</BackLink>
        <HStack gap={3} vAlign="center" style={{ flexWrap: 'wrap' }}>
          <Heading level={1} type="display-3" weight="semibold">
            {lessonLabel(lesson ? String(lesson) : null)}
          </Heading>
          <DeviceTag device={data.device} />
          {(data.status ?? (data.complete ? 'completed' : 'left')) === 'left' ? <Badge label="Left early · partial score" variant="warning" /> : <Badge label="Completed" variant="success" />}
        </HStack>
        <Text type="supporting">
          <span className="vc-mono">{data.sessionId}</span> · {formatDateTime(t0)} · {data.trace.length} events over {formatClock(tEnd - t0)}
        </Text>
      </VStack>

      <Card padding={6}>
        <HStack gap={8} vAlign="center" style={{ flexWrap: 'wrap' }}>
          <ScoreRing percent={data.overall.percent} caption="Overall learning score" />
          <VStack gap={2} style={{ flex: 1, minWidth: 240 }}>
            <Heading level={2}>Overall learning score</Heading>
            <Text type="supporting">
              {data.overall.percent === null
                ? 'Not enough activity to score yet.'
                : `${data.overall.points} of ${data.overall.max} rubric points across ${assessed.length} assessed dimension${assessed.length === 1 ? '' : 's'}.`}
            </Text>
            <Text type="supporting" size="sm">
              Scored on {deviceName} stats. {(data.status ?? (data.complete ? 'completed' : 'left')) === 'left' ? 'The student left the lab before finishing. This is a partial score: dimensions they never reached are counted against the full maximum.' : ''}
            </Text>
          </VStack>
        </HStack>
      </Card>

      <section>
        <VStack gap={4}>
          <Heading level={2}>Rubric</Heading>
          <Grid columns={{ minWidth: 300, repeat: 'fit' }} gap={4}>
            {data.dimensions.map((d) => (
              <Card key={d.key} padding={4}>
                <VStack gap={3}>
                  <HStack justify="between" vAlign="center">
                    <Text weight="semibold">{d.label}</Text>
                    {d.score === null ? (
                      <Badge label="Not assessed" variant="neutral" />
                    ) : (
                      <span className="vc-mono" style={{ fontWeight: 600 }}>
                        {d.score}/3
                      </span>
                    )}
                  </HStack>
                  <ProgressBar label={d.label} isLabelHidden value={d.score ?? 0} max={3} variant={d.score === null ? 'neutral' : d.score >= 3 ? 'success' : d.score === 0 ? 'error' : 'accent'} isDisabled={d.score === null} />
                  <Text type="supporting" size="xsm">
                    {d.basis}
                  </Text>
                </VStack>
              </Card>
            ))}
          </Grid>
        </VStack>
      </section>

      <section>
        <VStack gap={4}>
          <HStack gap={3} vAlign="center">
            <Heading level={2}>{data.deviceStats.kind === 'vr' ? 'VR stats' : data.deviceStats.kind === 'web' ? 'Web stats' : 'Device stats'}</Heading>
            <DeviceTag device={data.deviceStats.kind} />
          </HStack>
          <Card padding={5}>
            <Grid columns={{ minWidth: 200, repeat: 'fit' }} gap={6}>
              {data.deviceStats.items.map((s) => (
                <VStack key={s.label} gap={1}>
                  <Text type="supporting" size="sm">
                    {s.label}
                  </Text>
                  <Text size="2xl" weight="semibold" hasTabularNumbers>
                    {s.value}
                  </Text>
                  <Text type="supporting" size="xsm">
                    {s.hint}
                  </Text>
                </VStack>
              ))}
            </Grid>
          </Card>
        </VStack>
      </section>

      <section>
        <VStack gap={4}>
          <Heading level={2}>Timeline</Heading>
          <div className="vc-hairline">
            {data.trace.map((e, i) => (
              <div key={e.id} className="vc-link-row" style={{ display: 'grid', gridTemplateColumns: '64px 148px 1fr', gap: 16, alignItems: 'center', padding: '10px 16px', borderTop: i ? '1px solid #ffffff14' : undefined }}>
                <span className="vc-mono" style={{ color: '#a1a1a1', fontSize: 13 }}>
                  +{formatClock(e.timestamp - t0)}
                </span>
                <span>
                  <Badge label={e.verb.replace('_', ' ')} variant={VERB_VARIANT[e.verb] ?? 'neutral'} />
                </span>
                <Text>{describeEvent(e)}</Text>
              </div>
            ))}
          </div>
        </VStack>
      </section>
    </VStack>
  )
}
