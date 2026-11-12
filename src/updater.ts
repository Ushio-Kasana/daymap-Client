import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import packageInfo from "../package.json";
import { errorText, invoke, isTauri, listen, openExternal } from "./api";

const RELEASE_API =
  "https://api.github.com/repos/Ushio-Kasana/daymap-Client/releases/latest";
const RELEASES_PAGE =
  "https://github.com/Ushio-Kasana/daymap-Client/releases/latest";

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size?: number;
  digest?: string | null;
}

interface GitHubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string | null;
  published_at?: string;
  assets?: GitHubAsset[];
}

interface DownloadProgressEvent {
  downloaded: number;
  total: number | null;
}

export type UpdatePlatform = "macos" | "windows" | "linux" | "other";
export type UpdateArch = "aarch64" | "x86_64" | "x86" | "other";

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  percent: number | null;
}

export interface AvailableUpdate {
  version: string;
  body?: string;
  date?: string;
  releaseUrl: string;
  downloadUrl: string;
  downloadLabel: string;
  downloadName?: string;
  downloadDigest?: string | null;
  platform: UpdatePlatform;
}

export interface UpdaterController {
  currentVersion: string;
  platform: UpdatePlatform;
  checking: boolean;
  checked: boolean;
  downloading: boolean;
  opening: boolean;
  progress: UpdateProgress | null;
  available: AvailableUpdate | null;
  error: string | null;
  dismissed: boolean;
  keychainNoticeOpen: boolean;
  checkForUpdates: (manual?: boolean) => Promise<void>;
  requestDownload: () => void;
  confirmDownload: () => Promise<void>;
  cancelKeychainNotice: () => void;
  dismiss: () => void;
}

function parseVersion(version: string): number[] {
  const core = version.trim().replace(/^v/i, "").split(/[-+]/, 1)[0];
  return core.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
}

export function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = parseVersion(latest);
  const currentParts = parseVersion(current);
  const length = Math.max(latestParts.length, currentParts.length);

  for (let index = 0; index < length; index += 1) {
    const latestPart = latestParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;
    if (latestPart !== currentPart) return latestPart > currentPart;
  }

  return false;
}

