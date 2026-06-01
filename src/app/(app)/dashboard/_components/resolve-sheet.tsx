'use client'

import { useActionState, useEffect, useRef, useTransition, useState } from 'react'
import { toast } from 'sonner'
import { resolveItem, snoozeItem, editCoolingItem } from '@/app/actions/items'
import { useResolveSheet } from '@/app/(app)/_components/resolve-sheet-context'
import { CATEGORIES } from '@/core/categories/categories'
import { fmtCurrency, CURRENCIES } from '@/lib/formatters'
import { useCurrency } from '@/lib/currency-context'
import { SheetFrame } from '@/components/ui/sheet-frame'
import { ErrorBanner } from '@/components/ui/error-banner'
import { cn } from '@/lib/utils'

const SNOOZE_OPTIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: '1 day', minutes: 1440 },
  { label: '3 days', minutes: 4320 },
  { label: '1 week', minutes: 10080 },
] as const

const COOLING_PRESETS = [
  { label: '30 mins', value: 30, unit: 'MINUTES' },
  { label: '1 hour', value: 1, unit: 'HOURS' },
  { label: '5 hours', value: 5, unit: 'HOURS' },
  { label: '1 day', value: 1, unit: 'DAYS' },
  { label: '1 week', value: 7, unit: 'DAYS' },
] as const

interface ResolveItem {
  id: string
  title: string
  amountCents: number
  category?: string | null
  timeCostFormatted?: string
}

type Mode = 'resolve' | 'snooze' | 'edit'

interface Props {
  item: ResolveItem
  onClose: () => void
  onSkipped: (amountCents: number, timeCostFormatted?: string) => void
}

