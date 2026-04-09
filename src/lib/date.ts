export function parseEpisodeDate(dateStr: string): Date | null {
  // Handle M/D/YY or M/D/YYYY formats
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return null;

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);

  if (year < 100) {
    year += 2000;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  // Validate the date components are correct (e.g., no Feb 30)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function formatDateHuman(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] || "";
}
