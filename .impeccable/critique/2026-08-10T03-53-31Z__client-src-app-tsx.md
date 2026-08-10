---
target: client/src/App.tsx
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-08-10T03-53-31Z
slug: client-src-app-tsx
---
Method: dual-agent (A: design review, unanchored · B: detector + live-browser evidence, isolated)

## Design Health Score

Mode: **Operate**. All ten heuristics apply.

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `connected` initialises to `false` (`useNowPlaying.ts:26`), so the first thing a guest reads is "Reconnecting to the server" (`NowPlayingBar.tsx:88`) before anything has connected. Only the result count has `aria-live`. |
| 2 | Match System / Real World | 2 | `$DEFAULT$` is mapped to "Custom", but every other YARG id passes through raw (`format.ts:29-32`) — `RB3DLC`, `GH2`, `CTH3DLC` in three places. Chart formats surface as `Ini`/`Sng`/`ExCON`. "1 SONGS" at one result. |
| 3 | User Control and Freedom | 1 | Escape wipes all seven filter dimensions from anywhere on the page, no undo (`App.tsx:74-81`). No sort control at all below 768px. No URL state, so a dropped tab loses everything. |
| 4 | Consistency and Standards | 2 | Two spacing systems in six files: `SettingsPanel.tsx` is stock Tailwind (`p-6`, `gap-2`, `text-sm`) off the 5px grid. 34 of 110 arbitrary values match no token. `BUTTON_TONES` hardcodes hex against `design/README.md:94-96`'s own rule. |
| 5 | Error Prevention | 2 | min diff 6 / max diff 0 is freely selectable (`Filters.tsx:156-185`) and returns "Try clearing a filter or searching for something shorter" — advice unrelated to the cause. |
| 6 | Recognition Rather Than Recall | 2 | Collapsed filter state is one `aria-hidden` bullet (`Filters.tsx:89`). Sort state is invisible and unchangeable on mobile. |
| 7 | Flexibility and Efficiency | 2 | The only two accelerators (`/`, `esc`) are keyboard-only, permanently advertised in a 52px bar on a product whose primary device has no keyboard. No multi-select facets despite `Filters.sources` being `string[]`. |
| 8 | Aesthetic and Minimalist Design | 2 | Every surface computes between 1.01:1 and 1.15:1 of every other. `surface-app` vs `surface-card` = **1.013:1**. The difficulty capsule is **1.03:1** against its row — the shape is invisible. |
| 9 | Error Recovery | 1 | `"/api/songs failed: 500 Internal Server Error"` shown to party guests (`api.ts:12` → `App.tsx:223`) inside an `EmptyState` with no retry button. |
| 10 | Help and Documentation | 1 | Nothing on the guest surface explains the 0–6 difficulty scale, "has parts", or "Master only" — the last is explained only in a `title` attribute that never fires on touch. |
| **Total** | | **17/40** | **Poor** |

Scored against the stated primary device. A desktop-only build of the same code lands around 22; the phone loses sorting entirely and spends most of its vertical budget on chrome.

## Design Specificity Verdict

**LLM assessment: a well-skinned generic data table.** The identity lives entirely in the palette and the typeface. Swap the tokens for light gray and this is an admin panel for invoices — eight sortable columns with ▲/▼, four dropdown facets, right-aligned numerics, a result count, a virtualized list. Not one structural decision says "six of us are in a room picking the next song."

The evidence is what sits in the repo unrendered. `client/src/design/assets/` holds **46 source badges, 11 instrument glyphs, 24 difficulty rings, and eight vector icons including `random.svg`, `setlist.svg`, `show.svg`**. `assets/index.ts` exists solely to serve them. Grep for `design/assets` across every component returns **zero hits**. Meanwhile the source column, the now-playing detail, and the source dropdown all print YARG's raw internal ids. A rhythm-game library that renders `RB3DLC (412)` while 46 hand-drawn game badges sit in `src/` is not authored for this product.

Second: the app fetches every song's full 20-instrument `difficulties` record (`types.ts:89`) and displays it nowhere — `filtering.ts:71` uses it as a predicate only. A guest can filter to "has drums" but can never see which songs have drums. `charter`, `playlist`, `subgenre`, `vocalParts`, and `isMaster` are all on the wire and invisible; `'charter'` is a declared `SortKey` (`filtering.ts:19`) with no column in `COLUMNS`, so it is permanently unreachable.

