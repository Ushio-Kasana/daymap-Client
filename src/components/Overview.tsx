import type { ReactNode } from "react";
import type { AssessmentTask, Dashboard, DiaryItem, DaymapMessage, Section } from "../types";
import {
  attendanceLabel,
  attendanceTint,
  classTint,
  displayName,
  dueWithinWeek,
  formatDueLabel,
  formatHeaderDate,
  formatRelativeShort,
  formatTime,
  greeting,
  lessonOnDay,
  parseDaymapDate,
  sortTasksByDue,
  stripHtml,
  taskIsComplete,
  taskIsOverdue,
} from "../dates";
import { Icon, type IconName } from "../icons";

interface OverviewProps {
  dashboard: Dashboard;
  goTo: (section: Section) => void;
  obtaining: boolean;
}

export function Overview({ dashboard, goTo, obtaining }: OverviewProps) {
  const today = new Date();
  const upcoming = sortTasksByDue(
    dashboard.tasks.filter((task) => !taskIsComplete(task) && !taskIsOverdue(task)),
  );
  const overdue = dashboard.tasks.filter(taskIsOverdue);
  const dueSoon = dashboard.tasks.filter((task) => dueWithinWeek(task));
  const unread = dashboard.messages.filter((message) => !message.read);
  const todayLessons = dashboard.diary
    .filter((lesson) => lessonOnDay(lesson, today))
    .sort(
      (left, right) =>
        (parseDaymapDate(left.start)?.getTime() ?? 0) -
        (parseDaymapDate(right.start)?.getTime() ?? 0),
    );
  const firstName = dashboard.user.firstname?.trim() || displayName(dashboard.user).split(" ")[0];

  return (
    <div className="overview">
      <div className="page-heading">
        <div>
          <h2>
            {greeting()}, {firstName}
          </h2>
          <p>{formatHeaderDate(today)}</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          title="Due soon"
          value={dueSoon.length}
          detail="next 7 days"
          icon="clock"
          tint="#2e66de"
        />
        <StatCard
          title="Overdue"
          value={overdue.length}
          detail="need attention"
          icon="warning"
          tint="#d94047"
        />
        <StatCard
          title="Unread"
          value={unread.length}
          detail="messages"
          icon="messages"
          tint="#eb8c21"
        />
        <StatCard
          title="Notices"
          value={dashboard.notices.length}
          detail="school updates"
          icon="notices"
          tint="#7b55d9"
        />
      </div>

      <div className="overview-columns">
        <Card title="Up next" actionLabel="View all" onAction={() => goTo("tasks")}>
          {obtaining && upcoming.length === 0 ? (
            <p className="empty-copy">Obtaining tasks…</p>
          ) : upcoming.length === 0 ? (
            <p className="empty-copy">
              {overdue.length === 0
                ? "No upcoming tasks. Enjoy the break."
                : `Nothing due next — ${overdue.length} ${
                    overdue.length === 1 ? "task is" : "tasks are"
                  } overdue.`}
            </p>
          ) : (
            <div className="compact-list">
              {upcoming.slice(0, 4).map((task) => (
                <CompactTask key={task.id} task={task} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Today" actionLabel="Timetable" onAction={() => goTo("timetable")}>
          {obtaining && todayLessons.length === 0 ? (
            <p className="empty-copy">Obtaining lessons…</p>
          ) : todayLessons.length === 0 ? (
            <p className="empty-copy">No lessons scheduled today.</p>
          ) : (
            <div className="lesson-compact-list">
              {todayLessons.slice(0, 5).map((lesson) => (
                <CompactLesson key={lesson.id} lesson={lesson} />
              ))}
              {todayLessons.length > 5 && (
                <p className="empty-copy small">
                  + {todayLessons.length - 5} more{" "}
                  {todayLessons.length - 5 === 1 ? "lesson" : "lessons"}
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card title="Latest messages" actionLabel="Inbox" onAction={() => goTo("messages")}>
        {obtaining && dashboard.messages.length === 0 ? (
          <p className="empty-copy">Obtaining messages…</p>
        ) : dashboard.messages.length === 0 ? (
          <p className="empty-copy">No messages yet.</p>
        ) : (
          <div className="message-list">
            {dashboard.messages.slice(0, 3).map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  detail,
  icon,
  tint,
}: {
  title: string;
  value: number;
  detail: string;
  icon: IconName;
  tint: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ color: tint, background: `${tint}1c` }}>
        <Icon name={icon} size={20} />
      </div>
      <strong>{value}</strong>
      <span className="stat-title">{title}</span>
      <small>{detail}</small>
    </div>
  );
}

function Card({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-heading">
        <h3>{title}</h3>
        {actionLabel && onAction && (
          <button type="button" className="card-action" onClick={onAction}>
            {actionLabel}
            <Icon name="right" size={12} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function CompactTask({ task }: { task: AssessmentTask }) {
  return (
    <div className="task-compact">
      <span className="task-dot" style={{ background: classTint(task.className) }} />
      <div className="task-compact-copy">
        <strong>{task.name}</strong>
        <small>{task.className || "Assessment"}</small>
      </div>
      <span className={`task-time ${task.overdue ? "danger" : ""}`}>
        {formatDueLabel(parseDaymapDate(task.dueDate))}
      </span>
    </div>
  );
}

function CompactLesson({ lesson }: { lesson: DiaryItem }) {
  const attendance = attendanceLabel(lesson.attendanceStatus);
  return (
    <div className="lesson-compact">
      <div className="lesson-compact-top">
        <span className="lesson-stripe" style={{ background: classTint(lesson.title) }} />
        <strong>{lesson.title}</strong>
        {attendance && (
          <span
            className="attendance-pill"
            style={{
              color: attendanceTint(lesson.attendanceStatus),
              background: `${attendanceTint(lesson.attendanceStatus)}1c`,
            }}
          >
            {attendance.toUpperCase()}
          </span>
        )}
      </div>
      <span className="lesson-time-line">
        {formatTime(parseDaymapDate(lesson.start))} – {formatTime(parseDaymapDate(lesson.finish))}
      </span>
    </div>
  );
}

function MessageRow({ message }: { message: DaymapMessage }) {
  return (
    <div className="message-row">
      <span className={`unread-dot ${message.read ? "read" : ""}`} />
      <div className="message-copy">
        <div className="message-meta">
          <span>{message.senderName || "Daymap"}</span>
          <span>
            {message.hasAttachments && <Icon name="link" size={12} />}
            {formatRelativeShort(parseDaymapDate(message.sentOn))}
          </span>
        </div>
        <strong>{message.subject}</strong>
        <p>{stripHtml(message.text, 150) || "No preview available."}</p>
      </div>
    </div>
  );
}
