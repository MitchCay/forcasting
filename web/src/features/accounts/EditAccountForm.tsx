import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { accountTypes, accountTypeLabels, type Account } from 'shared'
import { Field } from '../../components/Field'
import { useUpdateAccount } from './queries'

// We let the user edit identifying fields here. Balance edits live with the
// snapshot form so every balance change has a clear, dated record.
const formSchema = z.object({
  name: z.string().min(1, 'Required').max(100),
  type: z.enum(accountTypes),
  excludeFromForecast: z.boolean(),
})
type FormValues = z.infer<typeof formSchema>

export function EditAccountForm({ account }: { account: Account }) {
  const update = useUpdateAccount()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: account.name,
      type: account.type,
      excludeFromForecast: account.excludeFromForecast,
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    await update.mutateAsync({ id: account.id, ...values })
    // Reset the form's "dirty" state to the new saved values so the Save button
    // disables again until the user makes another change.
    form.reset(values)
  })

  return (
    <form className="stack" onSubmit={onSubmit}>
      <div className="grid-2">
        <Field label="Account name" error={form.formState.errors.name?.message}>
          <input {...form.register('name')} />
        </Field>
        <Field label="Type" error={form.formState.errors.type?.message}>
          <select {...form.register('type')}>
            {accountTypes.map((t) => (
              <option key={t} value={t}>
                {accountTypeLabels[t]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="checkbox-row">
        <input type="checkbox" {...form.register('excludeFromForecast')} />
        <span>
          <strong>Hide from forecast</strong>
          <span className="muted" style={{ display: 'block', fontSize: '.85rem' }}>
            Reserved accounts stay off the dashboard's available total and
            projected line.
          </span>
        </span>
      </label>
      {update.isError && (
        <div className="error-banner">
          {(update.error as Error).message ?? 'Failed to update account'}
        </div>
      )}
      <div>
        <button
          type="submit"
          disabled={!form.formState.isDirty || form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
