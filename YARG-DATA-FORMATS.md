# YARG Data Formats: `currentSong.json` and the Song List

Reference for building an external app that reads YARG's now-playing state and song
library. Everything here was derived by reading the YARG and YARG.Core sources
(branch `guide-pitch`, YARG.Core as vendored at `YARG/YARG.Core/`).

**Confidence markers used throughout:**
- **[VERIFIED]** — read directly from source; the code says exactly this.
- **[DERIVED]** — follows from source plus documented Newtonsoft.Json default
  behavior, but was not observed in a real output file. Confirm against a real
  capture before depending on it.

> **Do this first:** run YARG, start any song, and copy the resulting
> `currentSong.json` into this repo as a test fixture. Several details below are
> marked [DERIVED] specifically because they depend on how Newtonsoft serializes
> types that have no explicit converter. One real capture resolves all of them.

---

## 1. Where the files live

`currentSong.txt` and `currentSong.json` are written to YARG's
`PathHelper.PersistentDataPath`. That path is Unity's `Application.persistentDataPath`
plus a **build-channel subfolder**. [VERIFIED — `Assets/Script/Helpers/PathHelper.cs:88-117`]

Unity's `persistentDataPath` resolves from `companyName: YARC` / `productName: YARG`
[VERIFIED — `ProjectSettings/ProjectSettings.asset:15-16`]:

| OS | `Application.persistentDataPath` |
|---|---|
| Windows | `%USERPROFILE%\AppData\LocalLow\YARC\YARG` |
| macOS | `~/Library/Application Support/YARC/YARG` |
| Linux | `~/.config/unity3d/YARC/YARG` |

Then a subfolder is appended based on how the build was compiled:

| Build | Subfolder |
|---|---|
| Stable release | `release` |
| Nightly | `nightly` |
| Unity Editor / test build | `dev` |

So a typical Windows stable install writes to:

```
C:\Users\<user>\AppData\LocalLow\YARC\YARG\release\currentSong.json
C:\Users\<user>\AppData\LocalLow\YARC\YARG\release\currentSong.txt
```

### The path can be overridden

If YARG is launched with `-persistent-data-path <dir>`, that directory replaces the
whole thing, including the channel subfolder.
[VERIFIED — `PathHelper.cs:102-117`, `Assets/Script/Persistent/CommandLineArgs.cs:36`]

**Do not hardcode the path.** Make it user-configurable, defaulting to the table
above with `release`. The YARC Launcher may also pass this argument.

Other paths in the same directory that may be useful:

| Path | Contents |
|---|---|
| `playlists/` | User playlists as JSON (see §5) |
| `songcache.bin` | Binary song cache — see §9; this is where chart *locations* live |
| `badsongs.txt` | Scan error log |

---

## 2. `currentSong.txt`

Produced by `CurrentSongController.OnGameStateChange`.
[VERIFIED — `Assets/Script/Integration/CurrentSongController.cs:83-93`]

Exactly **seven lines, `\n`-separated, no trailing newline**, in this order:

```
1. Name
2. Artist
3. Album
4. Genre
5. ParsedYear
6. Source  (mapped to a human-readable game name)
7. Charter
```

Rich text tags **are stripped** from this file (`RichTextUtils.StripRichTextTags`).
Line 6 is passed through `SongSources.SourceToGameName()`, so it is a display name
like `Rock Band 3`, not the raw source id like `rb3`.

This file is intended for OBS text sources. Prefer the JSON file for anything
structured.

---

## 3. `currentSong.json`

### 3.1 How it is produced

```csharp
string json = JsonConvert.SerializeObject(song, SortStringConverter.Default);
```

[VERIFIED — `CurrentSongController.cs:96`]

`song` is a `YARG.Core.Song.SongEntry`. There is **no DTO** — this is a direct
reflection-based serialization of an internal game class, with one custom converter
for `SortString`. The source file even carries a `// TODO: We may wanna explicitly
specify the json output by putting it in a new class` comment at line 14.

