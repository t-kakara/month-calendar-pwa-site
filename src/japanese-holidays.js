import { addDays, parseDateKey, toDateKey } from "./date-utils.js";

function nthWeekday(year, monthIndex, weekday, nth) {
  const first = new Date(year, monthIndex, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, monthIndex, 1 + offset + (nth - 1) * 7);
}

function vernalEquinox(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function autumnalEquinox(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

function addHoliday(map, date, title, kind = "national") {
  map.set(toDateKey(date), { title, kind });
}

function baseHolidays(year) {
  const map = new Map();
  addHoliday(map, new Date(year, 0, 1), "元日");
  addHoliday(map, nthWeekday(year, 0, 1, 2), "成人の日");
  addHoliday(map, new Date(year, 1, 11), "建国記念の日");
  if (year >= 2020) addHoliday(map, new Date(year, 1, 23), "天皇誕生日");
  addHoliday(map, new Date(year, 2, vernalEquinox(year)), "春分の日");
  addHoliday(map, new Date(year, 3, 29), "昭和の日");
  addHoliday(map, new Date(year, 4, 3), "憲法記念日");
  addHoliday(map, new Date(year, 4, 4), "みどりの日");
  addHoliday(map, new Date(year, 4, 5), "こどもの日");

  if (year === 2020) {
    addHoliday(map, new Date(year, 6, 23), "海の日");
    addHoliday(map, new Date(year, 6, 24), "スポーツの日");
    addHoliday(map, new Date(year, 7, 10), "山の日");
  } else if (year === 2021) {
    addHoliday(map, new Date(year, 6, 22), "海の日");
    addHoliday(map, new Date(year, 6, 23), "スポーツの日");
    addHoliday(map, new Date(year, 7, 8), "山の日");
  } else {
    addHoliday(map, nthWeekday(year, 6, 1, 3), "海の日");
    addHoliday(map, new Date(year, 7, 11), "山の日");
    addHoliday(map, nthWeekday(year, 9, 1, 2), "スポーツの日");
  }

  addHoliday(map, nthWeekday(year, 8, 1, 3), "敬老の日");
  addHoliday(map, new Date(year, 8, autumnalEquinox(year)), "秋分の日");
  addHoliday(map, new Date(year, 10, 3), "文化の日");
  addHoliday(map, new Date(year, 10, 23), "勤労感謝の日");

  if (year === 2019) {
    addHoliday(map, new Date(year, 3, 30), "休日", "citizen");
    addHoliday(map, new Date(year, 4, 1), "天皇の即位の日");
    addHoliday(map, new Date(year, 4, 2), "休日", "citizen");
    addHoliday(map, new Date(year, 9, 22), "即位礼正殿の儀");
  }
  return map;
}

export function holidaysForYear(year) {
  if (year < 2000 || year > 2099) return [];
  const map = baseHolidays(year);

  for (let day = new Date(year, 0, 2); day < new Date(year + 1, 0, 1); day = addDays(day, 1)) {
    const key = toDateKey(day);
    if (map.has(key)) continue;
    const before = map.get(toDateKey(addDays(day, -1)));
    const after = map.get(toDateKey(addDays(day, 1)));
    if (before?.kind === "national" && after?.kind === "national") {
      addHoliday(map, day, "休日", "citizen");
    }
  }

  const nationalSundays = [...map.entries()]
    .filter(([, holiday]) => holiday.kind === "national")
    .map(([key]) => parseDateKey(key))
    .filter((date) => date.getDay() === 0)
    .sort((a, b) => a - b);

  for (const sunday of nationalSundays) {
    let substitute = addDays(sunday, 1);
    while (map.has(toDateKey(substitute))) substitute = addDays(substitute, 1);
    addHoliday(map, substitute, "振替休日", "substitute");
  }

  return [...map.entries()]
    .map(([dateKey, holiday]) => holidayEvent(dateKey, holiday))
    .sort((a, b) => a.start - b.start);
}

export function holidaysForRange(start, end) {
  const events = [];
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    events.push(...holidaysForYear(year));
  }
  return events.filter((event) => event.start < end && event.end > start);
}

function holidayEvent(dateKey, holiday) {
  const start = parseDateKey(dateKey);
  return {
    id: `jp-holiday-${dateKey}`,
    title: holiday.title,
    description: "日本の国民の祝日・休日",
    start,
    end: addDays(start, 1),
    isAllDay: true,
    calendarId: "jp-holidays-built-in",
    calendarName: "日本の祝日",
    color: "#c43b45",
    reminderMinutes: null,
    isRecurring: false,
    isWritable: false,
    isHoliday: true,
    htmlLink: "",
    raw: null,
  };
}
