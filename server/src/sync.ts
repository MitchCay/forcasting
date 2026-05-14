import { and, eq, inArray } from "drizzle-orm";
import {
  addDaysISO,
  firstDueOnOrAfter,
  nextDueAfter,
  occurrencesOf,
  todayISO,
} from "shared";
import { db } from "./db/client";
import {
  accounts,
  goals,
  scheduledItems,
  type AccountRow,
  type ScheduledItemRow,
} from "./db/schema";

// ─── syncUser ───────────────────────────────────────────────────────────
//
// Catches the database up with every scheduled-item occurrence and credit-
// card statement payment whose date is in the past. Runs at the top of
// every read endpoint so the user never has to manually mark a paycheck
// as "received" — when the paycheck date passes, sync applies it.
//
// Math:
// - Scheduled income: `account_balance_cents += amount`. If the item funds a
//   goal, that contribution is then deducted from the income's account and
//   credited to the goal's target account; goal.saved_cents advances.
// - Scheduled expense: `account_balance_cents -= amount`.
// - CC statement payment (on the configured due day): paid_from -= statement,
//   cc balance := max(0, balance − statement), statement := max(0, balance − statement).
//
// Window:
// - We apply events with date STRICTLY BEFORE today, then bump every item's
//   `last_applied_date` (and CC's `last_statement_applied_date`) to yesterday.
// - The forecast engine continues to project from today forward — including
//   today's events. This keeps the seam clean: nothing is double-counted and
//   today's events stay visible on the chart.

