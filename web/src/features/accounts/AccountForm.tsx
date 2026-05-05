import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  accountTypes,
  accountTypeLabels,
  dollarsToCents,
} from 'shared'
import { Field } from '../../components/Field'
import { useCreateAccount } from './queries'

// Form-level schema uses dollars (the user types $123.45) and converts to
// cents at submit time. We keep the wire schema (cents) in `shared` so the
// API never sees floats.
const formSchema = z.object({
  name: z.string().min(1, 'Required').max(100),
  type: z.enum(accountTypes),
  currentBalanceDollars: z.coerce
    .number({ invalid_type_error: 'Enter a number' })
    .multipleOf(0.01, 'Up to 2 decimal places'),
  excludeFromForecast: z.boolean(),
})
type FormValues = z.infer<typeof formSchema>

export function AccountForm({ onSuccess }: { onSuccess?: () => void }) {
  const create = useCreateAccount()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      type: 'checking',
      currentBalanceDollars: 0,
      excludeFromForecast: false,
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    await create.mutateAsync({
      name: values.name,
      type: values.type,
      currentBalanceCents: dollarsToCents(values.currentBalanceDollars),
      isActive: true,
      excludeFromForecast: values.excludeFromForecast,
    })
    form.reset()
    onSuccess?.()
  })

  return (
    <form className="stack" onSubmit={onSubmit}>
      <Field label="Account name" error={form.formState.errors.name?.message}>
        <input {...form.register('name')} placeholder="Lake Elmo Checking" />
      </Field>
      <div className="grid-2">
        <Field label="Type" error={form.formState.errors.type?.message}>
          <select {...form.register('type')}>
            {accountTypes.map((t) => (
              <option key={t} value={t}>
                {accountTypeLabels[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Current balance ($)"
          error={form.formState.errors.currentBalanceDollars?.message}
          hint="Negative for credit card debt"
        >
          <input
            type="number"
            step="0.01"
            {...form.register('currentBalanceDollars')}
          />
        </Field>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" {...form.register('excludeFromForecast')} />
        <span>
          <strong>Hide from forecast</strong>
          <span className="muted" style={{ display: 'block', fontSize: '.85rem' }}>
            Money in reserved accounts (e.g. goal-earmarked savings) won't
            count toward your available total or the projected line.
          </span>
        </span>
      </label>
      {create.isError && (
        <div className="error-banner">
          {(create.error as Error).message ?? 'Failed to create account'}
        </div>
      )}
      <div>
        <button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Saving…' : 'Add account'}
        </button>
      </div>
    </form>
  )
}
