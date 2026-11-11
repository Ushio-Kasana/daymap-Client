use crate::api::{array_items, field_bool, field_f64, field_i64, field_string};
use crate::auth::{current_user, with_authenticated, AppState};
use crate::cache;
use crate::messages::{MessageError, PortalClient};
use crate::models::{AssignmentBundle, AssignmentDetail, AssignmentFile, AssignmentResult};
use reqwest::Client;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, State};
use url::Url;

const UPLOAD_TIMEOUT_SECONDS: u64 = 300;

fn failure(text: impl Into<String>) -> MessageError {
    MessageError::Message(text.into())
}

/// Loads a task's detail, its class resources and the student's uploaded work.
pub async fn fetch_assignment(
    http: &Client,
    api_base: &str,
    token: &str,
    student_id: i64,
    task_id: i64,
) -> Result<AssignmentBundle, MessageError> {
    let portal = PortalClient::new(http.clone(), api_base)?;
    let student = student_id.to_string();
    let task = task_id.to_string();

    let detail_query = [("studentId", student.clone()), ("taskId", task.clone())];
    let resources_query = [("fileType", "1".to_string()), ("linkId", task.clone())];
    let submission_query = [("studentId", student), ("taskId", task)];

    let detail_future = portal.get(
        "/lms/api/assessment/gettaskandoutcomes",
        token,
        &detail_query,
    );
    let resources_future = portal.get("/lms/api/files/filelist", token, &resources_query);
    let submission_future = portal.get(
        "/lms/api/assessment/studentresults",
        token,
        &submission_query,
    );

    let (detail_response, resources_response, submission_response) =
        tokio::join!(detail_future, resources_future, submission_future);

    let detail_value = detail_response?;
    let resources_value = resources_response.unwrap_or(Value::Array(Vec::new()));
    let submission_value = submission_response.unwrap_or(Value::Null);

    // The portal returns the task under a lowercase "task" key; older
    // responses used "Task". Without this fallback every field silently
    // defaulted, which hid the description and the upload button.
    let detail_object = detail_value
        .get("Task")
        .or_else(|| detail_value.get("task"))
        .cloned()
        .unwrap_or_else(|| detail_value.clone());

    let detail = AssignmentDetail {
        id: field_i64(&detail_object, &["ID", "Id", "id", "TaskID"]).unwrap_or(task_id),
        name: field_string(&detail_object, &["Name", "name"])
            .unwrap_or_else(|| "Assignment".to_string()),
        description: field_string(&detail_object, &["Description", "description"]),
        class_name: field_string(&detail_object, &["ClassName", "className"]),
        class_code: field_string(&detail_object, &["ClassCode", "classCode"]),
        task_type: field_string(&detail_object, &["Type", "type"]),
        teacher_name: field_string(&detail_object, &["TeacherName", "teacherName"]),
        status: field_string(&detail_object, &["Status", "status"]),
        max_mark: field_f64(&detail_object, &["MaxMark", "maxMark"]),
        due_date: field_string(&detail_object, &["DueDate", "dueDate"]),
        set_date: field_string(&detail_object, &["SetDate", "setDate"]),
        work_received: field_string(&detail_object, &["WorkReceived", "workReceived"]),
        student_can_upload: field_bool(&detail_object, &["StudentCanUpload", "studentCanUpload"])
            .unwrap_or(false),
        student_can_delete_work: field_bool(
            &detail_object,
            &["StudentCanDeleteWork", "studentCanDeleteWork"],
        )
        .unwrap_or(false),
        overdue: field_bool(&detail_object, &["Overdue", "overdue"]).unwrap_or(false),
        marked: field_bool(&detail_object, &["Marked", "marked"]).unwrap_or(false),
        graded: field_bool(&detail_object, &["Graded", "graded"]).unwrap_or(false),
    };

    let resources = normalize_files(resources_value);
    let work = submission_value
        .get("Work")
        .or_else(|| submission_value.get("work"))
        .map(|value| normalize_files(value.clone()))
        .unwrap_or_default();
    let work_received = submission_value
        .get("WorkReceived")
        .or_else(|| submission_value.get("workReceived"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or(detail.work_received.clone());

    let mut result = read_result(&detail_object, &detail_value, &submission_value);
    if result.max_mark.is_none() {
        result.max_mark = detail.max_mark;
    }

    // Anything Daymap attaches to the submission as a result: marked work or
    // the similarity report as a file, when the school releases it that way.
    let results = submission_value
        .get("Results")
        .or_else(|| submission_value.get("results"))
        .map(|value| normalize_files(value.clone()))
        .unwrap_or_default()
        .into_iter()
        .filter(|file| file.name != "File")
        .collect();

    Ok(AssignmentBundle {
        detail,
        resources,
        work,
        work_received,
        result,
        results,
    })
}

/// Schools name released results and plagiarism checks differently, so keys are
/// matched case-insensitively. Every value is optional: whatever Daymap didn't
/// send simply isn't shown.
const MARK_KEYS: &[&str] = &[
    "mark",
    "awardedmark",
    "achievedmark",
    "studentmark",
    "resultmark",
    "finalmark",
    "grademark",
    "score",
];
const MAX_MARK_KEYS: &[&str] = &["maxmark", "maximummark", "outof", "totalmark"];
const GRADE_KEYS: &[&str] = &[
    "grade",
    "lettergrade",
    "resultgrade",
    "gradecode",
    "gradeletter",
    "band",
];
const SIMILARITY_KEYS: &[&str] = &[
    "similarity",
    "similarityscore",
    "similaritypercentage",
    "similarityindex",
    "plagiarism",
    "plagiarised",
    "plagiarismscore",
    "plagiarismpercentage",
    "originalityscore",
    "turnitinsimilarity",
];
const REPORT_KEYS: &[&str] = &[
    "reporturl",
    "reportlink",
    "similarityreport",
    "similarityreporturl",
    "turnitinreport",
    "turnitinreporturl",
    "originalityreport",
    "plagiarismreport",
    "report",
];

fn number_value(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text
            .trim()
            .trim_end_matches('%')
            .trim()
            .parse::<f64>()
            .ok(),
        _ => None,
    }
}

fn object_number(value: &Value, keys: &[&str]) -> Option<f64> {
    let object = value.as_object()?;
    for (key, entry) in object {
        if keys.contains(&key.to_lowercase().as_str()) {
            if let Some(number) = number_value(entry) {
                return Some(number);
            }
        }
    }
    None
}

fn nested_number(value: &Value, keys: &[&str], depth: u8) -> Option<f64> {
    if depth > 3 {
        return None;
    }
    if let Some(number) = object_number(value, keys) {
        return Some(number);
    }
    match value {
        Value::Object(object) => object
            .values()
            .find_map(|entry| nested_number(entry, keys, depth + 1)),
        Value::Array(items) => items
            .iter()
            .find_map(|entry| nested_number(entry, keys, depth + 1)),
        _ => None,
    }
}

/// Looks at the payload's own fields first, so a rubric criterion's mark nested
/// deeper down doesn't stand in for the overall result.
fn find_number(value: &Value, keys: &[&str]) -> Option<f64> {
    object_number(value, keys).or_else(|| nested_number(value, keys, 0))
}

fn object_text(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for (key, entry) in object {
        if !keys.contains(&key.to_lowercase().as_str()) {
            continue;
        }
        let Some(text) = entry.as_str() else { continue };
        let text = text.trim();
        if !text.is_empty() {
            return Some(text.to_string());
        }
    }
    None
}

fn nested_text(value: &Value, keys: &[&str], depth: u8) -> Option<String> {
    if depth > 3 {
        return None;
    }
    if let Some(text) = object_text(value, keys) {
        return Some(text);
    }
    match value {
        Value::Object(object) => object
            .values()
            .find_map(|entry| nested_text(entry, keys, depth + 1)),
        Value::Array(items) => items
            .iter()
            .find_map(|entry| nested_text(entry, keys, depth + 1)),
        _ => None,
    }
}

fn find_text(value: &Value, keys: &[&str]) -> Option<String> {
    object_text(value, keys).or_else(|| nested_text(value, keys, 0))
}

/// Some responses carry the report only as a bare link, without a field name
/// that says what it is, so fall back to any link that mentions the check.
fn matching_url(value: &Value, depth: u8) -> Option<String> {
    const NEEDLES: &[&str] = &["turnitin", "similarity", "plagiar", "originality"];
    if depth > 4 {
        return None;
    }
    match value {
        Value::String(text) => {
            let lowered = text.to_lowercase();
            (lowered.starts_with("http") && NEEDLES.iter().any(|needle| lowered.contains(needle)))
                .then(|| text.clone())
        }
        Value::Object(object) => object
            .values()
            .find_map(|entry| matching_url(entry, depth + 1)),
        Value::Array(items) => items
            .iter()
            .find_map(|entry| matching_url(entry, depth + 1)),
        _ => None,
    }
}

/// Daymap reports an unreleased mark as `-1` (or similar), so anything outside
/// zero to the maximum is treated as "not marked yet" rather than as a mark.
fn valid_mark(mark: f64, max_mark: Option<f64>) -> Option<f64> {
    if mark < 0.0 {
        return None;
    }
    if max_mark.is_some_and(|max| max > 0.0 && mark > max) {
        return None;
    }
    Some(mark)
}

/// A similarity score is a percentage; anything outside that isn't one.
fn valid_similarity(value: f64) -> Option<f64> {
    (0.0..=100.0).contains(&value).then_some(value)
}

fn read_result(
    detail_object: &Value,
    detail_value: &Value,
    submission: &Value,
) -> AssignmentResult {
    let roots = [detail_object, detail_value, submission];
    let grade = roots.iter().find_map(|root| {
        // A numeric "Result" is a mark, not a letter grade.
        find_text(root, GRADE_KEYS)
            .filter(|text| number_value(&Value::String(text.clone())).is_none())
            .filter(|text| text.len() <= 24)
    });
    let max_mark = roots
        .iter()
        .find_map(|root| find_number(root, MAX_MARK_KEYS));
    let mark = roots
        .iter()
        .find_map(|root| find_number(root, MARK_KEYS))
        .and_then(|mark| valid_mark(mark, max_mark));
    let similarity = roots
        .iter()
        .find_map(|root| find_number(root, SIMILARITY_KEYS))
        .or_else(|| roots.iter().find_map(|root| similarity_number(root, 0)))
        .and_then(valid_similarity);
    AssignmentResult {
        mark,
        max_mark,
        grade,
        similarity,
        report_url: roots.iter().find_map(|root| {
            find_text(root, REPORT_KEYS)
                .filter(|text| text.starts_with("http"))
                .or_else(|| matching_url(root, 0))
        }),
    }
}

/// Similarity checks often arrive as a named object rather than a flat field,
/// such as `{"SimilarityReport": {"Percentage": 12, "Url": "…"}}`, so the
/// score inside a similarity-named object is read too.
fn similarity_number(value: &Value, depth: u8) -> Option<f64> {
    const NAMES: &[&str] = &[
        "similarity",
        "similarityreport",
        "turnitin",
        "turnitinreport",
        "plagiarism",
        "plagiarismreport",
        "originality",
        "originalityreport",
    ];
    const SCORE_KEYS: &[&str] = &["percentage", "percent", "score", "value", "similarity", "index"];
    if depth > 4 {
        return None;
    }
    match value {
        Value::Object(object) => {
            for (key, entry) in object {
                if !NAMES.contains(&key.to_lowercase().as_str()) {
                    continue;
                }
                if let Some(number) = number_value(entry) {
                    return Some(number);
                }
                if let Some(number) = nested_number(entry, SCORE_KEYS, 0) {
                    return Some(number);
                }
            }
            object
                .values()
                .find_map(|entry| similarity_number(entry, depth + 1))
        }
        Value::Array(items) => items
            .iter()
            .find_map(|entry| similarity_number(entry, depth + 1)),
        _ => None,
    }
}

pub(crate) fn normalize_files(value: Value) -> Vec<AssignmentFile> {
    array_items(
        value,
        &["Files", "files", "Items", "items", "Work", "work", "Results"],
    )
    .into_iter()
    .filter_map(|item| {
        let file_id = field_i64(
            &item,
            &["FileID", "FileId", "fileID", "fileId", "ID", "Id", "id"],
        );
        let name = field_string(
            &item,
            &["Name", "name", "FullName", "fullName", "FileName", "fileName"],
        )
        .unwrap_or_else(|| "File".to_string());
        let external_url = field_string(&item, &["URL", "Url", "url"])
            .filter(|link| file_id.is_none() && link.starts_with("http"));

        if file_id.is_none() && external_url.is_none() {
            return None;
        }

        Some(AssignmentFile {
            id: file_id,
            name,
            description: field_string(&item, &["Description", "description"]),
            modified: field_string(&item, &["Modified", "ModifiedDate", "modified"]),
            external_url,
        })
    })
    .collect()
}

pub async fn fetch_file(
    http: &Client,
    api_base: &str,
    token: &str,
    file_id: i64,
) -> Result<Vec<u8>, MessageError> {
    let portal = PortalClient::new(http.clone(), api_base)?;
    let url = portal.url(&format!("/lms/api/files/file/{file_id}"))?;
    let response = portal
        .http
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| failure("Couldn't download the file. Check your connection and try again."))?;

    if response.status().as_u16() == 401 {
        return Err(MessageError::Unauthorized);
    }
    if !response.status().is_success() {
        return Err(failure(format!(
            "Daymap returned HTTP {} for that file.",
            response.status().as_u16()
        )));
    }

    response
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|_| failure("The download didn't finish."))
}

