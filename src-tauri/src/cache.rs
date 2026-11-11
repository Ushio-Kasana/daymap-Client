use crate::models::{
    AssignmentBundle, ClassOverview, Dashboard, DaymapMessage, DaymapUser, DiaryItem, MessageFolder,
    MessagePerson,
};
use chrono::{Datelike, Duration as ChronoDuration, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const CACHE_VERSION: u32 = 1;
const PEOPLE_VERSION: u32 = 2;
const CACHE_FILE: &str = "offline-cache.json";
const MAILBOX_SYNC_INTERVAL_SECS: i64 = 6 * 60 * 60;
/// Keep the class cache bounded: notes are read from a class or two at a time,
/// so older classes and notes can safely drop out.
const MAX_CLASS_OVERVIEWS: usize = 24;
const MAX_CLASS_NOTES: usize = 240;
static CACHE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedWeek {
    saved_at: String,
    lessons: Vec<DiaryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedClass {
    saved_at: String,
    overview: ClassOverview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedNote {
    saved_at: String,
    html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfflineCache {
    version: u32,
    #[serde(default)]
    people_version: u32,
    user_key: String,
    saved_at: String,
    dashboard: Option<Dashboard>,
    folders: Vec<MessageFolder>,
    folder_messages: HashMap<String, Vec<DaymapMessage>>,
    people: Vec<MessagePerson>,
    thread_people: HashMap<String, Vec<MessagePerson>>,
    mailbox_synced_at: Option<i64>,
    #[serde(default)]
    diary_weeks: HashMap<String, CachedWeek>,
    #[serde(default)]
    assignments: HashMap<String, AssignmentBundle>,
    #[serde(default)]
    classes: HashMap<String, CachedClass>,
    #[serde(default)]
    class_notes: HashMap<String, CachedNote>,
}

impl OfflineCache {
    fn new(user_key: String) -> Self {
        Self {
            version: CACHE_VERSION,
            people_version: PEOPLE_VERSION,
            user_key,
            saved_at: chrono::Utc::now().to_rfc3339(),
            dashboard: None,
            folders: Vec::new(),
            folder_messages: HashMap::new(),
            people: Vec::new(),
            thread_people: HashMap::new(),
            mailbox_synced_at: None,
            diary_weeks: HashMap::new(),
            assignments: HashMap::new(),
            classes: HashMap::new(),
            class_notes: HashMap::new(),
        }
    }
}

pub fn user_key(user: &DaymapUser) -> String {
    let mut pieces = Vec::new();
    if let Some(value) = user.school_code.as_deref() {
        if !value.trim().is_empty() {
            pieces.push(value.trim().to_string());
        }
    }
    if let Some(value) = user.contact_id {
        pieces.push(value.to_string());
    }
    if let Some(value) = user.daymap_id {
        pieces.push(value.to_string());
    }
    if let Some(value) = user.username.as_deref() {
        if !value.trim().is_empty() {
            pieces.push(value.trim().to_string());
        }
    }
    if pieces.is_empty() {
        "default".to_string()
    } else {
        pieces.join("|")
    }
}

pub fn load_dashboard(app: &AppHandle, user: &DaymapUser) -> Option<Dashboard> {
    let mut dashboard = read(app, user).dashboard?;
    dashboard.offline = true;
    Some(dashboard)
}

pub fn save_dashboard(
    app: &AppHandle,
    user: &DaymapUser,
    dashboard: &Dashboard,
) -> Result<(), String> {
    let mut dashboard = dashboard.clone();
    dashboard.offline = false;
    update(app, user, |cache| {
        cache.dashboard = Some(dashboard.clone());
    })
}

pub fn save_diary_week(
    app: &AppHandle,
    user: &DaymapUser,
    week_start: &str,
    lessons: &[DiaryItem],
) -> Result<(), String> {
    let key = week_start.to_string();
    let week = CachedWeek {
        saved_at: chrono::Utc::now().to_rfc3339(),
        lessons: lessons.to_vec(),
    };
    update(app, user, |cache| {
        cache.diary_weeks.insert(key.clone(), week.clone());
    })
}

pub fn diary_week(app: &AppHandle, user: &DaymapUser, week_start: &str) -> Option<Vec<DiaryItem>> {
    read(app, user)
        .diary_weeks
        .get(week_start)
        .map(|week| week.lessons.clone())
}

/// Stores the weeks that the dashboard response covers completely, so the
/// timetable can open them without another round trip. Weeks that are only
/// partly covered are skipped to avoid caching an incomplete timetable.
pub fn save_dashboard_weeks(
    app: &AppHandle,
    user: &DaymapUser,
    lessons: &[DiaryItem],
    from: &str,
    to: &str,
) -> Result<(), String> {
    let Some(from) = NaiveDate::parse_from_str(from, "%Y-%m-%d").ok() else {
        return Ok(());
    };
    let Some(to) = NaiveDate::parse_from_str(to, "%Y-%m-%d").ok() else {
        return Ok(());
    };

    let mut groups: HashMap<String, Vec<DiaryItem>> = HashMap::new();
    for lesson in lessons {
        if let Some(key) = lesson_week_key(lesson) {
            groups.entry(key).or_default().push(lesson.clone());
        }
    }

    let mut monday = from - ChronoDuration::days(from.weekday().num_days_from_monday() as i64);
    while monday < from {
        monday += ChronoDuration::days(7);
    }
    let mut covered = Vec::new();
    while monday + ChronoDuration::days(6) <= to {
        covered.push(monday.format("%Y-%m-%d").to_string());
        monday += ChronoDuration::days(7);
    }
    if covered.is_empty() {
        return Ok(());
    }

    let saved_at = chrono::Utc::now().to_rfc3339();
    update(app, user, |cache| {
        for key in &covered {
            let lessons = groups.remove(key).unwrap_or_default();
            cache.diary_weeks.insert(
                key.clone(),
                CachedWeek {
                    saved_at: saved_at.clone(),
                    lessons,
                },
            );
        }
    })
}

pub fn save_assignment(
    app: &AppHandle,
    user: &DaymapUser,
    task_id: i64,
    bundle: &AssignmentBundle,
) -> Result<(), String> {
    let key = task_id.to_string();
    let bundle = bundle.clone();
    update(app, user, |cache| {
        cache.assignments.insert(key.clone(), bundle.clone());
    })
}

pub fn assignment(app: &AppHandle, user: &DaymapUser, task_id: i64) -> Option<AssignmentBundle> {
    read(app, user).assignments.get(&task_id.to_string()).cloned()
}

pub fn save_class(
    app: &AppHandle,
    user: &DaymapUser,
    key: &str,
    overview: &ClassOverview,
) -> Result<(), String> {
    let entry = CachedClass {
        saved_at: chrono::Utc::now().to_rfc3339(),
        overview: ClassOverview {
            offline: false,
            fetched_at: String::new(),
            ..overview.clone()
        },
    };
    update(app, user, |cache| {
        cache.classes.insert(key.to_string(), entry.clone());
        trim(&mut cache.classes, MAX_CLASS_OVERVIEWS, |entry| {
            entry.saved_at.clone()
        });
    })
}

/// Returns a saved class marked as offline, so the panel can say the data is
/// from the cache instead of Daymap.
pub fn class(app: &AppHandle, user: &DaymapUser, key: &str) -> Option<ClassOverview> {
    let cached = read(app, user).classes.get(key).cloned()?;
    Some(ClassOverview {
        offline: true,
        fetched_at: cached.saved_at,
        ..cached.overview
    })
}

pub fn save_class_note(
    app: &AppHandle,
    user: &DaymapUser,
    note_id: i64,
    html: &str,
) -> Result<(), String> {
    let entry = CachedNote {
        saved_at: chrono::Utc::now().to_rfc3339(),
        html: html.to_string(),
    };
    update(app, user, |cache| {
        cache.class_notes.insert(note_id.to_string(), entry.clone());
        trim(&mut cache.class_notes, MAX_CLASS_NOTES, |note| {
            note.saved_at.clone()
        });
    })
}

pub fn class_note(app: &AppHandle, user: &DaymapUser, note_id: i64) -> Option<String> {
    read(app, user)
        .class_notes
        .get(&note_id.to_string())
        .map(|note| note.html.clone())
}

pub fn clear(app: &AppHandle) -> Result<(), String> {
    let _guard = CACHE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let Some(path) = cache_path(app) else {
        return Ok(());
    };
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Couldn't clear offline data: {error}")),
    }
}

/// Drops the oldest entries once a map is over its limit, so the offline cache
/// doesn't grow with every class the user ever opened.
fn trim<T>(items: &mut HashMap<String, T>, limit: usize, saved_at: impl Fn(&T) -> String) {
    if items.len() <= limit {
        return;
    }
    let mut ages: Vec<(String, String)> = items
        .iter()
        .map(|(key, value)| (key.clone(), saved_at(value)))
        .collect();
    ages.sort_by(|left, right| right.1.cmp(&left.1));
    for (key, _) in ages.into_iter().skip(limit) {
        items.remove(&key);
    }
}

fn lesson_week_key(lesson: &DiaryItem) -> Option<String> {
    let start = lesson.start.as_deref()?;
    let date = NaiveDate::parse_from_str(start.get(0..10)?, "%Y-%m-%d").ok()?;
    let monday = date - ChronoDuration::days(date.weekday().num_days_from_monday() as i64);
    Some(monday.format("%Y-%m-%d").to_string())
}

pub fn folders(app: &AppHandle, user: &DaymapUser) -> Vec<MessageFolder> {
    read(app, user).folders
}

pub fn save_folders(
    app: &AppHandle,
    user: &DaymapUser,
    folders: &[MessageFolder],
) -> Result<(), String> {
    if folders.is_empty() {
        return Ok(());
    }
    let folders = folders.to_vec();
    update(app, user, |cache| {
        cache.folders = folders.clone();
    })
}

pub fn folder_messages(
    app: &AppHandle,
    user: &DaymapUser,
    folder_id: &str,
) -> Vec<DaymapMessage> {
    read(app, user)
        .folder_messages
        .get(folder_id)
        .cloned()
        .unwrap_or_default()
}

pub fn save_folder_messages(
    app: &AppHandle,
    user: &DaymapUser,
    folder_id: &str,
    messages: &[DaymapMessage],
) -> Result<(), String> {
    let folder_id = folder_id.to_string();
    let messages = messages.to_vec();
    update(app, user, |cache| {
        cache.folder_messages.insert(folder_id.clone(), messages.clone());
    })
}

pub fn thread_people(
    app: &AppHandle,
    user: &DaymapUser,
    message_id: i64,
) -> Vec<MessagePerson> {
    read(app, user)
        .thread_people
        .get(&message_id.to_string())
        .cloned()
        .unwrap_or_default()
}

pub fn record_thread_people(
    app: &AppHandle,
    user: &DaymapUser,
    message_id: i64,
    people: &[MessagePerson],
) -> Result<(), String> {
    let people = people.to_vec();
    update(app, user, |cache| {
        cache.thread_people.insert(message_id.to_string(), people.clone());
        merge_into(&mut cache.people, &people);
    })
}

pub fn merge_people(
    app: &AppHandle,
    user: &DaymapUser,
    people: &[MessagePerson],
) -> Result<(), String> {
    if people.is_empty() {
        return Ok(());
    }
    let people = people.to_vec();
    update(app, user, |cache| {
        merge_into(&mut cache.people, &people);
    })
}

pub fn search_people(app: &AppHandle, user: &DaymapUser, term: &str) -> Vec<MessagePerson> {
    let term = term.trim().to_lowercase();
    if term.is_empty() {
        return Vec::new();
    }
    let cache = read(app, user);
    let mut by_id: HashMap<i64, MessagePerson> = HashMap::new();
    let groups = cache
        .thread_people
        .values()
        .cloned()
        .chain(std::iter::once(cache.people));
    for person in groups.flatten() {
        let replace = match by_id.get(&person.id) {
            Some(existing) => title_quality(&person.title) > title_quality(&existing.title),
            None => true,
        };
        if replace {
            by_id.insert(person.id, person);
        }
    }
    let mut people: Vec<MessagePerson> = by_id
        .into_values()
        .filter(|person| {
            let id = person.id.to_string();
            person.title.to_lowercase().contains(&term)
                || person.type_label.to_lowercase().contains(&term)
                || id.contains(&term)
        })
        .collect();
    sort_people(&mut people);
    people
}

pub fn mailbox_needs_sync(app: &AppHandle, user: &DaymapUser) -> bool {
    let cache = read(app, user);
    // Rebuild an empty thread index even if an earlier sync recorded a timestamp.
    if cache.thread_people.values().all(Vec::is_empty) && !cache.folder_messages.is_empty() {
        return true;
    }
    let Some(synced_at) = cache.mailbox_synced_at else {
        return true;
    };
    chrono::Utc::now().timestamp() - synced_at > MAILBOX_SYNC_INTERVAL_SECS
}

pub fn thread_ids(app: &AppHandle, user: &DaymapUser) -> HashSet<i64> {
    read(app, user)
        .thread_people
        .into_iter()
        .filter(|(_, people)| !people.is_empty())
        .filter_map(|(key, _)| key.parse().ok())
        .collect()
}

pub fn save_mailbox(
    app: &AppHandle,
    user: &DaymapUser,
    folders: &[MessageFolder],
    messages: &HashMap<String, Vec<DaymapMessage>>,
    people: &[MessagePerson],
    thread_people: &HashMap<String, Vec<MessagePerson>>,
) -> Result<(), String> {
    let folders = folders.to_vec();
    let messages = messages.clone();
    let people = people.to_vec();
    let thread_people = thread_people.clone();
    update(app, user, |cache| {
        if !folders.is_empty() {
            cache.folders = folders.clone();
        }
        cache.folder_messages = messages.clone();
        for (message_id, members) in &thread_people {
            cache
                .thread_people
                .insert(message_id.clone(), members.clone());
        }
        merge_into(&mut cache.people, &people);
        cache.mailbox_synced_at = Some(chrono::Utc::now().timestamp());
    })
}

fn update<F>(app: &AppHandle, user: &DaymapUser, mutate: F) -> Result<(), String>
where
    F: FnOnce(&mut OfflineCache),
{
    let _guard = CACHE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let mut cache = read(app, user);
    mutate(&mut cache);
    cache.saved_at = chrono::Utc::now().to_rfc3339();
    write(app, &cache)
}

fn read(app: &AppHandle, user: &DaymapUser) -> OfflineCache {
    let key = user_key(user);
    let Some(path) = cache_path(app) else {
        return OfflineCache::new(key);
    };
    let Ok(data) = fs::read(&path) else {
        return OfflineCache::new(key);
    };
    match serde_json::from_slice::<OfflineCache>(&data) {
        Ok(mut cache) if cache.version == CACHE_VERSION && cache.user_key == key => {
            if cache.people_version < PEOPLE_VERSION {
                // Re-read thread participants with the corrected name fields,
                // but keep the message cache and the existing contact list.
                cache.thread_people.clear();
                cache.mailbox_synced_at = None;
                cache.people_version = PEOPLE_VERSION;
            }
            cache
        }
        _ => OfflineCache::new(key),
    }
}

fn write(app: &AppHandle, cache: &OfflineCache) -> Result<(), String> {
    let path = cache_path(app).ok_or_else(|| "Couldn't find the app data folder.".to_string())?;
    let data = serde_json::to_vec_pretty(cache)
        .map_err(|_| "Couldn't encode the offline cache.".to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, data).map_err(|error| format!("Couldn't save offline data: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600));
    }
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Couldn't finish saving offline data: {error}"))
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    let directory = app.path().app_data_dir().ok()?;
    fs::create_dir_all(&directory).ok()?;
    Some(directory.join(CACHE_FILE))
}

fn title_quality(title: &str) -> u8 {
    if title == "Contact" {
        0
    } else if title.contains(' ') {
        2
    } else {
        1
    }
}

fn merge_into(existing: &mut Vec<MessagePerson>, incoming: &[MessagePerson]) {
    let mut by_id: HashMap<i64, MessagePerson> =
        existing.drain(..).map(|person| (person.id, person)).collect();
    for person in incoming {
        let replace = match by_id.get(&person.id) {
            Some(current) => title_quality(&person.title) > title_quality(&current.title),
            None => true,
        };
        if replace {
            by_id.insert(person.id, person.clone());
        }
    }
    let mut people: Vec<MessagePerson> = by_id.into_values().collect();
    sort_people(&mut people);
    *existing = people;
}

fn sort_people(people: &mut [MessagePerson]) {
    people.sort_by(|left, right| {
        let left_rank = type_rank(&left.type_label);
        let right_rank = type_rank(&right.type_label);
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
    });
}

fn type_rank(label: &str) -> u8 {
    match label {
        "Student" | "Parent" => 0,
        "Staff" => 1,
        _ => 2,
    }
}
