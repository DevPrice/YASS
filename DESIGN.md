---
name: YASS
description: A YARG song library, browsed from every phone in the room.
colors:
  vivid-sky-blue: "#45D8FE"
  selected-blue: "#0082BA"
  title-cyan: "#31E4F1"
  artist-cyan: "#A5EFFF"
  night: "#090A0B"
  accent-tint: "rgba(69, 216, 254, 0.2)"
  accent-edge: "rgba(69, 216, 254, 0.5)"
  accent-fill: "rgba(69, 216, 254, 0.75)"
  surface-app: "#05060B"
  surface-card: "#070810"
  surface-sunken: "#030307"
  surface-bar: "#01040A"
  surface-row: "#000911"
  surface-hover: "#151A30"
  header-wash: "#001B33"
  border-card: "#12152D"
  border-row: "#2F344D"
  border-strong: "#7B7F9A"
  text-primary: "#FFFFFF"
  text-muted: "#9497AE"
  text-faint: "#7B7F9A"
  text-header: "#C7E0FF"
  count: "#B2CDED"
  count-muted: "#5D7EA6"
  imperial-red: "#F32B37"
  emerald: "#2BE18D"
typography:
  display:
    fontFamily: "Red Hat Display, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1
  headline:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.05
  title:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1
  artist:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Red Hat Display, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 800
    lineHeight: 1
  numeric:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "\"tnum\" 1"
rounded:
  sm: "5px"
  md: "10px"
  lg: "20px"
  pill: "50px"
  round: "78px"
spacing:
  "1": "5px"
  "2": "10px"
  "3": "15px"
  "4": "25px"
  "5": "35px"
  "6": "50px"
  "7": "100px"
components:
  button-accent:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.night}"
    typography: "{typography.label}"
    rounded: "{rounded.round}"
    padding: "0 20px"
    height: "38px"
  button-neutral:
    backgroundColor: "rgba(47, 52, 77, 0.75)"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.round}"
    padding: "0 20px"
    height: "38px"
  button-danger:
    backgroundColor: "rgba(243, 43, 55, 0.75)"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.round}"
    padding: "0 20px"
    height: "38px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.text-faint}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 15px"
  chip-active:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 15px"
  text-field:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "9px 15px"
  select:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "9px 15px"
  card:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.lg}"
  song-row:
    backgroundColor: "{colors.surface-row}"
    textColor: "{colors.text-primary}"
    typography: "{typography.title}"
    height: "80px"
  song-row-playing:
    backgroundColor: "{colors.selected-blue}"
    textColor: "{colors.text-primary}"
  helper-bar:
    backgroundColor: "{colors.surface-bar}"
    textColor: "{colors.text-muted}"
    height: "52px"
    padding: "0 15px"
---

# Design System: YASS

## Overview

**Creative North Star: "The Backstage Setlist"**

YASS is the setlist taped to the monitor: a working document for a band between songs,
scanned in a glance at arm's length and lit by whatever the stage is doing. The room is
the show and the big screen is the stage; the phone in a guest's hand is the setlist, and
its job is to put the next song in front of them before the conversation moves on.

That makes the system dark, dense and exact. Thousands of rows are the content, so chrome
is spent sparingly and every pixel of height is argued for. Light is the only emphasis: a
colour wash spilling in from one edge marks what's playing and which section you're in, and
controls light up when they're live rather than rising off the page. The visual vocabulary
began as YARG's own (the night-black surfaces, Vivid Sky Blue, Red Hat Display capitals,
Barlow's italic cyan artist line), so it reads as part of the game, but **this file is now
the authority**. The token files vendored in `client/src/design/tokens/` are where the
values started, and the overrides this system has already made to them (contrast fixes,
the accent compositings) are part of the system, not deviations from it.

There is no light theme. The room is dark and the big screen is dark; a white phone would
be the brightest thing in it.

**Key Characteristics:**
- Night-black tonal surfaces, never pure black, all leaning blue-violet.
- One accent, Vivid Sky Blue, spent on what's live: playing, active, focused.
- Emphasis is light washing in from an edge, not a filled shape.
- Uppercase Red Hat Display for labels and chrome; Barlow for the songs themselves; Inter
  for numbers.
