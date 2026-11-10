use crate::api::{array_items, field_bool, field_f64, field_i64, field_string};
use crate::auth::{with_authenticated, AppState};
use crate::messages::{MessageError, PortalClient};
use crate::models::{AssignmentBundle, AssignmentDetail, AssignmentFile};
use reqwest::Client;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;
use tauri::State;
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

    let detail_object = detail_value
        .get("Task")
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

    Ok(AssignmentBundle {
        detail,
        resources,
        work,
        work_received,
    })
}

fn normalize_files(value: Value) -> Vec<AssignmentFile> {
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

fn guess_mime(file_name: &str) -> String {
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
    task_id: i64,
    state: State<'_, AppState>,
) -> Result<AssignmentBundle, String> {
    let http = state.http.clone();
    with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        async move {
            let id = student_id(&session)?;
            fetch_assignment(&http, &session.api_base, &token, id, task_id).await
        }
    })
    .await
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
