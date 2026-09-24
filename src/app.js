import { APP_CONFIG, GOOGLE_CLIENT_ID, hasConfiguredClientId } from "./config.js";
import {
  CalendarApi,
  GOOGLE_SCOPES,
  GoogleApiError,
  eventToDateResource,
  eventToFormValues,
  formToGoogleEvent,
  normalizeEvent,
} from "./calendar-api.js";
import {
  addDays,
  addMonths,
  dateTimeLocalValue,
  eventOccursOn,
  eventSort,
  formatEventDateTime,
  formatLongDate,
  formatMonthTitle,
  formatTime,
  isSameMonth,
  monthGrid,
  monthRange,
  parseDateKey,
  reminderLabel,
  sameDay,
  startOfMonth,
  toDateKey,
} from "./date-utils.js";
import { holidaysForRange } from "./japanese-holidays.js";

const app = document.querySelector("#app");
const api = new CalendarApi();
const today = new Date();
today.setHours(0, 0, 0, 0);
const LONG_PRESS_MS = 450;
const DRAG_START_TOLERANCE = 10;
const MONTH_SWIPE_MIN_DISTANCE = 50;
let dragGesture = null;
let monthSwipe = null;
let ignoreEventClickUntil = 0;
let ignoreDateClickUntil = 0;

