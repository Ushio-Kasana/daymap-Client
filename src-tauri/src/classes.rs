use crate::api::{array_items, field_i64, field_string, ApiClient, ApiError};
use crate::assignments::normalize_files;
use crate::auth::{current_user, with_authenticated, AppState};
use crate::cache;
use crate::messages::{MessageError, PortalClient};
use crate::models::{
    AssignmentFile, ClassAttendance, ClassFile, ClassLesson, ClassNote, ClassOverview, DaymapUser,
};
use crate::retry;
use chrono::{Duration, Local};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Manager, State};

/// Classes are shown as a window of lessons around today. Daymap has no
/// class-level notes endpoint, so each lesson in the window is asked for its
/// lesson plans (the class notes a teacher writes for that lesson).
const LESSON_WINDOW_DAYS_BACK: i64 = 56;
const LESSON_WINDOW_DAYS_FORWARD: i64 = 21;
const CLASS_LOOKUP_DAYS_BACK: i64 = 180;
const MAX_LESSONS: usize = 80;
/// Note bodies cached after a class opens without anyone clicking them. The
/// panel opens the newest note and the rest on demand, so caching a few newest
/// notes keeps a class readable offline without downloading its whole history.
const BACKGROUND_NOTE_LIMIT: usize = 8;

fn failure(text: impl Into<String>) -> MessageError {
    MessageError::Message(text.into())
}

fn normalize(value: &str) -> String {
    value.trim().to_lowercase()
}

/// Daymap returns these fields as a string, a list of names or an object with
/// a `Name`, depending on the endpoint and school.
fn text_of(item: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(value) = item.get(*key) else { continue };
        if value.is_null() {
            continue;
        }
        match value {
            Value::String(text) => {
                let text = collapse_whitespace(text);
                if !text.is_empty() {
                    return Some(text);
                }
            }
            Value::Array(items) => {
                let parts: Vec<String> = items.iter().filter_map(text_of_item).collect();
                if !parts.is_empty() {
                    return Some(parts.join(", "));
                }
            }
            _ => {
                if let Some(text) = field_string(value, &["Name", "name", "FullName", "Title"]) {
                    return Some(text);
                }
            }
        }
    }
    None
}

fn text_of_item(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let text = collapse_whitespace(text);
            (!text.is_empty()).then_some(text)
        }
        _ => field_string(value, &["Name", "name", "FullName", "Title"])
            .map(|text| collapse_whitespace(&text)),
    }
}

/// Daymap sometimes joins a room and teacher into one field with a carriage
/// return between them.
fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

struct ClassIdentity {
    id: i64,
    name: String,
    code: Option<String>,
    subject: Option<String>,
    teachers: Option<String>,
    room: Option<String>,
}

fn identity_from(item: &Value) -> Option<ClassIdentity> {
    let name = field_string(item, &["ClassName", "className"])?;
    Some(ClassIdentity {
        id: field_i64(item, &["Id", "ID", "id"]).unwrap_or(0),
        name,
        code: field_string(item, &["ClassCode", "classCode"]),
        subject: field_string(item, &["Subject", "subject"]),
        teachers: text_of(
            item,
            &["Teachers", "Teacher", "teacherName", "TeacherName", "Staff"],
        ),
        room: text_of(item, &["Rooms", "Room", "room", "Location", "location"]),
    })
}

fn identity_matches(
    identity: &ClassIdentity,
    class_id: i64,
    class_name: &str,
    class_code: &str,
) -> bool {
    if class_id > 0 {
        return identity.id == class_id;
    }
    let name = normalize(&identity.name);
    let code = identity.code.as_deref().map(normalize).unwrap_or_default();
    if !class_name.is_empty() && name == class_name {
        return true;
    }
    !class_code.is_empty() && code == class_code
}

