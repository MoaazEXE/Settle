'use client'

import { useRef, useState, useCallback } from 'react'
import ReactCrop, { centerCrop, makeAspectCrop, type Crop, type PixelCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

const OUTPUT_PX   = 400
const JPEG_QUALITY = 0.82

function centeredCircleCrop(width: number, height: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, 1, width, height),
    width,
    height,
  )
}

async function cropToBlob(
  img: HTMLImageElement,
  crop: PixelCrop,
  rotation: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_PX
  canvas.height = OUTPUT_PX
  const ctx = canvas.getContext('2d')!

  const scaleX = img.naturalWidth / img.width
  const scaleY = img.naturalHeight / img.height

  ctx.save()
  ctx.translate(OUTPUT_PX / 2, OUTPUT_PX / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.translate(-OUTPUT_PX / 2, -OUTPUT_PX / 2)

  ctx.drawImage(
    img,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    OUTPUT_PX,
    OUTPUT_PX,
  )
  ctx.restore()

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Crop failed')),
      'image/jpeg',
      JPEG_QUALITY,
    ),
  )
}

interface Props {
  src: string
  onConfirm: (blob: Blob, previewUrl: string) => void
  onCancel: () => void
}

export function CropAvatarSheet({ src, onConfirm, onCancel }: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const [rotation, setRotation] = useState(0)
  const [applying, setApplying] = useState(false)

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    setCrop(centeredCircleCrop(width, height))
  }, [])

  async function handleApply() {
    if (!imgRef.current || !completedCrop) return
    setApplying(true)
    try {
      const blob = await cropToBlob(imgRef.current, completedCrop, rotation)
      const url = URL.createObjectURL(blob)
      onConfirm(blob, url)
    } catch {
      // fall through — keep sheet open
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-sheet-up">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-sep">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <h2 className="text-base font-semibold tracking-tight">Crop photo</h2>
        <button
          type="button"
          onClick={handleApply}
          disabled={!completedCrop || applying}
          className="text-sm font-semibold text-primary disabled:opacity-40 transition-opacity"
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
      </div>

      {/* Crop area */}
      <div className="flex-1 min-h-0 flex items-center justify-center bg-foreground/5 p-4 overflow-hidden">
        <ReactCrop
          crop={crop}
          onChange={c => setCrop(c)}
          onComplete={c => setCompletedCrop(c)}
          aspect={1}
          circularCrop
          className="max-h-full"
        >
          <img
            ref={imgRef}
            src={src}
            alt="Crop preview"
            onLoad={onImageLoad}
            style={{ transform: `rotate(${rotation}deg)`, maxHeight: '60vh', objectFit: 'contain' }}
          />
        </ReactCrop>
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 px-5 py-4 border-t border-sep space-y-4">
        {/* Rotation */}
        <div className="flex items-center gap-3">
          <RotateCcw size={16} strokeWidth={1.8} className="flex-shrink-0 text-muted-foreground" />
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={rotation}
            onChange={e => setRotation(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="text-xs tabular-nums text-muted-foreground w-9 text-right">
            {rotation > 0 ? `+${rotation}°` : `${rotation}°`}
          </span>
          {rotation !== 0 && (
            <button
              type="button"
              onClick={() => setRotation(0)}
              className="text-xs font-semibold text-primary"
            >
              Reset
            </button>
          )}
        </div>

        {/* Quick rotate buttons */}
        <div className="flex gap-2">
          {[-90, -45, 45, 90].map(deg => (
            <button
              key={deg}
              type="button"
              onClick={() => setRotation(r => Math.max(-180, Math.min(180, r + deg)))}
              className={cn(
                'flex-1 h-9 rounded-lg text-xs font-semibold border transition-colors',
                'border-border bg-card text-foreground hover:bg-muted',
              )}
            >
              {deg > 0 ? `+${deg}°` : `${deg}°`}
            </button>
          ))}
        </div>

        <p className="text-[11px] text-center text-muted-foreground">
          Drag to reposition · pinch or scroll to zoom
        </p>
      </div>
    </div>
  )
}
