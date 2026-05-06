import { useMemo } from "react";
import {
  formatUSD,
  frequencyLabels,
  type ForecastResponse,
  type Goal,
  type ScheduledItem,
} from "shared";
import { useGoals } from "../goals/queries";
import { useScheduledItems } from "../scheduled/queries";

// Compact one-row-per-goal panel showing on-track status, projected saved,
// and target vs estimated completion dates. Pulls saved-projection from the
// forecast response (computed by the engine) and the raw goal target/date
// from the goals list.

export function GoalStatus({ forecast }: { forecast: ForecastResponse }) {
  const { data: goals } = useGoals();
  const { data: scheduledItems } = useScheduledItems();

  const projectionById = useMemo(() => {
    const m = new Map<string, ForecastResponse["goalProjections"][number]>();
    for (const p of forecast.goalProjections) m.set(p.goalId, p);
    return m;
  }, [forecast.goalProjections]);

  const itemById = useMemo(() => {
    const m = new Map<string, ScheduledItem>();
    for (const it of scheduledItems ?? []) m.set(it.id, it);
    return m;
  }, [scheduledItems]);

  if (!goals || goals.length === 0) return null;

  return (
    <div className="goal-status">
      <h3>Goals</h3>
      <ul className="goal-status__list">
        {goals.map((g) => (
          <GoalRow
            key={g.id}
            goal={g}
            projection={projectionById.get(g.id)}
            fundingItem={
              g.fundedByScheduledItemId
                ? itemById.get(g.fundedByScheduledItemId)
                : undefined
            }
          />
        ))}
      </ul>
    </div>
  );
}

// Linear "expected progress" between createdAt and targetDate. Used as a
// rough where-you-should-be marker on the bar. We deliberately don't use
// per-occurrence math here — that would re-introduce the same kind of
// per-day jitter the user noted; a smooth ramp gives a steadier reference.
function expectedPercent(goal: Goal): number {
  const created = new Date(goal.createdAt).getTime();
  const target = new Date(`${goal.targetDate}T00:00:00Z`).getTime();
  const now = Date.now();
  if (Number.isNaN(created) || Number.isNaN(target) || target <= created) {
    return 100;
  }
  const frac = (now - created) / (target - created);
  if (frac <= 0) return 0;
  if (frac >= 1) return 100;
  return frac * 100;
}

function GoalRow({
  goal,
  projection,
  fundingItem,
}: {
  goal: Goal;
  projection?: ForecastResponse["goalProjections"][number];
  fundingItem?: ScheduledItem;
}) {
  // Progress numbers/bar reflect what's saved RIGHT NOW — not where the
  // forecast says we'll be at the end of the horizon. The badge alone uses
  // the projection to telegraph trajectory.
  const saved = goal.savedCents;
  const percent = Math.round(
    Math.min(1, saved / Math.max(goal.targetCents, 1)) * 100,
  );
  const isReached = saved >= goal.targetCents;
  const onTrack = projection?.onTrack ?? false;
  const willComplete =
    (projection?.projectedSavedCents ?? saved) >= goal.targetCents;
  const completionDate = projection?.estimatedCompletionDate;

  // Badge states: reached now / on track / will-arrive-late / behind / unfunded.
  let statusLabel: string;
  let statusClass: string;
  if (isReached) {
    statusLabel = "Reached";
    statusClass = "goal-status__badge goal-status__badge--ok";
  } else if (onTrack) {
    statusLabel = "On track";
    statusClass = "goal-status__badge goal-status__badge--ok";
  } else if (willComplete && completionDate) {
    statusLabel = `Reaches ${completionDate}`;
    statusClass = "goal-status__badge goal-status__badge--warn";
  } else if (goal.fundedByScheduledItemId) {
    statusLabel = "Behind";
    statusClass = "goal-status__badge goal-status__badge--bad";
  } else {
    statusLabel = "Unfunded";
    statusClass = "goal-status__badge goal-status__badge--muted";
  }

  const expected = expectedPercent(goal);
  // Hide the expected marker once it's at the start (just-created) or fully
  // at the end (after target date) — both edges read as noise.
  const showExpectedMarker = !isReached && expected > 1 && expected < 100;

  return (
    <li className="goal-status__row">
      <div className="goal-status__head">
        <span className="goal-status__name">{goal.name}</span>
        <span className={statusClass}>{statusLabel}</span>
      </div>
      <div
        className="progress"
        aria-hidden="true"
        style={{ position: "relative" }}
      >
        <div
          className={`progress__bar ${isReached ? "complete" : ""}`}
          style={{ width: `${percent}%` }}
        />
        {showExpectedMarker && (
          <div
            className="progress__marker"
            style={{ left: `${expected}%` }}
            title={`Expected ~${Math.round(expected)}% by today`}
          />
        )}
      </div>
      <div className="goal-status__meta">
        <span>
          {formatUSD(saved)} of {formatUSD(goal.targetCents)} ({percent}%)
        </span>
        <span>Target {goal.targetDate}</span>
      </div>
      {fundingItem &&
        goal.contributionPerOccurrenceCents !== null &&
        !isReached && (
          <div className="goal-status__contribution">
            {formatUSD(goal.contributionPerOccurrenceCents)} per{" "}
            {frequencyLabels[fundingItem.frequency].toLowerCase()} from{" "}
            <em>{fundingItem.name}</em>
          </div>
        )}
    </li>
  );
}

// ─── Warnings ───────────────────────────────────────────────────────────

export function ForecastWarnings({ forecast }: { forecast: ForecastResponse }) {
  if (forecast.warnings.length === 0) return null;
  return (
    <div className="warnings">
      <h3>Heads up</h3>
      <ul>
        {forecast.warnings.map((w, i) => (
          <li key={i} className={`warning warning--${w.type}`}>
            {w.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
