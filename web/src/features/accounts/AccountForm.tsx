import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  accountTypes,
  accountTypeLabels,
  dollarsToCents,
} from 'shared'
import { Field } from '../../components/Field'
import { useAccounts, useCreateAccount } from './queries'

// Form-level schema uses dollars (the user types $123.45) and converts to
// cents at submit time. CC accounts get conditional statement fields.
const formSchema = z
  .object({
    name: z.string().min(1, 'Required').max(100),
    type: z.enum(accountTypes),
    currentBalanceDollars: z.coerce
      .number({ invalid_type_error: 'Enter a number' })
      .multipleOf(0.01, 'Up to 2 decimal places'),
    excludeFromForecast: z.boolean(),
    // Empty string when not applicable (non-CC); CC requires positive ≥ 0.
    statementBalanceDollars: z.union([z.literal(''), z.coerce.number()]),
    statementDueDay: z.union([z.literal(''), z.coerce.number().int()]),
    statementPaidFromAccountId: z.string(),
  })
  .superRefine((data, ctx) => {
    const isCC = data.type === 'credit_card'
    if (!isCC) return

    if (typeof data.currentBalanceDollars !== 'number' || data.currentBalanceDollars < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentBalanceDollars'],
        message: 'Amount owed must be ≥ 0',
      })
    }
    if (data.statementBalanceDollars === '' || Number(data.statementBalanceDollars) < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statementBalanceDollars'],
        message: 'Required for credit-card accounts',
      })
    }
    if (
      data.statementDueDay === '' ||
      Number(data.statementDueDay) < 1 ||
      Number(data.statementDueDay) > 31
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statementDueDay'],
        message: 'Day must be 1–31',
      })
    }
    if (!data.statementPaidFromAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['statementPaidFromAccountId'],
        message: 'Pick an account to pay from',
      })
    }
  })
type FormValues = z.infer<typeof formSchema>

export function AccountForm({ onSuccess }: { onSuccess?: () => void }) {
  const create = useCreateAccount()
  const { data: existingAccounts } = useAccounts()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      type: 'checking',
      currentBalanceDollars: 0,
      excludeFromForecast: false,
      statementBalanceDollars: '',
      statementDueDay: '',
      statementPaidFromAccountId: '',
    },
  })

  const watchedType = form.watch('type')
  const isCC = watchedType === 'credit_card'

  // Eligible "paid from" accounts: anything that isn't itself a CC.
  const payingAccountOptions = (existingAccounts ?? []).filter(
    (a) => a.type !== 'credit_card',
  )

  const onSubmit = form.handleSubmit(async (values) => {
    const isCC = values.type === 'credit_card'
    await create.mutateAsync({
      name: values.name,
      type: values.type,
      currentBalanceCents: dollarsToCents(
        typeof values.currentBalanceDollars === 'number'
          ? values.currentBalanceDollars
          : Number(values.currentBalanceDollars) || 0,
      ),
      isActive: true,
      excludeFromForecast: values.excludeFromForecast,
      statementBalanceCents:
        isCC && values.statementBalanceDollars !== ''
          ? dollarsToCents(Number(values.statementBalanceDollars))
          : null,
      statementDueDay:
        isCC && values.statementDueDay !== ''
          ? Number(values.statementDueDay)
          : null,
      statementPaidFromAccountId: isCC
        ? values.statementPaidFromAccountId || null
        : null,
    })
    form.reset()
    onSuccess?.()
  })

  return (
    <form className="stack" noValidate onSubmit={onSubmit}>
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
          label={isCC ? 'Amount owed ($)' : 'Current balance ($)'}
          error={form.formState.errors.currentBalanceDollars?.message}
          hint={
            isCC
              ? 'Total currently owed on the card'
              : 'Negative for overdraft / loan balances'
          }
        >
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            min={isCC ? 0 : undefined}
            {...form.register('currentBalanceDollars')}
          />
        </Field>
      </div>

      {isCC && (
        <>
          <div className="grid-2">
            <Field
              label="Statement balance ($)"
              error={form.formState.errors.statementBalanceDollars?.message}
              hint="What's due on the next statement"
            >
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                min={0}
                {...form.register('statementBalanceDollars')}
              />
            </Field>
            <Field
              label="Statement due day"
              error={form.formState.errors.statementDueDay?.message}
              hint="Day of the month (1–31)"
            >
              <input
                type="number"
                step="1"
                min={1}
                max={31}
                inputMode="numeric"
                {...form.register('statementDueDay')}
              />
            </Field>
          </div>
          <Field
            label="Paid from"
            error={form.formState.errors.statementPaidFromAccountId?.message}
            hint="The account that will pay this statement"
          >
            <select {...form.register('statementPaidFromAccountId')}>
              <option value="">Select…</option>
              {payingAccountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          {payingAccountOptions.length === 0 && (
            <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
              You'll need a non-credit-card account to pay from. Add one
              first, then return to set this up.
            </p>
          )}
        </>
      )}

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