const state = {
  currentMonth: startOfMonth(today),
  selectedDate: today,
  events: [],
  holidays: [],
  calendars: [],
  history: [],
  authenticated: false,
  loading: false,
  gisReady: false,
  tokenClient: null,
  dialog: null,
  toast: "",
  error: "",
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(name) {
  const paths = {
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8"/><path d="M20 3v5h-5"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/>',
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
}

function visibleEvents() {
  return [...state.holidays, ...state.events].sort(eventSort);
}

function selectedEvents() {
  return visibleEvents().filter((event) => eventOccursOn(event, state.selectedDate));
}

function render() {
  const cells = monthGrid(state.currentMonth);
  const allEvents = visibleEvents();
  const weeks = cells.length / 7;
  const configWarning = hasConfiguredClientId() ? "" : `
    <div class="setup-banner" role="status">
      <strong>Google接続の準備が必要です</strong>
      <span><code>src/config.js</code> にOAuthクライアントIDを設定してください。</span>
    </div>`;

  app.innerHTML = `
    <header class="topbar">
      <button class="icon-button" data-action="account" aria-label="接続状態">${icon("account")}</button>
      <button class="month-title" data-action="month-picker" aria-label="年月を選択">${formatMonthTitle(state.currentMonth)}</button>
      <div class="topbar-actions">
        <button class="today-button" data-action="today">今日</button>
        <button class="icon-button" data-action="refresh" aria-label="再読み込み" ${state.authenticated ? "" : "disabled"}>${icon("refresh")}</button>
      </div>
    </header>
    ${configWarning}
    ${state.error ? `<div class="error-banner" role="alert">${escapeHtml(state.error)}</div>` : ""}
    <main class="calendar-layout" style="--week-count:${weeks}">
      <section class="month-section" aria-label="${formatMonthTitle(state.currentMonth)}">
        <div class="weekday-row" aria-hidden="true">
          ${["日", "月", "火", "水", "木", "金", "土"].map((day) => `<span>${day}</span>`).join("")}
        </div>
        <div class="month-grid">
          ${cells.map((date) => renderDayCell(date, allEvents)).join("")}
        </div>
      </section>
      <section class="day-panel" aria-label="選択日の予定">
        ${renderDayPanel()}
      </section>
    </main>
    <button class="add-button" data-action="new-event" aria-label="予定を追加" ${state.authenticated ? "" : "disabled"}>${icon("plus")}</button>
    ${state.loading ? '<div class="loading-overlay" role="status"><span class="spinner"></span><span>読み込み中</span></div>' : ""}
    ${state.dialog ? renderDialog() : ""}
    ${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ""}
  `;
  app.setAttribute("aria-busy", String(state.loading));
  bindEvents();
}

function renderDayCell(date, allEvents) {
  const dateEvents = allEvents.filter((event) => eventOccursOn(event, date));
  const shown = dateEvents.slice(0, APP_CONFIG.maxEventsPerCell);
  const remaining = dateEvents.length - shown.length;
  const classes = ["day-cell"];
  if (!isSameMonth(date, state.currentMonth)) classes.push("outside-month");
  if (sameDay(date, today)) classes.push("today");
  if (sameDay(date, state.selectedDate)) classes.push("selected");
  if (date.getDay() === 0) classes.push("sunday");
  if (date.getDay() === 6) classes.push("saturday");
  if (dateEvents.some((event) => event.isHoliday)) classes.push("holiday-date");

  return `
    <button class="${classes.join(" ")}" data-action="select-date" data-date="${toDateKey(date)}" aria-label="${formatLongDate(date)}、予定${dateEvents.length}件">
      <span class="day-number">${date.getDate()}</span>
      <span class="cell-events">
        ${shown.map((event) => `<span class="event-chip ${event.isHoliday ? "holiday-chip" : ""}" style="--event-color:${escapeHtml(event.color)}">${event.isAllDay ? "" : `<small>${formatTime(event.start)}</small>`}${escapeHtml(event.title)}</span>`).join("")}
        ${remaining > 0 ? `<span class="overflow-count">+${remaining}</span>` : ""}
      </span>
    </button>`;
}

function renderDayPanel() {
  const events = selectedEvents();
  return `
    <div class="day-panel-heading">
      <h1>${formatLongDate(state.selectedDate)}</h1>
      <span>${events.length ? `${events.length}件` : "予定なし"}</span>
    </div>
    <div class="event-list">
      ${events.length ? events.map(renderEventRow).join("") : `
        <div class="empty-state">
          <span>${state.authenticated ? "この日の予定はありません" : "Googleに接続すると予定を表示します"}</span>
          ${!state.authenticated && hasConfiguredClientId() ? '<button class="primary-button" data-action="connect">Googleに接続</button>' : ""}
        </div>`}
    </div>`;
}

function renderEventRow(event) {
  const time = event.isAllDay ? "終日" : `${formatTime(event.start)}\n${formatTime(event.end)}`;
  const canDrag = event.isWritable && !event.isRecurring && !event.isHoliday;
  const dragLabel = canDrag ? "、長押しでコピーまたは移動" : "";
  return `
    <button class="event-row ${event.isHoliday ? "holiday-row" : ""}" data-action="event-detail" data-event-id="${escapeHtml(event.id)}" data-calendar-id="${escapeHtml(event.calendarId)}" ${canDrag ? 'data-drag-enabled="true"' : ""} aria-label="${escapeHtml(`${time.replace("\n", "〜")} ${event.title} ${event.calendarName}${dragLabel}`)}">
      <span class="event-time">${escapeHtml(time)}</span>
      <span class="event-color" style="--event-color:${escapeHtml(event.color)}"></span>
      <span class="event-content">
        <strong>${escapeHtml(event.title)}</strong>
        <small>${escapeHtml(event.calendarName)}</small>
      </span>
      ${icon("chevronRight")}
    </button>`;
}

function renderDialog() {
  if (state.dialog.type === "month-picker") return renderMonthPicker();
  if (state.dialog.type === "account") return renderAccountDialog();
  if (state.dialog.type === "detail") return renderDetailDialog(state.dialog.event);
  if (state.dialog.type === "form") return renderEventForm(state.dialog.event || null);
  if (state.dialog.type === "drop-action") return renderDropActionDialog();
  return "";
}

function dialogShell(title, content, extraClass = "") {
  return `
    <div class="dialog-backdrop" data-action="close-dialog">
      <section class="dialog-sheet ${extraClass}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" data-dialog-sheet>
        <div class="dialog-header">
          <h2>${escapeHtml(title)}</h2>
          <button class="icon-button" data-action="close-dialog" aria-label="閉じる">${icon("close")}</button>
        </div>
        ${content}
      </section>
    </div>`;
}

function renderMonthPicker() {
  const year = state.currentMonth.getFullYear();
  const content = `
    <div class="year-picker">
      <button class="icon-button" data-action="change-year" data-amount="-1" aria-label="前年">${icon("chevronLeft")}</button>
      <strong>${year}年</strong>
      <button class="icon-button" data-action="change-year" data-amount="1" aria-label="翌年">${icon("chevronRight")}</button>
    </div>
    <div class="month-picker-grid">
      ${Array.from({ length: 12 }, (_, month) => `
        <button class="${month === state.currentMonth.getMonth() ? "active" : ""}" data-action="pick-month" data-month="${month}">${month + 1}月</button>`).join("")}
    </div>`;
  return dialogShell("年月を選択", content, "compact-sheet");
}

function renderAccountDialog() {
  const content = state.authenticated ? `
    <div class="dialog-body account-body">
      <div class="account-state connected">Googleカレンダーに接続中</div>
      <p>アクセストークンはこの画面を閉じた後も、現在のブラウザセッション内だけで使用します。</p>
      <button class="secondary-button" data-action="disconnect">接続を解除</button>
    </div>` : `
    <div class="dialog-body account-body">
      <div class="account-state">Googleカレンダーに未接続</div>
      <p>${hasConfiguredClientId() ? "Google標準画面でこのアプリに予定の読み書きを許可します。" : "先に src/config.js にOAuthクライアントIDを設定してください。"}</p>
      <button class="primary-button" data-action="connect" ${hasConfiguredClientId() && state.gisReady ? "" : "disabled"}>Googleに接続</button>
    </div>`;
  return dialogShell("Google接続", content, "compact-sheet");
}

function renderDetailDialog(event) {
  const canEdit = event.isWritable && !event.isRecurring && !event.isHoliday;
  const reminder = event.reminderMinutes == null ? "なし" : reminderLabel(event.reminderMinutes);
  const recurringMessage = event.isRecurring ? '<p class="notice">繰り返し予定はPhase 1では閲覧のみです。</p>' : "";
  const content = `
    <div class="dialog-body detail-body">
      <div class="detail-title"><span style="--event-color:${escapeHtml(event.color)}"></span><h3>${escapeHtml(event.title)}</h3></div>
      <dl class="detail-list">
        <div><dt>日時</dt><dd>${escapeHtml(formatEventDateTime(event))}</dd></div>
        <div><dt>カレンダー</dt><dd>${escapeHtml(event.calendarName)}</dd></div>
        <div><dt>通知</dt><dd>${escapeHtml(reminder)}</dd></div>
        <div><dt>メモ</dt><dd class="preserve-lines">${escapeHtml(event.description || "なし")}</dd></div>
      </dl>
      ${recurringMessage}
      ${event.isHoliday ? '<p class="notice">内閣府公表内容に基づく日本の祝日・休日です。</p>' : ""}
    </div>
    ${canEdit ? `<div class="dialog-actions">
      <button class="danger-button" data-action="delete-event" data-event-id="${escapeHtml(event.id)}" data-calendar-id="${escapeHtml(event.calendarId)}">${icon("trash")}削除</button>
      <button class="primary-button" data-action="edit-event" data-event-id="${escapeHtml(event.id)}" data-calendar-id="${escapeHtml(event.calendarId)}">編集</button>
    </div>` : ""}`;
  return dialogShell("予定の詳細", content);
}

function renderEventForm(event) {
  const values = event ? eventToFormValues(event) : newEventDefaults();
  const title = event ? "予定を編集" : "新しい予定";
  const writableCalendars = state.calendars.filter((calendar) => calendar.accessRole === "owner" || calendar.accessRole === "writer");
  const selectedCalendarId = event?.calendarId || writableCalendars.find((calendar) => calendar.primary)?.id || writableCalendars[0]?.id || "";
  const content = `
    <form id="event-form" class="event-form" data-original-event-id="${escapeHtml(event?.id || "")}" data-original-calendar-id="${escapeHtml(event?.calendarId || "")}">
      <label class="field title-field"><span>タイトル</span><input name="title" type="text" maxlength="200" required value="${escapeHtml(values.title)}" placeholder="予定のタイトル" autocomplete="off" /></label>
      ${state.history.length ? `<div class="history-section"><span>履歴から入力</span><div class="history-list">${state.history.map((item, index) => `<button type="button" data-action="apply-history" data-history-index="${index}"><strong>${escapeHtml(item.title)}</strong><small>${item.isAllDay ? "終日" : `${escapeHtml(item.startTime)}〜${escapeHtml(item.endTime)}`}</small></button>`).join("")}</div></div>` : ""}
      <label class="switch-field"><span>終日</span><input name="isAllDay" type="checkbox" ${values.isAllDay ? "checked" : ""} /></label>
      <div class="timed-fields" ${values.isAllDay ? "hidden" : ""}>
        <label class="field"><span>開始</span><input name="startDateTime" type="datetime-local" value="${escapeHtml(values.startDateTime || "")}" /></label>
        <label class="field"><span>終了</span><input name="endDateTime" type="datetime-local" value="${escapeHtml(values.endDateTime || "")}" /></label>
      </div>
      <div class="all-day-fields" ${values.isAllDay ? "" : "hidden"}>
        <label class="field"><span>日付</span><input name="startDate" type="date" value="${escapeHtml(values.startDate || toDateKey(state.selectedDate))}" /></label>
        <label class="field"><span>日数</span><input name="allDayDuration" type="number" min="1" max="365" value="${escapeHtml(values.allDayDuration || 1)}" /></label>
      </div>
      <label class="field"><span>カレンダー</span><select name="calendarId">${writableCalendars.map((calendar) => `<option value="${escapeHtml(calendar.id)}" ${calendar.id === selectedCalendarId ? "selected" : ""}>${escapeHtml(calendar.summaryOverride || calendar.summary)}</option>`).join("")}</select></label>
      <label class="field"><span>通知</span><select name="reminderMinutes">
        ${[["", "なし"], ["0", "開始時刻"], ["10", "10分前"], ["30", "30分前"], ["60", "1時間前"], ["1440", "1日前"]].map(([value, label]) => `<option value="${value}" ${String(values.reminderMinutes ?? "") === value ? "selected" : ""}>${label}</option>`).join("")}
      </select></label>
      <label class="field"><span>メモ</span><textarea name="description" rows="4" maxlength="8192" placeholder="メモを入力">${escapeHtml(values.description || "")}</textarea></label>
      <div class="form-actions"><button type="button" class="secondary-button" data-action="close-dialog">キャンセル</button><button type="submit" class="primary-button">保存</button></div>
    </form>`;
  return dialogShell(title, content, "form-sheet");
}

function renderDropActionDialog() {
  const { event, targetDate } = state.dialog;
  const content = `
    <div class="dialog-body drop-summary">
      <strong>${escapeHtml(event.title)}</strong>
      <span>${escapeHtml(formatLongDate(event.start))} → ${escapeHtml(formatLongDate(targetDate))}</span>
      <p>時刻と予定内容を保ったまま操作します。</p>
    </div>
    <div class="dialog-actions drop-actions">
      <button class="secondary-button" data-action="close-dialog">キャンセル</button>
      <button class="secondary-button" data-action="drop-copy">コピー</button>
      <button class="primary-button" data-action="drop-move">移動</button>
    </div>`;
  return dialogShell("コピーまたは移動", content, "compact-sheet");
}

function newEventDefaults() {
  const start = new Date(state.selectedDate);
  const now = new Date();
  const defaultHour = sameDay(start, now) ? Math.min(22, now.getHours() + 1) : 10;
  start.setHours(defaultHour, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: "",
    description: "",
    isAllDay: false,
    startDateTime: dateTimeLocalValue(start),
    endDateTime: dateTimeLocalValue(end),
    reminderMinutes: "",
  };
}

function bindEvents() {
  app.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", handleAction);
  });
  const sheet = app.querySelector("[data-dialog-sheet]");
  if (sheet) sheet.addEventListener("click", (event) => event.stopPropagation());
  const form = app.querySelector("#event-form");
  if (form) {
    form.addEventListener("submit", saveEvent);
    form.elements.isAllDay.addEventListener("change", toggleAllDayFields);
  }
  bindMonthSwipe();
  app.querySelectorAll('[data-drag-enabled="true"]').forEach(bindLongPressDrag);
}

