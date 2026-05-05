import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { dollarsToCents } from 'shared'
import { Field } from '../../components/Field'
import { useCreateSnapshot } from './queries'

const formSchema = z.object({
  balanceDollars: z.coerce
    .number({ invalid_type_error: 'Enter a number' })
    .multipleOf(0.01),
  recordedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  note: z.string().max(500).optional(),
})
type FormValues = z.infer<typeof formSchema>

const todayISO = () => new Date().toISOString().slice(0, 10)

export function SnapshotForm({ accountId }: { accountId: string }) {
  const create = useCreateSnapshot(accountId)
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { recordedAt: todayISO(), note: '' },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    await create.mutateAsync({
      balanceCents: dollarsToCents(values.balanceDollars),
      recordedAt: values.recordedAt,
      note: values.note?.trim() || undefined,
    })
    form.reset()
  })

  return (
    <form className="row" onSubmit={onSubmit}>
      <Field label="New balance ($)" error={form.formState.errors.balanceDollars?.message}>
        <input
          type="number"
          step="0.01"
          {...form.register('balanceDollars')}
        />
      </Field>
      <Field label="Date" error={form.formState.errors.recordedAt?.message}>
        <input type="date" {...form.register('recordedAt')} />
      </Field>
      <Field label="Note (optional)">
        <input type="text" {...form.register('note')} placeholder="…" />
      </Field>
      <button type="submit" disabled={form.formState.isSubmitting}>
        Update
      </button>
    </form>
  )
}
