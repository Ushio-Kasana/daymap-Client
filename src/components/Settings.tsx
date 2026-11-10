import { useEffect, useState } from "react";
import { errorText, invoke, isTauri } from "../api";
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
  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [touchIdEnabled, setTouchIdEnabled] = useState(true);
  const [touchIdBusy, setTouchIdBusy] = useState(false);
  const [touchIdError, setTouchIdError] = useState<string | null>(null);
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
  const showTouchId = updater.platform === "macos" && isTauri() && !demo;

  useEffect(() => {
    if (!showTouchId) return;
    let cancelled = false;
    void invoke<boolean>("touch_id_enabled")
      .then((enabled) => {
        if (!cancelled) setTouchIdEnabled(enabled);
      })
      .catch((cause) => {
        if (!cancelled) setTouchIdError(errorText(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [showTouchId]);

  const toggleTouchId = async () => {
    if (touchIdBusy) return;
    const next = !touchIdEnabled;
    setTouchIdEnabled(next);
    setTouchIdBusy(true);
    setTouchIdError(null);
    try {
      await invoke("set_touch_id_enabled", { enabled: next });
    } catch (cause) {
      setTouchIdEnabled(!next);
      setTouchIdError(errorText(cause));
    } finally {
      setTouchIdBusy(false);
    }
  };

  const clearCache = async () => {
    setClearingCache(true);
    setCacheError(null);
    setCacheNotice(null);
    try {
      await invoke("reset_cache");
      setCacheNotice("Offline data cleared.");
    } catch (cause) {
      setCacheError(errorText(cause));
    } finally {
      setClearingCache(false);
      setConfirmClearCache(false);
    }
  };

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

      {showTouchId && (
        <section className="settings-card">
          <div className="settings-card-title">
            <span>Unlock</span>
          </div>
          <p className="settings-copy">
            Choose whether reopening Daymap asks for your fingerprint, when available, before
            restoring the saved session. This is on by default.
          </p>
          <div className="settings-row">
            <div>
              <strong>Require Touch ID</strong>
              <span>
                {touchIdEnabled
                  ? "Daymap asks for Touch ID, or your Mac password as a fallback, when reopening."
                  : "Daymap opens your saved session without the fingerprint prompt."}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={touchIdEnabled}
              aria-label="Require Touch ID"
              className={`touch-id-switch ${touchIdEnabled ? "on" : ""}`}
              onClick={() => void toggleTouchId()}
              disabled={touchIdBusy}
            >
              <span />
            </button>
          </div>
          {touchIdError && (
            <p className="settings-update-error" role="alert">
              {touchIdError}
            </p>
          )}
          <div className="settings-note">
            <Icon name="info" size={13} />
            <span>
              This is an app unlock, not extra keychain encryption. Your saved Daymap tokens
              stay in the macOS keychain.
            </span>
          </div>
        </section>
      )}

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
          <span>Offline data</span>
        </div>
        <p className="settings-copy">
          Daymap keeps your last dashboard, messages, assignment details and timetable weeks on
          this computer so they open without a connection. Sign-in tokens are stored separately
          in the operating system keychain and are not affected.
        </p>
        <div className="settings-row">
          <div>
            <strong>Saved offline data</strong>
            <span>Clear the saved copy if it looks out of date.</span>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setConfirmClearCache(true)}
            disabled={clearingCache || demo}
          >
            <Icon name="archive" size={14} />
            <span>{clearingCache ? "Clearing…" : "Clear offline data"}</span>
          </button>
        </div>
        {cacheNotice && (
          <p className="settings-update-status">
            <Icon name="check" size={13} />
            <span>{cacheNotice}</span>
          </p>
        )}
        {cacheError && (
          <p className="settings-update-error" role="alert">
            {cacheError}
          </p>
        )}
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

      {confirmClearCache && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmClearCache(false);
          }}
        >
          <div className="modal-card confirm-modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <h2>Clear offline data?</h2>
                <p>
                  Saved dashboard, messages, assignment details and timetable weeks will be
                  removed from this computer. Your Daymap account and sign-in are not affected.
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <span />
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setConfirmClearCache(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => void clearCache()}
                >
                  Clear cache
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
