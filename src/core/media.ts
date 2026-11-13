// Prepare files for attachments, storage and pictures, like the app (attachments/Attachment.kt, ImageShrink).
// Photos are saved anew as JPEG: downscaled and without location or other metadata (ADR 0011).

/** Like AttachmentLimits in the app. */
export const LIMITS = {
  perMessage: 5,
  attachmentBytes: 10 * 1024 * 1024,
  storeBytes: 50 * 1024 * 1024,
  nameChars: 40,
  imageEdge: 1600,
  imageQuality: 0.8,
  /** Photos in the storages (ADR 0067 §7): larger, so that small print stays readable; without capture location. */
  storeImageEdge: 3200,
  storeImageQuality: 0.9,
  avatarEdge: 512,
  avatarQuality: 0.85,
}

export interface Prepared {
  bytes: Uint8Array
  /** ANMP kind: `jpg`, `pdf`, `m4a` or `file`. */
  type: string
  name: string
  width: number
  height: number
}

const IMAGE = /^image\/(jpeg|png|webp|gif|heic|heif|avif|bmp)$/i

/** Kind of a chosen file: photos become `jpg`, PDF stays `pdf`, everything else `file` with name. */
export function kindOf(file: File): 'jpg' | 'pdf' | 'file' {
  if (IMAGE.test(file.type) && !/gif/i.test(file.type)) return 'jpg'
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  return 'file'
}

/**
 * Prepare a file for chat or storage; `null` if a photo cannot be read. For storage ([forStore])
 * photos stay larger (ADR 0067 §7), metadata is dropped in both cases.
 */
export async function prepareFile(file: File, forStore = false): Promise<Prepared | null> {
  const kind = kindOf(file)
  if (kind === 'jpg') {
    const shrunk = forStore
      ? await shrinkImage(file, LIMITS.storeImageEdge, LIMITS.storeImageQuality)
      : await shrinkImage(file, LIMITS.imageEdge, LIMITS.imageQuality)
    if (!shrunk) return null
    return { ...shrunk, type: 'jpg', name: '' }
  }
  return { bytes: new Uint8Array(await file.arrayBuffer()), type: kind, name: file.name, width: 0, height: 0 }
}

/**
 * Picture to at most [maxEdge] pixels on the longest side, anew as JPEG (without metadata), the right way up according
 * to the image data; [rotate] then rotates clockwise as well (0, 90, 180, 270 degrees), like `shrinkImage` in the app.
 */
export async function shrinkImage(
  blob: Blob,
  maxEdge: number,
  quality: number,
  rotate = 0,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const drawWidth = Math.max(1, Math.round(bitmap.width * scale))
  const drawHeight = Math.max(1, Math.round(bitmap.height * scale))
  const turn = quarterTurns(rotate)
  // On a quarter turn, width and height of the result swap.
  const sideways = turn === 90 || turn === 270
  const width = sideways ? drawHeight : drawWidth
  const height = sideways ? drawWidth : drawHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // White background instead of black for transparent PNGs.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  // Rotate around the centre; in the canvas y grows downwards, so positive angles rotate clockwise.
  ctx.translate(width / 2, height / 2)
  ctx.rotate((turn * Math.PI) / 180)
  ctx.drawImage(bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
  bitmap.close()
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!out) return null
  return { bytes: new Uint8Array(await out.arrayBuffer()), width, height }
}

/** [degrees] as 0, 90, 180 or 270, also for negative values (like `quarterTurns` in the app). */
export function quarterTurns(degrees: number): number {
  return ((((Math.trunc(degrees / 90) % 4) + 4) % 4) * 90)
}

/** Rotate a photo from a storage by [turn] degrees clockwise, in the same size and quality as when storing. */
export function rotateStoreImage(bytes: Uint8Array, turn: number): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  return shrinkImage(new Blob([bytes as BlobPart], { type: 'image/jpeg' }), LIMITS.storeImageEdge, LIMITS.storeImageQuality, turn)
}

/** Shorten the file name for the envelope, the extension stays (MAX_NAME_CHARS in the app). */
export function shortName(name: string, max = LIMITS.nameChars): string {
  if (name.length <= max) return name
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : ''
  return name.slice(0, max - ext.length - 1) + '…' + ext
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  m4a: 'audio/mp4',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
}

/** MIME type for opening and saving: from the kind, for `file` from the extension (mimeTypeOf in the app). */
export function mimeOf(type: string, name: string): string {
  if (type !== 'file') return MIME[type] ?? 'application/octet-stream'
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

/** Save bytes to the device (only on explicit request, e.g. button „Aufs Gerät speichern“). */
export function saveBytes(bytes: Uint8Array | Int8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  saveUrl(url, name)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Save an already loaded blob URL to the device (only on explicit request). */
export function saveUrl(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}