/// Loads a class overview: the class details, its lessons around today and
/// the class notes and files attached to those lessons.
pub async fn fetch_class_overview(
    client: &ApiClient,
    portal: &PortalClient,
    token: &str,
    event_id: Option<i64>,
    class_name: Option<&str>,
    class_code: Option<&str>,
) -> Result<ClassOverview, MessageError> {
    let today = Local::now().date_naive();
    let window_from = (today - Duration::days(LESSON_WINDOW_DAYS_BACK))
        .format("%Y-%m-%d")
        .to_string();
    let window_to = (today + Duration::days(LESSON_WINDOW_DAYS_FORWARD))
        .format("%Y-%m-%d")
        .to_string();

    // The lesson the user clicked carries the class ID and the room/teacher
    // that only the per-lesson endpoint has.
    let clicked = match event_id.filter(|id| *id > 0) {
        Some(id) => Some(
            client
                .get(
                    "calendar/lessonclass",
                    token,
                    &[("eventId", id.to_string())],
                )
                .await?,
        ),
        None => None,
    };

    // A class opened from a lesson only needs the lessons window. A class
    // opened from a task label has to be found by name, so look further back
    // in case the class isn't running at the moment.
    let lookup_days_back = if clicked.is_some() {
        LESSON_WINDOW_DAYS_BACK
    } else {
        CLASS_LOOKUP_DAYS_BACK
    };
    let lookup_from = (today - Duration::days(lookup_days_back))
        .format("%Y-%m-%d")
        .to_string();

    let classes = client
        .get(
            "calendar/timetableclasses",
            token,
            &[("from", lookup_from), ("to", window_to.clone())],
        )
        .await?;
    let items = array_items(classes, &["Classes", "classes"]);

    let wanted_name = class_name.map(normalize).unwrap_or_default();
    let wanted_code = class_code.map(normalize).unwrap_or_default();

    let identity = match clicked.as_ref().and_then(identity_from) {
        Some(identity) => identity,
        None => items
            .iter()
            .filter_map(identity_from)
            .find(|identity| identity_matches(identity, 0, &wanted_name, &wanted_code))
            .ok_or_else(|| {
                failure("Daymap didn't return any lessons for that class yet.")
            })?,
    };
    let class_id = identity.id;

    // Keep the display window narrow so the class overview loads quickly,
    // while the lookup above can still find a class that isn't running now.
    let mut lessons: Vec<(String, Value)> = items
        .into_iter()
        .filter_map(|item| {
            let item_identity = identity_from(&item)?;
            let same = if class_id > 0 {
                item_identity.id == class_id
            } else {
                normalize(&item_identity.name) == normalize(&identity.name)
            };
            if !same {
                return None;
            }
            let date = field_string(&item, &["ClassDate", "classDate"])?;
            let day = date.get(..10).unwrap_or(&date).to_string();
            if day < window_from || day > window_to {
                return None;
            }
            Some((day, item))
        })
        .collect();
    lessons.sort_by(|left, right| left.0.cmp(&right.0));
    if lessons.len() > MAX_LESSONS {
        // Keep the most recent lessons when the window has more than we show.
        lessons.drain(..lessons.len() - MAX_LESSONS);
    }

    // Notes and files only exist once a lesson has run, and each lesson costs a
    // request, so lessons still ahead are skipped.
    let today_key = today.format("%Y-%m-%d").to_string();
    let mut targets: Vec<(i64, String, Option<String>)> = Vec::new();
    let mut seen = HashSet::new();
    for (date, item) in &lessons {
        if date.as_str() > today_key.as_str() {
            continue;
        }
        if let Some(id) = field_i64(item, &["EventID", "EventId", "ID", "Id", "id"]) {
            if id > 0 && seen.insert(id) {
                targets.push((id, date.clone(), field_string(item, &["Period", "period"])));
            }
        }
    }
    let event_ids: Vec<i64> = targets.iter().map(|(id, _, _)| *id).collect();
    let extras = fetch_lesson_extras(client, portal, token, &event_ids).await;

    let mut class_lessons = Vec::new();
    let mut notes = Vec::new();
    for (date, item) in lessons {
        let Some(id) = field_i64(&item, &["EventID", "EventId", "ID", "Id", "id"]) else {
            continue;
        };
        let period = field_string(&item, &["Period", "period"]);
        let lesson_plans = extras.plans.get(&id).cloned().unwrap_or_default();
        let mut note_count = 0_i64;

        for plan in &lesson_plans {
            let Some(note_id) = field_i64(plan, &["NoteID", "NoteId", "noteID", "ID", "Id"]) else {
                continue;
            };
            note_count += 1;
            notes.push(ClassNote {
                note_id,
                event_id: id,
                title: field_string(plan, &["Title", "title"])
                    .unwrap_or_else(|| "Class note".to_string()),
                category: field_string(plan, &["Category", "category"]),
                date: Some(date.clone()),
                period: period.clone(),
                published: ["Published", "published", "Modified", "modified"]
                    .iter()
                    .filter_map(|key| field_string(plan, &[*key]))
                    .find(|value| !value.starts_with("0001-01-01")),
                preview: field_string(plan, &["Preview", "preview"]),
            });
        }

        class_lessons.push(ClassLesson {
            event_id: id,
            date: Some(date),
            period,
            room: text_of(&item, &["Rooms", "Room", "room", "Location"]),
            teacher: text_of(
                &item,
                &["Teachers", "Teacher", "teacherName", "TeacherName", "Staff"],
            ),
            subject: field_string(&item, &["Subject", "subject"]),
            attendance_status: field_i64(
                &item,
                &["AttendanceStatus", "attendanceStatus"],
            ),
            note_count,
        });
    }

    let attendance = summarize_attendance(&class_lessons, &today_key);

    // Files keep the lesson they were attached to, newest lesson first, so the
    // panel can list them without showing lessons that have nothing attached.
    let mut files: Vec<ClassFile> = Vec::new();
    for (id, date, period) in &targets {
        for file in extras.files.get(id).into_iter().flatten() {
            files.push(ClassFile {
                file: file.clone(),
                event_id: *id,
                date: Some(date.clone()),
                period: period.clone(),
            });
        }
    }
    files.sort_by(|left, right| {
        right
            .date
            .cmp(&left.date)
            .then_with(|| left.file.name.to_lowercase().cmp(&right.file.name.to_lowercase()))
    });

    // Newest notes first, so the latest class note is the first thing shown.
    notes.sort_by(|left, right| {
        let left_key = (&left.date, &left.published, left.note_id);
        let right_key = (&right.date, &right.published, right.note_id);
        right_key.cmp(&left_key)
    });

    let header_lesson = clicked.as_ref().and_then(identity_from);
    let latest_subject = class_lessons
        .iter()
        .rev()
        .find_map(|lesson| lesson.subject.clone())
        .or_else(|| header_lesson.as_ref().and_then(|item| item.subject.clone()));

    Ok(ClassOverview {
        id: class_id,
        name: header_lesson
            .as_ref()
            .map(|item| item.name.clone())
            .unwrap_or_else(|| identity.name.clone()),
        code: header_lesson
            .as_ref()
            .and_then(|item| item.code.clone())
            .or_else(|| identity.code.clone()),
        subject: header_lesson
            .as_ref()
            .and_then(|item| item.subject.clone())
            .or(latest_subject),
        teachers: header_lesson
            .as_ref()
            .and_then(|item| item.teachers.clone())
            .or_else(|| identity.teachers.clone())
            .or_else(|| {
                class_lessons
                    .iter()
                    .rev()
                    .find_map(|lesson| lesson.teacher.clone())
            }),
        room: header_lesson
            .as_ref()
            .and_then(|item| item.room.clone())
            .or_else(|| identity.room.clone())
            .or_else(|| class_lessons.iter().rev().find_map(|lesson| lesson.room.clone())),
        attendance,
        notes,
        files,
        offline: false,
        fetched_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Rolls the per-lesson attendance up into one figure for the class header, so
/// the overview doesn't repeat an attendance status under every lesson.
fn summarize_attendance(lessons: &[ClassLesson], today: &str) -> ClassAttendance {
    let mut attended = 0_i64;
    let mut absent = 0_i64;
    let mut excused = 0_i64;

    for lesson in lessons {
        // Attendance is only meaningful once the lesson has happened.
        if lesson.date.as_deref().map_or(true, |date| date > today) {
            continue;
        }
        match lesson.attendance_status {
            Some(1) | Some(5) => absent += 1,
            // Present, late and left early all count as attending.
            Some(2) | Some(3) | Some(4) => attended += 1,
            Some(6) => excused += 1,
            _ => {}
        }
    }

    let marked = attended + absent;
    ClassAttendance {
        attended,
        absent,
        excused,
        marked,
        percentage: (marked > 0)
            .then(|| ((attended as f64 / marked as f64) * 100.0).round() as i64),
    }
}

#[derive(Default)]
struct LessonExtras {
    plans: HashMap<i64, Vec<Value>>,
    files: HashMap<i64, Vec<AssignmentFile>>,
}

/// Fetches the class notes and the attached files for several lessons at once.
/// The mobile lesson page asks for these separately, and both are optional, so
/// a failure on one lesson doesn't hide the rest.
async fn fetch_lesson_extras(
    client: &ApiClient,
    portal: &PortalClient,
    token: &str,
    ids: &[i64],
) -> LessonExtras {
    let mut extras = LessonExtras::default();
    for chunk in ids.chunks(8) {
        let mut tasks = tokio::task::JoinSet::new();
        for id in chunk {
            let client = client.clone();
            let portal = (*portal).clone();
            let token = token.to_string();
            let id = *id;
            tasks.spawn(async move {
                let plans_query = [("eventId", id.to_string())];
                // fileType 3 is the lesson's own resources, the same list the
                // mobile app shows under the lesson's Files.
                let files_query = [("fileType", "3".to_string()), ("linkId", id.to_string())];
                // A dropped request used to lose the notes for that lesson, so
                // each background request is retried before giving up.
                let plans = retry::with_retries(
                    retry::BACKGROUND_ATTEMPTS,
                    ApiError::is_transient,
                    || client.get("calendar/lessonplans", &token, &plans_query),
                )
                .await;
                let files = retry::with_retries(
                    retry::BACKGROUND_ATTEMPTS,
                    MessageError::is_transient,
                    || portal.get("/lms/api/files/filelist", &token, &files_query),
                )
                .await;
                (id, plans, files)
            });
        }
        while let Some(result) = tasks.join_next().await {
            let Ok((id, plans, files)) = result else {
                continue;
            };
            if let Ok(value) = plans {
                let items = array_items(value, &["Notes", "items", "Items"]);
                if !items.is_empty() {
                    extras.plans.insert(id, items);
                }
            }
            if let Ok(value) = files {
                let files = normalize_files(value);
                if !files.is_empty() {
                    extras.files.insert(id, files);
                }
            }
        }
    }
    extras
}

/// Loads the body of one class note as the HTML Daymap stores it.
pub async fn fetch_class_note(
    client: &ApiClient,
    token: &str,
    note_id: i64,
) -> Result<String, MessageError> {
    if note_id <= 0 {
        return Err(failure("That class note is not valid."));
    }
    let value = client
        .get(
            &format!("calendar/lessonplans/{note_id}"),
            token,
            &[],
        )
        .await?;
    Ok(value
        .get("note")
        .or_else(|| value.get("Note"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string())
}

/// Classes are cached under the lesson they were opened from and under their
/// own name, so a class saved from the timetable still opens offline from a
/// task's class label.
fn event_key(event_id: i64) -> String {
    format!("event:{event_id}")
}

fn class_key(name: &str, code: Option<&str>) -> String {
    format!(
        "class:{}|{}",
        normalize(name),
        code.map(normalize).unwrap_or_default()
    )
}

#[tauri::command]
pub async fn load_class_overview(
    app: AppHandle,
    event_id: Option<i64>,
    class_name: Option<String>,
    class_code: Option<String>,
    state: State<'_, AppState>,
) -> Result<ClassOverview, String> {
    let http = state.http.clone();
    let lookup_key = match event_id.filter(|id| *id > 0) {
        Some(id) => event_key(id),
        None => class_key(
            class_name.as_deref().unwrap_or("class"),
            class_code.as_deref(),
        ),
    };
    let user = current_user(&state).ok_or_else(|| "You are not signed in.".to_string())?;

    let result = with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        let class_name = class_name.clone();
        let class_code = class_code.clone();
        async move {
            let client =
                ApiClient::new(http.clone(), session.api_base.clone(), session.client_id.clone())?;
            let portal = PortalClient::new(http, &session.api_base)?;
            fetch_class_overview(
                &client,
                &portal,
                &token,
                event_id,
                class_name.as_deref(),
                class_code.as_deref(),
            )
            .await
        }
    })
    .await;

    match result {
        Ok(overview) => {
            let _ = cache::save_class(&app, &user, &lookup_key, &overview);
            let name_key = class_key(&overview.name, overview.code.as_deref());
            if name_key != lookup_key {
                let _ = cache::save_class(&app, &user, &name_key, &overview);
            }
            cache_note_bodies(app.clone(), overview.notes.clone(), user.clone());
            Ok(overview)
        }
        // A saved class keeps its notes readable when Daymap is unreachable.
        Err(error) => match cache::class(&app, &user, &lookup_key) {
            Some(overview) => Ok(overview),
            None => Err(error),
        },
    }
}

/// Fetches the class's note bodies after the overview has loaded, so a note that
/// was never clicked still opens without a connection. This runs in the
/// background: the overview is already on screen, and a failure only means the
/// note stays cached when it is opened.
fn cache_note_bodies(app: AppHandle, notes: Vec<ClassNote>, user: DaymapUser) {
    tauri::async_runtime::spawn(async move {
        let pending: Vec<i64> = notes
            .iter()
            .map(|note| note.note_id)
            .filter(|note_id| *note_id > 0 && cache::class_note(&app, &user, *note_id).is_none())
            .take(BACKGROUND_NOTE_LIMIT)
            .collect();
        if pending.is_empty() {
            return;
        }

        let state = app.state::<AppState>();
        for note_id in pending {
            let cache_app = app.clone();
            let user = user.clone();
            let http = state.http.clone();
            let result = with_authenticated(state.inner(), move |session, token| {
                let http = http.clone();
                let cache_app = cache_app.clone();
                let user = user.clone();
                async move {
                    let client =
                        ApiClient::new(http, session.api_base.clone(), session.client_id.clone())?;
                    let html = retry::with_retries(
                        retry::BACKGROUND_ATTEMPTS,
                        MessageError::is_transient,
                        || fetch_class_note(&client, &token, note_id),
                    )
                    .await?;
                    let _ = cache::save_class_note(&cache_app, &user, note_id, &html);
                    Ok(())
                }
            })
            .await;
            // Signed out or offline: the remaining notes would fail the same way.
            if result.is_err() {
                break;
            }
        }
    });
}

#[tauri::command]
pub async fn load_class_note(
    app: AppHandle,
    note_id: i64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let http = state.http.clone();
    let user = current_user(&state).ok_or_else(|| "You are not signed in.".to_string())?;
    let result = with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        async move {
            let client =
                ApiClient::new(http, session.api_base.clone(), session.client_id.clone())?;
            fetch_class_note(&client, &token, note_id).await
        }
    })
    .await;

    match result {
        Ok(html) => {
            let _ = cache::save_class_note(&app, &user, note_id, &html);
            Ok(html)
        }
        Err(error) => match cache::class_note(&app, &user, note_id) {
            Some(html) => Ok(html),
            None => Err(error),
        },
    }
}
