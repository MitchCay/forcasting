import { useQuery } from '@tanstack/react-query'
import type { ForecastHorizon, ForecastResponse } from 'shared'
import { api } from '../../lib/api'

const forecastKey = (horizon: ForecastHorizon) =>
  ['forecast', horizon] as const

export function useForecast(horizon: ForecastHorizon) {
  return useQuery({
    queryKey: forecastKey(horizon),
    queryFn: () => api<ForecastResponse>(`/forecast?horizon=${horizon}`),
    // Forecasts depend on accounts/items/goals — those queries already
    // invalidate explicitly. Don't auto-refetch here on focus; we'd rather
    // the user see a stable line until they explicitly refresh.
    staleTime: 60_000,
  })
}
