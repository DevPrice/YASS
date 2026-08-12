/**
 * Overgenrelizer buckets: official genre to the broad heading it falls under.
 *
 * YARG's third genre mode collapses its own list of official genres into
 * thirteen headings — the shape of a record shop rather than a taxonomy. It is
 * applied on top of a normal genrelize, to the genre that produced, and it drops
 * the subgenre entirely.
 *
 * Generated from `Overgenrelize` in `Assets/Script/Song/Genrelizer.cs`, with the
 * localization keys resolved against `en-US.json`. Anything not listed falls to
 * 'Other'.
 */
export const BROAD_GENRES: ReadonlyMap<string, string> = new Map([
  ['alternative', 'Alternative'],
  ['indie rock', 'Alternative'],
  ['country', 'Country/Folk'],
  ['folk', 'Country/Folk'],
  ['southern rock', 'Country/Folk'],
  ['children\'s music', 'Classical/Traditional'],
  ['classical', 'Classical/Traditional'],
  ['holiday', 'Classical/Traditional'],
  ['orchestral', 'Classical/Traditional'],
  ['soundtrack', 'Classical/Traditional'],
  ['traditional', 'Classical/Traditional'],
  ['ambient/drone', 'Dance/Electronic'],
  ['chiptune', 'Dance/Electronic'],
  ['dance', 'Dance/Electronic'],
  ['dnb/breakbeat/jungle', 'Dance/Electronic'],
  ['dubstep', 'Dance/Electronic'],
  ['electronic', 'Dance/Electronic'],
  ['glitch', 'Dance/Electronic'],
  ['hardcore edm', 'Dance/Electronic'],
  ['house', 'Dance/Electronic'],
  ['idm', 'Dance/Electronic'],
  ['techno', 'Dance/Electronic'],
  ['trance', 'Dance/Electronic'],
  ['hip-hop/rap', 'Hip-Hop'],
  ['trap', 'Hip-Hop'],
  ['blues', 'Jazz/Blues'],
  ['fusion', 'Jazz/Blues'],
  ['jazz', 'Jazz/Blues'],
  ['death/black metal', 'Metal'],
  ['djent', 'Metal'],
  ['doom metal', 'Metal'],
  ['grindcore', 'Metal'],
  ['groove metal', 'Metal'],
  ['heavy metal', 'Metal'],
  ['melodic/power metal', 'Metal'],
  ['thrash/speed metal', 'Metal'],
  ['ballad', 'Pop'],
  ['j-pop', 'Pop'],
  ['k-pop', 'Pop'],
  ['new wave', 'Pop'],
  ['pop', 'Pop'],
  ['synthpop/electropop', 'Pop'],
  ['emo', 'Punk/Scene/Core'],
  ['metalcore', 'Punk/Scene/Core'],
  ['nu-metal', 'Punk/Scene/Core'],
  ['pop-punk', 'Punk/Scene/Core'],
  ['post-hardcore', 'Punk/Scene/Core'],
  ['punk', 'Punk/Scene/Core'],
  ['r&b/soul/funk', 'R&B/Soul/Funk'],
  ['disco', 'R&B/Soul/Funk'],
  ['classic rock', 'Rock'],
  ['electronic rock', 'Rock'],
  ['glam', 'Rock'],
  ['grunge', 'Rock'],
  ['hard rock', 'Rock'],
  ['industrial', 'Rock'],
  ['j-rock', 'Rock'],
  ['math rock', 'Rock'],
  ['pop-rock', 'Rock'],
  ['progressive', 'Rock'],
  ['psychedelic', 'Rock'],
  ['rock', 'Rock'],
  ['rock & roll', 'Rock'],
  ['ska', 'Rock'],
  ['surf rock', 'Rock'],
  ['latin', 'World'],
  ['reggae', 'World'],
  ['world', 'World'],
])

/** Where an official genre nobody bucketed ends up. */
export const BROAD_OTHER = 'Other'
