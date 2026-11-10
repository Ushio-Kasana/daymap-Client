import { useCallback, useEffect, useState } from "react";
import type { Dashboard, DaymapUser, OverdueSettings, Section } from "../types";
import { errorText, invoke } from "../api";
import {
  displayName,
  initials,
  schoolLabel,
  taskIsOverdue,
  updatedLabel,
} from "../dates";
import { Icon, type IconName } from "../icons";
import { installHint, useUpdater, type UpdaterController } from "../updater";
import { Tasks } from "./Tasks";
import { Timetable } from "./Timetable";
import { Overview } from "./Overview";
import { Messages } from "./Messages";
import { Notices } from "./Notices";
import { Settings } from "./Settings";

interface AppShellProps {
  user: DaymapUser;
  dashboard: Dashboard | null;
  section: Section;
  onSection: (section: Section) => void;
  loading: boolean;
  error: string | null;
  demo: boolean;
  onRefresh: () => void;
  onOpenDaymap: () => void;
  onSignOut: () => void;
  onMarkMessageRead: (messageId: number) => void;
  refreshMinutes: number;
  onRefreshMinutesChange: (minutes: number) => void;
}

const NAV: Array<{ id: Section; label: string; icon: IconName }> = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "tasks", label: "Tasks", icon: "tasks" },
  { id: "messages", label: "Messages", icon: "messages" },
  { id: "notices", label: "Notices", icon: "notices" },
  { id: "timetable", label: "Timetable", icon: "timetable" },
];

const TITLES: Record<Section, string> = {
  overview: "Overview",
  tasks: "Tasks",
  messages: "Messages",
  notices: "Notices",
  timetable: "Timetable",
  settings: "Settings",
};

