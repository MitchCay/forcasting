import { useEffect, useMemo } from 'react'
import { useController, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  centsToDollars,
  dollarsToCents,
  frequencies,
  frequencyLabels,
  type ScheduledItem,
} from 'shared'
import { Field } from '../../components/Field'
import { useAccounts } from '../accounts/queries'
import {
  useCreateScheduledItem,
  useScheduledItems,
  useUpdateScheduledItem,
} from './queries'

// Form-level schema operates in dollars; we convert at submit time. Keeping
// frequency, dates, and the income/expense flag in the same shape as the
// server expects keeps the mapping trivial.
//
// Note on the amount field: we deliberately allow negative numbers through
// validation so that an "expense + -50" can be silently coerced to 50 in
// onSubmit. We still error when the user enters a negative number while the
// type is set to income (see the superRefine below).
const formSchema = z
  .object({
    accountId: z.string().uuid('Pick an account'),
    name: z.string().min(1, 'Required').max(100),
    amountDollars: z.coerce
      .number({ invalid_type_error: 'Enter a number' })
      .refine((n) => n !== 0, 'Must not be zero')
      .refine(
        (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
        'Up to 2 decimal places',
      ),
    direction: z.enum(['expense', 'income']),
    frequency: z.enum(frequencies),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    category: z.string().max(50).optional(),
    notes: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'End date must be on or after start date',
      })
    }
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

function defaultsForCreate(): FormValues {
  return {
    accountId: '',
    name: '',
    amountDollars: 0,
    direction: 'expense',
    frequency: 'monthly',
    startDate: todayISO(),
    endDate: undefined,
    category: '',
    notes: '',
  }
}

function defaultsForEdit(item: ScheduledItem): FormValues {
  return {
    accountId: item.accountId,
    name: item.name,
    amountDollars: centsToDollars(item.amountCents),
    direction: item.isIncome ? 'income' : 'expense',
    frequency: item.frequency,
    startDate: item.startDate,
    endDate: item.endDate ?? undefined,
    category: item.category ?? '',
    notes: item.notes ?? '',
  }
}