async function handleAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;
  if (action === "select-date") {
    if (Date.now() < ignoreDateClickUntil) return;
    state.selectedDate = parseDateKey(button.dataset.date);
    if (!isSameMonth(state.selectedDate, state.currentMonth)) {
      state.currentMonth = startOfMonth(state.selectedDate);
      await loadMonth();
    }
    render();
  } else if (action === "today") {
    state.selectedDate = new Date(today);
    const changed = !isSameMonth(state.currentMonth, today);
    state.currentMonth = startOfMonth(today);
    if (changed) await loadMonth(); else render();
  } else if (action === "month-picker") {
    state.dialog = { type: "month-picker" };
    render();
  } else if (action === "change-year") {
    state.currentMonth = new Date(state.currentMonth.getFullYear() + Number(button.dataset.amount), state.currentMonth.getMonth(), 1);
    render();
  } else if (action === "pick-month") {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), Number(button.dataset.month), 1);
    state.selectedDate = new Date(state.currentMonth);
    state.dialog = null;
    await loadMonth();
  } else if (action === "close-dialog") {
    state.dialog = null;
    render();
  } else if (action === "account") {
    state.dialog = { type: "account" };
    render();
  } else if (action === "connect") {
    connectGoogle();
  } else if (action === "disconnect") {
    disconnectGoogle();
  } else if (action === "refresh") {
    await loadMonth(true);
  } else if (action === "new-event") {
    state.dialog = { type: "form" };
    render();
  } else if (action === "event-detail") {
    if (Date.now() < ignoreEventClickUntil) return;
    const item = findEvent(button.dataset.eventId, button.dataset.calendarId);
    if (item) { state.dialog = { type: "detail", event: item }; render(); }
  } else if (action === "edit-event") {
    const item = findEvent(button.dataset.eventId, button.dataset.calendarId);
    if (item) { state.dialog = { type: "form", event: item }; render(); }
  } else if (action === "delete-event") {
    const item = findEvent(button.dataset.eventId, button.dataset.calendarId);
    if (item) await deleteEvent(item);
  } else if (action === "apply-history") {
    applyHistory(Number(button.dataset.historyIndex));
  } else if (action === "drop-copy" || action === "drop-move") {
    await applyDropAction(action === "drop-copy" ? "copy" : "move");
  }
}