**Treat this schema as unstable.** It is an accidental API; it will change whenever
`SongEntry` changes. Parse defensively, treat every field as optional, and never
assume key order.

### 3.2 Critical behaviors — read these before writing a parser

**(a) The file is blank, not `{}`, when no song is playing.**

On startup, on `OnDestroy`, and on any state change where the scene is not Gameplay
or the song entry is null, YARG writes an **empty string** to the file.
[VERIFIED — `CurrentSongController.cs:56-78`]

So the file is zero bytes whenever the player is in menus. `JSON.parse("")` throws.
Check for empty/whitespace content *before* parsing and treat it as "nothing playing."

**(b) Writes are not atomic — you will observe partial reads.**

The writer is `new StreamWriter(JsonFilePath, false)` — truncate, then write.
[VERIFIED — `CurrentSongController.cs:100-104`] There is no temp-file-plus-rename.
A reader polling at the wrong moment can see a truncated or zero-length file for a
song that is in fact playing.

Mitigation: on a parse failure, do not immediately surface "nothing playing." Retry
after a short delay (~50-100 ms) and only conclude the file is genuinely blank after
two or three consecutive consistent reads.

**(c) There is no change notification.** No socket, no event, no push. You must poll
the file (or use a filesystem watcher, which on Windows will fire multiple times per
write). Polling at 1-2 Hz is plenty — this file only changes at song start, pause,
and scene transitions.

**(d) Rich text tags are NOT stripped in the JSON.** Unlike `currentSong.txt`, the
JSON path does not call `StripRichTextTags`. The `SortStringConverter` writes
`SortString.Original`, which is the raw, untransformed string.
[VERIFIED — `CurrentSongController.cs:19-22`; `YARG.Core/.../SortString.cs:16,28`]

Song metadata is user-authored, so expect Unity rich text markup in `Name`,
`Artist`, `Album`, `Charter`, etc.:

```
<color=#FF0000>Song</color> <i>Title</i>
```

You must strip or neutralize these. Common tags: `<color=…>`, `<b>`, `<i>`, `<size=…>`,
`<sprite=…>`, `<material=…>`, plus closing forms. Since this is user-controlled text
being rendered in a browser, **strip tags rather than passing them through**, and
escape the result — do not inject it as HTML.

**(e) The JSON contains absolute filesystem paths.** `SortBasedLocation`,
`ActualLocation`, and `Location` expose where the chart lives on disk, which leaks
the user's username on Windows. If your app displays or transmits this data
(streaming overlay, relay server), filter these fields out.

**(f) Per-instrument difficulties are NOT present.** The `AvailableParts _parts`
field is `protected`, so Newtonsoft does not serialize it.
[VERIFIED — `YARG.Core/.../SongEntry.cs:76`] The only difficulty data you get is
`BandDifficulty` and `VocalsCount`. For per-instrument tiers you need the CSV or
HTML export (§4).

### 3.3 Field reference

All fields below are public instance properties on `SongEntry` and will be emitted by
Newtonsoft's default (opt-out) contract resolver. [DERIVED for exact JSON spelling;
property names and types VERIFIED from `YARG.Core/YARG.Core/Song/Entries/SongEntry.cs`]

Property names appear in JSON **verbatim, PascalCase** — no camelCase conversion is
configured.

#### Identity

| Field | Type | Notes |
|---|---|---|
| `Hash` | object | SHA-1 song hash. **See §3.4 — this one is awkward.** |
| `SubType` | int | `EntryType` enum: `0`=Ini, `1`=Sng, `2`=ExCON, `3`=CON |
| `SortBasedLocation` | string | Absolute path (see 3.2e) |
| `ActualLocation` | string | Absolute path (see 3.2e) |
| `IsDuplicate` | bool | True if another entry shares this hash |

#### Core metadata (all rich-text-tagged strings)

