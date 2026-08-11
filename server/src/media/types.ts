/**
 * What the media subsystem needs to know about a chart, and nothing else.
 *
 * The CSV export YARG writes has 35 columns and not one of them says where the
 * chart lives, which is why album art has only ever worked for the one song
 * `currentSong.json` names. `ChartRef` is the missing column, recovered from
 * files YARG already writes — see `cache.ts` for the fast path and `scan.ts`
 * for the one that doesn't care what version YARG is.
 *
 * **`path` never crosses the wire.** It is an absolute filesystem path, which on
 * Windows names the user's account, and this server is bound to the LAN by
 * design. Every media URL the client sees is keyed by hash; the path stays here.
 * Same rule `nowPlaying.ts` already applies to `ActualLocation`.
 */

/** YARG's `EntryType`, minus the `Unknown` the CSV loader needs and this doesn't. */
export type ChartFormat = 'Ini' | 'Sng' | 'CON' | 'ExCON'

export interface ChartRef {
  /** Canonical uppercase hex, 40 chars. Joins to `Song.hash`. */
  hash: string
  format: ChartFormat
  /**
   * Absolute location. A directory for `Ini`, a container file for `Sng`, the
   * package file for `CON`, the package *directory* for `ExCON`.
   */
  path: string
  /**
   * The RBCON shortname, which is how you find anything inside a package:
   * `songs/<sub>/<sub>.mid`, `songs/<sub>/gen/<sub>_keep.png_xbox`.
   *
   * `CON` and `ExCON` only.
   */
  subName?: string
  /**
   * The song's key in `songs.dta`, which is usually — but not always — the same
   * string as `subName`.
   *
   * YARG stores the two separately and so do we, because one package in this
   * library has files under `songs/seven/` and a DTA node called `sevenfnf`.
   * Looking the preview window up by `subName` finds nothing there; looking
   * files up by the node name finds nothing anywhere else.
   */
  dtaName?: string
}
