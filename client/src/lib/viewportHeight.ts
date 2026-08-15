/**
 * `--app-vh`: the real, JS-measured viewport height, in pixels.
 *
 * `svh` exists to answer exactly this and should need no help, but iOS 16
 * Safari — an iPhone 14's original OS — does not keep it pinned to the
 * smallest viewport the way the spec requires
 * (https://bugs.webkit.org/show_bug.cgi?id=261185): it tracks whatever the
 * toolbar-collapsed viewport happens to be at that instant instead. A sheet
 * whose height is clamped with `svh` and that opens while the toolbar is
 * mid-transition can lock onto a stale, wrong read and never correct — the
 * detail sheet collapsing to a sliver on that exact device is what sent us
 * looking for this.
 *
 * Measuring `visualViewport.height` ourselves sidesteps the browser's own
 * viewport-unit arithmetic rather than trying to work around a bug inside
 * it, which is the standard fix for this whole family of iOS quirks. Set
 * before the first paint so nothing ever renders against a missing
 * variable, and kept current on every event the visual viewport fires —
 * on iOS that includes the toolbar collapsing and expanding, which is
 * exactly the transition `svh` gets wrong.
 */
function setAppVh(): void {
  const height = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--app-vh', `${height}px`)
}

setAppVh()
;(window.visualViewport ?? window).addEventListener('resize', setAppVh)
