use crate::auth::{current_user, AppState};
use crate::cache;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

const SETTINGS_FILE: &str = "overdue-settings.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverdueSettings {
    #[serde(default)]
    pub muted_classes: Vec<String>,
    #[serde(default)]
    pub not_overdue_task_ids: Vec<i64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredOverdueSettings {
    #[serde(default)]
    accounts: HashMap<String, OverdueSettings>,
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join(SETTINGS_FILE))
}

fn sanitize(settings: OverdueSettings) -> OverdueSettings {
    let mut seen_classes = HashSet::new();
    let muted_classes = settings
        .muted_classes
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| seen_classes.insert(value.to_lowercase()))
        .take(200)
        .collect();

    let mut seen_tasks = HashSet::new();
    let not_overdue_task_ids = settings
        .not_overdue_task_ids
        .into_iter()
        .filter(|value| seen_tasks.insert(*value))
        .take(1_000)
        .collect();

    OverdueSettings {
        muted_classes,
        not_overdue_task_ids,
    }
}

fn read_settings(app: &AppHandle) -> StoredOverdueSettings {
    let Some(path) = settings_path(app) else {
        return StoredOverdueSettings::default();
    };
    let Ok(data) = fs::read_to_string(path) else {
        return StoredOverdueSettings::default();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

#[tauri::command]
pub fn load_overdue_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<OverdueSettings, String> {
    let Some(user) = current_user(&state) else {
        return Ok(OverdueSettings::default());
    };
    let key = cache::user_key(&user);
    let stored = read_settings(&app);
    Ok(stored
        .accounts
        .get(&key)
        .cloned()
        .map(sanitize)
        .unwrap_or_default())
}

#[tauri::command]
pub fn save_overdue_settings(
    app: AppHandle,
    settings: OverdueSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let user = current_user(&state).ok_or_else(|| "You are not signed in.".to_string())?;
    let key = cache::user_key(&user);
    let path = settings_path(&app)
        .ok_or_else(|| "Couldn't find Daymap's settings folder.".to_string())?;

    let mut stored = read_settings(&app);
    stored.accounts.insert(key, sanitize(settings));

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Couldn't save the overdue settings: {error}"))?;
    }
    let data = serde_json::to_vec_pretty(&stored)
        .map_err(|_| "Couldn't encode the overdue settings.".to_string())?;
    fs::write(path, data)
        .map_err(|error| format!("Couldn't save the overdue settings: {error}"))
}
