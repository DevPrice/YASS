/**
 * What to tell a guest when YARG refuses a setlist edit.
 *
 * Written for someone holding a phone at a party, not for whoever is reading
 * the server log: what happened, and whether trying again will help. Shared by
 * every surface that edits the setlist, so one refusal reads the same wherever
 * it happens.
 */

import type { SetlistEditError } from '@shared/types'

export function describeSetlistError(error: SetlistEditError): string {
  switch (error) {
    case 'duplicate':
      return 'Already in the setlist.'
    case 'full':
      return 'The setlist is full.'
    case 'unknown_song':
      return "YARG doesn't have this chart. It may need a rescan."
    case 'busy':
      return "YARG can't change the setlist right now. Try again in a moment."
    case 'conflict':
      return 'The setlist just changed. Try again.'
    case 'locked':
      return "That song has already been played or is playing, so it can't be changed."
    case 'unavailable':
    case 'timeout':
      return "Couldn't reach YARG."
    case 'not_found':
    case 'invalid':
    case 'failed':
      return "That didn't work. Try again."
  }
}
