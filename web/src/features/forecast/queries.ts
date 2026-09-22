import { useQuery } from '@tanstack/react-query'
import type { ForecastHorizon, ForecastResponse } from 'shared'
import { api } from '../../lib/api'

export function useForecast(
  horizon: ForecastHorizon,
  excludeCategories: string[] = [],
  applyTrend = false,
) {
  // Normalize so the query key is stable regardless of order/whitespace.
  const cats = Array.from(
    new Set(excludeCategories.map((c) => c.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))

  return useQuery({
    queryKey: ['forecast', horizon, cats, applyTrend] as const,
    queryFn: () => {
      const params = new URLSearchParams({ horizon })
      if (cats.length > 0) params.set('excludeCats', cats.join(','))
      if (applyTrend) params.set('trend', '1')
      return api<ForecastResponse>(`/forecast?${params.toString()}`)
    },
    // Forecasts depend on accounts/items/goals — those queries already
    // invalidate explicitly. Don't auto-refetch here on focus; we'd rather
    // the user see a stable line until they explicitly refresh.
    staleTime: 60_000,
  })
}