| Field | Type | Notes |
|---|---|---|
| `Name` | string | Song title |
| `Artist` | string | |
| `Album` | string | |
| `Genre` | string | May be overridden at runtime |
| `RawGenre` | string | As parsed from the chart |
| `Subgenre` | string | |
| `RawSubgenre` | string | |
| `Charter` | string | |
| `Source` | string | Raw source id (e.g. `rb3`), **not** the display name |
| `Playlist` | string | Chart-declared playlist; often `Unknown Playlist` |

#### Year

| Field | Type | Notes |
|---|---|---|
| `UnmodifiedYear` | string | Raw, e.g. `"1984 (remaster)"` |
| `ParsedYear` | string | Cleaned |
| `YearAsNumber` | int | **`2147483647` (`int.MaxValue`) means unknown** — VERIFIED at `SongEntry.cs:80`. Guard against this or you will render the year 2147483647. |
| `YearSecondary` | string | |

#### Timing

| Field | Type | Notes |
|---|---|---|
| `SongLengthMilliseconds` | long | |
| `SongLengthSeconds` | double | Same value ÷ 1000 |
| `SongOffsetMilliseconds` / `SongOffsetSeconds` | long / double | |
| `PreviewStartMilliseconds` / `PreviewStartSeconds` | long / double | |
| `PreviewEndMilliseconds` / `PreviewEndSeconds` | long / double | |
| `VideoStartTimeMilliseconds` / `VideoStartTimeSeconds` | long / double | |
| `VideoEndTimeMilliseconds` / `VideoEndTimeSeconds` | long / double | `-1` when unset |

Note both ms and seconds variants are emitted for each — redundant but harmless.

#### Classification / flags

| Field | Type | Notes |
|---|---|---|
| `IsMaster` | bool | Master recording vs. cover |
| `CoveredBy` | string | |
| `SongRating` | int | See §6 |
| `AlbumTrack` | int | |
| `PlaylistTrack` | int | |
| `VideoLoop` | bool | |
| `BandDifficulty` | int | sbyte; `-1` when unset |
| `VocalsCount` | int | `0` instrumental, `1` solo, `2`/`3` harmonies |
| `VocalGender` | int | See §6 |
| `VocalScrollSpeedScalingFactor` | number \| null | Nullable float |
| `LoadingPhrase` | string | |
| `Location` | string | Metadata field (a place/venue string), distinct from the path fields |
| `VenueHint` | string | |
| `VocalCharacterHint` | string | |

#### Links

`LinkBandcamp`, `LinkBluesky`, `LinkFacebook`, `LinkInstagram`, `LinkSpotify`,
`LinkTwitter`, `LinkYoutube`, `LinkOther` — all strings, empty when unset.

> Gotcha: `LinkNewgrounds`, `LinkSoundcloud`, and `LinkTiktok` exist in the
> underlying metadata struct but have **no public property** on `SongEntry`, so they
> are **not** in the JSON. [VERIFIED — compare `SongEntry.cs:116-123` against the
> serialize method at lines 394-404.]

#### Credits (all strings)

`CreditAlbumArtDesignedBy`, `CreditArrangedBy`, `CreditBackground`,
`CreditComposedBy`, `CreditCourtesyOf`, `CreditEngineeredBy`, `CreditLicense`,
`CreditMasteredBy`, `CreditMixedBy`, `CreditOther`, `CreditPerformedBy`,
`CreditProducedBy`, `CreditPublishedBy`, `CreditWrittenBy`

#### Per-part charter credits (all strings)

`CharterAudio`, `CharterBass`, `CharterDrums`, `CharterEliteDrums`, `CharterGuitar`,
`CharterKeys`, `CharterLowerDiff`, `CharterProBass`, `CharterProGuitar`,
`CharterProKeys`, `CharterVenue`, `CharterVocals`

#### Source-type-dependent fields

