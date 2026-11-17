// How the Profile and My agents show a date (decision 58): 13 Nov 2026, Sydney time.
export function dayOf(ms: number): string {
  return new Date(ms).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Sydney",
  });
}
