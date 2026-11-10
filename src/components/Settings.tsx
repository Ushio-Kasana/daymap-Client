import { useState } from "react";
import { displayName, initials, schoolLabel } from "../dates";
import { Icon } from "../icons";
import type { DaymapUser } from "../types";
import { installHint, type UpdaterController } from "../updater";

interface SettingsProps {
  user: DaymapUser;
  demo: boolean;
  refreshMinutes: number;
  onRefreshMinutesChange: (minutes: number) => void;
  onOpenDaymap: () => void;
  onSignOut: () => void;
  updater: UpdaterController;
}

export function Settings({
  user,
  demo,
  refreshMinutes,
  onRefreshMinutesChange,
  onOpenDaymap,
  onSignOut,
  updater,
}: SettingsProps) {
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const available = updater.available;
  const active = updater.downloading || updater.opening;
  const percent = updater.progress?.percent ?? null;
  const actionLabel = updater.opening
    ? "Opening installer…"
    : updater.downloading
      ? percent === null
        ? "Downloading…"
        : `Downloading ${percent}%`
      : available?.downloadLabel ?? "Download update";
  const installHelp = available
    ? installHint(updater.platform, Boolean(available.downloadName))
    : installHint(updater.platform);

  return (
    <div className="settings-page">
      <section className="settings-card profile-card">
        <div className="settings-profile-row">
          <div className="avatar settings-avatar">{initials(user)}</div>
          <div className="settings-profile-copy">
            <h2>{displayName(user)}</h2>
            <span>{user.username || "Signed in with Daymap"}</span>
          </div>
          {demo ? (
            <span className="pill sample">SAMPLE DATA</span>
          ) : (
            <span className="pill signed-in">SIGNED IN</span>
          )}
        </div>

        <div className="settings-divider" />

        <div className="profile-grid">
          <div>
            <span>School</span>
            <strong>{demo ? "Sample School" : schoolLabel(user)}</strong>
          </div>
          <div>
            <span>School code</span>
            <strong>{(user.schoolCode || "—").toUpperCase()}</strong>
          </div>
          <div>
            <span>Student ID</span>
            <strong>{user.daymapID ?? "—"}</strong>
          </div>
          <div>
            <span>Role</span>
            <strong>Student</strong>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <span>Refresh</span>
        </div>
        <p className="settings-copy">
          Daymap checks for new tasks, messages and notices while the app is open.
        </p>
        <div className="settings-row">
          <div>
            <strong>Dashboard refresh</strong>
            <span>Choose how often the dashboard refreshes.</span>
          </div>
          <select
            className="settings-select"
            value={refreshMinutes}
            onChange={(event) => onRefreshMinutesChange(Number(event.target.value))}
            aria-label="Refresh interval"
          >
            <option value={1}>Every minute</option>
            <option value={5}>Every 5 minutes</option>
            <option value={15}>Every 15 minutes</option>
            <option value={30}>Every 30 minutes</option>
            <option value={0}>Manually</option>
          </select>
        </div>
        <div className="settings-note">
          <Icon name="info" size={13} />
          <span>Refresh only runs while Daymap is open. You can also refresh from the top bar.</span>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <span>Updates</span>
          <span>GITHUB RELEASES</span>
        </div>
        <div className="settings-row settings-update-row">
          <div>
            <strong>Daymap {updater.currentVersion}</strong>
            <span>Checks the latest GitHub release when Daymap starts.</span>
          </div>
          <button
            type="button"
            className="secondary-button settings-update-button"
            onClick={() => void updater.checkForUpdates(true)}
            disabled={updater.checking || active}
          >
            {updater.checking ? (
              <span className="spinner" />
            ) : (
              <Icon name="refresh" size={14} />
            )}
            <span>{updater.checking ? "Checking…" : "Check for updates"}</span>
          </button>
        </div>

        {available && (
          <div className="settings-update-available">
            <div className="settings-update-heading">
              <div>
                <strong>Version {available.version} is available</strong>
                <span>
                  {updater.downloading
                    ? "Downloading to your Downloads folder."
                    : updater.opening
                      ? "Opening the installer. Daymap will quit."
                      : "Download and open the installer from here."}
                </span>
              </div>
              <button
                type="button"
                className="primary-button update-install-button"
                onClick={() => void updater.downloadUpdate()}
                disabled={active}
              >
                {active ? (
                  <span className="spinner light" />
                ) : (
                  <Icon name="download" size={13} />
                )}
                <span>{actionLabel}</span>
              </button>
            </div>
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
            <div className="settings-update-help">{installHelp}</div>
            {available.body && (
              <div className="settings-update-notes">{available.body}</div>
            )}
          </div>
        )}

        {!updater.available && updater.checked && !updater.checking && !updater.error && (
          <p className="settings-update-status">
            <Icon name="check" size={13} />
            <span>You&apos;re on the latest version.</span>
          </p>
        )}

        {updater.error && (
          <p className="settings-update-error" role="alert">
            {updater.error}
          </p>
        )}

        <div className="settings-note">
          <Icon name="info" size={13} />
          <span>
            {available ? "Your data stays in place." : installHelp}
          </span>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <span>Session</span>
        </div>
        <div className="session-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onOpenDaymap}
            disabled={!user.schoolCode}
          >
            <Icon name="external" size={14} />
            <span>Open Daymap in browser</span>
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => setConfirmSignOut(true)}
          >
            <Icon name={demo ? "sparkles" : "logout"} size={14} />
            <span>{demo ? "Exit sample data" : "Sign Out"}</span>
          </button>
        </div>
        <p className="settings-copy muted">
          Sign-in tokens are kept in the operating system keychain. Your password is never
          stored by this app.
        </p>
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <span>About</span>
        </div>
        <strong className="about-title">Daymap for Desktop {updater.currentVersion}</strong>
        <p className="settings-copy">
          An unofficial native client that talks to your school&apos;s own Daymap service. It
          is not affiliated with Daymap or your school. Everything you see comes from the
          account you sign in with.
        </p>
      </section>

      {confirmSignOut && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmSignOut(false);
          }}
        >
          <div className="modal-card confirm-modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <h2>{demo ? "Exit sample data?" : "Sign out of Daymap?"}</h2>
                <p>
                  {demo
                    ? "This will close the sample dashboard."
                    : "Your saved Daymap session will be removed from this computer."}
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <span />
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setConfirmSignOut(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    setConfirmSignOut(false);
                    onSignOut();
                  }}
                >
                  {demo ? "Exit preview" : "Sign Out"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
