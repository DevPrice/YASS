/**
 * Decoder for `.png_xbox` — the album art inside a CON package.
 *
 * Despite the name there is no PNG involved. It is a 32-byte header followed by
 * raw DXT1 or DXT5 blocks, as the Xbox 360's GPU wanted them, which means
 * big-endian: every adjacent pair of bytes is swapped relative to the
 * little-endian layout every DXT decoder in the world expects.
 *
 * ## The header
 *
 * ```
 *   [1]     bits per pixel
 *   [2..5]  int32 LE format
 *   [7..8]  int16 LE width
 *   [9..10] int16 LE height
 *   [32..]  block data
 * ```
 *
 * DXT1 iff `bitsPerPixel == 0x04 && format == 0x08`; everything else is DXT5.
 * Width and height sitting at 7 and 9 rather than at aligned offsets is not a
 * mistake in this comment — the fields really are unaligned.
 *
 * ## Two things YARG does that we deliberately do not
 *
 * **The byte swap we keep.** YARG defers it to texture upload time
 * (`ImageExtensions.LoadTexture` swaps pairs while copying into Unity's
 * buffer), which makes it look like a Unity detail. It isn't: it is how the
 * bytes are stored, and any decoder has to undo it. We do it up front and then
 * treat the result as ordinary little-endian DXT.
 *
 * **The vertical flip we drop.** YARG hands the texture to a `RawImage` with
 * `uvRect = (0, 0, 1, -1)`, flipping it on screen. That exists because Unity
 * addresses textures bottom-up and the source data is top-down — it is a fix
 * for a Unity convention, not a property of the image. Reproducing it here
 * would serve every CON cover upside down.
 *
 * Only mip 0 is decoded. The trailing mips in the file are never asked for.
 *
 * Source: `YARG.Core/IO/Images/YARGImage.cs` and
 * `Assets/Script/Helpers/Extensions/ImageExtensions.cs`.
 */

const HEADER_SIZE = 32

export interface DecodedImage {
  width: number
  height: number
  /** Top-down RGBA, 4 bytes per pixel — what ffmpeg takes as `-pix_fmt rgba`. */
  rgba: Buffer
}

/** 5/6/5 bits to 8/8/8, scaled so that all-ones maps to 255 rather than 248. */
function unpack565(value: number): [number, number, number] {
  const r = (value >> 11) & 0x1f
  const g = (value >> 5) & 0x3f
  const b = value & 0x1f

  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 3)]
}

/**
 * The four colours a DXT block interpolates between.
 *
 * When `c0 <= c1` the fourth entry is transparent black in DXT1's punch-through
 * mode. We return it opaque: album art has no alpha channel to speak of, YARG
 * uploads CON art as `TextureFormat.DXT1` (which has none either), and a
 * transparent texel here would show as a hole in a cover rather than as the
 * black the artist drew.
 */
function blockColours(c0: number, c1: number): number[][] {
  const a = unpack565(c0)
  const b = unpack565(c1)

  if (c0 > c1) {
    return [
      a,
      b,
      [
        Math.round((2 * a[0] + b[0]) / 3),
        Math.round((2 * a[1] + b[1]) / 3),
        Math.round((2 * a[2] + b[2]) / 3),
      ],
      [
        Math.round((a[0] + 2 * b[0]) / 3),
        Math.round((a[1] + 2 * b[1]) / 3),
        Math.round((a[2] + 2 * b[2]) / 3),
      ],
    ]
  }

  return [
    a,
    b,
    [
      Math.round((a[0] + b[0]) / 2),
      Math.round((a[1] + b[1]) / 2),
      Math.round((a[2] + b[2]) / 2),
    ],
    [0, 0, 0],
  ]
}

/** The eight alpha values a DXT5 block interpolates between. */
function alphaTable(a0: number, a1: number): number[] {
  const table = [a0, a1, 0, 0, 0, 0, 0, 0]

  if (a0 > a1) {
    for (let i = 0; i < 6; i++) table[i + 2] = Math.round(((6 - i) * a0 + (i + 1) * a1) / 7)
  } else {
    for (let i = 0; i < 4; i++) table[i + 2] = Math.round(((4 - i) * a0 + (i + 1) * a1) / 5)
    table[6] = 0
    table[7] = 255
  }

  return table
}