Third: the design system offered a song-row treatment and a section-header treatment and the product took neither. `--color-title` maps `--yarg-text-cyan`, annotated in `colors.css:56` as "song title in RB3-style rows"; titles render plain white. `--color-surface-row` (`#000911`) and `--color-border-row` are mapped and unused. `.yarg-wash-header` is documented as being for "category headers" that do not exist. Nine `@theme` mappings are dead.

Coherence is high across the library surface, then falls off a cliff at `SettingsPanel.tsx`, which reads as a different product's screen.

**Deterministic scan.** `detect.mjs` over `client/src` — exit code 2, **2 findings**, both `overused-font` (warning/slop) at `design/tokens/fonts.css:6-7`: Inter and Open Sans.

Both are **false positives as written**, and one masks a real defect. Inter is scoped to `--font-numeric` and used at exactly 7 tabular-number sites; display type is Red Hat Display, body is Barlow, and the whole directory is a verbatim vendored copy of the authority system. Open Sans is worse than generic — it is referenced by *nothing*. The real finding underneath: `fonts.css` issues **7 render-blocking `@import`s to fonts.googleapis.com, and 4 of the 7 families have zero usages anywhere** (Open Sans, Noto Sans, Big Shoulders Text, Archivo Black). For an app served off a LAN box, that is four unnecessary external downloads and a hard internet dependency on every cold load.

The detector's clean sweep of all six component files should not be read as a clean bill of health. It found none of the 27 contrast failures, none of the 22 undersized touch targets, neither dead focus ring, the absent heading outline, or the two-visible-rows mobile layout.

**Visual overlays: none.** No script injection was performed and no annotation layer exists in any browser tab. What *did* happen: a local Playwright 1.62.1 and a pre-existing Chromium turned out to be available, and your `npm run dev` stack was already running — vite on 5173, API on 4321, serving a real **4,168-song** library. Assessment B drove a browser against it read-only and captured four screenshots at 1440×900 and 390×844. No server was started, so none needed stopping; the dev stack was verified still up afterward. Two side effects worth knowing: `npx playwright --version` materialized the package into the npx cache, and two probe scripts were written there and deleted.

One environment artifact to discount: `GET /api/capabilities` returns **404** on your running server, twice per load. That process predates the route, so `canConfigure` is permanently false and the settings tab never renders. Restart the dev server before testing that path — it is not a code defect.

## Overall Impression

The engineering judgment here is better than the design judgment, and the gap is the story. `filtering.ts` is genuinely excellent — term-order-independent matching, diacritic folding, numeric collation, nulls last in both directions, a stable tiebreak, a `WeakMap` cache keyed on the Song object. The now-playing banner reasons about someone mid-scroll with a thumb on the glass and refuses to shift a single pixel. The empty state recognizes that the person seeing the error and the person who can fix it are two different people standing in the same room. That is real design thinking, five or six times over.

And then the surface those decisions live on is a spreadsheet in the dark. Everything is black-on-black at 1.01:1, the artwork that would make it look like YARG is sitting in `src/` unimported, and the phone — the stated primary device — cannot sort.

The single biggest opportunity: **stop treating the list as a table.** Four named views (random / shortest / everyone-knows-this / hardest) plus source badges would serve a party better than eight sortable columns on any device, and the assets for it are already vendored.

## What's Working

**The fixed-height now-playing banner.** Both states fill the identical 92px `Shell`, and the placeholder disc is the same 56px as real art, so a song starting or stopping costs zero pixels of reflow (`NowPlayingBar.tsx:8-12, 22, 97-108`). `AlbumArt` falls back on `onError`, so a moved chart or dropped network share degrades to the placeholder rather than punching a hole. This is the app's only asynchronous visual event and it produces zero layout shift — on a surface where people are mid-scroll. Most implementations collapse the banner when idle and shove the list under the reader's finger.

**The zero-songs empty state forks on capability.** A guest gets "Ask whoever is running YARG to export it" — an actionable social instruction — instead of a settings button that would 404. The host gets the specific menu path and a button (`App.tsx:238-260`). It works because it understands the defining fact of this product: two different people, same room.

**Virtualization is correct and verified at real scale.** Against the live 4,168-song library: 17 rows in the DOM, 495 total nodes, spacer at exactly 333,440px. Unvirtualized that would be ~70,900 nodes. DOM cost is O(viewport), and the trouble threshold is never approached.

## Priority Issues

### [P0] There is no way to sort on a phone

**What.** `SortHeader` is `hidden … md:flex` (`SongList.tsx:106`). Sort initialises to artist-ascending (`App.tsx:44-45`) and there is no other control anywhere. Below 768px, `sortKey` and `sortDirection` are frozen permanently.