export function currentPlatform(): UpdatePlatform {
  if (typeof navigator === "undefined") return "other";
  const userAgent = navigator.userAgent;

  if (/Windows/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macos";
  if (/Linux|X11/i.test(userAgent)) return "linux";
  return "other";
}

/// The architecture Rust reported for this build, normalised to the names
/// used in the release asset list.
export function updateArch(value: string): UpdateArch {
  if (value === "aarch64" || value === "arm64") return "aarch64";
  if (value === "x86_64" || value === "x64" || value === "amd64") return "x86_64";
  if (value === "x86" || value === "i686" || value === "i386") return "x86";
  return "other";
}

/// Release assets carry the architecture in their name, for example
/// `Daymap_0.1.8_aarch64.dmg` or `Daymap_0.1.8_x64-setup.exe`.
export function assetArch(name: string): UpdateArch {
  const lowered = name.toLowerCase();
  if (lowered.includes("aarch64") || lowered.includes("arm64")) return "aarch64";
  if (lowered.includes("x86_64") || lowered.includes("x64") || lowered.includes("amd64")) {
    return "x86_64";
  }
  if (lowered.includes("i686") || lowered.includes("i386") || lowered.includes("ia32")) {
    return "x86";
  }
  if (lowered.includes("x86")) return "x86";
  return "other";
}

function platformExtensions(platform: UpdatePlatform): string[] {
  switch (platform) {
    case "windows":
      return [".exe", ".msi"];
    case "macos":
      return [".dmg"];
    case "linux":
      return [".appimage", ".deb", ".rpm"];
    default:
      return [];
  }
}

function pickInstaller(
  assets: GitHubAsset[],
  platform: UpdatePlatform,
  arch: UpdateArch,
): GitHubAsset | undefined {
  // A release now ships one installer per architecture. Keep the assets built
  // for this machine, plus any that don't name an architecture at all, and
  // never hand an Intel Mac a silicon DMG or vice versa.
  const candidates =
    arch === "other"
      ? assets
      : assets.filter((asset) => {
          const value = assetArch(asset.name);
          return value === arch || value === "other";
        });
  for (const extension of platformExtensions(platform)) {
    const asset = candidates.find((candidate) =>
      candidate.name.toLowerCase().endsWith(extension),
    );
    if (asset) return asset;
  }
  return undefined;
}

function downloadLabel(asset: GitHubAsset | undefined): string {
  if (!asset) return "Open release";
  const dot = asset.name.lastIndexOf(".");
  const extension = dot >= 0 ? asset.name.slice(dot).toLowerCase() : "";
  return extension ? `Download ${extension}` : "Download installer";
}

export function installHint(
  platform: UpdatePlatform,
  hasInstaller = true,
): string {
  if (!hasInstaller) {
    return "No matching installer was found. Open the release page and choose the file for your computer.";
  }

  switch (platform) {
    case "macos":
      return "Daymap opens the DMG and quits. If macOS asks for access to Downloads, choose Allow. Drag Daymap into Applications, replace the old copy, then reopen it.";
    case "windows":
      return "Daymap opens the installer and quits. Follow the setup prompts to replace the old version.";
    case "linux":
      return "Daymap opens the package and quits. Install it with your package manager, then reopen Daymap.";
    default:
      return "Open the installer, complete the installation, then reopen Daymap.";
  }
}

function updateFromRelease(
  release: GitHubRelease,
  arch: UpdateArch,
): AvailableUpdate | null {
  const tag = release.tag_name?.trim();
  if (!tag) return null;

  const version = tag.replace(/^v/i, "");
  const platform = currentPlatform();
  const installer = pickInstaller(release.assets ?? [], platform, arch);
  const releaseUrl = release.html_url || RELEASES_PAGE;

  return {
    version,
    body: release.body?.trim() || undefined,
    date: release.published_at,
    releaseUrl,
    downloadUrl: installer?.browser_download_url || releaseUrl,
    downloadLabel: downloadLabel(installer),
    downloadName: installer?.name,
    downloadDigest: installer?.digest ?? null,
    platform,
  };
}

export function useUpdater(): UpdaterController {
  const [currentVersion, setCurrentVersion] = useState(packageInfo.version);
  const [hostArch, setHostArch] = useState<UpdateArch>("other");
  const [archReady, setArchReady] = useState(!isTauri());
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [keychainNoticeOpen, setKeychainNoticeOpen] = useState(false);
  const checkingRef = useRef(false);
  const autoCheckedRef = useRef(false);
  const platform = currentPlatform();

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    void getVersion()
      .then((version) => {
        if (!disposed) setCurrentVersion(version);
      })
      .catch(() => {
        // Fall back to the version bundled into the frontend.
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    void invoke<string>("host_arch")
      .then((arch) => {
        if (!disposed) setHostArch(updateArch(arch));
      })
      .catch(() => {
        // Keep the unfiltered list rather than offering the wrong installer.
      })
      .finally(() => {
        if (!disposed) setArchReady(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const checkForUpdates = useCallback(
    async (manual = false) => {
      if (checkingRef.current || downloading || opening) return;
      checkingRef.current = true;
      setChecking(true);
      setError(null);
      if (manual) setDismissed(false);

      try {
        const response = await fetch(RELEASE_API, {
          headers: { Accept: "application/vnd.github+json" },
          cache: "no-store",
        });

        if (response.status === 404) {
          throw new Error("No published GitHub release was found.");
        }
        if (response.status === 403) {
          throw new Error("GitHub rate limit reached. Try again later.");
        }
        if (!response.ok) {
          throw new Error(`GitHub returned ${response.status}.`);
        }

        const release = (await response.json()) as GitHubRelease;
        const update = updateFromRelease(release, hostArch);

        if (!update) {
          throw new Error("GitHub did not return a release version.");
        }

        setAvailable(
          isNewerVersion(update.version, currentVersion) ? update : null,
        );
        setChecked(true);
      } catch (cause) {
        setError(errorText(cause));
        setChecked(true);
      } finally {
        checkingRef.current = false;
        setChecking(false);
      }
    },
    [currentVersion, downloading, hostArch, opening],
  );

  useEffect(() => {
    // Wait for the architecture so the first check picks the matching build.
    if (!archReady || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void checkForUpdates(false);
  }, [archReady, checkForUpdates]);

  const downloadUpdate = useCallback(async () => {
    if (!available || downloading || opening) return;

    setError(null);

    if (!isTauri() || !available.downloadName) {
      try {
        await openExternal(available.downloadUrl);
      } catch (cause) {
        setError(errorText(cause));
      }
      return;
    }

    setKeychainNoticeOpen(false);
    setDownloading(true);
    setProgress({ downloaded: 0, total: null, percent: null });
    let unlisten: (() => void) | undefined;

    try {
      unlisten = await listen<DownloadProgressEvent>(
        "update-download-progress",
        (event) => {
          const downloaded = Math.max(0, event.payload.downloaded || 0);
          const total =
            typeof event.payload.total === "number" && event.payload.total > 0
              ? event.payload.total
              : null;
          setProgress({
            downloaded,
            total,
            percent:
              total === null
                ? null
                : Math.min(100, Math.round((downloaded / total) * 100)),
          });
        },
      );

      const path = await invoke<string>("download_update", {
        url: available.downloadUrl,
        fileName: available.downloadName,
        expectedDigest: available.downloadDigest ?? null,
      });

      setProgress((current) => ({
        downloaded: current?.downloaded ?? 0,
        total: current?.total ?? null,
        percent: 100,
      }));
      setDownloading(false);
      setOpening(true);

      await invoke("open_update_installer", { path });
      await new Promise((resolve) => setTimeout(resolve, 1600));
      await invoke("quit_app");
    } catch (cause) {
      setDownloading(false);
      setOpening(false);
      setProgress(null);
      setError(errorText(cause));
    } finally {
      unlisten?.();
    }
  }, [available, downloading, opening]);

  const requestDownload = useCallback(() => {
    if (platform === "macos" && isTauri() && available?.downloadName) {
      setKeychainNoticeOpen(true);
      return;
    }
    void downloadUpdate();
  }, [available, downloadUpdate, platform]);

  const confirmDownload = useCallback(async () => {
    setKeychainNoticeOpen(false);
    await downloadUpdate();
  }, [downloadUpdate]);

  const cancelKeychainNotice = useCallback(() => setKeychainNoticeOpen(false), []);

  const dismiss = useCallback(() => {
    setKeychainNoticeOpen(false);
    setDismissed(true);
  }, []);

  return {
    currentVersion,
    platform,
    checking,
    checked,
    downloading,
    opening,
    progress,
    available,
    error,
    dismissed,
    keychainNoticeOpen,
    checkForUpdates,
    requestDownload,
    confirmDownload,
    cancelKeychainNotice,
    dismiss,
  };
}
