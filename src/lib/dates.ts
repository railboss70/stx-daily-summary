import { format, parseISO, isValid } from "date-fns";

export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatLongDate(iso: string) {
  if (!iso) return "";
  const d = parseISO(iso);
  if (!isValid(d)) return iso;
  return format(d, "EEEE, MMMM d, yyyy");
}

export function formatShortDate(iso: string) {
  if (!iso) return "";
  const d = parseISO(iso);
  if (!isValid(d)) return iso;
  return format(d, "MMM d, yyyy");
}

export function formatTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!isValid(d)) return "";
  return format(d, "h:mm a");
}