**Why it matters.** One of the three capabilities the README advertises does not exist on the stated primary device. A guest who wants the shortest song before dinner, the easiest one for a drunk friend, or the newest thing the host added cannot get there. This also fails WCAG 1.4.4: at 200% zoom on a 1280px display the effective width is 640px, below `md`, so desktop users lose sorting too.

**Fix.** Add a mobile sort control to `FiltersPanel` for `<md`: a `ToggleChip` row of the four keys that matter at a party — artist / title / diff / time — where the active chip carries the ▲/▼ and re-tapping flips direction. Wire straight to the existing `onSort`. ~20 lines, no new state.

**Suggested command:** `/impeccable adapt`

### [P0] The list is invisible to screen readers, and the focus ring never renders on buttons or filter chips

**What.** Two independent defects, both confirmed in a live browser.

*Semantics.* Rows are bare `<div>`s (`SongList.tsx:81-93, 137`) with no `role="grid"/"row"/"gridcell"`, no `aria-rowcount`, no `aria-rowindex`, no region label. Because the list is virtualized, a screen reader sees ~15 unlabeled text fragments out of 4,168 with nothing indicating more exist. `aria-sort` is on `<button>` elements (`SongList.tsx:117`) where it is inert — the attribute is only honored on `columnheader`/`rowheader`. The app has **zero headings** (live DOM confirms `headings: []`) and only two landmarks, `header` and `nav` — no `<main>`, no `role="search"`.

*Dead focus rings.* `FOCUS_RING` uses Tailwind's `ring-2`, which compiles to a box-shadow — but `Button` (`ui/index.tsx:78`) and `ToggleChip` (`ui/index.tsx:205`) both set `boxShadow` **inline**, which wins. Diffing computed style blurred vs focused confirms it: focused `Button` shows `outline: 1px none` and an unchanged box-shadow. **The ring never renders on either.** `Select` is the one control where it works; the sort headers never include `FOCUS_RING` at all and survive only on the UA default outline.

**Why it matters.** Sam cannot complete the core task — not with difficulty, at all. And the dead ring hits every keyboard user, not just assistive-tech ones.

**Fix.** Move the inline `boxShadow` on `Button` and `ToggleChip` into the class string (or merge the ring into the inline value on focus) so `FOCUS_RING` can win. Add `role="grid"` + `aria-rowcount` + `aria-label="Song library"` + `tabIndex={0}` to the scroller, `role="row"` + `aria-rowindex` to each positioned wrapper, `role="columnheader"` with `aria-sort` on header *cells* with the button nested inside. Wrap the library in `<main>` and give the app one `<h1>`.

**Suggested command:** `/impeccable audit`

### [P1] 27 contrast failures, concentrated in two tokens

**What.** 91 real pairings were resolved through the token chain and computed by script. 13 text failures and 14 non-text failures.

