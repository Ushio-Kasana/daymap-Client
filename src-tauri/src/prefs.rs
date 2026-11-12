//! Local cache preferences. Both switches default to on, so the app keeps its
//! previous behaviour until one is turned off in Settings.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "cache-settings.json";

fn enabled() -> bool {
    true
}

fn disabled() -> bool {
    false
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSettings {
    /// Dashboard, timetable weeks, assignments, class overviews and notes,
    /// message folders and messages.
    #[serde(default = "enabled")]
    pub content: bool,
    /// Staff and student names kept for recipient search. Off by default, so a
    /// search asks Daymap unless the user opts in. Parent names are never kept.
    #[serde(default = "disabled")]
    pub contacts: bool,
}

impl Default for CacheSettings {
    fn default() -> Self {
        Self {
            content: true,
            contacts: false,
        }
    }
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join(SETTINGS_FILE))
}

pub fn load(app: &AppHandle) -> CacheSettings {
    let Some(path) = settings_path(app) else {
        return CacheSettings::default();
    };
    let Ok(data) = fs::read_to_string(path) else {
        return CacheSettings::default();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: CacheSettings) -> Result<(), String> {
    let path = settings_path(app)
        .ok_or_else(|| "Couldn't find Daymap's settings folder.".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Couldn't save the cache settings: {error}"))?;
    }
    let data = serde_json::to_vec_pretty(&settings)
        .map_err(|_| "Couldn't encode the cache settings.".to_string())?;
    fs::write(path, data).map_err(|error| format!("Couldn't save the cache settings: {error}"))
}

pub fn content_enabled(app: &AppHandle) -> bool {
    load(app).content
}

pub fn contacts_enabled(app: &AppHandle) -> bool {
    load(app).contacts
}

/// The architecture this build is running on, so the update check can offer the
/// installer built for it when a release ships several. The handle is unused: a
/// zero-argument command was compiled but its name was dropped from the release
/// binary, so keep the parameter or the update check stops finding it.
#[tauri::command]
pub fn host_arch(_app: AppHandle) -> String {
    std::env::consts::ARCH.to_string()
}

#[tauri::command]
pub fn load_cache_settings(app: AppHandle) -> CacheSettings {
    load(&app)
}

#[tauri::command]
pub fn save_cache_settings(app: AppHandle, settings: CacheSettings) -> Result<(), String> {
    save(&app, settings)?;
    // Remove what was just switched off, so "off" means gone from this
    // computer rather than merely unused. A failure here doesn't undo the
    // setting: the filter in `cache` still refuses to read or rewrite it.
    let _ = crate::cache::apply_cache_settings(&app);
    Ok(())
}