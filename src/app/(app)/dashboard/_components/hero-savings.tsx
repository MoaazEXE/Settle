'use client'

import { useEffect, useRef, useState } from 'react'
import type { SavingsDataPoint } from '@/core/savings/savings'
import { useFmt } from '@/lib/currency-context'
import { Card } from '@/components/ui/card'

interface Props {
  savedCents: number
  thisMonthCents: number
  timeCostFormatted?: string
  sparkData: SavingsDataPoint[]
}

function Sparkline({ data, gradientId }: { data: SavingsDataPoint[]; gradientId: string }) {
  const fmt = useFmt()
  const w = 320
  const h = 88
  const pad = 6
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const values = data.map(d => d.cumulativeCents)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const n = values.length

  const pts = values.map((v, i) => ({
    x: n > 1 ? pad + (i / (n - 1)) * (w - pad * 2) : w / 2,
    y: h - pad - ((v - min) / range) * (h - pad * 2),
  }))

  function buildPath(close: boolean) {
    if (pts.length === 0) return ''
    if (pts.length === 1) {
      const p = pts[0]
      return close ? `M${p.x},${p.y} L${p.x},${h} Z` : `M${p.x},${p.y}`
    }
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]
      const p1 = pts[i + 1]
      const dx = (p1.x - p0.x) / 3
      d += ` C${(p0.x + dx).toFixed(1)},${p0.y.toFixed(1)} ${(p1.x - dx).toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`
    }
    if (close) {
      d += ` L${pts[pts.length - 1].x.toFixed(1)},${h} L${pts[0].x.toFixed(1)},${h} Z`
    }
    return d
  }

  const line = buildPath(false)
  const area = buildPath(true)
  const last = pts[pts.length - 1]
  const hover = hoverIdx !== null ? pts[hoverIdx] : null
  const hoverData = hoverIdx !== null ? data[hoverIdx] : null

  function getNearestIdx(clientX: number): number {
    const svg = svgRef.current
    if (!svg) return 0
    const rect = svg.getBoundingClientRect()
    const xRatio = (clientX - rect.left) / rect.width
    const xInViewBox = xRatio * w
    let nearest = 0
    let bestDist = Infinity
    pts.forEach((p, i) => {
      const dist = Math.abs(p.x - xInViewBox)
      if (dist < bestDist) {
        bestDist = dist
        nearest = i
      }
    })
    return nearest
  }

  const tooltipLeft = hover ? Math.min(Math.max((hover.x / w) * 100, 8), 92) : 50

  return (
    <div className="relative select-none">
      <svg
        ref={svgRef}
        width="100%"
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        onMouseMove={e => setHoverIdx(getNearestIdx(e.clientX))}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchStart={e => {
          const t = e.touches[0]
          if (t) setHoverIdx(getNearestIdx(t.clientX))
        }}
        onTouchMove={e => {
          e.preventDefault()
          const t = e.touches[0]
          if (t) setHoverIdx(getNearestIdx(t.clientX))
        }}
        onTouchEnd={() => setHoverIdx(null)}
        className="cursor-crosshair overflow-visible touch-none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill={`url(#${gradientId})`} className="animate-fade-area" />

        {hover && (
          <line
            x1={hover.x}
            y1={pad}
            x2={hover.x}
            y2={h - pad}
            stroke="var(--primary)"
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity="0.35"
          />
        )}

        <path
          d={line}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="animate-fade-in"
        />

        {!hover && (
          <>
            <circle cx={last.x} cy={last.y} r="8" fill="var(--primary)" className="animate-pulse-soft" />
            <circle cx={last.x} cy={last.y} r="4" fill="var(--primary)" />
          </>
        )}

        {hover && (
          <>
            <circle cx={hover.x} cy={hover.y} r="9" fill="var(--primary)" opacity="0.22" />
            <circle cx={hover.x} cy={hover.y} r="4.5" fill="var(--primary)" />
            <circle cx={hover.x} cy={hover.y} r="2" fill="white" />
          </>
        )}
      </svg>

      {hoverData && hover && (
        <div
          className="absolute z-10 -top-2 -translate-x-1/2 -translate-y-full px-2.5 py-1.5 rounded-md bg-primary-deep text-primary-foreground text-[11px] font-semibold whitespace-nowrap shadow-tooltip pointer-events-none"
          style={{ left: `${tooltipLeft}%` }}
        >
          <div className="text-[10px] uppercase tracking-wide text-primary-foreground/70">
            {new Date(hoverData.date).toLocaleDateString('en-MY', { month: 'short', day: 'numeric' })}
          </div>
          <div className="text-xs text-gold-tint tabular-nums">
            {fmt(hoverData.cumulativeCents)}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptySparkline({ label }: { label: string }) {
  return (
    <div className="h-20 flex items-center justify-center rounded-lg bg-primary-tint/40">
      <p className="text-xs text-subtle-foreground">{label}</p>
    </div>
  )
}

export function HeroSavings({ savedCents, thisMonthCents, timeCostFormatted, sparkData }: Props) {
  const fmt = useFmt()
  const displayRef = useRef<HTMLSpanElement>(null)
  const prevRef = useRef(savedCents)

  useEffect(() => {
    const el = displayRef.current
    if (!el || prevRef.current === savedCents) return
    const from = prevRef.current
    const to = savedCents
    const duration = 700
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const current = Math.round(from + (to - from) * eased)
      el.textContent = fmt(current)
      if (t < 1) requestAnimationFrame(tick)
      else {
        prevRef.current = to
        el.textContent = fmt(to)
      }
    }
    requestAnimationFrame(tick)
  }, [savedCents, fmt])
  const mobileData = sparkData.slice(-7)
  const allZeroMobile = mobileData.every(d => d.cumulativeCents === 0)
  const allZeroDesktop = sparkData.every(d => d.cumulativeCents === 0)

  return (
    <Card padding="md" className="lg:p-6">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Saved by waiting · all time
      </p>

      <div className="flex items-baseline gap-1.5">
        <span
          ref={displayRef}
          className="font-display text-5xl lg:text-6xl font-bold leading-none tracking-tight text-primary tabular-nums"
        >
          {fmt(savedCents)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {timeCostFormatted && (
          <Chip tone="primary">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 3l1.8 5.4L19 10.2 13.8 12 12 17.4 10.2 12 5 10.2l5.2-1.8L12 3z" />
            </svg>
            +{timeCostFormatted} of your life
          </Chip>
        )}
        {thisMonthCents > 0 && (
          <Chip tone="gold">
            +{fmt(thisMonthCents, 0)} this month
          </Chip>
        )}
      </div>

      <div className="mt-5 lg:hidden">
        {allZeroMobile ? (
          <EmptySparkline label="Your savings will appear here" />
        ) : (
          <Sparkline data={mobileData} gradientId="sparkGrad7" />
        )}
        <div className="mt-2 flex justify-between text-[11px] font-medium text-subtle-foreground">
          <span>7 days ago</span>
          <span>Today</span>
        </div>
      </div>

      <div className="mt-5 hidden lg:block">
        {allZeroDesktop ? (
          <EmptySparkline label="Your savings will appear here" />
        ) : (
          <Sparkline data={sparkData} gradientId="sparkGrad30" />
        )}
        <div className="mt-2 flex justify-between text-[11px] font-medium text-subtle-foreground">
          <span>30 days ago</span>
          <span>Today</span>
        </div>
      </div>
    </Card>
  )
}

function Chip({
  tone,
  children,
}: {
  tone: 'primary' | 'gold'
  children: React.ReactNode
}) {
  const toneClass =
    tone === 'primary'
      ? 'bg-primary-tint text-primary-deep'
      : 'bg-gold-tint text-gold-deep'
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${toneClass}`}
    >
      {children}
    </span>
  )
}
