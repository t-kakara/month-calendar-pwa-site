const DAY_MS = 86_400_000;

export function pad2(value) {
  return String(value).padStart(2, "0");
}

export function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function addMonths(date, amount) {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + amount);
  result.setDate(Math.min(day, endOfMonth(result).getDate()));
  return result;
}

export function monthGrid(date) {
  const first = startOfMonth(date);
  const firstCell = addDays(first, -first.getDay());
  const last = endOfMonth(date);
  const cells = [];
  let cursor = firstCell;

  do {
    cells.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  } while (cells.length < 35 || cursor <= last || cursor.getDay() !== 0);

  return cells;
}

export function monthRange(date) {
  const cells = monthGrid(date);
  return {
    start: new Date(cells[0].getFullYear(), cells[0].getMonth(), cells[0].getDate()),
    end: addDays(cells[cells.length - 1], 1),
  };
}

export function sameDay(a, b) {
  return toDateKey(a) === toDateKey(b);
}

export function dateTimeLocalValue(date) {
  return `${toDateKey(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function combineDateAndTime(dateKey, timeValue) {
  const date = parseDateKey(dateKey);
  const [hours, minutes] = timeValue.split(":").map(Number);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function durationDays(startDateKey, endExclusiveDateKey) {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endExclusiveDateKey);
  return Math.max(1, Math.round((end - start) / DAY_MS));
}

export function formatTime(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatMonthTitle(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function formatLongDate(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

export function formatEventDateTime(event) {
  if (event.isAllDay) {
    const endInclusive = addDays(event.end, -1);
    if (sameDay(event.start, endInclusive)) {
      return `${formatLongDate(event.start)}・終日`;
    }
    return `${formatLongDate(event.start)}〜${formatLongDate(endInclusive)}・終日`;
  }
  const startDate = formatLongDate(event.start);
  const endDate = sameDay(event.start, event.end) ? "" : `${formatLongDate(event.end)} `;
  return `${startDate} ${formatTime(event.start)}〜${endDate}${formatTime(event.end)}`;
}

export function eventOccursOn(event, date) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = addDays(dayStart, 1);
  return event.start < dayEnd && event.end > dayStart;
}

export function eventSort(a, b) {
  if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
  return a.start - b.start || a.title.localeCompare(b.title, "ja");
}

export function isSameMonth(date, month) {
  return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
}

export function reminderLabel(minutes) {
  const value = Number(minutes);
  if (value === 0) return "開始時刻";
  if (value === 10) return "10分前";
  if (value === 30) return "30分前";
  if (value === 60) return "1時間前";
  if (value === 1440) return "1日前";
  return `${value}分前`;
}
