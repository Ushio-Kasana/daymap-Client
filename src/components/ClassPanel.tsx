import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { errorText, invoke } from "../api";
import {
  classTint,
  formatDueLabel,
  formatShortDate,
  isoDate,
  normalizeClassLabel,
  parseDaymapDate,
  stripHtml,
  taskIsComplete,
  taskShortStatus,
  updatedLabel,
} from "../dates";
import { Icon } from "../icons";
import type {
  AssessmentTask,
  AssignmentFile,
  ClassAttendance,
  ClassFile,
  ClassNote,
  ClassOverview,
  ClassTarget,
  OverdueSettings,
} from "../types";

interface ClassPanelProps {
  target: ClassTarget;
  tasks: AssessmentTask[];
  overdueSettings: OverdueSettings;
  onClose: () => void;
}

export function ClassPanel({
  target,
  tasks,
  overdueSettings,
  onClose,
}: ClassPanelProps) {
  const [overview, setOverview] = useState<ClassOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<ClassOverview>("load_class_overview", {
        eventId: target.eventId ?? null,
        className: target.className ?? null,
        classCode: target.classCode ?? null,
      });
      setOverview(data);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [target.classCode, target.className, target.eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const classTasks = useMemo(() => {
    if (!overview) return [];
    const labels = [overview.name, overview.code]
      .map(normalizeClassLabel)
      .filter(Boolean);
    return tasks
      .filter((task) =>
        [task.className, task.classCode]
          .map(normalizeClassLabel)
          .some((label) => label && labels.includes(label)),
      )
      .sort(
        (left, right) =>
          (parseDaymapDate(left.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (parseDaymapDate(right.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER),
      );
  }, [overview, tasks]);

  const name = overview?.name ?? target.className ?? "Class";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card class-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-modal-title"
      >
        <div className="modal-head class-modal-head">
          <div className="class-modal-title">
            <span
              className="class-modal-stripe"
              style={{ background: classTint(name) }}
            />
            <div>
              <h2 id="class-modal-title">{name}</h2>
              <p>
                {[overview?.code, overview?.subject]
                  .filter((value) => Boolean(value && value.trim()))
                  .join(" · ") || "Class overview"}
              </p>
            </div>
          </div>
          {overview?.attendance.percentage != null && (
            <AttendanceStat attendance={overview.attendance} />
          )}
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close class"
            title="Close"
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="class-modal-body">
          {loading && !overview && (
            <div className="class-loading" role="status" aria-live="polite">
              <span className="spinner" />
              <span>Obtaining the class from Daymap…</span>
            </div>
          )}

          {error && !overview && (
            <div className="notice-line error">
              <Icon name="warning" size={14} />
              <span>{error}</span>
              <button type="button" className="link-button" onClick={() => void load()}>
                Retry
              </button>
            </div>
          )}

          {overview && (
            <>
              <div className="class-facts">
                <ClassFact label="Class code" value={overview.code} />
                <ClassFact label="Subject" value={overview.subject} />
                <ClassFact label="Teacher" value={overview.teachers} />
                <ClassFact label="Room" value={overview.room} />
              </div>

              {overview.offline && (
                <p className="class-offline">
                  <Icon name="warning" size={12} />
                  <span>Offline · {updatedLabel(overview.fetchedAt)}</span>
                </p>
              )}

              <ClassNotes notes={overview.notes} files={overview.files} />

              <section className="class-section">
                <h4>TASKS</h4>
                {classTasks.length === 0 ? (
                  <p className="class-empty">No assessment tasks for this class.</p>
                ) : (
                  <div className="class-task-list">
                    {classTasks.map((task) => (
                      <div className="class-task-row" key={task.id}>
                        <span className="class-task-copy">
                          <strong>{task.name}</strong>
                          <small>
                            {task.type ? `${task.type} · ` : ""}
                            Due {formatDueLabel(parseDaymapDate(task.dueDate))}
                          </small>
                        </span>
                        <span
                          className={
                            taskIsComplete(task) ? "class-task-status done" : "class-task-status"
                          }
                        >
                          {taskShortStatus(task, overdueSettings)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AttendanceStat({ attendance }: { attendance: ClassAttendance }) {
  const percentage = attendance.percentage ?? 0;
  const tint = percentage >= 90 ? "#219c66" : percentage >= 75 ? "#eb8c21" : "#d94047";
  const detail = [`${attendance.attended} of ${attendance.marked} lessons attended`];
  if (attendance.absent > 0) detail.push(`${attendance.absent} absent`);
  if (attendance.excused > 0) detail.push(`${attendance.excused} excused`);
  return (
    <div className="class-attendance" title={detail.join(" · ")}>
      <strong style={{ color: tint }}>{percentage}%</strong>
      <small>attendance</small>
    </div>
  );
}

function ClassNotes({ notes, files }: { notes: ClassNote[]; files: ClassFile[] }) {
  // The newest note is the one the class opens on: it starts expanded, so its
  // text and the files uploaded with it are visible without a click.
  const latest = notes[0] ?? null;
  const [open, setOpen] = useState<number | null>(latest?.noteId ?? null);
  const [bodies, setBodies] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showOther, setShowOther] = useState(false);
  const requested = useRef<Set<number>>(new Set());
  const today = isoDate(new Date());

  const loadBody = useCallback(async (note: ClassNote) => {
    if (requested.current.has(note.noteId)) return;
    requested.current.add(note.noteId);
    setBusyId(note.noteId);
    try {
      const html = await invoke<string>("load_class_note", { noteId: note.noteId });
      setBodies((current) => ({
        ...current,
        [note.noteId]: stripHtml(html, 4000) || "This class note is empty.",
      }));
    } catch (cause) {
      requested.current.delete(note.noteId);
      setErrors((current) => ({ ...current, [note.noteId]: errorText(cause) }));
    } finally {
      setBusyId(null);
    }
  }, []);

  useEffect(() => {
    if (latest) void loadBody(latest);
  }, [latest, loadBody]);

  const toggle = (note: ClassNote) => {
    if (open === note.noteId) {
      setOpen(null);
      return;
    }
    setOpen(note.noteId);
    void loadBody(note);
  };

  const noteCard = (note: ClassNote) => {
    const expanded = open === note.noteId;
    const isToday = note.date === today;
    const date = parseDaymapDate(note.date);
    const lessonFiles = files.filter((entry) => entry.eventId === note.eventId);
    const meta = [
      isToday ? null : date ? formatShortDate(date) : null,
      note.period || null,
      note.category || null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div
        className={`class-note-card ${expanded ? "open" : ""}`}
        key={`${note.noteId}-${note.eventId}`}
      >
        <button
          type="button"
          className="class-note-head"
          onClick={() => void toggle(note)}
          aria-expanded={expanded}
        >
          <span className="class-note-copy">
            <strong>{note.title}</strong>
            {meta && <small>{meta}</small>}
          </span>
          {lessonFiles.length > 0 && (
            <span className="class-note-files-count">
              {lessonFiles.length} file{lessonFiles.length === 1 ? "" : "s"}
            </span>
          )}
          <Icon name={expanded ? "left" : "right"} size={14} />
        </button>
        {expanded ? (
          <>
            <div className="class-note-body">
              {busyId === note.noteId ? (
                <span className="class-note-loading">
                  <span className="spinner" />
                  Loading note…
                </span>
              ) : errors[note.noteId] ? (
                <span className="danger-text">{errors[note.noteId]}</span>
              ) : (
                <p>{bodies[note.noteId] ?? note.preview ?? ""}</p>
              )}
            </div>
            {lessonFiles.length > 0 && (
              <div className="class-note-files">
                <ClassFileList files={lessonFiles} />
              </div>
            )}
          </>
        ) : (
          isToday &&
          note.preview && <p className="class-note-preview">{note.preview}</p>
        )}
      </div>
    );
  };

  // Older notes keep their own files, and files from a lesson without a note
  // collect at the end of the same list.
  const otherNotes = notes.slice(1);
  const notedEvents = new Set(notes.map((note) => note.eventId));
  const otherFiles = files.filter((entry) => !notedEvents.has(entry.eventId));
  const otherCount = otherNotes.length + otherFiles.length;

  return (
    <section className="class-section">
      <h4>CLASS NOTES</h4>
      {!latest && otherCount === 0 && (
        <p className="class-empty">
          No class notes or files for this class in the last few weeks.
        </p>
      )}
      {latest && noteCard(latest)}
      {latest && otherCount > 0 && (
        <button
          type="button"
          className="class-notes-toggle"
          onClick={() => setShowOther((current) => !current)}
          aria-expanded={showOther}
        >
          {showOther
            ? "Hide other notes and files"
            : `Other notes and files (${otherCount})`}
        </button>
      )}
      {(showOther || !latest) && (
        <>
          {otherNotes.length > 0 && (
            <div className="class-note-list">{otherNotes.map(noteCard)}</div>
          )}
          {otherFiles.length > 0 && (
            <div className="class-other-files">
              <span className="class-file-label">OTHER FILES</span>
              <ClassFileList files={otherFiles} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ClassFileList({ files }: { files: ClassFile[] }) {
  const [downloading, setDownloading] = useState<number | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (file: AssignmentFile) => {
    if (file.id == null) return;
    setError(null);
    setSaved(null);
    try {
      const destination = await saveDialog({ defaultPath: file.name, title: "Save file" });
      if (!destination) return;
      setDownloading(file.id);
      await invoke("download_assignment_file", { fileId: file.id, destination });
      setSaved(file.name);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <div className="class-file-list">
        {files.map((entry) => {
          const file = entry.file;
          const date = parseDaymapDate(entry.date);
          const meta = [date ? formatShortDate(date) : null, entry.period || null]
            .filter(Boolean)
            .join(" · ");
          const busy = downloading != null && downloading === file.id;
          return (
            <div
              className="class-file-row"
              key={`${entry.eventId}-${file.id ?? file.name}`}
            >
              <span className="class-file-copy">
                <strong>{file.name}</strong>
                {meta && <small>{meta}</small>}
              </span>
              {file.id != null ? (
                <button
                  type="button"
                  className="link-button class-file-action"
                  onClick={() => void download(file)}
                  disabled={busy}
                >
                  {busy ? "Saving…" : "Download"}
                </button>
              ) : file.externalUrl ? (
                <button
                  type="button"
                  className="link-button class-file-action"
                  onClick={() =>
                    void invoke("open_external", { url: file.externalUrl ?? "" })
                  }
                >
                  Open
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {saved && <p className="class-file-note">Saved {saved}</p>}
      {error && <p className="class-file-note danger-text">{error}</p>}
    </>
  );
}

function ClassFact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="class-fact">
      <span>{label}</span>
      <strong>{value?.trim() || "—"}</strong>
    </div>
  );
}
