import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  centsToDollars,
  computeContributionPerOccurrence,
  countOccurrencesBetween,
  dollarsToCents,
  formatUSD,
  frequencyLabels,
  type Goal,
} from 'shared'
import { Field } from '../../components/Field'
import { useAccounts } from '../accounts/queries'
import { useScheduledItems } from '../scheduled/queries'
import { useCreateGoal, useUpdateGoal } from './queries'

// Form-level schema operates in dollars; we convert to cents at submit time.
// Cross-field constraints (saved <= target, target date in the future) are
// in a single superRefine.
const todayISO = () => new Date().toISOString().slice(0, 10)

const formSchema = z
  .object({
    name: z.string().min(1, 'Required').max(100),
    targetDollars: z.coerce
      .number({ invalid_type_error: 'Enter a number' })
      .positive('Must be greater than 0')
      .refine(
        (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
        'Up to 2 decimal places',
      ),
    savedDollars: z.coerce
      .number({ invalid_type_error: 'Enter a number' })
      .nonnegative('Cannot be negative')
      .refine(
        (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
        'Up to 2 decimal places',
      ),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    targetAccountId: z.string().uuid('Pick an account'),
    // Empty string when not set; the form layer maps to undefined/null at
    // submit time. Keeping it as a plain string keeps the <select> bindings
    // simple.
    fundedByScheduledItemId: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.savedDollars > data.targetDollars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['savedDollars'],
        message: 'Saved cannot exceed target',
      })
    }
  })
type FormValues = z.infer<typeof formSchema>

function defaultsForCreate(): FormValues {
  return {
    name: '',
    targetDollars: 0,
    savedDollars: 0,
    targetDate: todayISO(),
    targetAccountId: '',
    fundedByScheduledItemId: '',
  }
}

function defaultsForEdit(goal: Goal): FormValues {
  return {
    name: goal.name,
    targetDollars: centsToDollars(goal.targetCents),
    savedDollars: centsToDollars(goal.savedCents),
    targetDate: goal.targetDate,
    targetAccountId: goal.targetAccountId,
    fundedByScheduledItemId: goal.fundedByScheduledItemId ?? '',
  }
}

