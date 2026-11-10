import { useCallback, useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { Login } from "./components/Login";
import { errorText, invoke, isTauri, listen, openExternal } from "./api";
import { createDemoDashboard } from "./demo";
import type { Dashboard, DaymapUser, Section } from "./types";

export default function App() {
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [user, setUser] = useState<DaymapUser | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [refreshMinutes, setRefreshMinutes] = useState(() => {
    const saved = Number(localStorage.getItem("daymap.refreshMinutes") ?? "5");
    return [0, 1, 5, 15, 30].includes(saved) ? saved : 5;
  });

  useEffect(() => {
    if (!isTauri()) {
      const sample = createDemoDashboard();
      setUser(sample.user);
      setDashboard(sample);
      setDemo(true);
      setBooting(false);
      return;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const setup = async () => {
      try {
        const stopSuccess = await listen<DaymapUser>("auth-success", (event) => {
          if (disposed) return;
          setUser(event.payload);
          setDashboard(null);
          setDemo(false);
          setSigningIn(false);
          setAuthStatus(null);
          setAuthError(null);
          setBootError(null);
          setError(null);
          setBooting(false);
        });
        const stopError = await listen<string>("auth-error", (event) => {
          if (disposed) return;
          setAuthError(event.payload);
          setAuthStatus(null);
          setSigningIn(false);
        });
        if (disposed) {
          stopSuccess();
          stopError();
          return;
        }
        unlisteners.push(stopSuccess, stopError);

        const restored = await invoke<DaymapUser | null>("restore_session");
        if (disposed) return;
        if (restored) setUser(restored);
        setBooting(false);
      } catch (cause) {
        if (disposed) return;
        setBootError(errorText(cause));
        setBooting(false);
      }
    };

    void setup();
    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!isTauri() || demo) return;
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<Dashboard>("load_dashboard");
      setDashboard(data);
      if (!data.offline) {
        // Keep a complete mailbox and student/parent index for offline use.
        void invoke("sync_mailbox").catch(() => {});
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [demo]);

  // Paint the saved dashboard first, then let the refresh replace it with
  // current data so signing in doesn't sit on a blank screen.
  useEffect(() => {
    if (!user || demo || dashboard || !isTauri()) return;
    let cancelled = false;
    void invoke<Dashboard | null>("load_cached_dashboard")
      .then((cached) => {
        if (cancelled || !cached) return;
        setDashboard((current) => current ?? cached);
      })
      .catch(() => {
        // A missing cache is normal on a first run.
      });
    return () => {
      cancelled = true;
    };
  }, [user, demo, dashboard]);

  useEffect(() => {
    if (!user || demo) return;
    void refresh();
  }, [user, demo, refresh]);

  useEffect(() => {
    if (!user || demo || refreshMinutes <= 0) return;
    const timer = window.setInterval(() => void refresh(), refreshMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [user, demo, refresh, refreshMinutes]);

  const markMessageRead = useCallback((messageId: number) => {
    setDashboard((current) => {
      if (!current) return current;
      let changed = false;
      const messages = current.messages.map((message) => {
        if (message.id !== messageId || message.read) return message;
        changed = true;
        return { ...message, read: true };
      });
      return changed ? { ...current, messages } : current;
    });
  }, []);

  const changeRefreshMinutes = useCallback((minutes: number) => {
    setRefreshMinutes(minutes);
    localStorage.setItem("daymap.refreshMinutes", String(minutes));
  }, []);

  const signIn = async (school: string) => {
    if (!isTauri()) return;
    setSigningIn(true);
    setAuthError(null);
    setBootError(null);
    setAuthStatus("Opening your school's Daymap sign-in…");
    try {
      await invoke("begin_sign_in", { school });
      await invoke("open_auth_window");
      setAuthStatus("Complete sign-in in the Daymap window.");
    } catch (cause) {
      setAuthError(errorText(cause));
      setAuthStatus(null);
      setSigningIn(false);
    }
  };

  const cancelSignIn = () => {
    if (isTauri()) void invoke("cancel_sign_in");
    setSigningIn(false);
    setAuthStatus(null);
  };

  const signOut = async () => {
    if (isTauri()) {
      try {
        await invoke("sign_out");
      } catch {
        // Local state still needs to be cleared if the keychain is unavailable.
      }
    }
    setUser(null);
    setDashboard(null);
    setDemo(false);
    setError(null);
    setAuthError(null);
    setAuthStatus(null);
    setSection("overview");
  };

  const startPreview = () => {
    const sample = createDemoDashboard();
    setUser(sample.user);
    setDashboard(sample);
    setDemo(true);
    setError(null);
    setBootError(null);
    setAuthError(null);
    setAuthStatus(null);
    setSigningIn(false);
    setSection("overview");
  };

  const exitPreview = () => {
    setDemo(false);
    setUser(null);
    setDashboard(null);
    setError(null);
    setSection("overview");
  };

  const openDaymap = () => {
    const code = (user?.schoolCode ?? "").toLowerCase();
    if (!code) return;
    void openExternal(`https://${code}.daymap.net/daymap/`);
  };

  if (booting) {
    return <BootScreen />;
  }

  if (!user) {
    return (
      <Login
        isDesktop={isTauri()}
        busy={signingIn}
        status={authStatus}
        error={authError ?? bootError}
        onSignIn={signIn}
        onCancel={cancelSignIn}
        onPreview={startPreview}
      />
    );
  }

  return (
    <AppShell
      user={user}
      dashboard={dashboard}
      section={section}
      onSection={setSection}
      loading={loading}
      error={error}
      demo={demo}
      onRefresh={() => void refresh()}
      onOpenDaymap={openDaymap}
      onSignOut={demo ? exitPreview : () => void signOut()}
      onMarkMessageRead={markMessageRead}
      refreshMinutes={refreshMinutes}
      onRefreshMinutesChange={changeRefreshMinutes}
    />
  );
}

function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="brand-mark large">
        <span className="brand-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="boot-copy">
        <strong>Daymap</strong>
        <span>Checking your session…</span>
      </div>
      <span className="spinner" />
    </div>
  );
}