/// Uploads student work through Daymap's SAS flow: ask Daymap for a
/// short-lived Azure Blob target, send the file straight there, then tell
/// Daymap the upload finished.
pub async fn send_work(
    http: &Client,
    api_base: &str,
    token: &str,
    student_id: i64,
    task_id: i64,
    file_name: &str,
    mime: &str,
    data: &[u8],
) -> Result<(), MessageError> {
    let portal = PortalClient::new(http.clone(), api_base)?;
    let sas = portal
        .get(
            "/lms/api/files/upload/sas/studentwork",
            token,
            &[
                ("studentId", student_id.to_string()),
                ("taskId", task_id.to_string()),
                ("fileName", file_name.to_string()),
                ("size", data.len().to_string()),
            ],
        )
        .await?;

    let account = field_string(&sas, &["account", "Account"])
        .ok_or_else(|| failure("Daymap didn't return an upload account."))?;
    let container = field_string(&sas, &["container", "Container"])
        .ok_or_else(|| failure("Daymap didn't return an upload container."))?;
    let blob_token = field_string(&sas, &["token", "Token"])
        .ok_or_else(|| failure("Daymap didn't return an upload token."))?;
    let storage_path = field_string(&sas, &["storagePath", "StoragePath"])
        .ok_or_else(|| failure("Daymap didn't return an upload path."))?;
    let file_id = field_i64(&sas, &["fileId", "FileId", "fileID", "FileID"])
        .ok_or_else(|| failure("Daymap didn't return the uploaded file's ID."))?;

    let mut base = Url::parse(&format!("https://{account}.blob.core.windows.net/"))
        .map_err(|_| failure("Couldn't build the upload address."))?;
    {
        let mut segments = base
            .path_segments_mut()
            .map_err(|_| failure("Couldn't build the upload address."))?;
        segments.push(&container);
        for part in storage_path.split('/').filter(|part| !part.is_empty()) {
            segments.push(part);
        }
    }
    // The SAS token is already URL-encoded, so append it verbatim instead of
    // letting the URL builder encode the percent signs a second time.
    let upload_url = Url::parse(&format!(
        "{}?{}",
        base.as_str().trim_end_matches('/'),
        blob_token
    ))
    .map_err(|_| failure("Couldn't build the upload address."))?;

    let response = portal
        .http
        .put(upload_url)
        .header("x-ms-blob-type", "BlockBlob")
        .header("x-ms-version", "2021-12-02")
        .header("Content-Type", mime)
        .header("x-ms-blob-content-type", mime)
        .body(data.to_vec())
        .timeout(Duration::from_secs(UPLOAD_TIMEOUT_SECONDS))
        .send()
        .await
        .map_err(|_| failure("Couldn't send the file. Check your connection and try again."))?;

    if !response.status().is_success() {
        return Err(failure(format!(
            "The upload was rejected (HTTP {}).",
            response.status().as_u16()
        )));
    }

    portal
        .post(
            "/lms/api/files/upload/success",
            token,
            &json!({ "fileId": file_id }),
        )
        .await?;
    Ok(())
}

