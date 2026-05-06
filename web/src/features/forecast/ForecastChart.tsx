import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatUSD,
  type ForecastHorizon,
  type ForecastPoint,
  type ForecastResponse,
} from "shared";

// Tick formatter that adapts label density to the horizon. Short horizons
// show day-and-month; long horizons collapse to month-and-year so the axis
// stays readable.
function makeDateFormatter(horizon: ForecastHorizon) {
  return (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    if (horizon === "1m" || horizon === "3m") {
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    }
    if (horizon === "1y") {
      return d.toLocaleDateString(undefined, {
        month: "short",
        timeZone: "UTC",
      });
    }
    return d.toLocaleDateString(undefined, {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
  };
}

const compactUSD = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: "compact",
  }).format(cents / 100);

export function ForecastChart({
  forecast,
  horizon,
}: {
  forecast: ForecastResponse;
  horizon: ForecastHorizon;
}) {
  // ── Build chart data ──────────────────────────────────────────────
  // Recharts likes a flat array. We keep cents on the data and format on
  // display so axis math stays integer-precise. The full point is attached
  // so the custom tooltip can read events + goal contributions, and we
  // pre-compute the net change to available between consecutive points so
  // the tooltip can show "−$1,200 net" without re-deriving from event sums.
  const data = useMemo(
    () =>
      forecast.points.map((p, i, arr) => ({
        date: p.date,
        available: p.availableBalanceCents,
        reserved: p.reservedBalanceCents,
        total: p.availableBalanceCents + p.reservedBalanceCents,
        availableNetChange:
          i === 0
            ? 0
            : p.availableBalanceCents - arr[i - 1]!.availableBalanceCents,
        point: p,
      })),
    [forecast.points],
  );

  // ── Compute y-axis bounds + decide on stroke/fill colors ─────────
  // The gradient (with a hard color flip at the zero line) is only used
  // when the available line actually crosses zero. Otherwise recharts maps
  // the gradient over the line/area's own bounding box, which can push the
  // red zone into a chart that never goes negative. Using solid colors in
  // those cases keeps the visual honest.
  const { yMin, yMax, zeroPercent, crossesZero, allNegative } = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const p of data) {
      if (p.available < min) min = p.available;
      if (p.available > max) max = p.available;
      if (p.reserved < min) min = p.reserved;
      if (p.reserved > max) max = p.reserved;
    }
    // Pad the range a little so the line doesn't sit on the chart edge.
    const span = Math.max(1, max - min);
    const padded = { yMin: min - span * 0.05, yMax: max + span * 0.05 };
    const crosses = min < 0 && max > 0;
    const range = padded.yMax - padded.yMin;
    const zeroPct =
      crosses && range > 0 ? Math.max(0, Math.min(1, padded.yMax / range)) : 0;
    return {
      ...padded,
      zeroPercent: zeroPct * 100,
      crossesZero: crosses,
      allNegative: max <= 0 && min < 0,
    };
  }, [data]);

  const strokeColor = crossesZero
    ? "url(#availableStroke)"
    : allNegative
      ? "var(--negative)"
      : "var(--accent)";
  const fillColor = crossesZero
    ? "url(#availableFill)"
    : allNegative
      ? "rgba(248, 113, 113, 0.18)"
      : "rgba(110, 168, 255, 0.18)";

  const formatDate = useMemo(() => makeDateFormatter(horizon), [horizon]);

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
      >
        <defs>
          {/* Stroke gradient: accent above zero, negative red below. */}
          <linearGradient id="availableStroke" x1="0" y1="0" x2="0" y2="1">
            <stop offset={`${zeroPercent}%`} stopColor="var(--accent)" />
            <stop offset={`${zeroPercent}%`} stopColor="var(--negative)" />
          </linearGradient>
          {/* Fill gradient: subtle accent above zero, subtle red below. */}
          <linearGradient id="availableFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
            <stop
              offset={`${zeroPercent}%`}
              stopColor="var(--accent)"
              stopOpacity={0.05}
            />
            <stop
              offset={`${zeroPercent}%`}
              stopColor="var(--negative)"
              stopOpacity={0.05}
            />
            <stop
              offset="100%"
              stopColor="var(--negative)"
              stopOpacity={0.25}
            />
          </linearGradient>
        </defs>

        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />

        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          stroke="var(--muted)"
          tick={{ fill: "var(--muted)", fontSize: 12 }}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={compactUSD}
          stroke="var(--muted)"
          tick={{ fill: "var(--muted)", fontSize: 12 }}
          domain={[yMin, yMax]}
          width={64}
        />

        {/* Zero baseline — solid neutral so it doesn't compete with the
            reserved-line dashes or read as a warning. The line itself shifts
            to the negative color via the gradient when it crosses below. */}
        {yMin < 0 && yMax > 0 && (
          <ReferenceLine
            y={0}
            stroke="var(--muted)"
            strokeWidth={1}
            ifOverflow="visible"
          />
        )}

        <Tooltip
          content={<ForecastTooltip />}
          cursor={{ stroke: "var(--muted)" }}
        />

        {/* Reserved as a faint dashed secondary line. */}
        <Line
          type="monotone"
          dataKey="reserved"
          stroke="var(--muted)"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          name="reserved"
        />

        {/* Available as a filled area. Stroke + fill flip at y=0 only when
            the line actually crosses zero; otherwise solid colors. */}
        <Area
          type="monotone"
          dataKey="available"
          stroke={strokeColor}
          strokeWidth={2}
          fill={fillColor}
          dot={false}
          isAnimationActive={false}
          name="available"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── Custom tooltip ─────────────────────────────────────────────────────
