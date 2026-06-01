import Image from 'next/image'
import { cn } from '@/lib/utils'

const PALETTE = [
  '#2D5F5B', // primary teal
  '#C9A961', // gold
  '#D88376', // coral
  '#7C8D6B', // sage
  '#5E7A85', // slate-blue
  '#876B9E', // muted purple
] as const

function colorFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

interface Props {
  name: string
  src?: string | null
  size?: number
  shape?: 'circle' | 'square'
  className?: string
}

export function Avatar({ name, src, size = 32, shape = 'circle', className }: Props) {
  const initial = (name.trim().charAt(0) || '?').toUpperCase()
  const bg = colorFor(name)
  const borderRadius = shape === 'circle' ? 9999 : 14

  if (src) {
    return (
      <Image
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cn('inline-block object-cover', className)}
        style={{ width: size, height: size, borderRadius }}
        aria-hidden="true"
      />
    )
  }

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center text-white font-semibold select-none',
        'shadow-[inset_0_0_0_2px_rgba(255,255,255,0.18)]',
        className,
      )}
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: Math.round(size * 0.42),
        borderRadius,
      }}
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}