function findEvent(eventId, calendarId) {
  return visibleEvents().find((item) => item.id === eventId && item.calendarId === calendarId);
}

function bindMonthSwipe() {
  const section = app.querySelector(".month-section");
  section.addEventListener("touchstart", startMonthSwipe, { passive: true });
  section.addEventListener("touchmove", moveMonthSwipe, { passive: false });
  section.addEventListener("touchend", endMonthSwipe, { passive: true });
  section.addEventListener("touchcancel", cancelMonthSwipe);
}

function startMonthSwipe(event) {
  if (event.touches.length !== 1) return;
  const touch = event.touches[0];
  monthSwipe = { startX: touch.clientX, startY: touch.clientY, x: touch.clientX, y: touch.clientY, horizontal: false };
}

function moveMonthSwipe(event) {
  if (!monthSwipe || event.touches.length !== 1) return;
  const touch = event.touches[0];
  monthSwipe.x = touch.clientX;
  monthSwipe.y = touch.clientY;
  const dx = touch.clientX - monthSwipe.startX;
  const dy = touch.clientY - monthSwipe.startY;
  if (!monthSwipe.horizontal && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) monthSwipe.horizontal = true;
  if (monthSwipe.horizontal) event.preventDefault();
}

async function endMonthSwipe() {
  if (!monthSwipe) return;
  const dx = monthSwipe.x - monthSwipe.startX;
  const dy = monthSwipe.y - monthSwipe.startY;
  const shouldChange = monthSwipe.horizontal && Math.abs(dx) >= MONTH_SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.2;
  monthSwipe = null;
  if (!shouldChange) return;

  ignoreDateClickUntil = Date.now() + 500;
  const amount = dx < 0 ? 1 : -1;
  state.currentMonth = addMonths(state.currentMonth, amount);
  state.selectedDate = addMonths(state.selectedDate, amount);
  await loadMonth();
}