export interface DxtHeader {
  width: number
  height: number
  dxt1: boolean
}

/**
 * Read the 32-byte header.
 *
 * Split out from the decode so the header can be pinned by a unit vector, and
 * so a caller can sanity-check the payload length against the dimensions before
 * trusting any pixels — see `expectedPayloadBytes`.
 */
export function readDxtHeader(data: Buffer): DxtHeader | null {
  if (data.length < HEADER_SIZE) return null

  const bitsPerPixel = data[1]!
  const format = data.readInt32LE(2)
  const width = data.readInt16LE(7)
  const height = data.readInt16LE(9)

  if (width <= 0 || height <= 0) return null

  return { width, height, dxt1: bitsPerPixel === 0x04 && format === 0x08 }
}

/**
 * How many bytes mip 0 must occupy: one block per 4×4 texel group, 8 bytes for
 * DXT1 and 16 for DXT5.
 *
 * Worth checking before decoding, because a wrong guess about the format or the
 * dimensions produces plausible garbage rather than an error.
 */
export function expectedPayloadBytes(header: DxtHeader): number {
  const blocks = Math.ceil(header.width / 4) * Math.ceil(header.height / 4)
  return blocks * (header.dxt1 ? 8 : 16)
}

/**
 * Decode mip 0 of a `.png_xbox` to top-down RGBA.
 *
 * Returns null when the header is unreadable or the payload is too short for
 * the dimensions it claims — both mean "no art for this song", which the caller
 * already knows how to render.
 */
export function decodeDxt(file: Buffer): DecodedImage | null {
  const header = readDxtHeader(file)
  if (header === null) return null

  const { width, height, dxt1 } = header
  const blockBytes = dxt1 ? 8 : 16

  if (file.length - HEADER_SIZE < expectedPayloadBytes(header)) return null

  // Undo the Xbox byte order across the payload, on a copy — the caller's
  // buffer may be a view into a larger read and is not ours to mutate.
  const data = Buffer.from(file.subarray(HEADER_SIZE))
  for (let i = 0; i + 1 < data.length; i += 2) {
    const swap = data[i]!
    data[i] = data[i + 1]!
    data[i + 1] = swap
  }

  const rgba = Buffer.alloc(width * height * 4)
  const blocksAcross = Math.ceil(width / 4)
  const blocksDown = Math.ceil(height / 4)

  for (let by = 0; by < blocksDown; by++) {
    for (let bx = 0; bx < blocksAcross; bx++) {
      const at = (by * blocksAcross + bx) * blockBytes

      let alphas: number[] | null = null
      // Sixteen 3-bit indices over six little-endian bytes. Split into two
      // 24-bit halves — eight indices each, exactly — rather than reaching for
      // BigInt: 48 bits is past what `>>>` can shift, and a bigint per texel is
      // a million allocations on a 1024² cover.
      let alphaLow = 0
      let alphaHigh = 0
      let colourAt = at

      if (!dxt1) {
        alphas = alphaTable(data[at]!, data[at + 1]!)
        alphaLow = data.readUIntLE(at + 2, 3)
        alphaHigh = data.readUIntLE(at + 5, 3)
        colourAt = at + 8
      }

      const colours = blockColours(data.readUInt16LE(colourAt), data.readUInt16LE(colourAt + 2))
      const indices = data.readUInt32LE(colourAt + 4)

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px
          const y = by * 4 + py
          // The last block in a row or column overhangs a non-multiple-of-4
          // image; those texels exist in the data and not in the picture.
          if (x >= width || y >= height) continue

          const texel = py * 4 + px
          const colour = colours[(indices >>> (texel * 2)) & 0x3]!

          const out = (y * width + x) * 4
          rgba[out] = colour[0]!
          rgba[out + 1] = colour[1]!
          rgba[out + 2] = colour[2]!

          if (alphas === null) {
            rgba[out + 3] = 255
          } else {
            const bits = texel < 8 ? alphaLow : alphaHigh
            rgba[out + 3] = alphas[(bits >>> ((texel % 8) * 3)) & 0x7]!
          }
        }
      }
    }
  }

  return { width, height, rgba }
}