- Flat: depth comes from tone and inset strokes. The one shadow separates the helper bar
  from the list.
- Height-aware layout: a phone held sideways is a first-class layout, not an edge case.

## Colors

A near-black, blue-leaning ground with a single electric cyan accent and a small family of
cyans for song identity.

### Primary
- **Vivid Sky Blue** (`vivid-sky-blue`): the accent. Focus outlines, the active chip, the
  live volume fill, checked boxes. It marks state that is doing something, and appears
  nowhere decorative.
- **Selected Blue** (`selected-blue`): the playing row's fill, always washed out to card
  colour from one side. Never used as a flat fill.
- **Accent compositings** (`accent-tint` 20%, `accent-edge` 50%, `accent-fill` 75%): the
  only three ways the accent is mixed. Tint fills an active chip under white text; edge is
  the 2px inset stroke that says a control is live; fill is the solid-reading accent
  surface, which carries Night text and never white.

### Secondary
- **Title Cyan** (`title-cyan`): song titles in YARG's RB3-style rows.
- **Artist Cyan** (`artist-cyan`): the artist line, always italic, and "as made famous by".
  The second voice of every song.

### Tertiary
- **Imperial Red** (`imperial-red`): danger buttons and the ceiling of the difficulty
  ring. Red means the top of the scale or a destructive action, never decoration.
- **Emerald** (`emerald`): confirm. Rare in a browsing app, and it should stay rare.

### Neutral
- **App Night** (`surface-app`): the page.
- **Card Night** (`surface-card`): cards, the detail pane, the end of every wash.
- **Sunken Night** (`surface-sunken`): inside text fields, selects, badges and the art plate.
- **Bar Night** (`surface-bar`): the helper bar and footers.
- **Row Night** (`surface-row`) and **Oxford Blue** (`surface-hover`): the song row at
  rest and under the pointer.
- **Header Wash** (`header-wash`): the category header's colour, washed to card colour.
- **Card Stroke** (`border-card`): the 2px inset stroke on cards. Decorative only.
- **Row Rule** (`border-row`, Space Cadet): the hairline between songs.
- **Cool Gray** (`border-strong` / `text-faint`): the outline of every interactive control
  (5.15:1) and the faintest text allowed, used for placeholders and hints.
- **White** (`text-primary`), **Muted Lavender-Gray** (`text-muted`, Cool Gray lightened 20%
  toward white; 7.03:1 on the page), **Header Ice** (`text-header`), **Count Steel**
  (`count`) and **Count Slate** (`count-muted`): text, in descending voice.

### Named Rules
**The Live-Only Accent Rule.** Vivid Sky Blue marks what is live: playing, active, focused,
on. If an element isn't in a state, it isn't cyan.

**The Stay-on-Axis Rule.** Every neutral lives in the blue-violet band (hue ~228–233).
A grey that drifts green or warm stands out as a mistake beside the others; mix new
neutrals from Cool Gray rather than picking a hex.

**The Three Mixes Rule.** The accent is composited at 20%, 50% or 75% and nothing else.
A fourth opacity is a new colour nobody chose.

## Typography

**Display Font:** Red Hat Display (with system-ui)
**Body Font:** Barlow (with system-ui)
**Numeric Font:** Inter, tabular figures (with system-ui)

**Character:** Red Hat Display shouts, Barlow is read in motion, Inter is numbers. The
capitals are the game's voice and belong to chrome; the song itself is always in Barlow,
in the chart's own casing.

### Hierarchy
- **Display** (800, 20px, line-height 1, uppercase): empty-state titles and screen-level
  labels. "Pick a song" in the empty detail pane is 17px of the same.
- **Headline** (600, 30px, 1.05; 22px on short screens): the song title in the detail pane.
  Wraps; never truncates.
