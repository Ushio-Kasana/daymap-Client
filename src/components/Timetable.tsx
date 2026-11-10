import { useMemo, useState } from "react";
import { openExternal } from "../api";
import {
  absoluteDaymapUrl,
  attendanceLabel,
  attendanceTint,
  classTint,
  extractLinks,
  formatDayNumber,
  formatTime,
  formatWeekday,
  lessonOnDay,
  parseDaymapDate,
  sameDay,
  startOfDay,
  weekFromToday,
} from "../dates";
import { Icon } from "../icons";
import type { Dashboard, DiaryItem } from "../types";

export function Timetable({ dashboard }: { dashboard: Dashboard }) {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const days = weekFromToday();
  const lessons = useMemo(
    () =>
      dashboard.diary
        .filter((lesson) => lessonOnDay(lesson, day))
        .sort(
          (left, right) =>
            (parseDaymapDate(left.start)?.getTime() ?? 0) -
            (parseDaymapDate(right.start)?.getTime() ?? 0),
        ),
    [dashboard.diary, day],
  );

  return (
    <div className="timetable">
      <div className="day-strip">
        <div className="day-chips">
          {days.map((date) => {
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
        <button
          type="button"
          className="today-link"
          onClick={() => setDay(startOfDay(new Date()))}
        >
          <Icon name="refresh" size={14} />
          <span>Today</span>
        </button>
      </div>

      <div className="timetable-divider" />

      {lessons.length === 0 ? (
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

function LessonRow({ lesson, schoolCode }: { lesson: DiaryItem; schoolCode?: string | null }) {
  const attendance = attendanceLabel(lesson.attendanceStatus);
  const tint = attendanceTint(lesson.attendanceStatus);
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
          <strong>{lesson.title}</strong>
          {attendance && (
            <span
              className="attendance-pill"
              style={{ color: tint, background: `${tint}1c` }}
            >
              {attendance.toUpperCase()}
            </span>
          )}
        </div>
        {lesson.calendar && <span className="lesson-calendar">{lesson.calendar}</span>}
        {lesson.attendanceReason?.trim() && (
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
