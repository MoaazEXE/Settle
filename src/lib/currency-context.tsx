'use client'

import { createContext, useContext } from 'react'
import { fmtCurrency } from './formatters'
import { DEFAULT_CURRENCY } from '@/lib/constants'

const CurrencyContext = createContext<string>(DEFAULT_CURRENCY)

export function CurrencyProvider({
  currency,
  children,
}: {
  currency: string
  children: React.ReactNode
}) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  return useContext(CurrencyContext)
}

export function useFmt() {
  const currency = useCurrency()
  return (cents: number, decimals: 0 | 2 = 2) => fmtCurrency(cents, currency, decimals)
}
