import { Badge } from '@astryxdesign/core/Badge'
import type { Device } from '@/lib/types'

/** Where a session was recorded. Web and VR are scored on different stats, so it is always visible. */
export function DeviceTag({ device }: { device: Device | null | undefined }) {
  if (device === 'vr') return <Badge label="VR" variant="purple" />
  if (device === 'web') return <Badge label="Web" variant="blue" />
  return <Badge label="Unknown device" variant="neutral" />
}
