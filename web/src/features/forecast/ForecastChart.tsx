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
  type Account,
  type ForecastHorizon,
  type ForecastPoint,
  type ForecastResponse,
} from "shared";
import { availableColor, reservedColor } from "./palette";

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

// Predicted (adjusted) line color + the category-band palette. Amber is
// reserved for the predicted line so it never collides with a category band.
const PREDICTED_COLOR = "#fbbf24";
const CATEGORY_COLORS = [
  "#6ea8ff",
  "#5bc0c2",
  "#a78bfa",
  "#f472b6",
  "#4ade80",
  "#8cb9ff",
  "#e879a6",
];
const OTHER_COLOR = "#64748b";
const OTHER_KEY = "__other__";
const MAX_CAT_BANDS = 7; // remaining categories roll into a single "Other" band
const catColor = (i: number) => CATEGORY_COLORS[i % CATEGORY_COLORS.length]!;
const spendKey = (cat: string): `spend_${string}` => `spend_${cat}`;

export function ForecastChart({
  forecast,
  horizon,
  accounts,
  reservedExpanded = false,
  availableExpanded = false,
  showPredicted = false,
  predictedByCategory = false,
}: {
  forecast: ForecastResponse;
  horizon: ForecastHorizon;
  /** Account metadata, used to break the reserved/available totals into
      per-account lines. When omitted, only the summed lines render. */
  accounts?: Account[];
  reservedExpanded?: boolean;
  availableExpanded?: boolean;
  /** Show the history-driven predicted (adjusted) balance line. */
  showPredicted?: boolean;
  /** Decompose the base→predicted gap into stacked per-category spend bands. */
  predictedByCategory?: boolean;
}) {
  // Split accounts into the two forecast buckets. Credit cards are excluded
  // from both — their balances are tracked separately and only hit cash on
  // statement-due days.
  const reservedAccounts = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) => a.excludeFromForecast && a.type !== "credit_card",
      ),
    [accounts],
  );
  const availableAccounts = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) => !a.excludeFromForecast && a.type !== "credit_card",
      ),
    [accounts],
  );
  // Only meaningful to break out when there's more than one account in the
  // bucket — a single account IS the total.
  const showReservedBreakout =
    reservedExpanded && reservedAccounts.length > 1;
  const showAvailableBreakout =
    availableExpanded && availableAccounts.length > 1;

  // Predicted (adjusted) line + optional per-category decomposition. Both
  // require the server to have attached a spending model with categories.
  const spendingCats = useMemo(
    () => forecast.spendingModel?.categories ?? [],
    [forecast.spendingModel],
  );
  const hasModel = spendingCats.length > 0;
  const showPredictedLine = showPredicted && hasModel;
  const showCategoryBreakout = showPredictedLine && predictedByCategory;
  const topCats = useMemo(
    () => spendingCats.slice(0, MAX_CAT_BANDS).map((c) => c.category),
    [spendingCats],
  );
  const hasOther = spendingCats.length > topCats.length;

  // ── Build chart data ──────────────────────────────────────────────
  // Recharts likes a flat array. We keep cents on the data and format on
  // display so axis math stays integer-precise. The full point is attached
  // so the custom tooltip can read events + goal contributions, and we
  // pre-compute the net change to available between consecutive points so
  // the tooltip can show "−$1,200 net" without re-deriving from event sums.
  const data = useMemo(
    () =>
      forecast.points.map((p, i, arr) => {
        const adjusted = p.adjustedAvailableBalanceCents ?? p.availableBalanceCents;
        const abc = p.adjustedByCategory ?? {};
        const row: ChartDatum = {
          date: p.date,
          available: p.availableBalanceCents,
          reserved: p.reservedBalanceCents,
          total: p.availableBalanceCents + p.reservedBalanceCents,
          availableNetChange:
            i === 0
              ? 0
              : p.availableBalanceCents - arr[i - 1]!.availableBalanceCents,
          adjusted,
          // Hidden stack floor so the category bands sit BETWEEN the predicted
          // line and the base available line (adjusted + Σcategories = base).
          adjustedBase: adjusted,
          point: p,
        };
        let topSum = 0;
        for (const c of topCats) {
          const v = abc[c] ?? 0;
          row[spendKey(c)] = v;
          topSum += v;
        }
        // Other always absorbs the remainder so the bands meet the base line
        // exactly (a category can round out of the summary yet still accrue).
        const drag = p.availableBalanceCents - adjusted;
        row[spendKey(OTHER_KEY)] = Math.max(0, drag - topSum);
        return row;
      }),
    [forecast.points, topCats, hasOther],
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
      if (showPredictedLine) {
        if (p.adjusted < min) min = p.adjusted;
        if (p.adjusted > max) max = p.adjusted;
      }
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
  }, [data, showPredictedLine]);

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
          // Element form: recharts clones this and injects active/payload at
          // hover. Our extra props (the per-account breakout lists) ride along.
          content={
            <ForecastTooltip
              reservedAccounts={showReservedBreakout ? reservedAccounts : []}
              availableAccounts={
                showAvailableBreakout ? availableAccounts : []
              }
              predicted={showPredictedLine}
              breakout={showCategoryBreakout}
              topCats={topCats}
              hasOther={hasOther}
            />
          }
          cursor={{ stroke: "var(--muted)" }}
        />

        {/* Category breakout: stacked bands filling the gap between the
            predicted line and the base available line, split by category.
            A hidden floor (the predicted balance) offsets the stack so the
            bands sit BETWEEN predicted and available rather than from zero. */}
        {showCategoryBreakout && (
          <>
            <Area
              type="monotone"
              dataKey="adjustedBase"
              stackId="spend"
              stroke="none"
              fill="none"
              fillOpacity={0}
              dot={false}
              isAnimationActive={false}
              legendType="none"
              name="__spendfloor__"
            />
            {topCats.map((c, i) => (
              <Area
                key={c}
                type="monotone"
                dataKey={`spend_${c}`}
                stackId="spend"
                stroke={catColor(i)}
                strokeWidth={0.5}
                fill={catColor(i)}
                fillOpacity={0.5}
                dot={false}
                isAnimationActive={false}
                name={`Spend · ${c}`}
              />
            ))}
            <Area
              type="monotone"
              dataKey={`spend_${OTHER_KEY}`}
              stackId="spend"
              stroke={OTHER_COLOR}
              strokeWidth={0.5}
              fill={OTHER_COLOR}
              fillOpacity={0.45}
              dot={false}
              isAnimationActive={false}
              name="Spend · Other"
            />
          </>
        )}

        {/* Reserved. Either a single faint dashed total line, or — when
            expanded — one slightly-varied dashed line per reserved account
            (no summed line in the expanded view; it reads too busy). */}
        {showReservedBreakout ? (
          reservedAccounts.map((a, i) => (
            <Line
              key={a.id}
              type="monotone"
              dataKey={(d: ChartDatum) => d.point.byAccount[a.id] ?? 0}
              stroke={reservedColor(i)}
              strokeDasharray="4 4"
              strokeWidth={1.25}
              strokeOpacity={0.85}
              dot={false}
              isAnimationActive={false}
              name={`Reserved · ${a.name}`}
            />
          ))
        ) : (
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
        )}

        {/* Available. A filled area normally; a plain line when per-account
            expanded (detail carried by those lines) or when the category
            breakout is on (so the bands underneath stay visible). */}
        {showAvailableBreakout ? (
          availableAccounts.map((a, i) => (
            <Line
              key={a.id}
              type="monotone"
              dataKey={(d: ChartDatum) => d.point.byAccount[a.id] ?? 0}
              stroke={availableColor(i)}
              strokeWidth={1.75}
              strokeOpacity={0.9}
              dot={false}
              isAnimationActive={false}
              name={`Available · ${a.name}`}
            />
          ))
        ) : showCategoryBreakout ? (
          <Line
            type="monotone"
            dataKey="available"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            name="available"
          />
        ) : (
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
        )}

        {/* Predicted (adjusted) balance — history-driven, dashed amber. */}
        {showPredictedLine && (
          <Line
            type="monotone"
            dataKey="adjusted"
            stroke={PREDICTED_COLOR}
            strokeWidth={2}
            strokeDasharray="5 3"
            dot={false}
            isAnimationActive={false}
            name="predicted"
          />
        )}
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
  adjusted: number;
  adjustedBase: number;
  point: ForecastPoint;
} & Record<`spend_${string}`, number>;

