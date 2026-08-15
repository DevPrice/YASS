/**
 * Button — the pill, in all four tones plus the quiet toolbar variant.
 *
 * Labels are authored lowercase because the design system uppercases display
 * type in CSS; typing them capitalised here is how a port ends up shouting
 * twice.
 *
 * Layout glue is inline style rather than utility classes. The stylesheet this
 * DS ships is the app's own compiled Tailwind, which contains exactly the
 * classes `client/src/` uses and no others, so a utility invented for a preview
 * would silently resolve to nothing.
 */

import { Button, RandomIcon } from '@yass/client'

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
)

/** The four tones, which are the whole variant axis. */
export const Tones = () => (
  <Row>
    <Button tone="confirm">play</Button>
    <Button tone="accent">shuffle</Button>
    <Button tone="danger">remove</Button>
    <Button tone="neutral">cancel</Button>
  </Row>
)

/** `quiet` — no fill until hover, for toolbars where four filled pills would fight. */
export const Quiet = () => (
  <Row>
    <Button tone="accent" quiet>
      filters
    </Button>
    <Button tone="neutral" quiet>
      columns
    </Button>
    <Button tone="confirm" quiet>
      jump to
    </Button>
  </Row>
)

/** With a leading glyph. `RandomIcon` inherits the button's text colour. */
export const WithIcon = () => (
  <Row>
    <Button tone="accent" icon={<RandomIcon />}>
      random song
    </Button>
    <Button tone="neutral" quiet icon={<RandomIcon />}>
      surprise me
    </Button>
  </Row>
)

/** Disabled, which dims the fill rather than removing it. */
export const Disabled = () => (
  <Row>
    <Button tone="confirm" disabled>
      play
    </Button>
    <Button tone="neutral" quiet disabled>
      columns
    </Button>
  </Row>
)