export function ScheduledItemForm({
  item,
  onSuccess,
}: {
  /** When provided, the form edits this item; otherwise creates a new one. */
  item?: ScheduledItem
  onSuccess?: () => void
}) {
  const { data: accounts } = useAccounts()
  const create = useCreateScheduledItem()
  const update = useUpdateScheduledItem()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: item ? defaultsForEdit(item) : defaultsForCreate(),
  })

  // If the parent supplies a freshly-loaded item after mount, keep the form
  // values in sync with it.
  useEffect(() => {
    form.reset(item ? defaultsForEdit(item) : defaultsForCreate())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id])

  // Default the account picker to the first account once accounts load (only
  // for new items where we couldn't pick one upfront).
  useEffect(() => {
    if (!item && accounts && accounts.length && !form.getValues('accountId')) {
      form.setValue('accountId', accounts[0]!.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts])

  const frequency = form.watch('frequency')
  const showEndDate = frequency !== 'one_time'

  const onSubmit = form.handleSubmit(async (values) => {
    // For PATCH we send explicit nulls (rather than omitting the field) so the
    // server clears any previously-stored value. The server schema is
    // .nullable().optional() to accept that.
    //
    // Amounts are stored unsigned in the DB (sign comes from isIncome). For
    // expense entries we silently strip a leading minus so the user isn't
    // blocked on form submission for a near-miss; income still errors at
    // validation time via the superRefine above.
    const amountCents = dollarsToCents(Math.abs(values.amountDollars))
    const payload = {
      accountId: values.accountId,
      name: values.name,
      amountCents,
      frequency: values.frequency,
      startDate: values.startDate,
      endDate: showEndDate ? values.endDate || null : null,
      isIncome: values.direction === 'income',
      category: values.category?.trim() || null,
      notes: values.notes?.trim() || null,
    }
    if (item) {
      await update.mutateAsync({ id: item.id, ...payload })
    } else {
      await create.mutateAsync(payload)
      form.reset(defaultsForCreate())
    }
    onSuccess?.()
  })

  // Distinct categories from existing scheduled items, sorted. Empty for a
  // brand-new user; grows naturally as items are added.
  const { data: existingItems } = useScheduledItems()
  const categorySuggestions = useMemo(() => {
    const seen = new Set<string>()
    for (const it of existingItems ?? []) {
      if (it.category && it.category.trim()) seen.add(it.category.trim())
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b))
  }, [existingItems])

  const accountOptions = accounts ?? []
  const submitting = form.formState.isSubmitting
  const mutationError = (create.error ?? update.error) as Error | null

  return (
    <form className="stack" noValidate onSubmit={onSubmit}>
      {accountOptions.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          You need to add an account first.
        </p>
      ) : null}

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
        <Field
          label="Type"
          error={form.formState.errors.direction?.message}
        >
          <select {...form.register('direction')}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </Field>
      </div>

      <Field label="Name" error={form.formState.errors.name?.message}>
        <input
          {...form.register('name')}
          placeholder="Rent, Salary, Spotify…"
        />
      </Field>

      <div className="grid-2">
        <Field
          label="Amount ($)"
          error={form.formState.errors.amountDollars?.message}
          hint="Always positive — the type above sets the sign"
        >
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            {...form.register('amountDollars')}
          />
        </Field>
        <Field
          label="Frequency"
          error={form.formState.errors.frequency?.message}
        >
          <select {...form.register('frequency')}>
            {frequencies.map((f) => (
              <option key={f} value={f}>
                {frequencyLabels[f]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid-2">
        <Field
          label={frequency === 'one_time' ? 'Date' : 'Starts on'}
          error={form.formState.errors.startDate?.message}
        >
          <input type="date" {...form.register('startDate')} />
        </Field>
        {showEndDate && (
          <Field
            label="Ends on"
            error={form.formState.errors.endDate?.message}
            hint="Optional — leave blank for indefinite"
          >
            <input type="date" {...form.register('endDate')} />
          </Field>
        )}
      </div>

      <div className="grid-2">
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
      </div>

      {mutationError && (
        <div className="error-banner">
          {mutationError.message ?? 'Failed to save'}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          type="submit"
          disabled={submitting || accountOptions.length === 0}
        >
          {submitting
            ? 'Saving…'
            : item
            ? 'Save changes'
            : 'Add scheduled item'}
        </button>
        {item && onSuccess && (
          <button
            type="button"
            className="secondary"
            onClick={onSuccess}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

// ─── Category picker ────────────────────────────────────────────────────
// A free-form text input paired with quick-pick chips for the user's
// existing categories. Chips filter live as the user types; clicking one
// fills the input. No modes, no toggling — the input is always editable.

function CategoryPicker({
  control,
  name,
  suggestions,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any
  name: 'category'
  suggestions: string[]
}) {
  const { field } = useController({ control, name })
  const value = (field.value as string | undefined) ?? ''

  const trimmed = value.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!trimmed) return suggestions
    return suggestions.filter((s) => s.toLowerCase().includes(trimmed))
  }, [suggestions, trimmed])

  // Don't suggest the value the user has already typed exactly — there's
  // nothing to "pick".
  const visibleChips = filtered.filter(
    (s) => s.toLowerCase() !== trimmed,
  )

  return (
    <div>
      <input
        type="text"
        value={value}
        maxLength={50}
        placeholder="Type a category…"
        onChange={(e) => field.onChange(e.target.value)}
      />
      {visibleChips.length > 0 && (
        <div className="chip-row" aria-label="Existing categories">
          {visibleChips.map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              // mousedown so the chip click registers before any blur logic
              onMouseDown={(e) => {
                e.preventDefault()
                field.onChange(c)
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
