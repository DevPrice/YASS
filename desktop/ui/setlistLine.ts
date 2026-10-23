/**
 * What the popover says about YARG's setlist, as data.
 *
 * Kept apart from the JSX so the wording can be tested without a renderer: the
 * line is a sentence assembled from five link states and three kinds of
 * connected, and the failure worth catching is a wrong one — an off-by-one
 * show position, or a remedy offered for the state that has none.
 *
 * Never a warning tone. The setlist is optional and `off` is a legitimate
 * choice, so every state reads as a fact about what the guests will see.
 */

import type { SetlistState } from '@shared/types.js'

export type SetlistSummary = Omit<SetlistState, 'entries'>

/**
 * `plain` inherits the line's muted body colour; `faint` is the trailing
 * aside; `value` is a name the host has to find in YARG; `number` is a count,
 * in the numeric face.
 */
export interface Segment {
  text: string
  tone: 'plain' | 'faint' | 'value' | 'number'
}

const plain = (text: string): Segment => ({ text, tone: 'plain' })
const faint = (text: string): Segment => ({ text, tone: 'faint' })
const value = (text: string): Segment => ({ text, tone: 'value' })
const number = (n: number): Segment => ({ text: n.toLocaleString(), tone: 'number' })

export function setlistLine(setlist: SetlistSummary): Segment[] {
  switch (setlist.link) {
    case 'connected':
      return [plain("Following YARG's setlist"), ...connectedDetail(setlist)]
    case 'off':
      return [
        plain('Setlist sharing is off. To show guests the setlist, turn on '),
        value('Enable setlist socket'),
        plain(' in YARG → Settings → Experimental.'),
      ]
    case 'unsupported':
      return [plain('This build of YARG is too old to share its setlist.')]
    case 'unreachable':
      // The normal state whenever YARG is closed, so it gets no remedy.
      return [plain("Waiting for YARG's setlist"), faint(' · it connects while YARG is running')]
  }
}

function connectedDetail(setlist: SetlistSummary): Segment[] {
  // Checked before the show: while inactive, the other fields describe the
  // last setlist seen rather than one YARG is showing now.
  if (!setlist.active) {
    return [faint(' · out of view until you open the music library or start a show')]
  }

  const total = setlist.totalCount

  if (setlist.showInProgress && setlist.currentIndex !== null) {
    return [faint(' · show, '), number(setlist.currentIndex + 1), faint(' of '), number(total)]
  }

  if (total === 0) return [faint(' · empty')]
  return [faint(' · '), number(total), faint(total === 1 ? ' song' : ' songs')]
}

/**
 * Whether the guest-edits switch means anything right now.
 *
 * Only while YARG is connected and speaks the version that takes commands. In
 * any other state the switch would change a setting nobody can act on, and an
 * unchecked box under "waiting for YARG" reads as the reason it is waiting.
 */
export function canOfferGuestEdits(setlist: SetlistSummary): boolean {
  return setlist.link === 'connected' && setlist.guestEdits !== 'unsupported'
}
