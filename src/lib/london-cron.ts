const londonCronFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  hour: "2-digit",
  hour12: false,
});

export function isTuesdayNineAmLondon(scheduledTime: number): boolean {
  const parts = londonCronFormatter.formatToParts(new Date(scheduledTime));
  const weekday = parts.find((part) => part.type === "weekday")?.value || "";
  const hour = parts.find((part) => part.type === "hour")?.value || "";
  return weekday === "Tue" && hour === "09";
}
