// Period vocabulary for summary pages.
//
// Designed as a discriminated union so additional period kinds (quarter,
// season, week, era) can be added without breaking existing callers. Every
// summary route, query helper, and component takes either a `Period` (when
// it needs the kind for labelling/comparison) or a `PeriodBounds` (when it
// only needs a date range to filter against).

export type Period =
  | { kind: "year"; year: number }
  | { kind: "month"; year: number; month: number };

export type PeriodKind = Period["kind"];

// ISO YYYY-MM-DD, inclusive on both ends. Matches the format used by the
// `episodes.published_date` column, so SQL `BETWEEN start AND end` works
// directly without timezone gymnastics.
export type PeriodBounds = {
  start: string;
  end: string;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function lastDayOfMonth(year: number, month: number): number {
  // month is 1-indexed; new Date(year, month, 0) gives the last day of `month`
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function periodBounds(period: Period): PeriodBounds {
  if (period.kind === "year") {
    return { start: `${period.year}-01-01`, end: `${period.year}-12-31` };
  }
  const last = lastDayOfMonth(period.year, period.month);
  return {
    start: `${period.year}-${pad2(period.month)}-01`,
    end: `${period.year}-${pad2(period.month)}-${pad2(last)}`,
  };
}

// The previous comparable period for `Up / Down` deltas and "new since"
// comparisons. Months step back across year boundaries; years step back by
// one. Returns null only for malformed inputs.
export function previousPeriod(period: Period): Period | null {
  if (period.kind === "year") {
    return { kind: "year", year: period.year - 1 };
  }
  if (period.month === 1) {
    return { kind: "month", year: period.year - 1, month: 12 };
  }
  return { kind: "month", year: period.year, month: period.month - 1 };
}

export function periodLabel(period: Period): string {
  if (period.kind === "year") return String(period.year);
  return `${MONTH_NAMES[period.month - 1]} ${period.year}`;
}

export function periodPath(period: Period): string {
  if (period.kind === "year") return `/summaries/${period.year}`;
  return `/summaries/${period.year}/${period.month}`;
}

// Parse from URL params. Both inputs are raw strings from the route. Returns
// null for any malformed input — the route handler should treat that as 404.
export function parsePeriodPath(yearStr: string, monthStr?: string): Period | null {
  const year = Number(yearStr);
  if (!Number.isInteger(year) || year < 1900 || year > 9999) return null;

  if (monthStr === undefined) {
    return { kind: "year", year };
  }

  const month = Number(monthStr);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  return { kind: "month", year, month };
}

export function isWithinPeriod(isoDate: string, period: Period): boolean {
  const { start, end } = periodBounds(period);
  return isoDate >= start && isoDate <= end;
}
