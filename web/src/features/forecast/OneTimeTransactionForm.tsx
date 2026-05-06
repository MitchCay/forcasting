import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { dollarsToCents } from 'shared'
import { CategoryPicker } from '../../components/CategoryPicker'
import { Field } from '../../components/Field'
import { useAccounts } from '../accounts/queries'
import {
  useCreateScheduledItem,
  useScheduledItems,
} from '../scheduled/queries'

// Quick-add form for one-off transactions. Behind the scenes this creates a
// scheduled item with frequency='one_time' so it flows through the same
// forecast machinery as any recurring entry.
const formSchema = z
  .object({
    accountId: z.string().uuid('Pick an account'),
    direction: z.enum(['expense', 'income']),
    name: z.string().min(1, 'Required').max(100),
    amountDollars: z.coerce
      .number({ invalid_type_error: 'Enter a number' })
      .refine((n) => n !== 0, 'Must not be zero')
      .refine(
        (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
        'Up to 2 decimal places',
      ),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    category: z.string().max(50).optional(),
    notes: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.direction === 'income' && data.amountDollars < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amountDollars'],
        message: 'Income amount must be positive',
      })
    }
  })
type FormValues = z.infer<typeof formSchema>

const todayISO = () => new Date().toISOString().slice(0, 10)

export function OneTimeTransactionForm({ onSuccess }: { onSuccess?: () => void }) {
  const { data: accounts } = useAccounts()
  const create = useCreateScheduledItem()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      accountId: '',
      direction: 'expense',
      name: '',
      amountDollars: 0,
      date: todayISO(),
      category: '',
      notes: '',
    },
  })

  // Default the account picker to the first account once accounts load.
  useEffect(() => {
    if (accounts && accounts.length && !form.getValues('accountId')) {
      form.setValue('accountId', accounts[0]!.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts])

  // Pull category suggestions from existing scheduled items so the chip row
  // matches what the user sees in the recurring-item form.
  const { data: existingItems } = useScheduledItems()
  const categorySuggestions = useMemo(() => {
    const seen = new Set<string>()
    for (const it of existingItems ?? []) {
      if (it.category && it.category.trim()) seen.add(it.category.trim())
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [existingItems])

  const onSubmit = form.handleSubmit(async (values) => {
    // Same expense-sign-flip we do in ScheduledItemForm: an expense entered
    // as -50 silently becomes 50; income with a negative is blocked above.
    const amountCents = dollarsToCents(Math.abs(values.amountDollars))
    await create.mutateAsync({
      accountId: values.accountId,
      name: values.name,
      amountCents,
      frequency: 'one_time',
      startDate: values.date,
      endDate: null,
      isIncome: values.direction === 'income',
      category: values.category?.trim() || null,
      notes: values.notes?.trim() || null,
    })
    form.reset({
      ...form.getValues(),
      name: '',
      amountDollars: 0,
      notes: '',
    })
    onSuccess?.()
  })

  const accountOptions = accounts ?? []
  const submitting = form.formState.isSubmitting

  return (
    <form className="stack" noValidate onSubmit={onSubmit}>
      <div className="grid-2">
        <Field label="Account" error={form.formState.errors.accountId?.message}>
          <select {...form.register('accountId')}>
            <option value="">Select…</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type" error={form.formState.errors.direction?.message}>
          <select {...form.register('direction')}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </Field>
      </div>

      <Field label="Name" error={form.formState.errors.name?.message}>
        <input {...form.register('name')} placeholder="Coffee, refund, rent…" />
      </Field>

      <div className="grid-2">
        <Field
          label="Amount ($)"
          error={form.formState.errors.amountDollars?.message}
          hint="Positive — type sets the sign"
        >
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            {...form.register('amountDollars')}
          />
        </Field>
        <Field label="Date" error={form.formState.errors.date?.message}>
          <input type="date" {...form.register('date')} />
        </Field>
      </div>

      <Field label="Category" error={form.formState.errors.category?.message}>
        <CategoryPicker
          control={form.control}
          name="category"
          suggestions={categorySuggestions}
        />
      </Field>

      <Field label="Notes" error={form.formState.errors.notes?.message}>
        <input {...form.register('notes')} />
      </Field>

      {create.isError && (
        <div className="error-banner">
          {(create.error as Error).message ?? 'Failed to save'}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button type="submit" disabled={submitting || accountOptions.length === 0}>
          {submitting ? 'Saving…' : 'Add transaction'}
        </button>
      </div>
    </form>
  )
}
