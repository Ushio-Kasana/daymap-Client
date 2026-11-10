import type {
  AssessmentTask,
  DaymapUser,
  DiaryItem,
  LessonLink,
  OverdueSettings,
} from "./types";

const DM_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?)?$/;

export function parseDaymapDate(value?: string | null): Date | null {
  if (!value || value.startsWith("0001-01-01")) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const match = DM_DATE.exec(value.trim());
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, year, month, day, hour, minute, second, fraction] = match;
  const millis = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
    millis,
  );
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function weekOf(date = new Date()): Date[] {
  const start = startOfDay(date);
  const monday = addDays(start, -((start.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function formatTime(date: Date | null): string {
  if (!date) return "—";
  const hour = date.getHours() % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute} ${date.getHours() >= 12 ? "pm" : "am"}`;
}

export function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short" }).format(date);
}

export function formatDayNumber(date: Date): string {
  return String(date.getDate());
}

export function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat("en-AU", { month: "long" }).format(date);
}

export function formatHeaderDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function formatShortDate(date: Date): string {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

export function formatDueLabel(date: Date | null, now = new Date()): string {
  if (!date) return "No due date";
  if (sameDay(date, now)) return `Today, ${formatTime(date)}`;
  if (sameDay(date, addDays(now, 1))) return `Tomorrow, ${formatTime(date)}`;
  if (sameDay(date, addDays(now, -1))) return "Yesterday";
  const today = startOfDay(now);
  const diff = Math.round((startOfDay(date).getTime() - today.getTime()) / 86_400_000);
  if (diff > 0 && diff < 7) return `${formatWeekday(date)}, ${formatTime(date)}`;
  return `${formatShortDate(date)}, ${formatTime(date)}`;
}

export function formatRelativeShort(date: Date | null): string {
  if (!date) return "";
  const now = new Date();
  if (sameDay(date, now)) return formatTime(date);
  if (sameDay(date, addDays(now, -1))) return "Yesterday";
  const diff = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000);
  if (diff >= 0 && diff < 7) return formatWeekday(date);
  return formatShortDate(date);
}

export function formatFullStamp(date: Date | null): string {
  if (!date) return "—";
  return `${formatWeekday(date)} ${date.getDate()} ${formatMonth(date)}, ${formatTime(date)}`;
}

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function updatedLabel(fetchedAt?: string | null): string {
  if (!fetchedAt) return "Not updated yet";
  const date = new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) return "Not updated yet";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Updated just now";
  if (seconds < 3600) return `Updated ${Math.floor(seconds / 60)} min ago`;
  return `Updated ${formatTime(date)}`;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  laquo: "\u00ab",
  raquo: "\u00bb",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  deg: "\u00b0",
  middot: "\u00b7",
  bull: "\u2022",
  times: "\u00d7",
  divide: "\u00f7",
  euro: "\u20ac",
  pound: "\u00a3",
  yen: "\u00a5",
  cent: "\u00a2",
  sect: "\u00a7",
  para: "\u00b6",
};

/** Decode entities in plain text, including text Daymap has double-encoded. */
export function decodeHtmlEntities(value: string): string {
  let text = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = text.replace(
      /&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi,
      (match, entity: string) => {
        if (entity.startsWith("#")) {
          const hex = entity[1]?.toLowerCase() === "x";
          const digits = entity.slice(hex ? 2 : 1);
          const codePoint = Number.parseInt(digits, hex ? 16 : 10);
          if (!Number.isFinite(codePoint) || codePoint < 1 || codePoint > 0x10ffff) {
            return match;
          }
          return String.fromCodePoint(codePoint);
        }
        return HTML_ENTITIES[entity.toLowerCase()] ?? match;
      },
    );
    if (decoded === text) return text;
    text = decoded;
  }
  return text;
}

export function stripHtml(html?: string | null, limit = 200): string {
  if (!html) return "";
  const document = new DOMParser().parseFromString(html, "text/html");
  // textContent glues adjacent blocks together ("one.</p><p>Two" reads as
  // "one.Two"), so keep a space where each block ends and a newline for <br>.
  document.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  document
    .querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote")
    .forEach((node) => node.append(" "));
  let text = decodeHtmlEntities(document.body.textContent ?? "");
  text = text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > limit) text = text.slice(0, limit).trim();
  return text;
}

export function extractLinks(html?: string | null): LessonLink[] {
  if (!html) return [];
  const document = new DOMParser().parseFromString(html, "text/html");
  return Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => ({
      title: (anchor.textContent ?? "").replace(/\s+/g, " ").trim(),
      href: anchor.getAttribute("href") ?? "",
    }))
    .filter(
      (link) =>
        link.title.length > 0 &&
        link.href.length > 0 &&
        !link.href.toLowerCase().startsWith("javascript:"),
    );
}

export function absoluteDaymapUrl(schoolCode: string | null | undefined, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  const code = (schoolCode ?? "").toLowerCase();
  return `https://${code}.daymap.net${href.startsWith("/") ? href : `/${href}`}`;
}

const CLASS_COLORS = [
  "#3478dc",
  "#29a68c",
  "#b85ab8",
  "#e68438",
  "#599e4d",
  "#d15470",
  "#4d94c7",
  "#8c73cc",
];

export function classTint(name: string | null | undefined): string {
  if (!name) return "#2e66de";
  let hash = 0;
  for (const character of name) {
    hash = ((hash * 31 + character.codePointAt(0)!) % 100_000) | 0;
  }
  return CLASS_COLORS[Math.abs(hash) % CLASS_COLORS.length];
}

export function attendanceLabel(status: number | null | undefined): string | null {
  switch (status) {
    case 1:
    case 5:
      return "Absent";
    case 2:
      return "Present";
    case 3:
      return "Late";
    case 4:
      return "Left early";
    case 6:
      return "Excused";
    default:
      return null;
  }
}

export function attendanceTint(status: number | null | undefined): string {
  switch (status) {
    case 1:
    case 5:
      return "#d94047";
    case 2:
      return "#219c66";
    case 3:
    case 4:
      return "#eb8c21";
    case 6:
      return "#7b55d9";
    default:
      return "#7b8496";
  }
}

export function attendanceStatusForLesson(
  lesson: DiaryItem,
  now = new Date(),
): number | null {
  const start = parseDaymapDate(lesson.start);
  // Daymap can return a stale attendance code for a lesson that hasn't started.
  if (start && start.getTime() > now.getTime()) return null;
  return lesson.attendanceStatus ?? null;
}

export function displayName(user?: DaymapUser | null): string {
  const full = [user?.firstname, user?.surname]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return full || user?.username || "Student";
}

export function initials(user?: DaymapUser | null): string {
  const words = displayName(user).split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase() ?? "").join("") || "DM";
}

export function schoolLabel(user?: DaymapUser | null): string {
  return user?.schoolName?.trim() || user?.schoolCode?.toUpperCase() || "Daymap";
}

export function taskIsSubmitted(task: AssessmentTask): boolean {
  if (task.workReceived) return true;
  const status = (task.status ?? "").toLowerCase();
  return (
    status.includes("work has been received") ||
    status.includes("work received") ||
    status.includes("results published")
  );
}

export function taskIsComplete(task: AssessmentTask): boolean {
  return taskIsSubmitted(task);
}

export function normalizeClassLabel(value?: string | null): string {
  return (value ?? "").trim().toLocaleLowerCase();
}

export function taskIsClassMuted(
  task: AssessmentTask,
  settings: OverdueSettings,
): boolean {
  const classLabels = [task.classCode, task.className]
    .map(normalizeClassLabel)
    .filter(Boolean);
  return classLabels.some((label) =>
    settings.mutedClasses.some(
      (muted) => normalizeClassLabel(muted) === label,
    ),
  );
}

export function taskHasOverdueOverride(
  task: AssessmentTask,
  settings: OverdueSettings,
): boolean {
  return settings.notOverdueTaskIds.includes(task.id);
}

export function taskIsOverdue(
  task: AssessmentTask,
  settings?: OverdueSettings,
): boolean {
  if (!task.overdue || taskIsComplete(task)) return false;
  if (!settings) return true;
  return !taskIsClassMuted(task, settings) && !taskHasOverdueOverride(task, settings);
}

export function taskShortStatus(
  task: AssessmentTask,
  settings?: OverdueSettings,
): string {
  if (taskIsOverdue(task, settings)) return "Overdue";
  if (taskIsSubmitted(task)) return "Submitted";
  if (task.overdue && settings) return "Not overdue";
  return task.status?.trim() || "Not submitted";
}

export function dueWithinWeek(
  task: AssessmentTask,
  now = new Date(),
  settings?: OverdueSettings,
): boolean {
  if (taskIsComplete(task) || taskIsOverdue(task, settings)) return false;
  const due = parseDaymapDate(task.dueDate);
  if (!due) return false;
  const end = addDays(startOfDay(now), 7);
  return due >= startOfDay(now) && due < end;
}

export function lessonOnDay(lesson: DiaryItem, day: Date): boolean {
  return sameDay(parseDaymapDate(lesson.start), day);
}

export function sortTasksByDue(tasks: AssessmentTask[]): AssessmentTask[] {
  return [...tasks].sort((a, b) => {
    const left = parseDaymapDate(a.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const right = parseDaymapDate(b.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}