function cancelMonthSwipe() {
  monthSwipe = null;
}

function bindLongPressDrag(row) {
  row.addEventListener("touchstart", startTouchDrag, { passive: true });
  row.addEventListener("touchmove", moveTouchDrag, { passive: false });
  row.addEventListener("touchend", endTouchDrag, { passive: false });
  row.addEventListener("touchcancel", cancelDragGesture);
  row.addEventListener("mousedown", startMouseDrag);
}

function startDragGesture(row, x, y) {
  cancelDragGesture();
  const item = findEvent(row.dataset.eventId, row.dataset.calendarId);
  if (!item) return;
  dragGesture = {
    row,
    item,
    startX: x,
    startY: y,
    x,
    y,
    active: false,
    timer: window.setTimeout(beginDrag, LONG_PRESS_MS),
    ghost: null,
    targetCell: null,
  };
}

function movedPastTolerance(x, y) {
  return Math.hypot(x - dragGesture.startX, y - dragGesture.startY) > DRAG_START_TOLERANCE;
}

function beginDrag() {
  if (!dragGesture) return;
  dragGesture.active = true;
  dragGesture.row.classList.add("drag-source");
  document.documentElement.classList.add("event-dragging");
  app.querySelectorAll(".day-cell").forEach((cell) => cell.classList.add("drop-candidate"));

  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.setAttribute("role", "status");
  ghost.innerHTML = `<strong>${escapeHtml(dragGesture.item.title)}</strong><span>日付へドラッグ</span>`;
  document.body.append(ghost);
  dragGesture.ghost = ghost;
  updateDragPosition(dragGesture.x, dragGesture.y);
}

