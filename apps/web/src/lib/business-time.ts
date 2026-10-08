// Business dates and clock times always use Bangladesh time, regardless of the device timezone.
export function dhakaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function withDhakaTime(date: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${date}T${part("hour")}:${part("minute")}:${part("second")}.${String(now.getUTCMilliseconds()).padStart(3, "0")}+06:00`;
}
