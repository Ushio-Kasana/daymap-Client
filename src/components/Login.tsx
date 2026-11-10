import { useState, type FormEvent } from "react";
import { Icon, type IconName } from "../icons";

interface LoginProps {
  isDesktop: boolean;
  busy: boolean;
  status: string | null;
  error: string | null;
  onSignIn: (school: string) => void;
  onCancel: () => void;
  onPreview: () => void;
}

export function Login({
  isDesktop,
  busy,
  status,
  error,
  onSignIn,
  onCancel,
  onPreview,
}: LoginProps) {
  const [school, setSchool] = useState(
    () => localStorage.getItem("daymap.lastSchool") ?? "",
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isDesktop || busy) return;
    localStorage.setItem("daymap.lastSchool", school.trim().toLowerCase());
    onSignIn(school);
  };

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="hero-orb hero-orb-one" />
        <div className="hero-orb hero-orb-two" />
        <div className="hero-content">
          <div className="brand-lockup">
            <div className="brand-mark">
              <span className="brand-bars" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
            <span>Daymap</span>
          </div>

          <div className="hero-title-block">
            <h1>School, without the tab hunting.</h1>
            <p>
              A fast desktop client for your school&apos;s Daymap. Everything that matters, in one
              window.
            </p>
          </div>

          <div className="hero-features">
            <Feature icon="tasks" title="Assessment tasks" detail="Due dates, status and marks at a glance." />
            <Feature icon="timetable" title="Your timetable" detail="Today's lessons, rooms and attendance." />
            <Feature icon="notices" title="Notices" detail="School updates without the extra clicks." />
            <Feature icon="school" title="Windows, macOS and Linux" detail="One codebase, native system webviews." />
          </div>

          <div className="hero-footer">
            <Icon name="lock" size={13} />
            <span>Unofficial client · Your password stays on your school&apos;s login page.</span>
          </div>
        </div>
      </section>

      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className="login-heading">
            <h2>Sign in</h2>
            <p>Connect to your school&apos;s Daymap.</p>
          </div>

          <form onSubmit={submit}>
            <label className="field-label" htmlFor="school-code">
              School code
            </label>
            <div className={`school-field ${!isDesktop ? "disabled" : ""}`}>
              <span>daymap.net/</span>
              <input
                id="school-code"
                autoFocus={isDesktop}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={school}
                disabled={!isDesktop || busy}
                onChange={(event) => setSchool(event.target.value)}
                placeholder="school"
              />
            </div>
            <p className="field-help">
              Your school&apos;s Daymap address — for example <code>school</code> for school.daymap.net.
            </p>

            <button className="primary-button" type="submit" disabled={!isDesktop || busy}>
              {busy ? <span className="spinner light" /> : <Icon name="right" size={17} />}
              <span>{busy ? "Connecting…" : "Continue with Daymap"}</span>
            </button>
          </form>

          {!isDesktop && (
            <div className="inline-note">
              <Icon name="info" size={14} />
              <span>Browser preview: sign-in is only available in the desktop build.</span>
            </div>
          )}

          {status && (
            <div className="status-line">
              <span className="spinner" />
              <span>{status}</span>
              <button type="button" className="link-button" onClick={onCancel}>
                Cancel
              </button>
            </div>
          )}

          {error && (
            <div className="error-banner compact" role="alert">
              <Icon name="warning" size={15} />
              <span>{error}</span>
            </div>
          )}

          <div className="divider-label">
            <span />
            <small>or</small>
            <span />
          </div>

          <button className="preview-button" type="button" onClick={onPreview}>
            <Icon name="sparkles" size={16} />
            <span>Preview with sample data</span>
            <Icon name="right" size={15} className="preview-chevron" />
          </button>

          <p className="login-privacy">
            Sign-in opens your school&apos;s own Daymap/EdPass page. This app never sees your
            password. Session tokens are stored in your operating system&apos;s keychain.
          </p>
        </div>
      </section>
    </div>
  );
}

function Feature({
  icon,
  title,
  detail,
}: {
  icon: IconName;
  title: string;
  detail: string;
}) {
  return (
    <div className="hero-feature">
      <span className="feature-icon">
        <Icon name={icon} size={15} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}
