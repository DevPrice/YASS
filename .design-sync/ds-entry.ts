/**
 * The design-system surface YASS publishes to claude.ai/design.
 *
 * This file exists because the sync needs one module that names exactly what
 * the design system is, and the app has no such module — `ui/index.tsx` and
 * `ui/library.tsx` are imported piecemeal by whoever needs them. The converter
 * would otherwise synthesize an entry by re-exporting every `.tsx` under
 * `client/src/`, which pulls in `main.tsx` — and that one mounts React into
 * `#root` on import, so merely loading the bundle would try to boot the app.
 *
 * Keep this list in step with `componentSrcMap` in `config.json`: the entry
 * decides what ships in the bundle, that map decides what gets a card, and a
 * component in one but not the other is either an unreachable card or dead
 * bytes.
 *
 * `features/` is deliberately absent. Those are composed screens that read app
 * state and fetch, so they neither render statically nor mean anything to a
 * design agent composing a new screen.
 */

// Presentational primitives — ported from the YARG design system's recipes.
export {
  Badge,
  Button,
  ChevronRight,
  EmptyState,
  HelperBar,
  Panel,
  RandomIcon,
  Select,
  SortArrow,
  TextField,
  ToggleChip,
  cx,
} from '../client/src/ui/index'

/*
 * The instrument artwork, as data URIs.
 *
 * Already in the bundle either way — `InstrumentStrip` and `PartsGrid` reach
 * for it internally — but unreachable by anything composing *with* the design
 * system until it is named here. `DifficultyRing` is the case that proves it:
 * the glyph in the middle of the ring is `children`, supplied by the caller, so
 * without these a caller has nothing to put there and the ring wraps a
 * placeholder.
 *
 * Neither name is PascalCase, so neither is mistaken for a component; they land
 * on `window.YASS` beside the components as plain lookups.
 */
export { GROUP_ART, INSTRUMENT_ART } from '../client/src/design/assets'

// Song-display pieces — the parts that turn a `Song`'s fields into the art.
export {
  AlbumThumb,
  ArtistName,
  DifficultyRing,
  InstrumentStrip,
  LensDifficulty,
  PartsGrid,
  SongTitle,
  SourceBadge,
} from '../client/src/ui/library'
