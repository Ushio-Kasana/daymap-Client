import { useState } from "react";
import { displayName, initials, schoolLabel } from "../dates";
import { Icon } from "../icons";
import type { DaymapUser } from "../types";

interface SettingsProps {
  user: DaymapUser;
  demo: boolean;
  refreshMinutes: number;
  onRefreshMinutesChange: (minutes: number) => void;
  onOpenDaymap: () => void;
  onSignOut: () => void;
}

export function Settings({
  user,
  demo,
  refreshMinutes,
  onRefreshMinutesChange,
  onOpenDaymap,
  onSignOut,
}: SettingsProps) {
  const [confirmSignOut, setConfirmSignOut] = useState(false);

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
          <span>Updates</span>
        </div>
        <p className="settings-copy">
          Daymap checks for new tasks, messages and notices while the app is open.
        </p>
        <div className="settings-row">
          <div>
            <strong>Check for updates</strong>
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
        <strong className="about-title">Daymap for Desktop 0.1.0</strong>
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