Two root causes account for most of it. **`--yarg-text-dim` `#5C6070` can never pass 4.5:1 on any app surface** — its best case is 3.30:1 — and it carries the search placeholder (the field's only instruction), the "list exported" stamp, the helper-bar status, the idle now-playing line, the null-difficulty dash, and both settings hints. **`--yarg-border-card` `#12152D` tops out at ~1.15:1** against any dark surface, so the card edge, the text field ring, the select ring, the chip ring, and the album-art ring are all effectively invisible.

Two more worth naming individually. White on the 75%-alpha accent fill computes to **2.92:1** — below even the 3:1 large-text floor — and that is the active nav tab, the expanded Filters button, and "open settings". And on the mobile now-playing row, `.yarg-wash-selected` puts `#0082BA` at the *left* edge, exactly where the narrow layout stacks title and artist: **4.28:1** title, **3.34:1** artist. Desktop is fine at 7.09:1 because the artist sits 40% across where the scrim has taken over. The signature treatment was authored for a wide row and reused unchanged at 375px, inverting its own legibility on the primary device.

**Why it matters.** On a phone at 40% brightness in a lit room this is one undifferentiated black field with floating text. The row that answers "what's playing right now" is the least readable row on the screen.

**Fix.** `--yarg-text-dim` needs to lift to roughly `#8A90A4` to clear 4.5:1, or stop carrying anything a user must read. Give the button tones a darker text color or a heavier fill. Mirror the wash gradient below `md` so the bright edge lands on the empty right side — or drop the fill there and keep only the 3px white border, already the stronger signal. For row structure, stop trying to earn it from hairlines: `--yarg-border-row` would only reach 1.29:1, so the palette cannot deliver a hairline solution at all.

**Suggested command:** `/impeccable colorize`

### [P1] Opening the filter panel leaves two visible song rows, and the thumb zone is decorative

**What.** Measured at 390×844, not inferred:

| | banner | header | filters | helper bar | **list** |
|---|---|---|---|---|---|
| collapsed | 92 | 58 | 108 | 52 | **534px = 6.7 rows** |
| expanded | 92 | 58 | **459** | 52 | **183px = 2.3 rows** |

The filter panel is `shrink-0` inside a `h-full` flex column, so when expanded it takes 459px and squeezes the list to 22% of the viewport. The banner and helper bar are unconditional at every width — neither has a single breakpoint. The bottom 52px, the natural one-handed thumb zone, is the HelperBar, whose entire content is two keyboard shortcuts a phone cannot produce, while every real control is stacked in the top 200px.

Touch targets compound it, all measured live: sort headers **13px** tall, "clear filters" **11px** with zero padding, `ToggleChip` **23px** (below WCAG 2.2 AA 2.5.8's 24px floor and half the 44px iOS target), `Button` 38px, `Select` 39px. Nothing except `<label>` wrappers reaches 44px. The smallest tap target in the app is the one that undoes mistakes.

There is **no horizontal overflow** at 390px — the fixed widths all sit inside `hidden lg:/xl:/2xl:` columns, and the list reflows correctly via its `md:hidden` narrow layout. The problem is entirely vertical.

**Why it matters.** Casey opens filters to narrow 4,168 songs and can see two of the results she is narrowing.

**Fix.** Give the expanded filter region `max-h-[45vh] overflow-y-auto` so it can never crowd the list out. Hide `HelperBar` below `md` and put a bottom bar there carrying search plus the P0 sort control — real controls in the thumb zone. Pad "clear filters" and the sort headers to 44px hit areas without changing their visual size.

**Suggested command:** `/impeccable adapt`

### [P1] The design system's imagery and vocabulary are both sitting unused

**What.** 81 vendored PNGs plus 8 vector icons, imported by nothing. Zero `<img>` and zero `<svg>` per song row; the entire page contains 0 images and 2 svgs. At the same time the app prints `RB3DLC` and `GH2` where those 46 badges belong, renders no instrument glyphs despite carrying all 20 difficulty fields per song, and shows band difficulty as a bare "0" — which `types.ts:57` documents can mean "present but untiered" and every user will read as "trivially easy".

**Why it matters.** This is the whole specificity verdict in one line. The app wears the design system's color and none of its imagery. It is also the cheapest large win available: the source-id translation table is the only thing blocking the badges, and `random.svg` needs no table at all.

**Fix.** Land the CSV-source-id → badge-slug map (needs YARG's source list) and the `InstrumentKey` → glyph map, then render source badges in the row and now-playing bar, and instrument glyphs on the difficulty capsule where `LibraryRow` places them. Ship a Random button first — it needs no mapping and it is the single most party-appropriate control the design system already drew for you.

**Suggested command:** `/impeccable bolder`

## Persona Red Flags

**Casey (distracted mobile user).** Every interactive element is in the top 200px; the bottom 52px is non-interactive branding. Six 23px filter chips are her primary control surface, and the 11px "clear filters" undoes them. Search sits at the top with ~534px of list below — the software keyboard eats ~300px of that, so she types and sees two or three results. The search field sets no `autoCapitalize`, `autoCorrect`, `autoComplete`, or `enterKeyHint`, so iOS autocorrect rewrites band names — while the *host-only* settings fields do set `spellCheck={false}`; the protection went to the wrong field. `filterSongs` runs synchronously over all 4,168 songs on every keystroke with no debounce or `useDeferredValue`, and the `WeakMap` cache is cold on the first pass. Returning from an interruption tells her nothing: collapsed filter state is one bullet, sort state is invisible, and no state is in the URL — iOS Safari evicts tabs holding 4,168 songs of parsed JSON, and Back exits the app rather than closing the filter panel.

**Sam (screen reader + keyboard).** Cannot perceive the list at all — no roles, no rowcount, no region label, `aria-sort` inert on a button. Zero headings, so heading navigation is unavailable. No `<main>`. The focus ring is dead on every `Button` and every filter chip. `aria-live` on the result count floods one announcement per typed character with no debounce. The active-filter indicator is `aria-hidden`, so the Filters button reads identically whether zero or seven filters are on. Thirteen text contrast failures. At 200% zoom, sorting disappears (WCAG 1.4.4) and every cell is `truncate` with no `title` and no detail view (WCAG 1.4.10). Escape — a keyboard user's reflex — destroys all filter state from anywhere on the page with no announcement and no undo. The search field's focus cue is a `box-shadow`, which Windows High Contrast discards entirely; there is no `forced-colors` block anywhere, and the system's own `--shadow-focus` and `--focus-ring` tokens are unused.

**Riley (stress tester).** Long titles are permanently unrecoverable — `truncate` on every field with no `title`, no wrap, no detail view; ~24 characters on a 375px screen, so "Through the Fire and Flames" clips. Zero `dir=` attributes anywhere, so RTL titles clip the logical start and the ellipsis lands on the wrong end. `foldForSearch` does NFD + lowercase only — no kana or fullwidth folding, so "ビートルズ" is findable only by paste — and `Intl.Collator(undefined, …)` uses the *visitor's* locale, so the host's desktop and a guest's phone in a different locale **sort the same library differently**. Exactly 1 result renders "1 SONGS"; 0 results renders "0 SONGS" above a separate "No songs match" panel, two statements that read as contradictory. `MAX_FACET_OPTIONS = 200` silently drops options with no "showing 200 of 412" note, and a native `<select>` with 200 entries on mobile is a 200-row picker wheel. min 6 / max 0 is selectable and diagnosed wrongly. Duplicate charts are indistinguishable because `charter` has no column. The guest-visible "reload" button hits an unguarded `POST /api/songs/reload` and jumps every reader to the top of the list. Handled well: empty library, SSE drop → polling fallback, album-art 404 → placeholder.

## Minor Observations

- **`SCRIM` terminates at `#070910`** (`NowPlayingBar.tsx:27`) while the surface beneath it is `#070810`. One digit off, matches no token — drift, not intent.
- **`confirm.fill` is `#17E289`**, which is not `--yarg-emerald` `#2BE18D`. A fifth off-palette green. Ring colors `#43FFAD` and `#FF7B84` match no token at all.
- **12 distinct font sizes in use** (10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24), 7 of them off the type scale.
- **Three-way type drift**: `SongList.tsx:6` says "Barlow 25px title", `--text-track` is 25px, the code renders `text-[22px]`.
- **Motion tokens abandoned** — `--ease-standard` and `--duration-base` are never referenced; transitions hardcode `duration-160` with Tailwind's default easing. No `prefers-reduced-motion` guard (low harm — only color fades).
- **Tailwind class-order collision in `SortHeader`**: `column.className` is placed before `'… flex …'` in `cx`, so at xl+ the media-scoped `xl:block` outranks the unprefixed `flex`, silently killing `items-center` on the album and genre header buttons.
- **`scrollToOffset(0)` fires on sort too**, not just filtering (`SongList.tsx:58-60` depends on array identity, and `sortSongs` returns a new array). The comment only claims the filter behavior.
- **Node count 495 → 675 after a fast scroll jump**, not settling within 800ms. Bounded, not provably a leak, but worth a second look.
- **`formatDifficulty` is exported and never called**; `DifficultyCapsule` reimplements it inline.
- **`themeColor` in `index.html` is `#0b0b0f`** — not any token. The app background is `#05060B`.
- **Two of seven UI primitives serve the guest surface**: `Panel` is used only by SettingsPanel, `Badge` only by NowPlayingBar.

## Questions to Consider

1. If a friend cannot act on a song, what is the list *for*? If the honest answer is "shouting the title across the room," why does the row truncate at 24 characters instead of making the title enormous and readable at arm's length?
2. Six people in a room are looking at six copies of this list, and the app is architected as though one person were using it. Not a queue — just a shareable URL for a filtered view, or presence. Why is there no shared state of any kind?
3. A rhythm-game group doesn't ask "does this song have drums," it asks "what can *we* play?" What would the library look like if the unit of selection were the **band** — pick who's holding what, and the list reorders around what that lineup covers?
4. Sorting eight columns is a desktop metaphor imported wholesale. Would four named views — random, shortest, everyone-knows-this, hardest — beat eight sortable columns on every device, including the host's?
5. Album art isn't available library-wide, but the app already knows every song's source. Would a grid of source badges as the *default* browse mode, with the table demoted to a details toggle, be closer to how a person actually picks a song?
6. Why does the app say "Reconnecting to the server" before it has ever connected — and what else in the first three seconds tells a guest something is broken when nothing is?