- **Title** (600, 22px, 1): the song title in a row and in the now-playing banner. 17px in
  the narrow row. Truncates with glyph room kept (see Don'ts).
- **Artist** (500 italic, 18px, 1, Artist Cyan): directly under every title. 20px in the
  detail pane, 17px in the banner, 14px in the narrow row. The album that sometimes follows
  it is upright and muted.
- **Body** (400, 15px): empty-state explanations, field text, facet lists. Max 28rem wide.
- **Label** (800, 10–13px, uppercase, line-height 1): chips (11px), buttons (13px), badges
  (10px), field captions (11px, Count Slate). Authored lowercase and uppercased in CSS.
- **Numeric** (Inter, 11–16px, tabular): years, lengths, counts, difficulty tiers. Anything
  a guest compares down a column.

### Named Rules
**The Lowercase Source Rule.** Labels are written lowercase in code and uppercased by
style. A capitalised string shouts twice and fights screen readers.

**The Song Keeps Its Casing Rule.** Titles and artists are shown exactly as the chart wrote
them. Never uppercase a song.

## Layout

A single list owns the screen, and everything else earns its height against it.

- **Spacing** runs on a 5px base (5 / 10 / 15 / 25 / 35 / 50 / 100). 10px is the default
  gap inside a control, 15px between controls, 25px for gutters and page padding.
- **Song rows are 80px** in the table layout, which has a sort header and as many columns
  as the list's own width allows. Below it, a narrow two-line row stacks title over artist.
  Column decisions are made from the list container's width, never the window's.
- **Master–detail from `lg`.** The detail pane sits beside the list at
  `clamp(320px, 32%, 460px)`. Below that, detail is a sheet that rises from the bottom (and
  docks right on short screens).
- **Height is a layout input.** The variants in `client/src/index.css` are the vocabulary:
  `short` (≤500px tall), `bar-stack` (narrow and tall: controls at the bottom edge, in thumb
  reach), `bar-top` (one toolbar row), `roomy` / `cramped`, and `has-table`. Each pair is an
  exact complement. A new rule that asks only about width is suspect.
- **An index rail** (38px) runs down the list's outer edge as a sibling column, never an
  overlay, with one mark per division of the current sort.
- **The helper bar** (52px) sits at the bottom on desktop only; a phone spends that height
  on its filter bar instead.
- Safe-area insets are respected; the list owns scrolling and the page never rubber-bands.

## Elevation & Depth

Flat, with depth carried by tone. Surfaces step between night values (app → card → sunken)
and cards are drawn with a 2px inset stroke rather than a shadow. Emphasis is light rather
than height: the selected-row wash, the category-header wash and the venue wash all fade a
colour in from one edge, and the venue wash uses `screen` blending so it reads as stage
light falling on the banner.

### Shadow Vocabulary
- **Bar lift** (`box-shadow: 0 0 150px 0 rgb(0,0,0)`): the helper bar and the phone's
  control bar, separating fixed chrome from the scrolling list. The only true shadow in the
  app.
- **Card stroke** (`box-shadow: inset 0 0 0 2px #12152D`): every card. A stroke, not a lift.
- **Control stroke** (`box-shadow: inset 0 0 0 2px` Cool Gray, or `accent-edge` when live):
  text fields, selects and chips.

### Named Rules
**The Lit, Not Lifted Rule.** Nothing rises on hover or selection. Controls brighten
(`brightness(1.15)`), fill with the 20% tint, or light their inset stroke. No scale, no
translate, no bounce.

**The Edge Wash Rule.** Colour emphasis enters from one edge and fades to card colour,
angled away from the text it sits under. It never fills a shape flat.

## Shapes

Pills for anything you press, soft rectangles for anything that holds content.

- **Buttons** are full capsules (78px radius). **Chips and text fields** are pills (50px).
- **Selects, source tiles and toasts** are gently rounded (10px); **badges** are barely
  rounded (5px).
- **Cards** have generous 20px corners.
- **Strokes** are 2px for controls and cards, 1px hairlines between rows. Thin chevrons
  (1.75px stroke, round caps) point direction.
- **The difficulty ring** is the one signature geometry: six notches round a circle, filling
  clockwise from a gap at twelve o'clock, stroke 9% of the diameter. Red at the ceiling.
- **Album art is square** and treated as a real image slot whether or not art exists yet.

## Components

Every control is **lit, not lifted**: flat and exact at rest, lighting up when live.

### Buttons
- **Shape:** full capsule (78px), 38px tall, 44px on coarse pointers.
- **Tones:** accent, confirm, danger and neutral. Each is a 75% fill with a brighter 2px
  inset ring in the same hue. Text is Night on the light fills (accent, confirm) and white
  on the dark ones (danger, neutral), because white on the light fills fails contrast.
- **Quiet:** no fill and no ring, white text. Used for toolbar actions.
- **Hover / Focus:** `brightness(1.15)` over 160ms; focus is a 2px Vivid Sky Blue outline at
  2px offset, never a box-shadow ring.
- **Disabled:** 50% opacity, no hover.

### Chips
- **Style:** transparent pill, Cool Gray inset stroke, faint label text.
- **Active:** 20% accent tint, 50% accent inset stroke, white label. Rises to full text
  colour on hover when inactive.

### Cards / Containers
- **Corner Style:** 20px.
- **Background:** Card Night.
- **Shadow Strategy:** none. A 2px inset stroke in Card Stroke.
- **Internal Padding:** 15–25px.

### Inputs / Fields
- **Text field:** pill on Sunken Night with a Cool Gray 2px inset stroke; leading icon in
  faint text. Focus lights the stroke to the 50% accent edge and adds the outline, so
  forced-colors mode keeps a cue.
- **Select:** 10px corners, same surface and stroke; hover lights the stroke white. An
  optional 11px uppercase caption in Count Slate sits above.

### Navigation
- **Helper bar:** Bar Night, 52px, bar lift, a row of key hints in muted text. Kept from the
  game as identity even though a browser has no gamepad; treat it as branding.
- **Sort header and compact sort chips:** the sort header appears only with the table; the
  chips appear on exactly the screens the header is hidden from.

### Song Row (signature)
80px, Row Night, a hairline between rows. Title in white Barlow 22/600, italic cyan
artist beneath, numbers in Inter, instrument glyphs lit or dim for "has this part". The
**playing row** is Selected Blue washed out to Card Night from the side opposite the
text, with a hard white border.

### Now-Playing Banner (signature)
The currently playing song over the list, with the **venue wash**: YARG's live stage
lighting, cross-faded at the song's tempo, `screen`-blended and masked off the right side
where the numbers are. Removed entirely under `prefers-reduced-motion`. With the optional
Setlist Bridge plugin, a show adds a position badge (`2/8`) to the badge row and, from `sm`
up, an **up next** title beside the length; a setlist waiting to start replaces the idle
line. Without the plugin none of this renders and the banner is unchanged. The same plugin
puts an accent **Add to setlist** button under the identity in the song detail, which gives way
to the song's place in the setlist once it is in; it is absent, not disabled, without it.

### Art Plate (signature)
A square slot on Sunken Night with a Selected Blue wash from the top corner. Until real art
arrives it carries the song's own title as Display type. Nothing around it may be arranged
on the assumption that it isn't a real cover.

## Do's and Don'ts

### Do:
- **Do** style through tokens and the named compositings: `var(--yarg-…)`, `--accent-tint`,
  `--accent-edge`, `--accent-fill`. Add a new mapping in `client/src/index.css` rather than
  typing a hex into a component.
- **Do** keep every interactive boundary at 3:1 or better and text at 4.5:1 (Cool Gray is
  the floor for both).
- **Do** give every control a 44px target on coarse pointers (`pointer-coarse:`, or
  `.tap-target` where there's clear space).
- **Do** use the `.yarg-focusable` outline for focus. Inline inset box-shadows would hide a
  ring utility, and forced-colors mode drops box-shadows entirely.
- **Do** use `truncate-tight` for any truncating line set at `leading-none`, so descenders
  and umlauts aren't clipped.
- **Do** test every layout at 844×390 as well as upright and desktop.

### Don't:
- **Don't** add a light theme, a pure-black (#000) surface, or a neutral off the
  blue-violet axis.
- **Don't** use drop shadows for depth on cards or rows; the bar lift is the only shadow.
- **Don't** scale, translate or bounce anything on hover, press or selection.
- **Don't** set white text on the accent or confirm fills; use Night.
- **Don't** uppercase song titles or artists.
- **Don't** redraw YARG's bitmap art (instrument glyphs, source badges) as vectors, or mix
  the 500px instrument glyph generation with the 512px one.
- **Don't** show score data (stars, medals, stats).
- **Don't** animate anything decorative when reduced motion is requested.
