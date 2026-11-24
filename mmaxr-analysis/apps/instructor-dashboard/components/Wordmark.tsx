import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <HStack gap={2} vAlign="center">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 2 22.5 20.5H1.5z" fill="#ededed" />
      </svg>
      <Text weight="semibold" size={compact ? 'base' : 'lg'}>
        MMAXR
      </Text>
      {compact ? null : (
        <Text type="supporting" size="sm">
          Instructor
        </Text>
      )}
    </HStack>
  )
}