`SongEntry` is abstract; the concrete runtime type varies by where the chart came
from. Newtonsoft serializes the **runtime** type, so extra fields appear for some
songs and not others. Known example: RBCON-derived entries add `RBSongId` (string).
[VERIFIED — `YARG.Core/.../RBCON/SongEntry.RBCON.cs:49`]

Treat unknown extra keys as expected, not as an error.

### 3.4 The `Hash` field — the one real trap

`HashWrapper` is a struct whose actual storage is a `private fixed int _hash[5]`
(20 bytes, SHA-1). Its only public instance member is:

```csharp
public readonly byte[] HashBytes { get; }
```

[VERIFIED — `YARG.Core/YARG.Core/Song/Entries/Types/HashWrapper.cs`]

`CurrentSongController` passes **only** `SortStringConverter` — it does *not* pass
`JsonHashWrapperConverter` (which exists and is used elsewhere, e.g. by
`PlaylistContainer`). So `Hash` is serialized structurally rather than as a hex
string. **[DERIVED]** the result is:

```json
"Hash": { "HashBytes": "3q2+7wAAAAAAAAAAAAAAAAAAAAA=" }
```

Newtonsoft serializes `byte[]` as **base64** by default, so expect a 28-character
base64 string (20 bytes → 28 chars with padding) nested under a `HashBytes` key.

**This is the highest-value thing to confirm from a real capture**, because song
identity depends on it.

#### Converting to the canonical hash

Everywhere else in YARG — playlist files, the CSV export, log output — the hash is
the **uppercase hex** form produced by `HashWrapper.ToString()` (`"X2"` per byte,
40 characters). [VERIFIED — `HashWrapper.cs` `ToString()`]

To match `currentSong.json` against a playlist file, normalize:

```js
// base64 (from currentSong.json) -> uppercase hex (canonical)
function toCanonicalHash(base64) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return [...bytes].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}
```

Always compare hashes case-insensitively as a safety measure.

---

## 4. The song list

### 4.1 The constraint on the *exports* — and the way around it

**YARG does not automatically publish the song library in any export format.** All four
are *manual, user-initiated actions* — the user opens Settings → Export Songs List,
picks a format, and chooses a save location through a native file dialog.
[VERIFIED — `Assets/Script/Song/Exporters/SongExport.cs:22-41`,
`Assets/Script/Settings/SettingsManager.cs:192-198`]

Design consequences, if an export is what you read:
- The song list is a **snapshot**, not a feed. It goes stale when the user adds songs.
- You must either ask the user to perform an export and point you at the file, or
  have them re-export after library changes.
- There is no "list version" or timestamp inside most formats to detect staleness.
  (The HTML export embeds a `generated` date — see 4.5.)

Settings entry points are `ExportSongsJson`, `ExportSongsText`, `ExportSongsCsv`,
`ExportSongsWeb`. [VERIFIED — `SettingsManager.Settings.cs:531-548`]

> **This section used to end here, and that was the wrong conclusion.** YARG *does*
> publish the library automatically — just not as an export. It rewrites
> `songcache.bin` on every scan, and that file carries the same metadata plus the
> chart paths and the album track number that no export has. **See section 9, and
> prefer it to everything in this section.** What follows is still accurate, and is
> still the right reference if you want a format with a published spec and no version
> risk; it is no longer the recommendation.

### 4.2 Choosing a format

| Format | Has hash? | Per-instrument difficulty? | Automatic? | Verdict |
|---|---|---|---|---|
| `songcache.bin` (§9) | **Yes** | **Yes** (all 21) | **Yes** | **Best, if you accept a version check** |
| CSV | **Yes** | **Yes** (all 21) | No | Best of the exports |
| HTML (web browser) | No | Aggregated to 5 slots | No | Good if you want compact data |
| JSON (Ouvert) | No | Bitmask, 10 instruments | No | Legacy; avoid |
| Text | No | No | No | Human-readable only |