export function AppShell({
  user,
  dashboard,
  section,
  onSection,
  loading,
  error,
  demo,
  onRefresh,
  onOpenDaymap,
  onSignOut,
  onMarkMessageRead,
  refreshMinutes,
  onRefreshMinutesChange,
}: AppShellProps) {
  const [overdueSettings, setOverdueSettings] = useState<OverdueSettings>({
    mutedClasses: [],
    notOverdueTaskIds: [],
  });
  const [overdueSettingsError, setOverdueSettingsError] = useState<string | null>(null);

  useEffect(() => {
    if (demo) {
      setOverdueSettings({ mutedClasses: [], notOverdueTaskIds: [] });
      setOverdueSettingsError(null);
      return;
    }
    let cancelled = false;
    void invoke<OverdueSettings>("load_overdue_settings")
      .then((settings) => {
        if (cancelled) return;
        setOverdueSettings(settings);
        setOverdueSettingsError(null);
      })
      .catch((cause) => {
        if (!cancelled) setOverdueSettingsError(errorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [demo]);

  const changeOverdueSettings = useCallback(
    (settings: OverdueSettings) => {
      setOverdueSettings(settings);
      setOverdueSettingsError(null);
      if (demo) return;
      void invoke("save_overdue_settings", { settings }).catch((cause) => {
        setOverdueSettingsError(errorText(cause));
      });
    },
    [demo],
  );

  const overdue =
    dashboard?.tasks.filter((task) => taskIsOverdue(task, overdueSettings)).length ?? 0;
  const unread = dashboard?.messages.filter((message) => !message.read).length ?? 0;
  const flush = section === "messages" || section === "notices";
  const updater = useUpdater();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="account-block">
          <div className="avatar">{initials(user)}</div>
          <div className="account-copy">
            <strong title={displayName(user)}>{displayName(user)}</strong>
            <span title={schoolLabel(user)}>{schoolLabel(user)}</span>
          </div>
          {demo && <span className="demo-pill">DEMO</span>}
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {NAV.map((item) => {
            const badge =
              item.id === "tasks" ? overdue : item.id === "messages" ? unread : 0;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-row ${section === item.id ? "active" : ""}`}
                onClick={() => onSection(item.id)}
                aria-current={section === item.id ? "page" : undefined}
              >
                <Icon name={item.icon} size={19} />
                <span>{item.label}</span>
                {badge > 0 && (
                  <b className={`badge ${item.id === "tasks" ? "red" : "blue"}`}>
                    {badge}
                  </b>
                )}
              </button>
            );
          })}
        </nav>

        <div className="nav-settings">
          <button
            type="button"
            className={`nav-row ${section === "settings" ? "active" : ""}`}
            onClick={() => onSection("settings")}
            aria-current={section === "settings" ? "page" : undefined}
          >
            <Icon name="settings" size={19} />
            <span>Settings</span>
          </button>
        </div>

        <div className="sidebar-spacer" />

        <div className="sidebar-footer">
          <div className="update-copy">
            <span>
              {demo
                ? "Preview mode"
                : dashboard?.offline
                  ? `Offline · saved ${updatedLabel(dashboard.fetchedAt)}`
                  : updatedLabel(dashboard?.fetchedAt)}
            </span>
            {error && !demo && <small title={error}>{error}</small>}
          </div>
          <button
            type="button"
            className="icon-button"
            title="Refresh"
            aria-label="Refresh dashboard"
            onClick={onRefresh}
            disabled={loading || demo}
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>

        <button type="button" className="signout-button" onClick={onSignOut}>
          <Icon name={demo ? "sparkles" : "logout"} size={15} />
          <span>{demo ? "Exit preview" : "Sign out"}</span>
        </button>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <h1>{TITLES[section]}</h1>
          <div className="topbar-actions">
            {demo && <span className="sample-pill">SAMPLE DATA</span>}
            {loading && <span className="spinner" title="Refreshing" />}
            <button
              type="button"
              className="icon-button"
              onClick={onRefresh}
              disabled={loading || demo}
              title="Refresh"
              aria-label="Refresh"
            >
              <Icon name="refresh" size={17} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onOpenDaymap}
              title="Open Daymap in your browser"
              aria-label="Open Daymap in your browser"
            >
              <Icon name="external" size={17} />
            </button>
          </div>
        </header>

        {updater.available && !updater.dismissed && <UpdateBanner updater={updater} />}

        {loading && dashboard && !demo && (
          <div className="obtaining-bar" role="status" aria-live="polite">
            <span className="spinner" />
            <span>Obtaining the latest from Daymap…</span>
          </div>
        )}

        <main className={`page-scroll ${flush ? "flush" : ""}`}>
          {error && (
            <div className="error-banner" role="alert">
              <Icon name="warning" size={16} />
              <span>{error}</span>
              <button type="button" className="link-button" onClick={onRefresh}>
                Retry
              </button>
            </div>
          )}

          {!dashboard ? (
            <LoadingPanel />
          ) : section === "overview" ? (
            <Overview
              dashboard={dashboard}
              goTo={onSection}
              obtaining={loading}
              overdueSettings={overdueSettings}
            />
          ) : section === "tasks" ? (
            <Tasks
              dashboard={dashboard}
              obtaining={loading}
              overdueSettings={overdueSettings}
              onOverdueSettingsChange={changeOverdueSettings}
            />
          ) : section === "messages" ? (
            <Messages
              dashboard={dashboard}
              demo={demo}
              obtaining={loading}
              onMarkRead={onMarkMessageRead}
              onRefresh={onRefresh}
            />
          ) : section === "notices" ? (
            <Notices dashboard={dashboard} demo={demo} obtaining={loading} />
          ) : section === "timetable" ? (
            <Timetable dashboard={dashboard} demo={demo} />
          ) : (
            <Settings
              user={user}
              demo={demo}
              refreshMinutes={refreshMinutes}
              onRefreshMinutesChange={onRefreshMinutesChange}
              onOpenDaymap={onOpenDaymap}
              onSignOut={onSignOut}
              updater={updater}
              tasks={dashboard?.tasks ?? []}
              overdueSettings={overdueSettings}
              onOverdueSettingsChange={changeOverdueSettings}
              overdueSettingsError={overdueSettingsError}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function UpdateBanner({ updater }: { updater: UpdaterController }) {
  const update = updater.available;
  if (!update || updater.dismissed) return null;

  const active = updater.downloading || updater.opening;
  const percent = updater.progress?.percent ?? null;
  const actionLabel = updater.opening
    ? "Opening installer…"
    : updater.downloading
      ? percent === null
        ? "Downloading…"
        : `Downloading ${percent}%`
      : update.downloadLabel;
  const help = installHint(updater.platform, Boolean(update.downloadName));

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="update-banner-icon">
        <Icon name="download" size={16} />
      </span>
      <div className="update-banner-copy">
        <strong>Daymap {update.version} is available</strong>
        {updater.error ? (
          <span className="update-banner-error">{updater.error}</span>
        ) : (
          <>
            <span>
              {updater.opening
                ? "Opening the installer and quitting Daymap."
                : updater.downloading
                  ? "Downloading the installer to your Downloads folder."
                  : "Download the installer here."}
            </span>
            <span className="update-banner-help">{help}</span>
          </>
        )}
        {active && percent !== null && (
          <div
            className="update-progress"
            role="progressbar"
            aria-label="Update download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      <div className="update-banner-actions">
        <button
          type="button"
          className="primary-button update-install-button"
          onClick={() => void updater.downloadUpdate()}
          disabled={active}
        >
          {actionLabel}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={updater.dismiss}
          disabled={active}
          aria-label="Dismiss update"
          title="Dismiss update"
        >
          <Icon name="close" size={15} />
        </button>
      </div>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="loading-panel">
      <span className="spinner large" />
      <strong>Loading your Daymap…</strong>
      <span>Tasks, lessons, messages and notices are on their way.</span>
    </div>
  );
}