function updateDragPosition(x, y) {
  if (!dragGesture?.active) return;
  dragGesture.x = x;
  dragGesture.y = y;
  dragGesture.ghost.style.left = `${x}px`;
  dragGesture.ghost.style.top = `${y}px`;
  const cell = document.elementFromPoint(x, y)?.closest?.(".day-cell") || null;
  if (cell === dragGesture.targetCell) return;
  dragGesture.targetCell?.classList.remove("drop-target");
  dragGesture.targetCell = cell;
  dragGesture.targetCell?.classList.add("drop-target");
}

function finishDrag(x, y) {
  if (!dragGesture?.active) { cancelDragGesture(); return; }
  updateDragPosition(x, y);
  const item = dragGesture.item;
  const dateKey = dragGesture.targetCell?.dataset.date || "";
  ignoreEventClickUntil = Date.now() + 500;
  cancelDragGesture();

  if (!dateKey) { showToast("日付セルにドロップしてください"); return; }
  const targetDate = parseDateKey(dateKey);
  if (sameDay(item.start, targetDate)) { showToast("別の日付へドロップしてください"); return; }
  state.dialog = { type: "drop-action", event: item, targetDate };
  render();
}

function cancelDragGesture() {
  if (!dragGesture) return;
  window.clearTimeout(dragGesture.timer);
  dragGesture.row?.classList.remove("drag-source");
  dragGesture.targetCell?.classList.remove("drop-target");
  dragGesture.ghost?.remove();
  app.querySelectorAll(".day-cell.drop-candidate").forEach((cell) => cell.classList.remove("drop-candidate"));
  document.documentElement.classList.remove("event-dragging");
  dragGesture = null;
  window.removeEventListener("mousemove", moveMouseDrag);
  window.removeEventListener("mouseup", endMouseDrag);
}

function startTouchDrag(event) {
  if (event.touches.length !== 1) return;
  const touch = event.touches[0];
  startDragGesture(event.currentTarget, touch.clientX, touch.clientY);
}

function moveTouchDrag(event) {
  if (!dragGesture || event.touches.length !== 1) return;
  const touch = event.touches[0];
  dragGesture.x = touch.clientX;
  dragGesture.y = touch.clientY;
  if (!dragGesture.active && movedPastTolerance(touch.clientX, touch.clientY)) {
    cancelDragGesture();
    return;
  }
  if (dragGesture.active) {
    event.preventDefault();
    updateDragPosition(touch.clientX, touch.clientY);
  }
}

function endTouchDrag(event) {
  if (!dragGesture) return;
  if (!dragGesture.active) { cancelDragGesture(); return; }
  event.preventDefault();
  event.stopPropagation();
  const touch = event.changedTouches[0];
  finishDrag(touch.clientX, touch.clientY);
}

function startMouseDrag(event) {
  if (event.button !== 0) return;
  startDragGesture(event.currentTarget, event.clientX, event.clientY);
  window.addEventListener("mousemove", moveMouseDrag);
  window.addEventListener("mouseup", endMouseDrag);
}

function moveMouseDrag(event) {
  if (!dragGesture) return;
  dragGesture.x = event.clientX;
  dragGesture.y = event.clientY;
  if (!dragGesture.active && movedPastTolerance(event.clientX, event.clientY)) {
    cancelDragGesture();
    return;
  }
  if (dragGesture.active) {
    event.preventDefault();
    updateDragPosition(event.clientX, event.clientY);
  }
}

function endMouseDrag(event) {
  if (!dragGesture) return;
  if (dragGesture.active) {
    event.preventDefault();
    finishDrag(event.clientX, event.clientY);
  } else {
    cancelDragGesture();
  }
}

function initializeGoogleIdentity() {
  if (!hasConfiguredClientId() || !window.google?.accounts?.oauth2) return false;
  state.tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: handleTokenResponse,
    error_callback: (error) => showError(error.message || "Google認証を完了できませんでした。"),
  });
  state.gisReady = true;
  render();
  return true;
}

