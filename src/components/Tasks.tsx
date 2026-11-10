import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { errorText, invoke, isTauri, openExternal } from "../api";
import {
  formatDueLabel,
  formatFullStamp,
  parseDaymapDate,
  sameDay,
  startOfDay,
  addDays,
  classTint,
  taskIsComplete,
  taskIsOverdue,
  taskShortStatus,
} from "../dates";
import { Icon } from "../icons";
import type { AssessmentTask, AssignmentBundle, AssignmentFile, Dashboard } from "../types";

type TaskFilter = "upcoming" | "overdue" | "completed" | "all";

const FILTERS: Array<{ id: TaskFilter; label: string }> = [
  { id: "upcoming", label: "Upcoming" },
  { id: "overdue", label: "Overdue" },
  { id: "completed", label: "Completed" },
  { id: "all", label: "All" },
];

interface TaskGroup {
  id: string;
  title: string;
  tasks: AssessmentTask[];
}

export function Tasks({ dashboard }: { dashboard: Dashboard }) {
  const [filter, setFilter] = useState<TaskFilter>("upcoming");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const filtered = useMemo(
    () => filterTasks(dashboard.tasks, filter, query),
    [dashboard.tasks, filter, query],
  );
  const groups = useMemo(() => groupTasks(filtered, filter), [filtered, filter]);

  useEffect(() => {
    if (selectedId !== null && filtered.some((task) => task.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selectedId]);

  const selected = dashboard.tasks.find((task) => task.id === selectedId) ?? null;

  return (
    <div className="tasks-layout">
      <section className="task-list-panel">
        <div className="task-controls">
          <div className="segmented" role="tablist" aria-label="Task filter">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={`segment ${filter === item.id ? "active" : ""}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="search-field">
            <Icon name="search" size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks, classes or teachers"
              aria-label="Search tasks"
            />
            {query && (
              <button
                type="button"
                className="clear-search"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <Icon name="close" size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="task-list-scroll">
          {filtered.length === 0 ? (
            <div className="empty-state small">
              <Icon name="tasks" size={30} />
              <strong>{filter === "completed" ? "Nothing completed yet" : "No tasks here"}</strong>
              <span>
                {filter === "completed"
                  ? "Submitted and graded tasks will appear here."
                  : "Tasks from Daymap will appear here after a refresh."}
              </span>
            </div>
          ) : (
            groups.map((group) => (
              <div className="task-group" key={group.id}>
                <h4>{group.title}</h4>
                {group.tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`task-list-row ${selectedId === task.id ? "selected" : ""}`}
                    onClick={() => setSelectedId(task.id)}
                  >
                    <span className="task-list-stripe" style={{ background: classTint(task.className) }} />
                    <span className="task-list-copy">
                      <strong>{task.name}</strong>
                      <small>
                        {task.className || "Assessment"}
                        {task.type ? ` · ${task.type}` : ""}
                      </small>
                    </span>
                    <span className="task-list-due">
                      <span className={taskIsOverdue(task) ? "danger-text" : ""}>
                        {formatDueLabel(parseDaymapDate(task.dueDate))}
                      </span>
                      {taskIsComplete(task) ? (
                        <span className="completed-mark">
                          <Icon name="tasks" size={12} />
                        </span>
                      ) : taskIsOverdue(task) ? (
                        <small className="danger-text">Overdue</small>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="task-detail-panel">
        {selected ? (
          <TaskDetail task={selected} schoolCode={dashboard.user.schoolCode} />
        ) : (
          <div className="empty-state">
            <Icon name="book" size={38} />
            <strong>Select a task</strong>
            <span>Choose an assessment task to see its class, teacher, due date and status.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function TaskDetail({ task, schoolCode }: { task: AssessmentTask; schoolCode?: string | null }) {
  const overdue = taskIsOverdue(task);
  const complete = taskIsComplete(task);
  const statusTint = overdue ? "var(--danger)" : complete ? "var(--success)" : "var(--accent)";
  const code = (schoolCode ?? "").toLowerCase();
  const daymapUrl = code
    ? `https://${code}.daymap.net/daymap/student/assignment.aspx?d=1&TaskID=${task.id}`
    : "";

  const desktop = isTauri();
  const [assignment, setAssignment] = useState<AssignmentBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!desktop) return;
    setLoading(true);
    setLoadError(null);
    try {
      const bundle = await invoke<AssignmentBundle>("load_assignment", { taskId: task.id });
      setAssignment(bundle);
    } catch (cause) {
      setLoadError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [desktop, task.id]);

  useEffect(() => {
    setAssignment(null);
    setActionError(null);
    setActionMessage(null);
    void load();
  }, [load]);

  const upload = async () => {
    setActionError(null);
    setActionMessage(null);
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: "Choose a file to upload",
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;
      setUploading(true);
      await invoke("upload_assignment_file", { taskId: task.id, path });
      await load();
      setActionMessage(`Uploaded ${path.split(/[\\/]/).pop() ?? "file"}`);
    } catch (cause) {
      setActionError(errorText(cause));
    } finally {
      setUploading(false);
    }
  };

  const download = async (file: AssignmentFile) => {
    if (file.externalUrl) {
      void openExternal(file.externalUrl);
      return;
    }
    if (file.id == null) return;
    setActionError(null);
    setActionMessage(null);
    try {
      const destination = await saveDialog({ defaultPath: file.name, title: "Save file" });
      if (!destination) return;
      setDownloadingId(file.id);
      await invoke("download_assignment_file", { fileId: file.id, destination });
      setActionMessage(`Saved ${file.name}`);
    } catch (cause) {
      setActionError(errorText(cause));
    } finally {
      setDownloadingId(null);
    }
  };

  const description = plainText(assignment?.detail.description);

  return (
    <div className="task-detail">
      <div className="detail-badges">
        {task.className && (
          <span className="pill outline" style={{ color: classTint(task.className) }}>
            {task.className.toUpperCase()}
          </span>
        )}
        {task.type && <span className="pill outline muted">{task.type.toUpperCase()}</span>}
      </div>

      <h2>{task.name}</h2>

      <div className="status-box" style={{ borderColor: `${statusTint}55`, background: `${statusTint}14` }}>
        <Icon name={overdue ? "warning" : complete ? "tasks" : "clock"} size={16} />
        <span style={{ color: statusTint }}>{taskShortStatus(task)}</span>
        {task.maxMark != null && task.maxMark > 0 && task.graded && (
          <small>{Math.round(task.maxMark)} marks</small>
        )}
      </div>

      <div className="detail-grid">
        <DetailRow label="Due" value={formatDueLabel(parseDaymapDate(task.dueDate))} danger={overdue} />
        <DetailRow
          label="Set date"
          value={task.setDate ? formatDueLabel(parseDaymapDate(task.setDate)) : "—"}
        />
        <DetailRow label="Class" value={task.className || "—"} />
        <DetailRow label="Teacher" value={task.teacherName || "—"} />
        {(task.workReceived || assignment?.workReceived) && (
          <DetailRow
            label="Work received"
            value={formatFullStamp(
              parseDaymapDate(task.workReceived ?? assignment?.workReceived ?? null),
            )}
          />
        )}
      </div>

      {task.status && (
        <div className="daymap-status">
          <h4>DAYMAP STATUS</h4>
          <p>{task.status}</p>
        </div>
      )}

      {desktop && loading && assignment === null && (
        <div className="detail-card assignment-loading">
          <span className="spinner" />
          <span>Loading assignment…</span>
        </div>
      )}

      {loadError && (
        <div className="notice-line error">
          <Icon name="warning" size={13} />
          <span>{loadError}</span>
        </div>
      )}

      {description && (
        <section className="detail-card assignment-body">
          <h4>DESCRIPTION</h4>
          <p>{description}</p>
        </section>
      )}

      {assignment && assignment.resources.length > 0 && (
        <FileCard
          title="RESOURCES"
          files={assignment.resources}
          busyId={downloadingId}
          onAction={(file) => void download(file)}
        />
      )}

      {assignment && (
        <section className="detail-card">
          <header className="file-card-head">
            <h4>YOUR WORK</h4>
            {assignment.detail.studentCanUpload && desktop && (
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => void upload()}
                disabled={uploading}
              >
                <Icon name="external" size={12} />
                <span>{uploading ? "Uploading…" : "Upload"}</span>
              </button>
            )}
          </header>
          {assignment.work.length === 0 ? (
            <p className="assignment-empty">No work uploaded</p>
          ) : (
            <FileList files={assignment.work} busyId={downloadingId} onAction={(file) => void download(file)} />
          )}
        </section>
      )}

      {actionError && (
        <div className="notice-line error">
          <Icon name="warning" size={13} />
          <span>{actionError}</span>
        </div>
      )}
      {actionMessage && (
        <div className="notice-line success">
          <Icon name="tasks" size={13} />
          <span>{actionMessage}</span>
        </div>
      )}

      <div className="detail-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={!daymapUrl}
          onClick={() => void openExternal(daymapUrl)}
        >
          <Icon name="external" size={15} />
          <span>Open in Daymap</span>
        </button>
      </div>
    </div>
  );
}

function FileCard({
  title,
  files,
  busyId,
  onAction,
}: {
  title: string;
  files: AssignmentFile[];
  busyId: number | null;
  onAction: (file: AssignmentFile) => void;
}) {
  return (
    <section className="detail-card">
      <header className="file-card-head">
        <h4>{title}</h4>
      </header>
      <FileList files={files} busyId={busyId} onAction={onAction} />
    </section>
  );
}

function FileList({
  files,
  busyId,
  onAction,
}: {
  files: AssignmentFile[];
  busyId: number | null;
  onAction: (file: AssignmentFile) => void;
}) {
  return (
    <div className="file-list">
      {files.map((file, index) => (
        <div className="file-row" key={`${file.id ?? file.name}-${index}`}>
          <span className="file-icon">
            <Icon name="book" size={14} />
          </span>
          <span className="file-copy">
            <span className="file-name">{file.name}</span>
            {file.description ? (
              <small className="file-meta">{plainText(file.description)}</small>
            ) : file.modified ? (
              <small className="file-meta">
                Modified {formatFullStamp(parseDaymapDate(file.modified))}
              </small>
            ) : null}
          </span>
          <button
            type="button"
            className="secondary-button compact"
            disabled={busyId === file.id}
            onClick={() => onAction(file)}
          >
            {file.externalUrl ? "Open" : busyId === file.id ? "Saving…" : "Download"}
          </button>
        </div>
      ))}
    </div>
  );
}

function DetailRow({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong className={danger ? "danger-text" : ""}>{value}</strong>
    </div>
  );
}

function plainText(value?: string | null): string {
  if (!value) return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function filterTasks(tasks: AssessmentTask[], filter: TaskFilter, query: string): AssessmentTask[] {
  let base: AssessmentTask[];
  switch (filter) {
    case "upcoming":
      base = tasks.filter((task) => !taskIsComplete(task) && !taskIsOverdue(task));
      break;
    case "overdue":
      base = tasks.filter(taskIsOverdue);
      break;
    case "completed":
      base = tasks.filter(taskIsComplete);
      break;
    default:
      base = tasks;
  }

  const term = query.trim().toLowerCase();
  if (!term) return base;
  return base.filter((task) =>
    [task.name, task.className, task.teacherName]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(term)),
  );
}

function groupTasks(tasks: AssessmentTask[], filter: TaskFilter): TaskGroup[] {
  if (filter === "completed") {
    const sorted = [...tasks].sort(
      (left, right) =>
        (parseDaymapDate(right.dueDate)?.getTime() ?? 0) -
        (parseDaymapDate(left.dueDate)?.getTime() ?? 0),
    );
    return sorted.length ? [{ id: "done", title: "Completed", tasks: sorted }] : [];
  }

  const overdue: AssessmentTask[] = [];
  const today: AssessmentTask[] = [];
  const tomorrow: AssessmentTask[] = [];
  const week: AssessmentTask[] = [];
  const later: AssessmentTask[] = [];
  const none: AssessmentTask[] = [];
  const now = new Date();
  const weekEnd = addDays(startOfDay(now), 7);

  for (const task of tasks) {
    if (taskIsOverdue(task)) {
      overdue.push(task);
      continue;
    }
    const due = parseDaymapDate(task.dueDate);
    if (!due) {
      none.push(task);
    } else if (sameDay(due, now)) {
      today.push(task);
    } else if (sameDay(due, addDays(now, 1))) {
      tomorrow.push(task);
    } else if (due < weekEnd) {
      week.push(task);
    } else {
      later.push(task);
    }
  }

  const buckets: Array<[string, AssessmentTask[]]> = [
    ["Overdue", overdue],
    ["Today", today],
    ["Tomorrow", tomorrow],
    ["This week", week],
    ["Later", later],
    ["No due date", none],
  ];

  return buckets
    .filter(([, values]) => values.length > 0)
    .map(([title, values]) => ({
      id: title,
      title,
      tasks: [...values].sort(
        (left, right) =>
          (parseDaymapDate(left.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (parseDaymapDate(right.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER),
      ),
    }));
}
