/**
 * The Magma value pairs, transcribed from YARG rather than from Genrelizer.
 *
 * Magma is the compiler behind Rock Band CON files, and it offers a closed list
 * of genres with a fixed set of subgenres under each. Several of those pairs are
 * telltale: a Magma user tagging a metalcore song had to settle for
 * `metal > core`, because `metalcore` was not on offer. Where the pair is
 * unambiguous, both halves are reinterpreted.
 *
 * **These live in YARG's own source, not in the Genrelizer repository**, because
 * the Magma list is closed and finite — Genrelizer's `docs/Special Cases.md`
 * documents them for reference and says outright that the file does not drive
 * behaviour. So they are carried here rather than read off disk, and they are the
 * one part of genrelizing that goes stale if YARG changes it.
 *
 * The match is exact on both halves and case-insensitive on both. `Metal > Core`
 * is reinterpreted; `Metal > Metalcore` and `Heavy Metal > Core` deliberately are
 * not, since neither is the fingerprint of a Magma export.
 *
 * Generated from `Assets/Script/Song/Genrelizer.Lists.cs` (`MAGMA_MAPPINGS`),
 * with the genre constants resolved to their literal values. Entries: 193.
 *
 * Columns: the Magma genre and subgenre to match, then the genre and subgenre to
 * use instead. A null subgenre means the result carries no subgenre at all.
 */
