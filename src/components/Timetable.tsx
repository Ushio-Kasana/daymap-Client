import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { errorText, invoke, isTauri, openExternal } from "../api";
import {
  absoluteDaymapUrl,
  addDays,
  attendanceLabel,
  attendanceStatusForLesson,
  attendanceTint,
  classTint,
  extractLinks,
  formatDayNumber,
  formatShortDate,
  formatTime,
  formatWeekday,
  isoDate,
  lessonOnDay,
  parseDaymapDate,
  sameDay,
  startOfDay,
  weekOf,
} from "../dates";
import { Icon } from "../icons";
import type { Dashboard, DiaryItem } from "../types";

type ViewMode = "day" | "week";

function lessonTime(lesson: DiaryItem): number {
  return parseDaymapDate(lesson.start)?.getTime() ?? 0;
}

function weekRangeLabel(week: Date[]): string {
  return `${formatShortDate(week[0])} – ${formatShortDate(week[week.length - 1])}`;
}

function lessonHeading(lesson: DiaryItem): { title: string; room: string | null } {
  const title = lesson.title.trim();
  const explicit = lesson.room?.trim();
  if (explicit) {
    if (title.toLowerCase().endsWith(explicit.toLowerCase())) {
      return {
        title: title.slice(0, title.length - explicit.length).replace(/[\s,–—-]+$/, "").trim(),
        room: explicit,
      };
    }
    return { title, room: explicit };
  }

  // Daymap appends the room to the lesson title when the diary response does
  // not carry a separate room field. Only strip a final code-like token, and
  // only on a full lesson title, so ordinary class names stay untouched.
  const words = title.split(/\s+/);
  const last = words[words.length - 1] ?? "";
  if (
    words.length >= 4 &&
    /^[A-Z][A-Z0-9]{1,5}$/.test(last) &&
    (/[0-9]/.test(last) || last.length >= 4)
  ) {
    return { title: words.slice(0, -1).join(" "), room: last };
  }

  return { title, room: null };
}

function LessonMeta({ lesson }: { lesson: DiaryItem }) {
  const { room } = lessonHeading(lesson);
  return (
    <>
      {room && <span className="lesson-meta">Room: {room}</span>}
      {lesson.teacherName?.trim() && (
        <span className="lesson-meta">Teacher: {lesson.teacherName}</span>
      )}
      {lesson.substituteName?.trim() && (
        <span className="lesson-meta lesson-substitute">SUB: {lesson.substituteName}</span>
      )}
    </>
  );
}

interface TimetableProps {
  dashboard: Dashboard;
  demo: boolean;
}

