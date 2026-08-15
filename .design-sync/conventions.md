# Building with the YASS design system

YASS is a song browser for [YARG](https://yarg.in). It runs on the machine hosting the
game and serves the player's library to phones on the LAN, so every screen is **dark, dense
and read at arm's length** — a table of a few thousand songs, scanned rather than studied.
These components are ports of the YARG design system to Tailwind; the game is the visual
authority.

## Setup

**There is no provider and no theme context.** Every component is pure and presentational —
render it directly:

```jsx
const { Button, SongTitle, Panel } = window.YASS
```

What you *do* need is `styles.css`. It carries the token files and the compiled component
CSS, and it is what paints the ground: it sets `html body` to the app surface with readable
text. Without it every component renders as unstyled black-on-white.

## Style through the tokens

The tokens are the vocabulary. They ship complete in `tokens/` and are the only styling
values that are guaranteed to resolve — write `var(--yarg-…)`, never a literal hex.

| Family | Names |
|---|---|
| Surfaces | `--yarg-surface-app` (the page), `-card`, `-sunken`, `-bar`, `-row`, `--yarg-row-selected` |
| Text | `--yarg-text-primary`, `--yarg-text-muted`, `--yarg-text-dim`, `--yarg-text-header`, `--yarg-text-cyan`, `--yarg-text-count` (plus `--text-secondary`, which has no `--yarg-` spelling) |
| Accents | `--yarg-vivid-sky-blue` (the accent), `--yarg-action-confirm`, `--yarg-error-red`, `--yarg-mustard` |
| Borders | `--yarg-border-card`, `--yarg-border-row`, `--stroke` (2px), `--stroke-hairline` |
| Type | `--font-ui` (Barlow), `--font-display` (Red Hat Display), `--font-data` (Inter, tabular) |
| Sizes | `--text-row-title`, `--text-row-artist`, `--text-display-1`, `--text-caption`, `--text-eyebrow`, `--text-meta` |
| Weight | `--weight-medium` … `--weight-black` |
| Space | `--space-1` … `--space-7`, radii `--radius-sm/md/lg/chip/pill/round` |
| Motion | `--duration-fast`, `--duration-base`, `--ease-standard` |

**One trap.** `--text-body` is declared twice upstream — a colour in `colors.css`, a 20px
size in `typography.css` — and typography is imported last, so `color: var(--text-body)`
silently resolves to `20px` and the text falls back to black. Use `--yarg-text-primary`.
The `--yarg-`-prefixed names have no such collisions, which is the reason to prefer them
throughout.

**Tailwind utility classes are NOT a general option here.** The stylesheet is the app's own
compiled Tailwind, and Tailwind v4 emits only what it found in YASS's source — so
`bg-surface-card`, `text-content-muted` and `font-numeric` work, while `bg-surface-row`,
`rounded-card` and `font-display` were never used and do not exist. A class you invent
resolves to nothing, silently. **For your own layout, write inline styles with the tokens
above.**

## Three habits the components assume

- **Style your own wrapper, not the component.** Only `Button`, `Select` and `TextField`
  forward a `style` prop — they spread native attributes. `Panel`, `HelperBar`,
  `AlbumThumb`, `DifficultyRing`, `InstrumentStrip` and `SourceBadge` take `className`
  only, and the rest take neither. So put layout and padding on a `div` you own, inside or
  around the component. Check the `.d.ts` before reaching for a prop.
- **Labels are authored lowercase.** Display type is uppercased in CSS, so `play` renders
  as PLAY. Typing `Play` makes it shout twice.
- **The song-text components emit no wrapper.** `SongTitle` and `ArtistName` deliberately
  render bare, because five different housings set the size, colour and truncation around
  them. Give them a sized, coloured parent or they render at browser defaults.

## The `Song` object

`AlbumThumb`, `InstrumentStrip`, `LensDifficulty` and `PartsGrid` take a whole `Song`.
Their `.d.ts` names the type but cannot define it, and the examples in their `.prompt.md`
refer to fixture constants (`FULL_BAND`, `EXPERT`, `SPARSE`) that exist only in this repo's
preview files — so build one from this:

```js
const song = {
  id: 'A1B2…', hash: 'A1B2…',            // hash may be null; art and preview are keyed by it
  name: 'Hollow Transmission', artist: 'The Paper Aviators', album: 'Signal Fires',
  genre: 'Rock', subgenre: 'Alternative', charter: 'yarg-charts', playlist: '',
  source: 'yarg',                          // a real OpenSource id; SourceBadge resolves it
  year: '2019', yearNumber: 2019, lengthSeconds: 243, albumTrack: 4,
  isMaster: true, ageRating: 'No Rating',
  vocalParts: 1,                           // 0 instrumental, 1 solo, 2-3 harmonies
  bandDifficulty: 4,                       // 0-6, or null when unrated
  difficulties: { guitar5: 4, bass5: 3, drums4: 4, proDrums: 4, vocals: 3, keys: null },
  format: 'Sng',                           // 'Ini' | 'Sng' | 'ExCON' | 'CON' | 'Unknown'
  hasArt: false, hasPreview: false,
}
```

`difficulties` is keyed by instrument (`guitar5`, `bass5`, `rhythm5`, `coop5`, `keys`,
`guitar6`, `bass6`, `drums4`, `proDrums`, `drums5`, `eliteDrums`, `proGuitar17`, `proBass17`,
`proKeys`, `vocals`, `harmony`, …). **`null` and `0` are not the same fact** and these
components draw them differently: `null` means the part is not charted at all, `0` means
charted but never rated. Omitted keys read as `null`.

`AlbumThumb` renders nothing unless `hasArt` is true *and* the image loads, because an empty
square is the honest state of a cover that has not arrived.

## The instrument artwork

`window.YASS.GROUP_ART` maps `guitar | bass | drums | keys | vocals` to a ready `<img src>`
(the art is inlined, so there is nothing to fetch). `INSTRUMENT_ART` is the same by exact
glyph name. Use it for the middle of a `DifficultyRing`, whose centre is `children`:

```jsx
<DifficultyRing tier={4} size={48}><img src={GROUP_ART.drums} alt="" style={{ width: '100%' }} /></DifficultyRing>
```

## Where the truth is

Read these before styling — they beat any summary here: `styles.css` and the files it
imports (`tokens/colors.css`, `typography.css`, `layout.css`), then each component's own
`<Name>.prompt.md` and `<Name>.d.ts`. The `Music` components take a `Song`; their
`.prompt.md` carries a complete literal you can copy.

## An idiomatic screen

```jsx
const { Panel, SongTitle, SourceBadge, Button } = window.YASS

<Panel>
  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--text-row-title)',
        fontWeight: 'var(--weight-semibold)',
        color: 'var(--yarg-text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        <SongTitle song={song} notes="inline" />
      </div>
      <SourceBadge source={song.source} size={18} />
    </div>
    <Button tone="confirm">play</Button>
  </div>
</Panel>
```

The component carries the control; the tokens carry your glue. That split is the whole
convention.
