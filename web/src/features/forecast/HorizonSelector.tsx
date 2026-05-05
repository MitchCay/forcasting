import {
  forecastHorizons,
  forecastHorizonLabels,
  type ForecastHorizon,
} from 'shared'

export function HorizonSelector({
  value,
  onChange,
}: {
  value: ForecastHorizon
  onChange: (horizon: ForecastHorizon) => void
}) {
  return (
    <div className="horizon-selector" role="radiogroup" aria-label="Forecast horizon">
      {forecastHorizons.map((h) => (
        <button
          key={h}
          type="button"
          role="radio"
          aria-checked={h === value}
          className={`horizon-selector__pill ${h === value ? 'active' : ''}`}
          onClick={() => onChange(h)}
        >
          {forecastHorizonLabels[h]}
        </button>
      ))}
    </div>
  )
}
