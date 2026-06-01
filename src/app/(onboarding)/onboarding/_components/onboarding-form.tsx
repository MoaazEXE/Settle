'use client'

import { useActionState, useReducer, useRef } from 'react'
import { completeOnboarding } from '@/app/actions/users'
import { normalizeUsername } from '@/lib/username'
import { StepUsername } from './step-username'
import { StepCurrency } from './step-currency'
import { StepIncome } from './step-income'
import { DEFAULT_CURRENCY } from '@/lib/constants'

interface FormState {
  step: 0 | 1 | 2
  username: string
  currency: string
  monthlyIncome: string
  weeklyHours: string
}

type Action =
  | { type: 'SET_USERNAME'; value: string }
  | { type: 'SET_CURRENCY'; value: string }
  | { type: 'SET_MONTHLY_INCOME'; value: string }
  | { type: 'SET_WEEKLY_HOURS'; value: string }
  | { type: 'NEXT' }
  | { type: 'BACK' }

function reducer(state: FormState, action: Action): FormState {
  switch (action.type) {
    case 'SET_USERNAME': return { ...state, username: action.value }
    case 'SET_CURRENCY': return { ...state, currency: action.value }
    case 'SET_MONTHLY_INCOME': return { ...state, monthlyIncome: action.value }
    case 'SET_WEEKLY_HOURS': return { ...state, weeklyHours: action.value }
    case 'NEXT': return { ...state, step: Math.min(state.step + 1, 2) as FormState['step'] }
    case 'BACK': return { ...state, step: Math.max(state.step - 1, 0) as FormState['step'] }
    default: return state
  }
}

interface Props {
  suggestedUsername: string
}

export function OnboardingForm({ suggestedUsername }: Props) {
  const [formState, dispatch] = useReducer(reducer, {
    step: 0,
    username: suggestedUsername,
    currency: DEFAULT_CURRENCY,
    monthlyIncome: '',
    weeklyHours: '',
  })

  const formRef = useRef<HTMLFormElement>(null)
  const [error, submitAction, isPending] = useActionState(completeOnboarding, null)

  function handleSubmit() {
    formRef.current?.requestSubmit()
  }

  return (
    <form ref={formRef} action={submitAction} className="contents">
      <input type="hidden" name="username" value={normalizeUsername(formState.username)} />
      <input type="hidden" name="currency" value={formState.currency} />
      {formState.monthlyIncome && (
        <input type="hidden" name="monthlyIncome" value={formState.monthlyIncome} />
      )}
      {formState.weeklyHours && (
        <input type="hidden" name="weeklyHours" value={formState.weeklyHours} />
      )}

      {formState.step === 0 && (
        <StepUsername
          suggestedUsername={suggestedUsername}
          value={formState.username}
          onChange={v => dispatch({ type: 'SET_USERNAME', value: v })}
          onNext={() => dispatch({ type: 'NEXT' })}
        />
      )}

      {formState.step === 1 && (
        <StepCurrency
          value={formState.currency}
          onChange={v => dispatch({ type: 'SET_CURRENCY', value: v })}
          onNext={() => dispatch({ type: 'NEXT' })}
          onBack={() => dispatch({ type: 'BACK' })}
        />
      )}

      {formState.step === 2 && (
        <StepIncome
          monthlyIncome={formState.monthlyIncome}
          weeklyHours={formState.weeklyHours}
          onMonthlyIncomeChange={v => dispatch({ type: 'SET_MONTHLY_INCOME', value: v })}
          onWeeklyHoursChange={v => dispatch({ type: 'SET_WEEKLY_HOURS', value: v })}
          onBack={() => dispatch({ type: 'BACK' })}
          onSubmit={handleSubmit}
          isPending={isPending}
          error={error}
        />
      )}
    </form>
  )
}