**Recommendation: read `songcache.bin`.** It is written without the user being asked,
it carries everything the CSV does, and it adds the two things no export has — where
each chart lives on disk, and the album track number. The cost is an undocumented
layout that changes between versions, which is why section 9 insists on an allowlist
of verified `CACHE_VERSION` stamps and a fallback.

**If you want the CSV instead**, it is the only *export* carrying the song hash, which
is what correlates against `currentSong.json` and writes playlist files. Two behaviours
to know: it exports `SongContainer.Songs`, which is filtered by the player's Max Song
Rating setting, and its `Genre` column is the value YARG *genrelized* after the scan
rather than the one the chart author wrote.

### 4.3 CSV export — full spec

[VERIFIED — `Assets/Script/Song/Exporters/SongExport.cs:68-181`]

Header row, then one row per song in `SongContainer.Songs` order. 36 columns:

```
Name, Artist, Album, Genre, Subgenre, Year, Length,
Charter, Playlist, Source, Master, Age Rating, Vocal Parts,
Guitar (5-Fret) Difficulty, Bass (5-Fret) Difficulty, Rhythm (5-Fret) Difficulty,
Co-op (5-Fret) Difficulty, Keys Difficulty,
Guitar (6-Fret) Difficulty, Bass (6-Fret) Difficulty, Rhythm (6-Fret) Difficulty,
Co-op (6-Fret) Difficulty,
Drums (4-Lane) Difficulty, Pro Drums Difficulty, Drums (5-Lane) Difficulty,
Elite Drums Difficulty,
Pro Guitar (17-Fret) Difficulty, Pro Guitar (22-Fret) Difficulty,
Pro Bass (17-Fret) Difficulty, Pro Bass (22-Fret) Difficulty, Pro Keys Difficulty,
Vocals Difficulty, Harmony Difficulty, Band Difficulty, Format, Hash
```

Semantics:

- **Rich text is stripped** from all text columns. Unlike the JSON, this data is
  already clean.
- **`Length`** is `M:SS` (e.g. `4:07`), not seconds. Minutes are not zero-padded and
  are not capped at 59 — a 75-minute chart renders as `75:00`.
- **`Year`** is `UnmodifiedYear` — the raw string, which may be `1984 (remaster)` or
  empty. Parse leniently.