export function GoalForm({
  goal,
  onSuccess,
}: {
  /** When provided, the form edits this goal; otherwise creates a new one. */
  goal?: Goal
  onSuccess?: () => void
}) {
  const { data: accounts } = useAccounts()
  const create = useCreateGoal()
  const update = useUpdateGoal()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: goal ? defaultsForEdit(goal) : defaultsForCreate(),
  })

  useEffect(() => {
    form.reset(goal ? defaultsForEdit(goal) : defaultsForCreate())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal?.id])

  // Auto-pick the first account when none is selected and accounts have
  // loaded — same UX trick as the scheduled-item form.
  useEffect(() => {
    if (
      !goal &&
      accounts &&
      accounts.length &&
      !form.getValues('targetAccountId')
    ) {
      form.setValue('targetAccountId', accounts[0]!.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts])

  const onSubmit = form.handleSubmit(async (values) => {
    const payload = {
      name: values.name,
      targetCents: dollarsToCents(values.targetDollars),
      savedCents: dollarsToCents(values.savedDollars),
      targetDate: values.targetDate,
      targetAccountId: values.targetAccountId,
      fundedByScheduledItemId: values.fundedByScheduledItemId || null,
    }
    if (goal) {
      await update.mutateAsync({ id: goal.id, ...payload })
    } else {
      await create.mutateAsync(payload)
      form.reset(defaultsForCreate())
    }
    onSuccess?.()
  })

  // ── Funding source preview ──────────────────────────────────────────
  // We mirror the same math the server uses (computeContributionPerOccurrence)
  // so the user sees the locked-in number before they save.
  const { data: scheduledItems } = useScheduledItems()
  const incomeItems = useMemo(
    () => (scheduledItems ?? []).filter((it) => it.isIncome),
    [scheduledItems],
  )
  const watchedFundingId = form.watch('fundedByScheduledItemId')
  const watchedTarget = form.watch('targetDollars')
  const watchedSaved = form.watch('savedDollars')
  const watchedTargetDate = form.watch('targetDate')

  const fundingPreview = useMemo(() => {
    if (!watchedFundingId) return null
    const item = incomeItems.find((it) => it.id === watchedFundingId)
    if (!item) return null

    const target = Number(watchedTarget) || 0
    const saved = Number(watchedSaved) || 0
    if (target <= 0) return null

    const targetCents = Math.round(target * 100)
    const savedCents = Math.round(saved * 100)
    const remainingCents = targetCents - savedCents
    if (remainingCents <= 0) {
      return { itemName: item.name, status: 'met' as const }
    }

    const occurrences = countOccurrencesBetween(
      { frequency: item.frequency, startDate: item.startDate, endDate: item.endDate },
      todayISO(),
      watchedTargetDate || todayISO(),
    )
    const perOccurrenceCents = computeContributionPerOccurrence({
      targetCents,
      savedCents,
      targetDate: watchedTargetDate || todayISO(),
      fundingItem: {
        frequency: item.frequency,
        startDate: item.startDate,
        endDate: item.endDate,
      },
    })
    return {
      itemName: item.name,
      status:
        occurrences > 0
          ? ('on_track' as const)
          : ('compressed' as const),
      perOccurrenceCents,
      occurrences,
      frequencyLabel: frequencyLabels[item.frequency],
    }
  }, [
    watchedFundingId,
    incomeItems,
    watchedTarget,
    watchedSaved,
    watchedTargetDate,
  ])

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

      <Field label="Name" error={form.formState.errors.name?.message}>
        <input
          {...form.register('name')}
          placeholder="Down payment, Vacation, Emergency fund…"
        />
      </Field>

      <div className="grid-2">
        <Field
          label="Target ($)"
          error={form.formState.errors.targetDollars?.message}
        >
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            {...form.register('targetDollars')}
          />
        </Field>
        <Field
          label="Already saved ($)"
          error={form.formState.errors.savedDollars?.message}
          hint="Optional — defaults to 0"
        >
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            {...form.register('savedDollars')}
          />
        </Field>
      </div>

      <div className="grid-2">
        <Field
          label="Target date"
          error={form.formState.errors.targetDate?.message}
        >
          <input type="date" {...form.register('targetDate')} />
        </Field>
        <Field
          label="Target account"
          error={form.formState.errors.targetAccountId?.message}
          hint="Where the saved money will be held"
        >
          <select {...form.register('targetAccountId')}>
            <option value="">Select…</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        label="Funded by"
        error={form.formState.errors.fundedByScheduledItemId?.message}
        hint="Optional — pick a scheduled income to auto-contribute toward this goal"
      >
        <select {...form.register('fundedByScheduledItemId')}>
          <option value="">— No automatic funding —</option>
          {incomeItems.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name} ({frequencyLabels[it.frequency]})
            </option>
          ))}
        </select>
      </Field>

      {fundingPreview && (
        <div className="funding-preview">
          {fundingPreview.status === 'met' && (
            <span>Goal already reached — no contribution needed.</span>
          )}
          {fundingPreview.status === 'on_track' && (
            <span>
              <strong>
                ≈ {formatUSD(fundingPreview.perOccurrenceCents!)}
              </strong>{' '}
              per occurrence · {fundingPreview.occurrences} expected
              payment{fundingPreview.occurrences === 1 ? '' : 's'} of{' '}
              <em>{fundingPreview.itemName}</em> before target date.
            </span>
          )}
          {fundingPreview.status === 'compressed' && (
            <span>
              No occurrences of <em>{fundingPreview.itemName}</em> fall before
              the target date — the goal will be funded in full on its next
              occurrence after that date.
            </span>
          )}
        </div>
      )}

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
            : goal
            ? 'Save changes'
            : 'Add goal'}
        </button>
        {goal && onSuccess && (
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