function connectGoogle() {
  state.error = "";
  if (!state.tokenClient && !initializeGoogleIdentity()) {
    showError("Google認証の準備がまだ完了していません。少し待って再試行してください。");
    return;
  }
  const wasConnected = localStorage.getItem("calendar-consent-granted") === "true";
  state.tokenClient.requestAccessToken({ prompt: wasConnected ? "" : "consent" });
}

async function handleTokenResponse(response) {
  if (response.error) { showError(response.error_description || response.error); return; }
  api.setAccessToken(response.access_token);
  state.authenticated = true;
  state.dialog = null;
  localStorage.setItem("calendar-consent-granted", "true");
  await loadCalendarsAndEvents();
}

function disconnectGoogle() {
  api.setAccessToken("");
  state.authenticated = false;
  state.calendars = [];
  state.events = [];
  state.history = [];
  state.dialog = null;
  showToast("接続を解除しました");
  render();
}

async function loadCalendarsAndEvents() {
  setLoading(true);
  try {
    state.calendars = await api.listCalendars();
    await Promise.all([loadMonth(false), loadHistory(false)]);
    state.error = "";
  } catch (error) {
    handleApiError(error);
  } finally {
    setLoading(false);
  }
}

async function loadMonth(showSuccess = false) {
  const range = monthRange(state.currentMonth);
  state.holidays = holidaysForRange(range.start, range.end);
  if (!state.authenticated) { render(); return; }
  setLoading(true);
  try {
    const eventGroups = await Promise.all(state.calendars.map(async (calendar) => {
      if (isHolidayCalendar(calendar)) return [];
      const items = await api.listEvents(calendar.id, range.start, range.end);
      return items.map((item) => normalizeEvent(item, calendar));
    }));
    state.events = eventGroups.flat().sort(eventSort);
    state.error = "";
    if (showSuccess) showToast("予定を更新しました");
  } catch (error) {
    handleApiError(error);
  } finally {
    setLoading(false);
    render();
  }
}

async function loadHistory(manageLoading = true) {
  const primary = state.calendars.find((calendar) => calendar.primary) || state.calendars[0];
  if (!primary) return;
  if (manageLoading) setLoading(true);
  try {
    const end = new Date();
    const start = addDays(end, -APP_CONFIG.historyLookbackDays);
    const raw = await api.listEvents(primary.id, start, end, APP_CONFIG.historyMaxResults);
    const normalized = raw.map((item) => normalizeEvent(item, primary)).filter((item) => !item.isRecurring);
    state.history = buildHistory(normalized);
  } catch (error) {
    if (!(error instanceof GoogleApiError && error.status === 403)) handleApiError(error);
  } finally {
    if (manageLoading) setLoading(false);
  }
}