function ForecastTooltip({
  active,
  payload,
  reservedAccounts = [],
  availableAccounts = [],
  predicted = false,
  breakout = false,
  topCats = [],
  hasOther = false,
}: TooltipProps<number, string> & {
  /** When non-empty, the tooltip lists these accounts individually instead
      of the single summed Available / Reserved rows. */
  reservedAccounts?: Account[];
  availableAccounts?: Account[];
  /** Show the predicted (adjusted) balance row. */
  predicted?: boolean;
  /** Show the per-category projected-spend breakdown. */
  breakout?: boolean;
  topCats?: string[];
  hasOther?: boolean;
}) {
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
        {availableAccounts.length > 0 ? (
          availableAccounts.map((a, i) => (
            <Row
              key={a.id}
              label={a.name}
              value={formatUSD(point.byAccount[a.id] ?? 0)}
              swatch={availableColor(i)}
            />
          ))
        ) : (
          <Row label="Available" value={formatUSD(datum.available)} />
        )}
        {reservedAccounts.length > 0
          ? reservedAccounts.map((a, i) => (
              <Row
                key={a.id}
                label={a.name}
                value={formatUSD(point.byAccount[a.id] ?? 0)}
                swatch={reservedColor(i)}
                muted
              />
            ))
          : datum.reserved !== 0 && (
              <Row label="Reserved" value={formatUSD(datum.reserved)} muted />
            )}
        <Row label="Total" value={formatUSD(datum.total)} muted />
        {predicted && point.adjustedAvailableBalanceCents != null && (
          <Row
            label="Predicted"
            value={formatUSD(point.adjustedAvailableBalanceCents)}
            kind={
              point.adjustedAvailableBalanceCents < datum.available
                ? "expense"
                : undefined
            }
          />
        )}
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

      {breakout &&
        point.adjustedByCategory &&
        point.adjustedAvailableBalanceCents != null &&
        (() => {
          const abc = point.adjustedByCategory!;
          // Keep each category's ORIGINAL index so its swatch matches the band
          // color (bands are drawn in topCats order via catColor(i)).
          const rows = topCats
            .map((c, i) => ({ c, v: abc[c] ?? 0, color: catColor(i) }))
            .filter((r) => r.v > 0);
          const topSum = topCats.reduce((sum, c) => sum + (abc[c] ?? 0), 0);
          const other = Math.max(
            0,
            datum.available - point.adjustedAvailableBalanceCents! - topSum,
          );
          if (rows.length === 0 && other <= 0) return null;
          return (
            <Section title="Projected spend to date">
              {rows.map((r) => (
                <EventLine
                  key={r.c}
                  name={r.c}
                  amount={`−${formatUSD(r.v)}`}
                  kind="expense"
                  swatch={r.color}
                />
              ))}
              {other > 0 && (
                <EventLine
                  name="Other"
                  amount={`−${formatUSD(other)}`}
                  kind="expense"
                  swatch={OTHER_COLOR}
                />
              )}
            </Section>
          );
        })()}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  kind,
  swatch,
}: {
  label: string;
  value: string;
  muted?: boolean;
  /** Color the amount to match income/expense semantics. */
  kind?: "income" | "expense";
  /** Optional color dot that ties this row to its chart line. */
  swatch?: string;
}) {
  const amountClass = kind
    ? `forecast-tooltip__amount forecast-tooltip__amount--${kind}`
    : "forecast-tooltip__amount";
  return (
    <div className={`forecast-tooltip__row ${muted ? "muted" : ""}`}>
      <span className="forecast-tooltip__label">
        {swatch && (
          <span
            className="forecast-tooltip__swatch"
            style={{ background: swatch }}
          />
        )}
        {label}
      </span>
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
  swatch,
}: {
  name: string;
  amount: string;
  kind: "income" | "expense" | "goal";
  meta?: string;
  /** Bold the row — used for the per-target "→ Account: $total" header. */
  strong?: boolean;
  /** Indent + de-emphasize — used for individual goals beneath their group. */
  nested?: boolean;
  /** Optional color dot that ties the row to its chart band. */
  swatch?: string;
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
        {swatch && (
          <span
            className="forecast-tooltip__swatch"
            style={{ background: swatch }}
          />
        )}
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
