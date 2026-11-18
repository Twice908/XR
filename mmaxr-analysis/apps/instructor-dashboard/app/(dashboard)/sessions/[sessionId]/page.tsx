'use client'

import { use } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { Heading } from '@astryxdesign/core/Heading'
import { Link } from '@astryxdesign/core/Link'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useSessionData } from '@/hooks/useSessionData'
import { DIMENSIONS, VERB_VARIANT, describeEvent, formatClock, highlights } from '@/lib/trace'

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <VStack gap={1}>
      <Text type="supporting" size="sm">
        {label}
      </Text>
      <Text size="2xl" weight="semibold" hasTabularNumbers>
        {value}
      </Text>
      {hint ? (
        <Text type="supporting" size="xsm">
          {hint}
        </Text>
      ) : null}
    </VStack>
  )
}

export default function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const id = decodeURIComponent(sessionId)
  const { data, error, isLoading } = useSessionData(id)

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
        <Link href="/">← Sessions</Link>
        <Banner status="error" title="Could not load this session" description={(error as Error | undefined)?.message ?? 'Session not found'} collapsible={false} />
      </VStack>
    )
  }

  const h = highlights(data.trace)
  const t0 = data.trace[0]?.timestamp ?? 0
  const acc = h.predictions ? Math.round((h.predictionsRight / h.predictions) * 100) : null

  return (
    <VStack gap={8}>
      <VStack gap={3}>
        <Link href="/">← Sessions</Link>
        <HStack gap={3} vAlign="center">
          <Heading level={1} type="display-3" weight="semibold">
            <span className="vc-mono" style={{ fontSize: '0.8em' }}>
              {data.sessionId}
            </span>
          </Heading>
          {h.isChemistry ? <Badge label="Chemistry · Indicators" variant="blue" /> : null}
        </HStack>
        <Text type="supporting">
          {data.trace.length} events over {formatClock(h.durationMs)}
          {data.metrics.hasSensorData ? ' · sensor data attached' : ' · no sensor data uploaded'}
        </Text>
      </VStack>

      {h.isChemistry ? (
        <Banner
          status="info"
          title="Rubric scores below come from the physics-lab prototype engine"
          description="Revision quality and causal coherence for the chemistry lab are not scored yet, so those bars read low. The process highlights and timeline are exact counts from the trace."
          collapsible={false}
        />
      ) : null}

      <section>
        <VStack gap={4}>
          <Heading level={2}>Process highlights</Heading>
          <Card padding={5}>
            <Grid columns={{ minWidth: 180 }} gap={6}>
              <Metric label="Predictions made" value={String(h.predictions)} hint={acc === null ? undefined : `${acc}% matched what happened`} />
              <Metric label="Avg. time to act" value={`${(data.metrics.avgThinkTimeMs / 1000).toFixed(1)}s`} hint="Between prediction and action" />
              <Metric label="Hand movement" value={`${data.metrics.avgHandMovementMeters.toFixed(2)} m`} hint="Per think period" />
              <Metric label="Changed their mind" value={String(h.revisions)} hint="Conclusions revised" />
              {h.conclusionsCorrect !== null ? <Metric label="Tubes identified" value={`${h.conclusionsCorrect}/${h.tubes}`} hint="At submission" /> : null}
              <Metric label="Confident but wrong" value={String(h.confidentWrong)} hint="Said ‘certain’, was not" />
            </Grid>
          </Card>
        </VStack>
      </section>

      <section>
        <VStack gap={4}>
          <Heading level={2}>Rubric</Heading>
          <Grid columns={{ minWidth: 300 }} gap={4}>
            {DIMENSIONS.map((d) => {
              const score = data.scores[d.key]
              return (
                <Card key={d.key} padding={4}>
                  <VStack gap={3}>
                    <HStack justify="between" vAlign="center">
                      <Text weight="semibold">{d.label}</Text>
                      <Text className="vc-mono" weight="semibold" hasTabularNumbers>
                        {score}/3
                      </Text>
                    </HStack>
                    <ProgressBar label={d.label} isLabelHidden value={score} max={3} variant={score >= 3 ? 'success' : score === 0 ? 'neutral' : 'accent'} />
                    <Text type="supporting" size="xsm">
                      {d.hint}
                    </Text>
                  </VStack>
                </Card>
              )
            })}
          </Grid>
        </VStack>
      </section>

      <section>
        <VStack gap={4}>
          <Heading level={2}>Timeline</Heading>
          <div className="vc-hairline">
            {data.trace.map((e, i) => (
              <div
                key={i}
                className="vc-link-row"
                style={{ display: 'grid', gridTemplateColumns: '64px 148px 1fr', gap: 16, alignItems: 'center', padding: '10px 16px', borderTop: i ? '1px solid #ffffff14' : undefined }}
              >
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
