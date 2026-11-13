// Generated pictures according to ADR 0012 and Docs/marke §7: circle angular with three rings of arc segments around
// a dot, person round with a mirrored box pattern. Colour pairs only from the palette; own photo if there is one.
import { useEffect, useState } from 'preact/hooks'
import type { ImageRef } from 'anmp-core'
import { imageUrl, isSupportCircle, people, supportPeer } from '../core/session'

/** Surface / pattern, like `AppTheme.colors.avatarTones`. */
const TONES: [string, string][] = [
  ['#082C35', '#FF8A00'],
  ['#687983', '#FAFAF7'],
  ['#134552', '#FFB347'],
  ['#FFF0DE', '#FF8A00'],
  ['#E6E4DE', '#687983'],
  ['#082C35', '#FAFAF7'],
]

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Picture of a circle or a person; circles of a support request show the picture of support (ADR 0065). */
export function Avatar(props: { id: string; kind: 'circle' | 'person'; size?: number; image?: ImageRef | null }) {
  const support = props.kind === 'circle' && isSupportCircle(props.id) ? supportPeer.value : null
  if (support) return <PlainAvatar {...props} id={support} image={people.value.get(support)?.image ?? null} />
  return <PlainAvatar {...props} />
}

function PlainAvatar({ id, kind, size = 44, image }: { id: string; kind: 'circle' | 'person'; size?: number; image?: ImageRef | null }) {
  const [photo, setPhoto] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setPhoto(null)
    if (image) imageUrl(image).then((u) => alive && setPhoto(u)).catch(() => {})
    return () => {
      alive = false
    }
  }, [image?.id, image?.space])

  const radius = kind === 'circle' ? size * 0.26 : size / 2
  if (photo) {
    return <img class="avatar" src={photo} width={size} height={size} style={{ borderRadius: `${radius}px` }} alt="" />
  }
  const h = hash(id)
  const [bg, fg] = TONES[h % TONES.length]
  return (
    <svg class="avatar" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      {kind === 'circle' ? <rect width="40" height="40" rx="10.4" fill={bg} /> : <circle cx="20" cy="20" r="20" fill={bg} />}
      {kind === 'circle' ? rings(h, fg) : boxes(h, fg)}
    </svg>
  )
}

/** Three rings of arc segments around a dot; gaps and rotation from the ID. */
function rings(h: number, color: string) {
  const out = [<circle key="dot" cx="20" cy="20" r="2.6" fill={color} />]
  for (let ring = 0; ring < 3; ring++) {
    const r = 7 + ring * 4.6
    const pieces = 2 + ((h >>> (ring * 3)) % 3)
    const turn = ((h >>> (ring * 5 + 9)) % 360) * (Math.PI / 180)
    for (let i = 0; i < pieces; i++) {
      const a0 = turn + (i * 2 * Math.PI) / pieces
      const a1 = a0 + ((2 * Math.PI) / pieces) * 0.62
      const x0 = 20 + r * Math.cos(a0)
      const y0 = 20 + r * Math.sin(a0)
      const x1 = 20 + r * Math.cos(a1)
      const y1 = 20 + r * Math.sin(a1)
      out.push(
        <path
          key={`${ring}-${i}`}
          d={`M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`}
          stroke={color}
          stroke-width="2.4"
          stroke-linecap="round"
          fill="none"
        />,
      )
    }
  }
  return out
}

/** 5×5 boxes, mirrored left and right, inside the round shape. */
function boxes(h: number, color: string) {
  const out = []
  const cell = 4.6
  const start = 20 - cell * 2.5
  let bits = h
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const on = bits & 1
      bits = (bits >>> 1) | ((bits & 1) << 31)
      if (!on) continue
      for (const cx of x === 2 ? [2] : [x, 4 - x]) {
        out.push(<rect key={`${cx}-${y}`} x={start + cx * cell + 0.4} y={start + y * cell + 0.4} width={cell - 0.8} height={cell - 0.8} rx="1" fill={color} />)
      }
    }
  }
  return out
}
