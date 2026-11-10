use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

const DOWNLOAD_EVENT: &str = "update-download-progress";
const ALLOWED_ASSET_PREFIX: &str = "/Ushio-Kasana/daymap-Client/releases/download/";

#[derive(Clone, Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    url: String,
    file_name: String,
    expected_digest: Option<String>,
) -> Result<String, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "The update link is invalid.".to_string())?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("github.com")
        || !parsed.path().starts_with(ALLOWED_ASSET_PREFIX)
    {
        return Err("This update did not come from the Daymap GitHub release.".to_string());
    }

    let safe_name = Path::new(&file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The update has an invalid file name.".to_string())?
        .to_string();

    let directory = app
        .path()
        .download_dir()
        .map_err(|_| "Couldn't find your Downloads folder.".to_string())?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| format!("Couldn't access your Downloads folder: {error}"))?;

    let path = directory.join(&safe_name);
    let temporary = directory.join(format!(".{safe_name}.part"));
    let _ = tokio::fs::remove_file(&temporary).await;

    if let Err(error) = download_to_path(&app, parsed, &temporary, expected_digest.as_deref()).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error);
    }

    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|error| format!("Couldn't replace the old download: {error}"))?;
    }
    tokio::fs::rename(&temporary, &path)
        .await
        .map_err(|error| format!("Couldn't finish saving the update: {error}"))?;

    let size = tokio::fs::metadata(&path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let _ = app.emit(
        DOWNLOAD_EVENT,
        DownloadProgress {
            downloaded: size,
            total: Some(size),
        },
    );

    Ok(path.to_string_lossy().to_string())
}

async fn download_to_path(
    app: &AppHandle,
    url: url::Url,
    path: &Path,
    expected_digest: Option<&str>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15 * 60))
        .user_agent(format!("DaymapTauri/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Couldn't prepare the update download: {error}"))?;

    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Couldn't download the update: {error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub refused the update download: {error}"))?;

    let total = response.content_length().filter(|size| *size > 0);
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|error| format!("Couldn't create the update file: {error}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;

    let _ = app.emit(DOWNLOAD_EVENT, DownloadProgress { downloaded, total });

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("The update download stopped: {error}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Couldn't save the update: {error}"))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        let _ = app.emit(DOWNLOAD_EVENT, DownloadProgress { downloaded, total });
    }

    file.flush()
        .await
        .map_err(|error| format!("Couldn't finish saving the update: {error}"))?;
    drop(file);

    if downloaded == 0 {
        return Err("The update download was empty.".to_string());
    }

    if let Some(expected) = expected_digest
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let expected = expected
            .strip_prefix("sha256:")
            .or_else(|| expected.strip_prefix("SHA256:"))
            .unwrap_or(expected);
        let actual = format!("{:x}", hasher.finalize());
        if !expected.eq_ignore_ascii_case(&actual) {
            return Err("The update download didn't match GitHub's checksum.".to_string());
        }
    }

    Ok(())
}

#[tauri::command]
pub fn open_update_installer(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("The downloaded update could not be found.".to_string());
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(
        extension.as_str(),
        "dmg" | "exe" | "msi" | "appimage" | "deb" | "rpm"
    ) {
        return Err("The downloaded file is not a supported installer.".to_string());
    }

    open::that_detached(&path).map_err(|error| format!("Couldn't open the installer: {error}"))
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