fn student_id(session: &crate::models::StoredSession) -> Result<i64, MessageError> {
    session
        .user
        .daymap_id
        .filter(|id| *id > 0)
        .ok_or_else(|| failure("Daymap didn't return a student ID for this account."))
}

pub(crate) fn guess_mime(file_name: &str) -> String {
    let extension = Path::new(file_name)
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "rtf" => "application/rtf",
        "zip" => "application/zip",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
    .to_string()
}

#[tauri::command]
pub async fn load_assignment(
    app: AppHandle,
    task_id: i64,
    state: State<'_, AppState>,
) -> Result<AssignmentBundle, String> {
    let user = current_user(&state).ok_or_else(|| "You are not signed in.".to_string())?;
    let http = state.http.clone();
    let result = with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        async move {
            let id = student_id(&session)?;
            fetch_assignment(&http, &session.api_base, &token, id, task_id).await
        }
    })
    .await;

    match result {
        Ok(bundle) => {
            let _ = cache::save_assignment(&app, &user, task_id, &bundle);
            Ok(bundle)
        }
        // Fall back to the saved copy so a task opened before still works offline.
        Err(error) => match cache::assignment(&app, &user, task_id) {
            Some(bundle) => Ok(bundle),
            None => Err(error),
        },
    }
}

#[tauri::command]
pub fn cached_assignment(
    app: AppHandle,
    task_id: i64,
    state: State<'_, AppState>,
) -> Result<Option<AssignmentBundle>, String> {
    let user = current_user(&state).ok_or_else(|| "You are not signed in.".to_string())?;
    Ok(cache::assignment(&app, &user, task_id))
}