- **`Master`** is `True`/`False` (C# `bool.ToString()`, capitalized).
- **`Age Rating`** is a display string: `No Rating`, `Family Friendly`,
  `Supervision Recommended`, `Mature`, `Sensitive Content`.
- **Difficulty columns** are integers. **`-1` means the instrument is absent.**
  Present-but-unknown clamps to `0` (`Math.Max((sbyte)0, intensity)`). Real tiers are
  0-6.
- **`Format`** is the `EntryType` name as a string: `Ini`, `Sng`, `ExCON`, `CON`.
- **`Hash`** is the canonical **uppercase hex, 40 chars** — this is your join key.

Quoting: standard RFC-4180-style. Fields are quoted only if they contain a comma,
double quote, CR, or LF; embedded quotes are doubled. Empty/null fields are written
as empty. Use a real CSV parser — song titles contain commas and quotes routinely.

> **Encoding caveat [DERIVED]:** the writer is a plain `StreamWriter` with no
> explicit encoding, so it uses .NET's default UTF-8. Verify whether a BOM is
> present and strip it if so. Song metadata is heavily non-ASCII (CJK, accents),
> so decode as UTF-8, not Latin-1.

### 4.4 Ouvert JSON export

[VERIFIED — `Assets/Script/Song/Exporters/OuvertExport.cs`]

A legacy format for the Ouvert overlay tool. Indented JSON array; null fields omitted.

```json
[
  {
    "Name": "...", "Artist": "...", "Album": "...", "Playlist": "...",
    "Genre": "...", "Charter": "...", "Year": "...",
    "songlength": 240000,
    "chartsAvailable": 12345
  }
]
```

- Rich text **is** stripped.
- `songlength` is **milliseconds** (unsigned).
- `Playlist` is omitted entirely when it equals `Unknown Playlist`.
- **No hash**, so you cannot reliably join this against `currentSong.json`.

`chartsAvailable` is a 64-bit bitmask: `bitIndex = (instrumentId * 6) + difficulty`,
tested as `(chartsAvailable & (1 << bitIndex)) != 0`. Only 10 instruments fit:

| id | Instrument | | id | Instrument |
|---|---|---|---|---|
| 0 | 5-Fret Guitar | | 5 | Pro Drums |
| 1 | 5-Fret Bass | | 6 | Keys |
| 2 | 5-Fret Rhythm | | 7 | Pro Keys |
| 3 | 4-Lane Drums | | 8 | Vocals |
| 4 | 5-Lane Drums | | 9 | Harmony |

Instruments outside this list (6-fret, Pro Guitar/Bass, Elite Drums) are silently
absent from the mask.

### 4.5 HTML / web browser export

[VERIFIED — `WebBrowserExport.cs`, `WebBrowserRecord.cs`, `WebBrowserDifficulty.cs`]

Produces a **self-contained HTML file** with a working song browser UI — worth
opening before you build anything, since it may already do part of what you want.

The data is embedded as three JSON literals inside a `<script>` block, injected at
`/*DATA*/`, `/*GENRES*/`, and `/*META*/` markers in the template. If you want to
extract them, slice between those markers.

**Note:** all `<` characters in the embedded JSON are escaped to `\u003C` (an
XSS guard against `</script>` in user metadata). Un-escape before parsing if you
scrape the file.

Records are sorted by (Artist, Title), invariant case-insensitive. Field names are
single characters to save space:

| Key | Meaning |
|---|---|
| `a` | Artist (rich text stripped, trimmed) |
| `t` | Title |
| `al` | Album — **omitted** when empty |
| `y` | Year as int — **omitted** when unparsable (strict `int.TryParse`, so `"1984 (remaster)"` yields nothing) |
| `l` | Length in **seconds**, truncated |
| `vp` | Vocal parts count (0-3) |
| `p` | Parts code (see below) |
| `d` | Difficulty code (see below) |
| `g` | Index into the genres array — **omitted** when no genre |

**Parts code (`p`)** — subset of `V G D K B` in that fixed order:
- `V` lead vocals present (harmony alone does not qualify)
- `G` 5-fret or 6-fret guitar
- `D` 4-lane, Pro, or 5-lane drums (Elite excluded)
- `K` keys — uppercase if ProKeys also present, lowercase `k` if not
- `B` 5-fret or 6-fret bass (rhythm/coop excluded)

Example: `"VGDkB"`.

**Difficulty code (`d`)** — always exactly **5 characters**, positions fixed as
V, G, D, K, B. Each character:

| Char | Meaning |
|---|---|
| `.` | Part absent |
| `?` | Present, tier unknown |
| `0`-`9` | Tier 0-9 |
| `a`-`z` | Tier 10-35 (headroom; real charts are 0-6) |

Each slot **aggregates** its sub-instruments by taking the maximum known tier —
e.g. the V slot is `max(Vocals, Harmony)`, D is `max(4-lane, Pro, 5-lane)`.

`META` carries `{ source: "YARG", generated: "YYYY-MM-DD", count: N }` — the
`generated` date is your only built-in staleness signal across any export format.

---

## 5. Playlist file format

Relevant if you want to write a setlist back into YARG, or read the user's existing
playlists.

Location: `<PersistentDataPath>/playlists/*.json`, with `favorites.json` reserved.
[VERIFIED — `Assets/Script/Playlists/PlaylistContainer.cs:35-36`]

Filename convention: sanitized name (max 20 chars, non-alphanumerics removed) + `.` +
first 8 chars of the GUID + `.json` — e.g. `MyPartySet.3f2a9b1c.json`.
[VERIFIED — `PlaylistContainer.cs:187-203`]

Shape [VERIFIED — `Assets/Script/Playlists/Playlist.cs:10-31`]:

```json
{
  "Name": "My Party Set",
  "Author": "You",
  "Id": "3f2a9b1c-0000-0000-0000-000000000000",
  "SongHashes": [ "AABBCC...", "DDEEFF..." ]
}
```

- Serialized indented, with `JsonHashWrapperConverter` — so unlike `currentSong.json`,
  hashes here **are** plain hex strings. [VERIFIED — `PlaylistContainer.cs:14-21`]
- `Id` must be a unique GUID; colliding with the favorites playlist id causes the
  file to be skipped on load.
- Hashes not present in the user's library are pruned on save (`RemoveDeadHashes`).

**Important limitation:** `PlaylistContainer.Initialize()` reads this directory
**exactly once at startup**, and there is no reload path.
[VERIFIED — `PlaylistContainer.cs:33-88`] A file you write while YARG is running
will **not** be picked up until YARG restarts, unless game-side changes are made to
watch the directory. Do not assume live pickup works.

---

## 6. Enum reference

Enums serialize as **integers** (no `StringEnumConverter` is configured).

**`EntryType`** (`SubType` in JSON, `Format` in CSV)
[VERIFIED — `YARG.Core/.../Song/Entries/SongEnums.cs:11-17`]

| Value | Name |
|---|---|
| 0 | `Ini` |
| 1 | `Sng` |
| 2 | `ExCON` |
| 3 | `CON` |

**`VocalGender`** [VERIFIED — `SongEnums.cs:19-26`]

| Value | Name |
|---|---|
| 0 | `Male` |
| 1 | `Female` |
| 2 | `Nonbinary` |
| 3 | `Other` |
| 4 | `Unspecified` |

**`SongRating`** — the CSV export maps these to display strings
[VERIFIED — `SongExport.cs:99-106`]. The numeric values were not confirmed; read
them from `YARG.Core` if you need the ints.

| Display string |
|---|
| `No Rating` (fallback) |
| `Family Friendly` |
| `Supervision Recommended` |
| `Mature` |
| `Sensitive Content` |

---

## 7. Implementation checklist

1. Make the YARG data directory a **user setting**; default per §1, `release` channel.
2. Capture a real `currentSong.json` and pin it as a test fixture before writing the
   parser. Confirm the `Hash` shape (§3.4) first.
3. Handle the **empty file** case as "nothing playing" — do not let it surface as an
   error (§3.2a).
4. Retry on parse failure before concluding nothing is playing — writes are not
   atomic (§3.2b).
5. Poll at 1-2 Hz. There is no push mechanism (§3.2c).
6. **Strip rich text tags and HTML-escape** every string from `currentSong.json`
   before rendering (§3.2d).
7. Filter out `SortBasedLocation`, `ActualLocation`, and `Location` from anything you
   display or transmit (§3.2e).
8. Normalize hashes to uppercase hex; compare case-insensitively (§3.4).
9. Read **`songcache.bin`** for the library (§9) — it needs no user action, and it is
   the only source with chart paths and track numbers. Pin an allowlist of verified
   `CACHE_VERSION` stamps, read only the fixed-size run from the hash to `SongRating`,
   and have something to fall back on. Use the **CSV export** (§4.2) if you would
   rather have a stable format than an automatic one.
10. Guard `YearAsNumber == 2147483647` and difficulty `-1` sentinels. From the cache,
    also guard `AlbumTrack == 2147483647`, and read *both* bytes of a `PartValues` —
    `subTracks == 0` is an absent instrument, which is not the same fact as an
    `intensity` of `-1` on one that exists.
11. Tolerate unknown JSON keys; never depend on key order or on the schema being
    stable across YARG versions.

## 8. Source map

| Topic | File |
|---|---|
| `currentSong.*` writer | `Assets/Script/Integration/CurrentSongController.cs` |
| State change events | `Assets/Script/Integration/GameStateFetcher.cs` |
| Path resolution | `Assets/Script/Helpers/PathHelper.cs` |
| CLI overrides | `Assets/Script/Persistent/CommandLineArgs.cs` |
| Export dispatch, CSV, text | `Assets/Script/Song/Exporters/SongExport.cs` |
| Ouvert JSON | `Assets/Script/Song/Exporters/OuvertExport.cs` |
| HTML export | `Assets/Script/Song/Exporters/WebBrowser{Export,Record,Difficulty,GenreTable,Template}.cs` |
| Playlists | `Assets/Script/Playlists/{Playlist,PlaylistContainer}.cs` |
| Song library | `Assets/Script/Song/SongContainer.cs` |
| `SongEntry` schema | `YARG.Core/YARG.Core/Song/Entries/SongEntry.cs` |
| Hash type | `YARG.Core/YARG.Core/Song/Entries/Types/HashWrapper.cs` |
| `SortString` type | `YARG.Core/YARG.Core/Song/Entries/Types/SortString.cs` |
| Enums | `YARG.Core/YARG.Core/Song/Entries/SongEnums.cs` |

---

## 9. `songcache.bin` — where the charts actually are

An earlier version of this document said "proprietary format, do not attempt to parse".
That was wrong in a way worth correcting, because this file answers the one question no
export format does: **where each song lives on disk**. Without it, album art works for
exactly the song `currentSong.json` names and for nothing else.

YARG rewrites it on every scan. Two properties make a read-only parser cheap and safe:

1. **Everything is length-prefixed.** Groups and entries are `int32 length` followed by
   that many bytes, so a reader can take the two or three fields at the head of each
   entry and skip a metadata tail it does not understand — by arithmetic, not by guessing.
2. **The encodings are plain .NET.** Little-endian scalars, strings as a 7-bit-encoded
   (LEB128) length plus UTF-8, and the SHA-1 as 20 raw bytes.

```
  int32   CACHE_VERSION            refuse anything unverified — see below
  bool    fullDirectoryPlaylists
  9 ×     string table             int32 byteLength, then int32 count + strings
  array   update directories       ─┐
  array   unpacked upgrades         ├─ skippable by their length prefixes
  array   packed upgrades          ─┘
  array   ini groups               base directory + relative paths
  array   CON groups               package path + per-entry shortname
```

where `array` is `int32 count` followed by that many independently length-prefixed
slices (`CacheLoopable`).

**The version check is not paranoia.** `CACHE_VERSION` is a `YY_MM_DD_RR` stamp and the
layout genuinely changes shape between values — the CON group header's type field is an
`int32` enum today and was a `bool` before. YARG's own full-scan reader (`ReadCONGroup`)
still carries the 1-byte read that change left behind, so **follow the writer and
`QuickReadCONGroup`, not `ReadCONGroup`**. Verify a new version by diffing
`Song/Cache/` and `Song/Entries/` between the two commits; if every change lands after
the hash, the head layout is unaffected.

Two traps worth naming:

- The DTA node name and the `subName` are **different strings** and both are stored. Most
  packages use the same value for both; at least one in a 4,000-song library does not,
  keeping its files under `songs/seven/` and its DTA node under `sevenfnf`.
- The hash for a CON song is `SHA1(mainMidi ++ updateMidi ++ upgradeMidi)`, not
  `SHA1(mid)`, whenever an RBCON update or upgrade applies. Recomputing it independently
  is only exact for songs with neither.

[VERIFIED — `YARG.Core/Song/Cache/CacheHandler.cs`, `CacheLoopable.cs`,
`CacheGroups/*.cs`, and the `ForceDeserialize` methods on each entry type. Implemented in
`server/src/media/cache.ts`, checked against a 4,168-song library where every hash in the
CSV export resolves.]

---