export function Timetable({ dashboard, demo }: TimetableProps) {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<ViewMode>("day");
  // The dashboard only carries a short diary window, so each week the user
  // opens is fetched on demand and kept for the rest of this visit.
  const [loadedWeeks, setLoadedWeeks] = useState<Record<string, DiaryItem[]>>({});
  const [weekError, setWeekError] = useState<string | null>(null);
  const [weekAttempt, setWeekAttempt] = useState(0);
  const fetchedWeeks = useRef<Set<string>>(new Set());
  const prefetchedPrevious = useRef(false);
  const canFetchWeeks = isTauri() && !demo;

  const selectedWeek = useMemo(() => weekOf(day), [day]);
  const selectedWeekKey = isoDate(selectedWeek[0]);
  const weekOptions = useMemo(() => {
    const monday = selectedWeek[0];
    return Array.from({ length: 5 }, (_, index) =>
      weekOf(addDays(monday, (index - 2) * 7)),
    );
  }, [selectedWeek]);
  const thisWeekStart = weekOf(new Date())[0];

  const diary = useMemo(() => {
    const loaded = loadedWeeks[selectedWeekKey];
    if (!loaded) return dashboard.diary;
    const byId = new Map<number, DiaryItem>();
    for (const lesson of dashboard.diary) byId.set(lesson.id, lesson);
    for (const lesson of loaded) byId.set(lesson.id, lesson);
    return [...byId.values()];
  }, [dashboard.diary, loadedWeeks, selectedWeekKey]);

  useEffect(() => {
    if (!canFetchWeeks || fetchedWeeks.current.has(selectedWeekKey)) return;
    fetchedWeeks.current.add(selectedWeekKey);
    let cancelled = false;
    const key = selectedWeekKey;
    const to = isoDate(addDays(selectedWeek[0], 6));

    void (async () => {
      // Paint the saved week first, then replace it with fresh lessons.
      if (!loadedWeeks[key]) {
        try {
          const cached = await invoke<DiaryItem[] | null>("cached_timetable_week", {
            from: key,
          });
          if (!cancelled && cached) {
            setLoadedWeeks((current) =>
              current[key] ? current : { ...current, [key]: cached },
            );
          }
        } catch {
          // The network request below is still the source of truth.
        }
      }

      try {
        const lessons = await invoke<DiaryItem[]>("load_timetable", { from: key, to });
        if (cancelled) return;
        setWeekError(null);
        setLoadedWeeks((current) => ({ ...current, [key]: lessons }));
      } catch (cause) {
        if (!cancelled) setWeekError(errorText(cause));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canFetchWeeks, loadedWeeks, selectedWeek, selectedWeekKey, weekAttempt]);

  // Cache the week before the selected one once per visit so stepping back is
  // instant and keeps working without a connection.
  useEffect(() => {
    if (!canFetchWeeks || prefetchedPrevious.current) return;
    prefetchedPrevious.current = true;
    const previous = isoDate(addDays(selectedWeek[0], -7));
    let cancelled = false;

    void (async () => {
      try {
        const cached = await invoke<DiaryItem[] | null>("cached_timetable_week", {
          from: previous,
        });
        if (cancelled || cached) return;
        const lessons = await invoke<DiaryItem[]>("load_timetable", {
          from: previous,
          to: isoDate(addDays(selectedWeek[0], -1)),
        });
        if (!cancelled) {
          setLoadedWeeks((current) =>
            current[previous] ? current : { ...current, [previous]: lessons },
          );
        }
      } catch {
        // Best effort; opening that week retries it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canFetchWeeks, selectedWeek]);

  const weekDays = useMemo(() => {
    return selectedWeek.filter((date) => {
      if (date.getDay() !== 0 && date.getDay() !== 6) return true;
      return diary.some((lesson) => lessonOnDay(lesson, date));
    });
  }, [diary, selectedWeek]);
  const stripDays = useMemo(() => {
    return selectedWeek.filter((date) => {
      if (weekDays.includes(date)) return true;
      return sameDay(date, day);
    });
  }, [day, selectedWeek, weekDays]);
  const lessons = useMemo(
    () =>
      diary
        .filter((lesson) => lessonOnDay(lesson, day))
        .sort((left, right) => lessonTime(left) - lessonTime(right)),
    [day, diary],
  );

  const lessonsFor = (date: Date) =>
    diary
      .filter((lesson) => lessonOnDay(lesson, date))
      .sort((left, right) => lessonTime(left) - lessonTime(right));

  const shiftWeek = (weeks: number) => {
    setDay(startOfDay(addDays(day, weeks * 7)));
  };

  const retryWeek = () => {
    fetchedWeeks.current.delete(selectedWeekKey);
    setWeekError(null);
    setWeekAttempt((value) => value + 1);
  };

  const weekReady = !canFetchWeeks || Boolean(loadedWeeks[selectedWeekKey]);
  const weekPending = !weekReady;
  const showLoadError = weekPending && Boolean(weekError);
  const weekLoading = weekPending && !weekError;
  const weekHasLessons = useMemo(
    () => weekDays.some((date) => diary.some((lesson) => lessonOnDay(lesson, date))),
    [diary, weekDays],
  );
  const hasVisibleLessons = view === "week" ? weekHasLessons : lessons.length > 0;

  return (
    <div className="timetable">
      <div className="day-strip">
        {view === "day" ? (
          <div className="day-chips" role="group" aria-label="Choose day">
            {stripDays.map((date) => {
              const active = sameDay(date, day);
              const today = sameDay(date, new Date());
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  className={`day-chip ${active ? "active" : ""}`}
                  onClick={() => setDay(startOfDay(date))}
                >
                  <span>{today ? "TODAY" : formatWeekday(date).toUpperCase()}</span>
                  <strong>{formatDayNumber(date)}</strong>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="week-chips" role="group" aria-label="Choose week">
            {weekOptions.map((week) => {
              const active = sameDay(week[0], selectedWeek[0]);
              const current = sameDay(week[0], thisWeekStart);
              return (
                <button
                  key={week[0].toISOString()}
                  type="button"
                  className={`week-range-chip ${active ? "active" : ""}`}
                  onClick={() => setDay(startOfDay(week[0]))}
                >
                  <span>{current ? "THIS WEEK" : "WEEK OF"}</span>
                  <strong>{weekRangeLabel(week)}</strong>
                </button>
              );
            })}
          </div>
        )}
        <div className="timetable-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => shiftWeek(-1)}
            aria-label="Previous week"
            title="Previous week"
          >
            <Icon name="left" size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => shiftWeek(1)}
            aria-label="Next week"
            title="Next week"
          >
            <Icon name="right" size={15} />
          </button>
          <div className="view-switch" role="group" aria-label="Timetable view">
            <button
              type="button"
              className={view === "day" ? "active" : ""}
              aria-pressed={view === "day"}
              onClick={() => setView("day")}
            >
              Day
            </button>
            <button
              type="button"
              className={view === "week" ? "active" : ""}
              aria-pressed={view === "week"}
              onClick={() => setView("week")}
            >
              Week
            </button>
          </div>
          <button
            type="button"
            className="today-link"
            onClick={() => setDay(startOfDay(new Date()))}
          >
            <Icon name="refresh" size={14} />
            <span>Today</span>
          </button>
        </div>
      </div>

      <div className="timetable-divider" />

      {weekError && !showLoadError && (
        <div className="error-banner compact" role="alert">
          <Icon name="warning" size={14} />
          <span>{weekError}</span>
          <button type="button" className="link-button" onClick={retryWeek}>
            Retry
          </button>
        </div>
      )}

      {weekLoading && hasVisibleLessons && (
        <div className="timetable-loading-note" role="status" aria-live="polite">
          <span className="spinner" />
          <span>Loading the full week of {weekRangeLabel(selectedWeek)}…</span>
        </div>
      )}

      {showLoadError ? (
        <div className="timetable-empty" role="alert">
          <Icon name="warning" size={38} />
          <strong>Couldn&apos;t load this week&apos;s timetable</strong>
          <span>{weekError}</span>
          <button type="button" className="secondary-button" onClick={retryWeek}>
            Try again
          </button>
        </div>
      ) : weekLoading && !hasVisibleLessons ? (
        <div className="timetable-empty" role="status" aria-live="polite">
          <span className="spinner large" />
          <strong>Loading timetable</strong>
          <span>{weekRangeLabel(selectedWeek)}</span>
        </div>
      ) : view === "week" ? (
        <div
          className="week-grid"
          style={{ "--week-columns": weekDays.length } as CSSProperties}
        >
          {weekDays.map((date) => {
            const dayLessons = lessonsFor(date);
            const today = sameDay(date, new Date());
            return (
              <section
                key={date.toISOString()}
                className={`week-column ${today ? "today" : ""}`}
              >
                <button
                  type="button"
                  className="week-day-head"
                  title={`Open ${formatWeekday(date)} ${formatDayNumber(date)}`}
                  onClick={() => {
                    setDay(startOfDay(date));
                    setView("day");
                  }}
                >
                  <span>{today ? "TODAY" : formatWeekday(date).toUpperCase()}</span>
                  <strong>{formatDayNumber(date)}</strong>
                </button>
                {dayLessons.length === 0 ? (
                  <span className="week-empty">No lessons</span>
                ) : (
                  <div className="week-lessons">
                    {dayLessons.map((lesson) => (
                      <WeekLesson key={lesson.id} lesson={lesson} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : lessons.length === 0 ? (
        <div className="timetable-empty">
          <Icon name="calendar" size={38} />
          <strong>Nothing scheduled</strong>
          <span>No lessons or events for this day.</span>
        </div>
      ) : (
        <div className="lesson-list">
          {lessons.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              schoolCode={dashboard.user.schoolCode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WeekLesson({ lesson }: { lesson: DiaryItem }) {
  const { title } = lessonHeading(lesson);
  const status = attendanceStatusForLesson(lesson);
  const attendance = attendanceLabel(status);
  const tint = attendanceTint(status);

  return (
    <article className="week-lesson" style={{ borderLeftColor: classTint(lesson.title) }}>
      <span className="week-lesson-time">
        {formatTime(parseDaymapDate(lesson.start))} – {formatTime(parseDaymapDate(lesson.finish))}
      </span>
      <strong className="week-lesson-title">{title}</strong>
      <LessonMeta lesson={lesson} />
      {attendance && (
        <span className="week-attendance" style={{ color: tint }}>
          {attendance.toUpperCase()}
        </span>
      )}
    </article>
  );
}

function LessonRow({ lesson, schoolCode }: { lesson: DiaryItem; schoolCode?: string | null }) {
  const { title } = lessonHeading(lesson);
  const status = attendanceStatusForLesson(lesson);
  const attendance = attendanceLabel(status);
  const tint = attendanceTint(status);
  const links = extractLinks(lesson.text);

  return (
    <article className="lesson-row">
      <div className="lesson-times">
        <strong>{formatTime(parseDaymapDate(lesson.start))}</strong>
        <span>{formatTime(parseDaymapDate(lesson.finish))}</span>
      </div>
      <span className="lesson-row-stripe" style={{ background: classTint(lesson.title) }} />
      <div className="lesson-body">
        <div className="lesson-title-line">
          <strong>{title}</strong>
          {attendance && (
            <span
              className="attendance-pill"
              style={{ color: tint, background: `${tint}1c` }}
            >
              {attendance.toUpperCase()}
            </span>
          )}
        </div>
        <LessonMeta lesson={lesson} />
        {lesson.calendar && !/^class lessons$/i.test(lesson.calendar.trim()) && (
          <span className="lesson-calendar">{lesson.calendar}</span>
        )}
        {attendance && lesson.attendanceReason?.trim() && (
          <span className="lesson-reason" style={{ color: tint }}>
            <Icon name="info" size={12} />
            {lesson.attendanceReason}
          </span>
        )}
        {links.length > 0 && (
          <div className="lesson-links">
            {links.slice(0, 3).map((link) => (
              <button
                key={`${link.href}-${link.title}`}
                type="button"
                className="link-chip"
                onClick={() => void openExternal(absoluteDaymapUrl(schoolCode, link.href))}
              >
                <Icon name="link" size={12} />
                <span>{link.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