#[tauri::command]
pub async fn download_assignment_file(
    file_id: i64,
    destination: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if destination.trim().is_empty() {
        return Err("Choose where to save the file first.".to_string());
    }
    let http = state.http.clone();
    with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        let destination = destination.clone();
        async move {
            let bytes = fetch_file(&http, &session.api_base, &token, file_id).await?;
            std::fs::write(&destination, bytes)
                .map_err(|error| failure(format!("Couldn't save the file: {error}")))
        }
    })
    .await
}

#[tauri::command]
pub async fn upload_assignment_file(
    task_id: i64,
    path: String,
    mime: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let file_name = Path::new(&path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "That file has no name.".to_string())?;
    let data = std::fs::read(&path)
        .map_err(|error| format!("Couldn't read the selected file: {error}"))?;
    if data.is_empty() {
        return Err("The selected file is empty.".to_string());
    }
    let mime = mime
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| guess_mime(&file_name));

    let http = state.http.clone();
    with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        let file_name = file_name.clone();
        let mime = mime.clone();
        let data = data.clone();
        async move {
            let id = student_id(&session)?;
            send_work(
                &http,
                &session.api_base,
                &token,
                id,
                task_id,
                &file_name,
                &mime,
                &data,
            )
            .await
        }
    })
    .await
}