export function ResolveSheet({ item, onClose, onSkipped }: Props) {
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>('resolve')
  const currency = useCurrency()
  const { markResolved } = useResolveSheet()

  function handleBuy() {
    markResolved(item.id)
    startTransition(async () => {
      await resolveItem(item.id, 'BOUGHT')
      onClose()
      toast(`${item.title} · bought`, { description: 'Removed from cooling.' })
    })
  }

  function handleSkip() {
    markResolved(item.id)
    startTransition(async () => {
      await resolveItem(item.id, 'SKIPPED')
      onClose()
      onSkipped(item.amountCents, item.timeCostFormatted)
    })
  }

  function handleSnooze(minutes: number, label: string) {
    startTransition(async () => {
      await snoozeItem(item.id, minutes)
      onClose()
      toast(`${item.title} · snoozed`, { description: `Cooling extended by ${label}.` })
    })
  }

  const sheetTitle = mode === 'edit' ? 'Edit temptation' : mode === 'snooze' ? 'Snooze' : 'Cooling'

  return (
    <SheetFrame title={sheetTitle} onClose={onClose}>
      {mode === 'resolve' && (
        <div className="px-5 pb-8">
          <div className="mb-6 text-center">
            <p className="text-xl font-bold text-foreground tracking-tight">{item.title}</p>
            <p className="mt-1 text-3xl font-bold text-primary tabular-nums leading-tight tracking-tight">
              {fmtCurrency(item.amountCents, currency)}
            </p>
            {item.timeCostFormatted && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                ≈ {item.timeCostFormatted} of your life
              </p>
            )}
          </div>

          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Still want it?
          </p>

          <div className="flex gap-2.5">
            <ActionButton onClick={handleBuy} disabled={pending} tone="coral">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 8h14l-1 12H6L5 8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M9 8V6a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              Buy it
            </ActionButton>

            <ActionButton onClick={() => setMode('snooze')} disabled={pending} tone="primary-tint">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 7h6L5 17h6M14 11h5l-5 6h5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Snooze
            </ActionButton>

            <ActionButton onClick={handleSkip} disabled={pending} tone="primary" wide>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 12l4.5 4.5L19 7"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Skip
            </ActionButton>
          </div>

          <button
            type="button"
            onClick={() => setMode('edit')}
            className="mt-3 w-full min-h-[44px] text-center text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center"
          >
            Edit details
          </button>
        </div>
      )}

      {mode === 'snooze' && (
        <div className="px-5 pb-8">
          <p className="mb-4 text-center text-sm font-medium text-muted-foreground">
            Snooze for how long?
          </p>
          <div className="flex flex-col gap-2.5">
            {SNOOZE_OPTIONS.map(opt => (
              <button
                key={opt.minutes}
                type="button"
                onClick={() => handleSnooze(opt.minutes, opt.label)}
                disabled={pending}
                className="h-14 rounded-xl bg-primary-tint text-primary-deep font-semibold text-sm transition-all active:scale-[0.97] disabled:opacity-50"
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setMode('resolve')}
            className="mt-3 w-full h-12 rounded-xl bg-card border border-border text-foreground font-semibold text-sm transition-colors hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      )}

      {mode === 'edit' && (
        <EditCoolingForm item={item} onSaved={onClose} onCancel={() => setMode('resolve')} />
      )}
    </SheetFrame>
  )
}

function EditCoolingForm({
  item,
  onSaved,
  onCancel,
}: {
  item: ResolveItem
  onSaved: () => void
  onCancel: () => void
}) {
  const [error, action, isPending] = useActionState(editCoolingItem, null)
  const [title, setTitle] = useState(item.title)
  const [category, setCategory] = useState(item.category ?? 'other')
  const currency = useCurrency()
  const currencySymbol = CURRENCIES.find(c => c.code === currency)?.symbol ?? currency
  const [selectedPreset, setSelectedPreset] = useState(3)
  const [isCustom, setIsCustom] = useState(false)
  const wasPending = useRef(false)

  useEffect(() => {
    if (wasPending.current && !isPending && error === null) {
      toast.success('Temptation updated')
      onSaved()
    }
    wasPending.current = isPending
  }, [isPending, error, onSaved])

  const coolingValue = isCustom ? undefined : COOLING_PRESETS[selectedPreset]?.value
  const coolingUnit = isCustom ? undefined : COOLING_PRESETS[selectedPreset]?.unit

  return (
    <form action={action} className="px-5 pb-8 space-y-5">
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="category" value={category} />

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Name
        </label>
        <input
          name="title"
          type="text"
          required
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full h-13 px-4 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Amount
        </label>
        <div className="flex items-center gap-1.5 h-13 px-4 rounded-lg bg-background border border-border focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-colors">
          <span className="text-sm font-semibold text-muted-foreground">{currencySymbol}</span>
          <input
            name="amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            required
            defaultValue={item.amountCents / 100}
            className="flex-1 h-full text-sm font-semibold text-foreground bg-transparent border-none outline-none"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Category
        </label>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              className={cn(
                'h-9 px-3 rounded-lg text-sm font-semibold transition-colors',
                category === cat.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card border border-border text-foreground hover:bg-muted',
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          New cooling period
        </label>
        <div className="flex flex-wrap gap-2">
          {COOLING_PRESETS.map((preset, i) => (
            <PresetPill
              key={i}
              active={!isCustom && selectedPreset === i}
              onClick={() => { setSelectedPreset(i); setIsCustom(false) }}
            >
              {preset.label}
            </PresetPill>
          ))}
          <PresetPill active={isCustom} onClick={() => setIsCustom(true)}>
            Custom
          </PresetPill>
        </div>

        {!isCustom && (
          <>
            <input type="hidden" name="coolingValue" value={coolingValue} />
            <input type="hidden" name="coolingUnit" value={coolingUnit} />
          </>
        )}

        {isCustom && (
          <div className="mt-1 bg-card rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 mb-3">
              <input
                name="coolingValue"
                type="number"
                inputMode="numeric"
                min="1"
                defaultValue="3"
                required
                className="w-16 h-9 px-2 rounded-sm bg-background border border-border text-sm font-semibold text-foreground text-center focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <span className="text-sm font-medium text-muted-foreground">of</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['MINUTES', 'HOURS', 'DAYS', 'WEEKS'] as const).map(unit => (
                <label
                  key={unit}
                  className="h-9 px-3 rounded-lg text-sm font-semibold transition-colors flex items-center cursor-pointer select-none has-[:checked]:bg-primary has-[:checked]:text-primary-foreground text-muted-foreground bg-background border border-border"
                >
                  <input
                    type="radio"
                    name="coolingUnit"
                    value={unit}
                    defaultChecked={unit === 'DAYS'}
                    className="sr-only"
                  />
                  <span className="capitalize">{unit.toLowerCase()}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <ErrorBanner message={error} />

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 h-13 rounded-xl bg-card border border-border text-foreground font-semibold text-sm transition-colors hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !title.trim()}
          className="flex-[2] h-13 rounded-xl bg-primary text-primary-foreground text-sm font-semibold transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

const toneClasses = {
  coral: 'bg-coral-tint text-coral-deep',
  'primary-tint': 'bg-primary-tint text-primary-deep',
  primary: 'bg-primary text-primary-foreground',
} as const

function ActionButton({
  onClick,
  disabled,
  tone,
  wide,
  children,
}: {
  onClick: () => void
  disabled: boolean
  tone: keyof typeof toneClasses
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-14 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.97] disabled:opacity-50',
        wide ? 'flex-[1.2]' : 'flex-1',
        toneClasses[tone],
      )}
    >
      {children}
    </button>
  )
}

function PresetPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-10 px-4 rounded-lg text-sm font-semibold transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-card border border-border text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}