export const MAGMA_PAIRS: ReadonlyArray<readonly [string, string, string, string | null]> = [
  ['alternative', 'college', 'alternative', 'College Rock'],
  ['alternative', 'other', 'alternative', null],

  ['blues', 'acoustic', 'blues', 'Acoustic Blues'],
  ['blues', 'chicago', 'blues', 'Chicago Blues'],
  ['blues', 'classic', 'blues', 'Classic Blues'],
  ['blues', 'contemporary', 'blues', 'Contemporary Blues'],
  ['blues', 'country', 'blues', 'Country Blues'],
  ['blues', 'delta', 'blues', 'Delta Blues'],
  ['blues', 'electric', 'blues', 'Electric Blues'],
  ['blues', 'other', 'blues', null],

  ['country', 'alternative', 'country', 'Alternative Country'],
  ['country', 'contemporary', 'country', 'Contemporary Country'],
  ['country', 'outlaw', 'country', 'Outlaw Country'],
  ['country', 'traditional folk', 'traditional', 'Traditional Folk'],
  ['country', 'traditionalfolk', 'traditional', 'Traditional Folk'],
  ['country', 'other', 'country', null],

  ['glam', 'other', 'glam', null],

  ['hip-hop/rap', 'alternativerap', 'hip-hop/rap', 'Alternative Rap'],
  ['hip-hop/rap', 'gangsta', 'hip-hop/rap', 'Gangsta Rap'],
  ['hip-hop/rap', 'hardcorerap', 'hip-hop/rap', 'Hardcore Rap'],
  ['hip-hop/rap', 'old school hip hop', 'hip-hop/rap', 'Oldschool Hip-Hop'],
  ['hip-hop/rap', 'oldschoolhiphop', 'hip-hop/rap', 'Oldschool Hip-Hop'],
  ['hip-hop/rap', 'other', 'hip-hop/rap', null],
  ['hip-hop/rap', 'triphop', 'hip-hop/rap', 'Trip Hop'],
  ['hip-hop/rap', 'undergroundrap', 'hip-hop/rap', 'Underground Rap'],

  ['hiphoprap', 'alternativerap', 'hip-hop/rap', 'Alternative Rap'],
  ['hiphoprap', 'gangsta', 'hip-hop/rap', 'Gangsta Rap'],
  ['hiphoprap', 'hardcorerap', 'hip-hop/rap', 'Hardcore Rap'],
  ['hiphoprap', 'old school hip hop', 'hip-hop/rap', 'Oldschool Hip-Hop'],
  ['hiphoprap', 'oldschoolhiphop', 'hip-hop/rap', 'Oldschool Hip-Hop'],
  ['hiphoprap', 'other', 'hip-hop/rap', null],
  ['hiphoprap', 'triphop', 'hip-hop/rap', 'Trip Hop'],
  ['hiphoprap', 'undergroundrap', 'hip-hop/rap', 'Underground Rap'],

  ['indie rock', 'lofi', 'indie rock', 'Lo-Fi'],
  ['indie rock', 'math rock', 'math rock', null],
  ['indie rock', 'mathrock', 'math rock', null],
  ['indie rock', 'noise', 'noise', 'Noise Rock'],
  ['indie rock', 'other', 'indie rock', null],
  ['indie rock', 'postrock', 'indie rock', 'Post Rock'],

  ['indierock', 'lofi', 'indie rock', 'Lo-Fi'],
  ['indierock', 'math rock', 'math rock', null],
  ['indierock', 'mathrock', 'math rock', null],
  ['indierock', 'noise', 'noise', 'Noise Rock'],
  ['indierock', 'other', 'indie rock', null],
  ['indierock', 'postrock', 'indie rock', 'Post Rock'],

  ['jazz', 'acidjazz', 'jazz', 'Acid Jazz'],
  ['jazz', 'contemporary', 'jazz', 'Contemporary Jazz'],
  ['jazz', 'experimental', 'jazz', 'Experimental Jazz'],
  ['jazz', 'smooth', 'jazz', 'Smooth Jazz'],
  ['jazz', 'other', 'jazz', null],

  ['metal', 'alternative', 'heavy metal', 'Alternative Metal'],
  ['metal', 'black', 'death/black metal', 'Black Metal'],
  ['metal', 'core', 'metalcore', null],
  ['metal', 'death', 'death/black metal', 'Death Metal'],
  ['metal', 'hair', 'heavy metal', 'Hair Metal'],
  ['metal', 'industrial', 'industrial', 'Industrial Metal'],
  ['metal', 'metal', 'heavy metal', null],
  ['metal', 'power', 'melodic/power metal', 'Power Metal'],
  ['metal', 'prog', 'heavy metal', 'Progressive Metal'],
  ['metal', 'speed', 'thrash/speed metal', 'Speed Metal'],
  ['metal', 'thrash', 'thrash/speed metal', 'Thrash Metal'],
  ['metal', 'other', 'heavy metal', null],

  ['new wave', 'dark wave', 'new wave', 'Darkwave'],
  ['new wave', 'synthpop', 'synthpop/electropop', 'Synthpop'],
  ['new wave', 'other', 'new wave', null],

  ['new_wave', 'dark wave', 'new wave', 'Darkwave'],
  ['new_wave', 'synth', 'synthpop/electropop', 'Synthpop'],
  ['new_wave', 'synthpop', 'synthpop/electropop', 'Synthpop'],
  ['new_wave', 'other', 'new wave', null],

  ['pop/dance/electronic', 'ambient', 'ambient/drone', 'Ambient'],
  ['pop/dance/electronic', 'breakbeat', 'dnb/breakbeat/jungle', 'Breakbeat'],
  ['pop/dance/electronic', 'chiptune', 'chiptune', null],
  ['pop/dance/electronic', 'dance', 'dance', null],
  ['pop/dance/electronic', 'downtempo', 'electronic', 'Downtempo'],
  ['pop/dance/electronic', 'dub', 'dubstep', null],
  ['pop/dance/electronic', 'drum and bass', 'dnb/breakbeat/jungle', 'Drum and Bass'],
  ['pop/dance/electronic', 'drumandbass', 'dnb/breakbeat/jungle', 'Drum and Bass'],
  ['pop/dance/electronic', 'electronica', 'electronic', 'Electronica'],
  ['pop/dance/electronic', 'garage', 'electronic', 'Garage'],
  ['pop/dance/electronic', 'hardcore dance', 'hardcore edm', 'Hardcore Dance'],
  ['pop/dance/electronic', 'hardcoredance', 'hardcore edm', 'Hardcore Dance'],
  ['pop/dance/electronic', 'house', 'house', null],
  ['pop/dance/electronic', 'industrial', 'industrial', null],
  ['pop/dance/electronic', 'techno', 'techno', ''],
  ['pop/dance/electronic', 'trance', 'trance', ''],
  ['pop/dance/electronic', 'other', 'electronic', null],

  ['popdanceelectronic', 'ambient', 'ambient/drone', 'Ambient'],
  ['popdanceelectronic', 'breakbeat', 'dnb/breakbeat/jungle', 'Breakbeat'],
  ['popdanceelectronic', 'chiptune', 'chiptune', null],
  ['popdanceelectronic', 'dance', 'dance', null],
  ['popdanceelectronic', 'downtempo', 'electronic', 'Downtempo'],
  ['popdanceelectronic', 'dub', 'dubstep', null],
  ['popdanceelectronic', 'drum and bass', 'dnb/breakbeat/jungle', 'Drum and Bass'],
  ['popdanceelectronic', 'drumandbass', 'dnb/breakbeat/jungle', 'Drum and Bass'],
  ['popdanceelectronic', 'electronica', 'electronic', 'Electronica'],
  ['popdanceelectronic', 'garage', 'electronic', 'Garage'],
  ['popdanceelectronic', 'hardcore dance', 'hardcore edm', 'Hardcore Dance'],
  ['popdanceelectronic', 'hardcoredance', 'hardcore edm', 'Hardcore Dance'],
  ['popdanceelectronic', 'house', 'house', null],
  ['popdanceelectronic', 'industrial', 'industrial', null],
  ['popdanceelectronic', 'techno', 'techno', ''],
  ['popdanceelectronic', 'trance', 'trance', ''],
  ['popdanceelectronic', 'other', 'electronic', null],

  ['pop-rock', 'contemporary', 'pop-rock', 'Contemporary Pop-Rock'],
  ['pop-rock', 'disco', 'disco', null],
  ['pop-rock', 'motown', 'r&b/soul/funk', 'Motown'],
  ['pop-rock', 'pop', 'pop', 'PopRock'],
  ['pop-rock', 'rhythm and blues', 'r&b/soul/funk', 'Rhythm and Blues'],
  ['pop-rock', 'rhythmandblues', 'r&b/soul/funk', 'Rhythm and Blues'],
  ['pop-rock', 'softrock', 'pop-rock', 'Soft Rock'],
  ['pop-rock', 'soul', 'r&b/soul/funk', 'Soul'],
  ['pop-rock', 'teen', 'pop', 'Teen Pop'],
  ['pop-rock', 'other', 'pop-rock', null],

  ['poprock', 'contemporary', 'pop-rock', 'Contemporary Pop-Rock'],
  ['poprock', 'disco', 'disco', null],
  ['poprock', 'motown', 'r&b/soul/funk', 'Motown'],
  ['poprock', 'pop', 'pop', 'PopRock'],
  ['poprock', 'rhythm and blues', 'r&b/soul/funk', 'Rhythm and Blues'],
  ['poprock', 'rhythmandblues', 'r&b/soul/funk', 'Rhythm and Blues'],
  ['poprock', 'softrock', 'pop-rock', 'Soft Rock'],
  ['poprock', 'soul', 'r&b/soul/funk', 'Soul'],
  ['poprock', 'teen', 'pop', 'Teen Pop'],
  ['poprock', 'other', 'pop-rock', null],

  ['prog', 'prog rock', 'progressive', null],
  ['prog', 'progrock', 'progressive', null],

  ['punk', 'alternative', 'punk', 'Alternative Punk'],
  ['punk', 'classic', 'punk', 'Classic Punk'],
  ['punk', 'garage', 'punk', 'Garage Punk'],
  ['punk', 'hardcore', 'punk', 'Hardcore Punk'],
  ['punk', 'pop', 'pop-punk', null],
  ['punk', 'other', 'punk', null],

  ['r&b/soul/funk', 'disco', 'disco', null],
  ['r&b/soul/funk', 'other', 'r&b/soul/funk', null],

  ['rbsoulfunk', 'disco', 'disco', null],
  ['rbsoulfunk', 'other', 'r&b/soul/funk', null],
  ['rbsoulfunk', 'rhythmandblues', 'r&b/soul/funk', 'Rhythm and Blues'],

  ['reggae/ska', 'reggae', 'reggae', null],
  ['reggae/ska', 'ska', 'ska', null],
  ['reggae/ska', 'other', 'ska', null],

  ['reggaeska', 'reggae', 'reggae', null],
  ['reggaeska', 'ska', 'ska', null],
  ['reggaeska', 'other', 'ska', null],

  ['rock', 'arena', 'hard rock', 'Arena Rock'],
  ['rock', 'blues', 'rock', 'Blues Rock'],
  ['rock', 'folk rock', 'folk', 'Folk Rock'],
  ['rock', 'folkrock', 'folk', 'Folk Rock'],
  ['rock', 'funk', 'r&b/soul/funk', 'Funk'],
  ['rock', 'garage', 'rock', 'Garage Rock'],
  ['rock', 'hard rock', 'hard rock', null],
  ['rock', 'hardrock', 'hard rock', null],
  ['rock', 'psychadelic', 'psychedelic', 'Psychedelic Rock'],
  ['rock', 'psychedelic', 'psychedelic', 'Psychedelic Rock'],
  ['rock', 'reggae', 'reggae', null],
  ['rock', 'rockabilly', 'rock & roll', 'Rockabilly'],
  ['rock', 'rock and roll', 'rock & roll', null],
  ['rock', 'rockandroll', 'rock & roll', null],
  ['rock', 'ska', 'ska', null],
  ['rock', 'surf', 'surf rock', null],
  ['rock', 'other', 'rock', null],

  ['urban', 'alternative rap', 'hip-hop/rap', 'Alternative Rap'],
  ['urban', 'alternativerap', 'hip-hop/rap', 'Alternative Rap'],
  ['urban', 'downtempo', 'electronic', 'Downtempo'],
  ['urban', 'drum and bass', 'dnb/breakbeat/jungle', 'Drum and Bass'],
  ['urban', 'drumandbass', 'dnb/breakbeat/jungle', 'Drum and Bass'],
  ['urban', 'dub', 'reggae', 'dub'],
  ['urban', 'electronica', 'electronic', 'Electronica'],
  ['urban', 'gangsta', 'hip-hop/rap', 'Gangsta Rap'],
  ['urban', 'garage', 'electronic', 'Garage'],
  ['urban', 'hardcore dance', 'hardcore edm', 'Hardcore Dance'],
  ['urban', 'hardcoredance', 'hardcore edm', 'Hardcore Dance'],
  ['urban', 'hardcore rap', 'hip-hop/rap', 'Hardcore Rap'],
  ['urban', 'hardcorerap', 'hip-hop/rap', 'Hardcore Rap'],
  ['urban', 'hip hop', 'hip-hop/rap', 'Hip-Hop'],
  ['urban', 'hiphop', 'hip-hop/rap', 'Hip-Hop'],
  ['urban', 'industrial', 'industrial', null],
  ['urban', 'old school hip hop', 'hip-hop/rap', 'Oldschool Hip-Hop'],
  ['urban', 'oldschoolhiphop', 'hip-hop/rap', 'Oldschool Hip-Hop'],
  ['urban', 'rap', 'hip-hop/rap', 'Rap'],
  ['urban', 'trip hop', 'hip-hop/rap', 'Trip Hop'],
  ['urban', 'underground rap', 'hip-hop/rap', 'Underground Rap'],
  ['urban', 'undergroundrap', 'hip-hop/rap', 'Underground Rap'],
  ['urban', 'other', 'other', 'Urban'],

  ['other', 'ambient', 'ambient/drone', 'Ambient'],
  ['other', 'breakbeat', 'dnb/breakbeat/jungle', 'Breakbeat'],
  ['other', 'chiptune', 'chiptune', null],
  ['other', 'classical', 'classical', null],
  ['other', 'contemporary folk', 'folk', 'Contemporary Folk'],
  ['other', 'contemporaryfolk', 'folk', 'Contemporary Folk'],
  ['other', 'dance', 'dance', null],
  ['other', 'electronica', 'electronic', 'Electronica'],
  ['other', 'house', 'house', null],
  ['other', 'techno', 'techno', null],
  ['other', 'trance', 'trance', null],
]
