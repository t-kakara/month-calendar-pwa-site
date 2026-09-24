import { addDays, durationDays, parseDateKey, toDateKey } from "./date-utils.js";

const API_ROOT = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
].join(" ");

export class GoogleApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.body = body;
  }
}

export class CalendarApi {
  constructor() {
    this.accessToken = "";
  }

  setAccessToken(token) {
    this.accessToken = token || "";
  }

  async request(path, options = {}) {
    if (!this.accessToken) throw new GoogleApiError("Googleへの接続が必要です。", 401);
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${this.accessToken}`);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    const response = await fetch(`${API_ROOT}${path}`, { ...options, headers });
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body?.error?.message || `Google Calendar API エラー (${response.status})`;
      throw new GoogleApiError(message, response.status, body);
    }
    return body;
  }

  async listCalendars() {
    const calendars = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({ minAccessRole: "reader", showHidden: "false" });
      if (pageToken) params.set("pageToken", pageToken);
      const data = await this.request(`/users/me/calendarList?${params}`);
      calendars.push(...(data.items || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken);
    return calendars.filter((calendar) => calendar.selected !== false);
  }

  async listEvents(calendarId, timeMin, timeMax, maxResults = 2500) {
    const events = [];
    let pageToken = "";
    do {
      const params = new URLSearchParams({
        singleEvents: "true",
        showDeleted: "false",
        orderBy: "startTime",
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        maxResults: String(maxResults),
      });
      if (pageToken) params.set("pageToken", pageToken);
      const data = await this.request(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
      events.push(...(data.items || []));
      pageToken = data.nextPageToken || "";
    } while (pageToken && events.length < maxResults);
    return events.slice(0, maxResults);
  }

  createEvent(calendarId, resource) {
    return this.request(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify(resource),
    });
  }

  updateEvent(calendarId, eventId, resource) {
    return this.request(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "PUT",
      body: JSON.stringify(resource),
    });
  }

  deleteEvent(calendarId, eventId) {
    return this.request(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
    });
  }

  moveEvent(calendarId, eventId, destination) {
    const params = new URLSearchParams({ destination });
    return this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move?${params}`,
      { method: "POST" },
    );
  }
}

export function normalizeEvent(raw, calendar) {
  const isAllDay = Boolean(raw.start?.date);
  const start = isAllDay ? parseDateKey(raw.start.date) : new Date(raw.start?.dateTime);
  const end = isAllDay ? parseDateKey(raw.end.date) : new Date(raw.end?.dateTime);
  const overrides = raw.reminders?.useDefault ? [] : raw.reminders?.overrides || [];
  const popupReminder = overrides.find((reminder) => reminder.method === "popup");

  return {
    id: raw.id,
    raw,
    title: raw.summary || "（無題）",
    description: raw.description || "",
    start,
    end,
    isAllDay,
    calendarId: calendar.id,
    calendarName: calendar.summaryOverride || calendar.summary || "カレンダー",
    color: raw.backgroundColor || calendar.backgroundColor || "#6d43ad",
    reminderMinutes: popupReminder ? popupReminder.minutes : null,
    isRecurring: Boolean(raw.recurringEventId || raw.recurrence),
    isWritable: calendar.accessRole === "owner" || calendar.accessRole === "writer",
    htmlLink: raw.htmlLink || "",
  };
}

export function formToGoogleEvent(values, originalRaw = null) {
  const resource = originalRaw ? structuredClone(originalRaw) : {};
  const calendarOnlyFields = [
    "id", "etag", "htmlLink", "created", "updated", "creator", "organizer", "iCalUID",
    "kind", "sequence", "status", "recurringEventId", "originalStartTime",
  ];
  for (const key of calendarOnlyFields) delete resource[key];

  resource.summary = values.title.trim();
  resource.description = values.description.trim();

  if (values.isAllDay) {
    const startKey = values.startDate;
    const days = Math.max(1, Number(values.allDayDuration || 1));
    resource.start = { date: startKey };
    resource.end = { date: toDateKey(addDays(parseDateKey(startKey), days)) };
  } else {
    resource.start = { dateTime: new Date(values.startDateTime).toISOString() };
    resource.end = { dateTime: new Date(values.endDateTime).toISOString() };
  }

  if (values.reminderMinutes === "") {
    resource.reminders = { useDefault: false, overrides: [] };
  } else {
    resource.reminders = {
      useDefault: false,
      overrides: [{ method: "popup", minutes: Number(values.reminderMinutes) }],
    };
  }
  return resource;
}

export function eventToFormValues(event) {
  if (event.isAllDay) {
    return {
      title: event.title === "（無題）" ? "" : event.title,
      description: event.description,
      isAllDay: true,
      startDate: toDateKey(event.start),
      allDayDuration: durationDays(toDateKey(event.start), toDateKey(event.end)),
      reminderMinutes: event.reminderMinutes == null ? "" : String(event.reminderMinutes),
    };
  }
  return {
    title: event.title === "（無題）" ? "" : event.title,
    description: event.description,
    isAllDay: false,
    startDateTime: localDateTime(event.start),
    endDateTime: localDateTime(event.end),
    reminderMinutes: event.reminderMinutes == null ? "" : String(event.reminderMinutes),
  };
}

export function eventToDateResource(event, targetDate, copy = false) {
  const values = eventToFormValues(event);
  if (event.isAllDay) {
    values.startDate = toDateKey(targetDate);
  } else {
    const start = new Date(targetDate);
    start.setHours(event.start.getHours(), event.start.getMinutes(), event.start.getSeconds(), event.start.getMilliseconds());
    const end = new Date(start.getTime() + (event.end - event.start));
    values.startDateTime = localDateTime(start);
    values.endDateTime = localDateTime(end);
  }
  return formToGoogleEvent(values, copy ? null : event.raw);
}

function localDateTime(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