function buildHistory(events) {
  const seen = new Set();
  return [...events].sort((a, b) => b.start - a.start).filter((event) => {
    const key = event.isAllDay ? `${event.title}|all-day` : `${event.title}|${formatTime(event.start)}|${formatTime(event.end)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12).map((event) => ({
    title: event.title === "（無題）" ? "" : event.title,
    isAllDay: event.isAllDay,
    startTime: event.isAllDay ? "" : formatTime(event.start),
    endTime: event.isAllDay ? "" : formatTime(event.end),
  }));
}

function isHolidayCalendar(calendar) {
  const haystack = `${calendar.id} ${calendar.summary || ""} ${calendar.summaryOverride || ""}`.toLowerCase();
  return haystack.includes("holiday") || haystack.includes("祝日");
}

function toggleAllDayFields(event) {
  const form = event.currentTarget.form;
  form.querySelector(".timed-fields").hidden = event.currentTarget.checked;
  form.querySelector(".all-day-fields").hidden = !event.currentTarget.checked;
}

function applyHistory(index) {
  const item = state.history[index];
  const form = app.querySelector("#event-form");
  if (!item || !form) return;
  form.elements.title.value = item.title;
  form.elements.isAllDay.checked = item.isAllDay;
  form.querySelector(".timed-fields").hidden = item.isAllDay;
  form.querySelector(".all-day-fields").hidden = !item.isAllDay;
  if (!item.isAllDay) {
    const startDate = form.elements.startDateTime.value.slice(0, 10) || toDateKey(state.selectedDate);
    const endDate = form.elements.endDateTime.value.slice(0, 10) || startDate;
    form.elements.startDateTime.value = `${startDate}T${item.startTime}`;
    form.elements.endDateTime.value = `${endDate}T${item.endTime}`;
  } else {
    form.elements.startDate.value ||= toDateKey(state.selectedDate);
    form.elements.allDayDuration.value = "1";
  }
}

async function saveEvent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const values = Object.fromEntries(data.entries());
  values.isAllDay = form.elements.isAllDay.checked;
  if (!validateEventValues(values)) return;

  const originalId = form.dataset.originalEventId;
  const originalCalendarId = form.dataset.originalCalendarId;
  const original = originalId ? findEvent(originalId, originalCalendarId) : null;
  const resource = formToGoogleEvent(values, original?.raw || null);
  setLoading(true);
  try {
    if (!original) {
      await api.createEvent(values.calendarId, resource);
      showToast("予定を作成しました");
    } else if (originalCalendarId !== values.calendarId) {
      const moved = await api.moveEvent(originalCalendarId, originalId, values.calendarId);
      await api.updateEvent(values.calendarId, moved.id, resource);
      showToast("予定を更新しました");
    } else {
      await api.updateEvent(values.calendarId, originalId, resource);
      showToast("予定を更新しました");
    }
    state.dialog = null;
    await Promise.all([loadMonth(false), loadHistory(false)]);
  } catch (error) {
    handleApiError(error);
  } finally {
    setLoading(false);
    render();
  }
}

function validateEventValues(values) {
  if (!values.title.trim()) { showError("タイトルを入力してください。"); return false; }
  if (!values.calendarId) { showError("書き込み可能なカレンダーがありません。"); return false; }
  if (values.isAllDay) {
    if (!values.startDate) { showError("日付を入力してください。"); return false; }
  } else {
    const start = new Date(values.startDateTime);
    const end = new Date(values.endDateTime);
    if (!values.startDateTime || !values.endDateTime || Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
      showError("開始日時と終了日時を入力してください。"); return false;
    }
    if (end <= start) { showError("終了日時は開始日時より後にしてください。"); return false; }
  }
  return true;
}

async function applyDropAction(mode) {
  const selection = state.dialog;
  if (selection?.type !== "drop-action") return;
  const { event, targetDate } = selection;
  const resource = eventToDateResource(event, targetDate, mode === "copy");
  setLoading(true);
  try {
    if (mode === "copy") {
      await api.createEvent(event.calendarId, resource);
    } else {
      await api.updateEvent(event.calendarId, event.id, resource);
    }
    state.selectedDate = new Date(targetDate);
    if (!isSameMonth(targetDate, state.currentMonth)) state.currentMonth = startOfMonth(targetDate);
    state.dialog = null;
    await Promise.all([loadMonth(false), loadHistory(false)]);
    showToast(`予定を${mode === "copy" ? "コピー" : "移動"}しました`);
  } catch (error) {
    handleApiError(error);
  } finally {
    setLoading(false);
    render();
  }
}

async function deleteEvent(item) {
  if (!window.confirm(`「${item.title}」を削除しますか？`)) return;
  setLoading(true);
  try {
    await api.deleteEvent(item.calendarId, item.id);
    state.dialog = null;
    await Promise.all([loadMonth(false), loadHistory(false)]);
    showToast("予定を削除しました");
  } catch (error) {
    handleApiError(error);
  } finally {
    setLoading(false);
    render();
  }
}

function handleApiError(error) {
  if (error instanceof GoogleApiError && error.status === 401) {
    api.setAccessToken("");
    state.authenticated = false;
    state.error = "Googleの接続期限が切れました。もう一度接続してください。";
  } else {
    state.error = error?.message || "予定を処理できませんでした。";
  }
  render();
}

function setLoading(value) {
  state.loading = value;
  render();
}

function showError(message) {
  state.error = message;
  render();
}

function showToast(message) {
  state.toast = message;
  render();
  window.setTimeout(() => {
    if (state.toast === message) { state.toast = ""; render(); }
  }, 2600);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

state.holidays = holidaysForRange(...Object.values(monthRange(state.currentMonth)));
render();
registerServiceWorker();

const gisTimer = window.setInterval(() => {
  if (initializeGoogleIdentity()) window.clearInterval(gisTimer);
}, 250);
window.setTimeout(() => window.clearInterval(gisTimer), 15_000);