// Shows the day's totals and lists every scheduled-item event + goal
// contribution that fired on that date so the user can immediately see what
// drove the change at the hover point.

type ChartDatum = {
  date: string;
  available: number;
  reserved: number;
  total: number;
  availableNetChange: number;
  point: ForecastPoint;
};

function ForecastTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload as ChartDatum | undefined;
  if (!datum) return null;
  const { point } = datum;

  const dateLabel = new Date(`${datum.date}T00:00:00Z`).toLocaleDateString(
    undefined,
    {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    },
  );

  const incomes = point.events.filter((e) => e.isIncome);
  const expenses = point.events.filter((e) => !e.isIncome);

  // Goal contributions rolled up by target account so a paycheck that funds
  // multiple goals into one savings account shows as a single line — that's
  // the number the user actually allocates per pay period.
  const contribsByAccount: Map<
    string,
    { name: string; total: number; goals: typeof point.goalContributions }
  > = new Map();
  for (const g of point.goalContributions) {
    const entry = contribsByAccount.get(g.targetAccountId);
    if (entry) {
      entry.total += g.cents;
      entry.goals.push(g);
    } else {
      contribsByAccount.set(g.targetAccountId, {
        name: g.targetAccountName,
        total: g.cents,
        goals: [g],
      });
    }
  }

  // Did anything happen on this day? Bookend points (today, end-of-horizon)
  // have empty arrays; for those we skip the "net change" line since it'd
  // always be 0.
  const hasActivity =
    incomes.length > 0 ||
    expenses.length > 0 ||
    point.goalContributions.length > 0 ||
    point.creditCardPayments.length > 0;

  return (
    <div className="forecast-tooltip">
      <div className="forecast-tooltip__date">{dateLabel}</div>

      <div className="forecast-tooltip__totals">
        <Row label="Available" value={formatUSD(datum.available)} />
        {datum.reserved !== 0 && (
          <Row label="Reserved" value={formatUSD(datum.reserved)} muted />
        )}
        <Row label="Total" value={formatUSD(datum.total)} muted />
        {hasActivity && datum.availableNetChange !== 0 && (
          <Row
            label="Net to Available"
            value={`${datum.availableNetChange >= 0 ? "+" : "−"}${formatUSD(
              Math.abs(datum.availableNetChange),
            )}`}
            kind={datum.availableNetChange >= 0 ? "income" : "expense"}
          />
        )}
      </div>

      {incomes.length > 0 && (
        <Section title="Income">
          {incomes.map((e) => (
            <EventLine
              key={e.scheduledItemId}
              name={e.name}
              amount={`+${formatUSD(e.amountCents)}`}
              kind="income"
            />
          ))}
        </Section>
      )}

      {expenses.length > 0 && (
        <Section title="Expenses">
          {expenses.map((e) => (
            <EventLine
              key={e.scheduledItemId}
              name={e.name}
              amount={`−${formatUSD(e.amountCents)}`}
              kind="expense"
              meta={e.category ?? undefined}
            />
          ))}
        </Section>
      )}

      {contribsByAccount.size > 0 && (
        <Section title="Goal contributions">
          {Array.from(contribsByAccount.entries()).map(([accountId, info]) => {
            // Single goal funding this account today — render as one line
            // so the user immediately sees which goal it is. The amount on
            // that line IS the per-account total for the day.
            if (info.goals.length === 1) {
              const g = info.goals[0]!;
              return (
                <EventLine
                  key={accountId}
                  name={`→ ${g.goalName}`}
                  meta={info.name}
                  amount={formatUSD(g.cents)}
                  kind="goal"
                />
              );
            }
            // Multiple goals into the same account — show a per-account
            // header total followed by nested goal-by-goal breakdown.
            return (
              <div key={accountId} className="forecast-tooltip__group">
                <EventLine
                  name={`→ ${info.name}`}
                  amount={formatUSD(info.total)}
                  kind="goal"
                  strong
                />
                {info.goals.map((g) => (
                  <EventLine
                    key={g.goalId}
                    name={g.goalName}
                    amount={formatUSD(g.cents)}
                    kind="goal"
                    nested
                  />
                ))}
              </div>
            );
          })}
        </Section>
      )}

      {point.creditCardPayments.length > 0 && (
        <Section title="Statement payments">
          {point.creditCardPayments.map((p) => (
            <EventLine
              key={p.creditCardAccountId}
              name={p.creditCardName}
              meta={`from ${p.paidFromName}`}
              amount={`−${formatUSD(p.cents)}`}
              kind="expense"
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  kind,
}: {
  label: string;
  value: string;
  muted?: boolean;
  /** Color the amount to match income/expense semantics. */
  kind?: "income" | "expense";
}) {
  const amountClass = kind
    ? `forecast-tooltip__amount forecast-tooltip__amount--${kind}`
    : "forecast-tooltip__amount";
  return (
    <div className={`forecast-tooltip__row ${muted ? "muted" : ""}`}>
      <span>{label}</span>
      <span className={amountClass}>{value}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="forecast-tooltip__section">
      <div className="forecast-tooltip__section-title">{title}</div>
      {children}
    </div>
  );
}

function EventLine({
  name,
  amount,
  kind,
  meta,
  strong,
  nested,
}: {
  name: string;
  amount: string;
  kind: "income" | "expense" | "goal";
  meta?: string;
  /** Bold the row — used for the per-target "→ Account: $total" header. */
  strong?: boolean;
  /** Indent + de-emphasize — used for individual goals beneath their group. */
  nested?: boolean;
}) {
  const cls = [
    "forecast-tooltip__row",
    strong ? "forecast-tooltip__row--strong" : "",
    nested ? "forecast-tooltip__row--nested" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <span className="forecast-tooltip__event-name">
        {name}
        {meta && <span className="forecast-tooltip__meta"> · {meta}</span>}
      </span>
      <span
        className={`forecast-tooltip__amount forecast-tooltip__amount--${kind}`}
      >
        {amount}
      </span>
    </div>
  );
}