export async function syncUser(userId: string): Promise<void> {
  const today = todayISO();
  const yesterday = addDaysISO(today, -1);

  await db.transaction(async (tx) => {
    const userAccounts = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId));
    if (userAccounts.length === 0) return;

    const accountIds = userAccounts.map((a) => a.id);
    const userItems = await tx
      .select()
      .from(scheduledItems)
      .where(inArray(scheduledItems.accountId, accountIds));
    const userGoals = await tx
      .select()
      .from(goals)
      .where(eq(goals.userId, userId));

    // Mutable local mirrors of every row we might touch.
    const balances = new Map<string, number>();
    for (const a of userAccounts) balances.set(a.id, a.currentBalanceCents);

    const savedAmounts = new Map<string, number>();
    for (const g of userGoals) savedAmounts.set(g.id, g.savedCents);

    const ccStatements = new Map<string, number>();
    const ccLastApplied = new Map<string, string>();
    for (const a of userAccounts) {
      if (a.type === "credit_card") {
        ccStatements.set(a.id, a.statementBalanceCents ?? 0);
        ccLastApplied.set(a.id, a.lastStatementAppliedDate ?? yesterday);
      }
    }

    // ── Enumerate past events ──────────────────────────────────────
    type PastEvent =
      | { kind: "scheduled"; date: string; item: ScheduledItemRow }
      | { kind: "cc_statement"; date: string; ccId: string };
    const events: PastEvent[] = [];

    for (const item of userItems) {
      const lastApplied = item.lastAppliedDate ?? yesterday;
      if (lastApplied >= yesterday) continue;
      const from = addDaysISO(lastApplied, 1);
      for (const date of occurrencesOf(item, from, yesterday)) {
        events.push({ kind: "scheduled", date, item });
      }
    }

    for (const a of userAccounts) {
      if (a.type !== "credit_card") continue;
      if (
        a.statementBalanceCents == null ||
        a.statementDueDay == null ||
        !a.statementPaidFromAccountId
      )
        continue;
      const lastApplied = a.lastStatementAppliedDate ?? yesterday;
      if (lastApplied >= yesterday) continue;
      const from = addDaysISO(lastApplied, 1);
      let cursor = firstDueOnOrAfter(from, a.statementDueDay);
      while (cursor <= yesterday) {
        events.push({ kind: "cc_statement", date: cursor, ccId: a.id });
        cursor = nextDueAfter(cursor, a.statementDueDay);
      }
    }

    if (events.length === 0) {
      // Nothing to apply, but still advance markers so we don't re-scan the
      // same window on every read.
      await bumpMarkers(tx, userItems, userAccounts, yesterday);
      return;
    }

    // Date-stable sort so multiple events on one day apply in a defined
    // order. (We don't have a sub-day ordering hint, but lexical sort on
    // ISO dates groups by date which is what we need.)
    events.sort((a, b) => a.date.localeCompare(b.date));

    // ── Apply each event ──────────────────────────────────────────
    for (const ev of events) {
      if (ev.kind === "scheduled") {
        const item = ev.item;
        if (item.isIncome) {
          balances.set(
            item.accountId,
            (balances.get(item.accountId) ?? 0) + item.amountCents,
          );
          for (const goal of userGoals) {
            if (goal.fundedByScheduledItemId !== item.id) continue;
            if (goal.contributionPerOccurrenceCents == null) continue;
            const saved = savedAmounts.get(goal.id) ?? 0;
            const remaining = goal.targetCents - saved;
            if (remaining <= 0) continue;
            const contribution = Math.min(
              goal.contributionPerOccurrenceCents,
              remaining,
            );
            balances.set(
              item.accountId,
              (balances.get(item.accountId) ?? 0) - contribution,
            );
            balances.set(
              goal.targetAccountId,
              (balances.get(goal.targetAccountId) ?? 0) + contribution,
            );
            savedAmounts.set(goal.id, saved + contribution);
          }
        } else {
          balances.set(
            item.accountId,
            (balances.get(item.accountId) ?? 0) - item.amountCents,
          );
        }
      } else {
        // cc_statement
        const cc = userAccounts.find((a) => a.id === ev.ccId);
        if (!cc || !cc.statementPaidFromAccountId) continue;
        const paidFromId = cc.statementPaidFromAccountId;
        const statementCents = ccStatements.get(cc.id) ?? 0;
        const balanceBefore = balances.get(cc.id) ?? 0;

        balances.set(
          paidFromId,
          (balances.get(paidFromId) ?? 0) - statementCents,
        );
        const next = Math.max(0, balanceBefore - statementCents);
        balances.set(cc.id, next);
        ccStatements.set(cc.id, next);
        ccLastApplied.set(cc.id, ev.date);
      }
    }

    // ── Write back ────────────────────────────────────────────────
    for (const a of userAccounts) {
      const newBal = balances.get(a.id) ?? a.currentBalanceCents;
      const updates: Record<string, unknown> = {};
      if (newBal !== a.currentBalanceCents)
        updates.currentBalanceCents = newBal;
      if (a.type === "credit_card") {
        const newStmt = ccStatements.get(a.id);
        if (
          newStmt !== undefined &&
          newStmt !== (a.statementBalanceCents ?? 0)
        ) {
          updates.statementBalanceCents = newStmt;
        }
      }
      if (Object.keys(updates).length > 0) {
        await tx
          .update(accounts)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(accounts.id, a.id));
      }
    }

    for (const g of userGoals) {
      const newSaved = savedAmounts.get(g.id) ?? g.savedCents;
      if (newSaved !== g.savedCents) {
        await tx
          .update(goals)
          .set({ savedCents: newSaved, updatedAt: new Date() })
          .where(eq(goals.id, g.id));
      }
    }

    await bumpMarkers(tx, userItems, userAccounts, yesterday);
  });
}

// Advances last_applied_date / last_statement_applied_date forward to
// yesterday on any row whose marker is older. Called whether or not we had
// events to apply — once a day passes, we shouldn't re-scan it.
async function bumpMarkers(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  items: ScheduledItemRow[],
  userAccounts: AccountRow[],
  yesterday: string,
): Promise<void> {
  for (const item of items) {
    const last = item.lastAppliedDate ?? yesterday;
    if (last >= yesterday) continue;
    await tx
      .update(scheduledItems)
      .set({ lastAppliedDate: yesterday, updatedAt: new Date() })
      .where(eq(scheduledItems.id, item.id));
  }
  for (const a of userAccounts) {
    if (a.type !== "credit_card") continue;
    const last = a.lastStatementAppliedDate ?? yesterday;
    if (last >= yesterday) continue;
    await tx
      .update(accounts)
      .set({ lastStatementAppliedDate: yesterday, updatedAt: new Date() })
      .where(and(eq(accounts.id, a.id)));
  }
}
