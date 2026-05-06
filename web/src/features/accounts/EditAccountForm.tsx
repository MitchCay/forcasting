import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  accountTypeLabels,
  centsToDollars,
  dollarsToCents,
  type Account,
} from 'shared'
import { Field } from '../../components/Field'
import { useAccounts, useUpdateAccount } from './queries'

// Edit form: type is locked after creation (read-only label, not a select),
// balance can be updated, and credit-card-specific statement fields appear
// inline when the account is a credit card.
const formSchema = z
  .object({
    name: z.string().min(1, 'Required').max(100),
    excludeFromForecast: z.boolean(),
    currentBalanceDollars: z.coerce
      .number({ invalid_type_error: 'Enter a number' })
      .multipleOf(0.01, 'Up to 2 decimal places'),
    statementBalanceDollars: z.union([z.literal(''), z.coerce.number()]),
    statementDueDay: z.union([z.literal(''), z.coerce.number().int()]),
    statementPaidFromAccountId: z.string(),
  })
  .superRefine((data, ctx) => {
    // The form's parent passes whether this is a CC account in `meta`. We
    // can't check it here directly, so the form component below applies the
    // type-conditional checks via setError after submit if needed. The base
    // validation here is the universal piece.
    if (data.currentBalanceDollars === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentBalanceDollars'],
        message: 'Required',
      })
    }
  })
type FormValues = z.infer<typeof formSchema>

export function EditAccountForm({ account }: { account: Account }) {
  const update = useUpdateAccount()
  const { data: existingAccounts } = useAccounts()
  const isCC = account.type === 'credit_card'

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: account.name,
      excludeFromForecast: account.excludeFromForecast,
      currentBalanceDollars: centsToDollars(account.currentBalanceCents),
      statementBalanceDollars:
        account.statementBalanceCents != null
          ? centsToDollars(account.statementBalanceCents)
          : '',
      statementDueDay: account.statementDueDay ?? '',
      statementPaidFromAccountId: account.statementPaidFromAccountId ?? '',
    },
  })

  // Eligible "paid from" accounts: anything that isn't a CC and isn't this
  // account itself.
  const payingAccountOptions = (existingAccounts ?? []).filter(
    (a) => a.type !== 'credit_card' && a.id !== account.id,
  )

  const onSubmit = form.handleSubmit(async (values) => {
    // CC-specific validation since the schema-level superRefine doesn't have
    // access to the locked type.
    if (isCC) {
      let hasError = false
      if (Number(values.currentBalanceDollars) < 0) {
        form.setError('currentBalanceDollars', { message: 'Amount owed must be ≥ 0' })
        hasError = true
      }
      if (
        values.statementBalanceDollars === '' ||
        Number(values.statementBalanceDollars) < 0
      ) {
        form.setError('statementBalanceDollars', {
          message: 'Required for credit-card accounts',
        })
        hasError = true
      }
      if (
        values.statementDueDay === '' ||
        Number(values.statementDueDay) < 1 ||
        Number(values.statementDueDay) > 31
      ) {
        form.setError('statementDueDay', { message: 'Day must be 1–31' })
        hasError = true
      }
      if (!values.statementPaidFromAccountId) {
        form.setError('statementPaidFromAccountId', {
          message: 'Pick an account to pay from',
        })
        hasError = true
      }
      if (hasError) return
    }

    await update.mutateAsync({
      id: account.id,
      name: values.name,
      excludeFromForecast: values.excludeFromForecast,
      currentBalanceCents: dollarsToCents(Number(values.currentBalanceDollars)),
      statementBalanceCents: isCC
        ? dollarsToCents(Number(values.statementBalanceDollars))
        : null,
      statementDueDay: isCC ? Number(values.statementDueDay) : null,
      statementPaidFromAccountId: isCC
        ? values.statementPaidFromAccountId || null
        : null,
    })
    form.reset(values)
  })

  return (
    <form className="stack" noValidate onSubmit={onSubmit}>
      <div className="grid-2">
        <Field label="Account name" error={form.formState.errors.name?.message}>
          <input {...form.register('name')} />
        </Field>
        <Field label="Type" hint="Account type can't be changed after creation">
          <input value={accountTypeLabels[account.type]} disabled readOnly />
        </Field>
      </div>

      <Field
        label={isCC ? 'Amount owed ($)' : 'Current balance ($)'}
        error={form.formState.errors.currentBalanceDollars?.message}
        hint={
          isCC
            ? 'Update as your real card balance changes'
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

      {isCC && (
        <>
          <div className="grid-2">
            <Field
              label="Statement balance ($)"
              error={form.formState.errors.statementBalanceDollars?.message}
              hint="Update when you receive a new statement"
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
        </>
      )}

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
