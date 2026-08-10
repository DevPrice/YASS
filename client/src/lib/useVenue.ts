/**
 * YARG's stage lighting, as pushed down the event stream.
 *
 * Rides the same `EventSource` as everything else, so subscribing costs no
 * connection. The server publishes at most twice a second and only on change,
 * which is why this can be plain state with no throttling of its own.
 *
 * The idle value is what a client sees when YARG isn't broadcasting — which is
 * the default, since the sending setting ships off — so it must be the value
 * that renders as "no effect at all".
 */

import { useEffect, useState } from 'react'

import type { VenueState } from '@shared/types'
import { onServerEvent } from './events'

const IDLE: VenueState = { streaming: false, cue: null, grade: null, section: null, bpm: null }

export function useVenue(): VenueState {
  const [venue, setVenue] = useState<VenueState>(IDLE)

  useEffect(() => onServerEvent<VenueState>('venue', setVenue), [])

  return venue
}
