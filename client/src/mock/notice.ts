/**
 * The one thing the demo says out loud.
 *
 * A public build of this app looks exactly like a real one — that is the point
 * of mocking at the network seam — so it has to admit what it is somewhere, or
 * it is a page presenting 1,650 invented songs as somebody's library. One card,
 * once per session, dismissible.
 *
 * Plain DOM rather than a React component, and injected from the mock rather
 * than rendered by `App`: nothing about the demo belongs in the app's own tree,
 * and this way the production bundle has no notion that a demo exists.
 *
 * The styling goes through the design tokens, so the card is the same surface,
 * border and type as the cards the app draws. It sits above the helper bar on
 * desktop and above the safe-area inset on a phone, where the filter bar is.
 */

const DISMISSED_KEY = 'yass.demo.notice.dismissed'

const STYLE = `
.yass-demo-notice {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  /*
   * Clear of whatever owns the bottom edge, which is not the same control at
   * every width: below md the filter bar is down there (max-md:order-last, in
   * Filters.tsx) and above it the helper bar is. A card that covered the search
   * field and the sort control until it was dismissed would be a notice that
   * broke the app it was describing.
   *
   * No backticks in here, incidentally — this block is inside a template
   * literal, and the first one ends the stylesheet.
   */
  bottom: calc(128px + env(safe-area-inset-bottom));
  z-index: 60;
  width: min(30rem, calc(100vw - 32px));
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 14px 16px;
  border-radius: var(--radius-md, 8px);
  background: var(--yarg-surface-toast, #000206);
  box-shadow:
    inset 0 0 0 2px var(--yarg-border-card, #12152d),
    0 18px 40px rgb(0 0 0 / 0.55);
  color: var(--yarg-text-muted, #8d9799);
  font-size: 12px;
  line-height: 1.5;
  animation: yass-demo-notice-in 260ms ease-out both;
}

@media (min-width: 48rem) {
  .yass-demo-notice { bottom: 62px; }
}

@keyframes yass-demo-notice-in {
  from { opacity: 0; transform: translate(-50%, 10px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

.yass-demo-notice strong {
  display: block;
  margin-bottom: 3px;
  color: var(--yarg-white, #fff);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.yass-demo-notice button {
  flex-shrink: 0;
  align-self: center;
  padding: 6px 12px;
  border: 0;
  border-radius: var(--radius-sm, 4px);
  background: var(--yarg-surface-sunken, #030307);
  box-shadow: inset 0 0 0 2px var(--yarg-border-card, #12152d);
  color: var(--yarg-white, #fff);
  font: inherit;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
}

.yass-demo-notice button:hover { color: var(--yarg-vivid-sky-blue, #45d8fe); }

@media (prefers-reduced-motion: reduce) {
  .yass-demo-notice { animation: none; }
}
`

/** Say what this build is, once per session. */
export function showDemoNotice(): void {
  // The tab title is the one label that survives dismissal, which matters when
  // the page is one of thirty in somebody's browser.
  document.title = 'YASS demo — Yet Another Song Selector'

  let dismissed = false
  try {
    dismissed = window.sessionStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    // Private-mode Safari throws on storage access. Showing the card again is
    // the right failure.
  }
  if (dismissed) return

  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)

  const card = document.createElement('div')
  card.className = 'yass-demo-notice'
  card.setAttribute('role', 'status')

  const text = document.createElement('div')
  const heading = document.createElement('strong')
  heading.textContent = 'Demo build'
  const body = document.createElement('span')
  body.textContent =
    'The library is 1,650 invented songs with generated covers, and the ' +
    '“now playing” feed is simulated. Everything else — search, filters, sort, ' +
    'the jump rail, the keyboard shortcuts — is the real app.'
  text.append(heading, body)

  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.textContent = 'Got it'
  dismiss.addEventListener('click', () => {
    card.remove()
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // See above: not being able to remember is not worth failing over.
    }
  })

  card.append(text, dismiss)
  document.body.append(card)
}
