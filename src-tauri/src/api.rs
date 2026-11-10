use crate::models::{AssessmentTask, Dashboard, DaymapMessage, DaymapUser, DiaryItem};
use chrono::{Duration, Local};
use reqwest::{Client, StatusCode};
use serde_json::Value;
use std::fmt;
use url::Url;

#[derive(Debug)]
pub enum ApiError {
    Unauthorized,
    Message(String),
}

impl ApiError {
    pub fn message(text: impl Into<String>) -> Self {
        Self::Message(text.into())
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unauthorized => formatter.write_str("Daymap rejected the request. Please sign in again."),
            Self::Message(text) => formatter.write_str(text),
        }
    }
}

pub struct ApiClient {
    http: Client,
    base_url: String,
    client_id: String,
}

impl ApiClient {
    pub fn new(http: Client, base_url: impl Into<String>, client_id: impl Into<String>) -> Result<Self, ApiError> {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        if Url::parse(&base_url).is_err() {
            return Err(ApiError::message("Daymap returned an invalid API address."));
        }
        Ok(Self {
            http,
            base_url,
            client_id: client_id.into(),
        })
    }

    pub async fn get(
        &self,
        path: &str,
        token: &str,
        query: &[(&str, String)],
    ) -> Result<Value, ApiError> {
        let mut url = Url::parse(&format!(
            "{}/{}",
            self.base_url,
            path.trim_start_matches('/')
        ))
        .map_err(|_| ApiError::message("Couldn't build a Daymap request."))?;

        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("api-version", "3.0");
            for (key, value) in query {
                pairs.append_pair(key, value);
            }
        }

        let response = self
            .http
            .get(url)
            .header("Authorization", format!("Bearer {token}"))
            .header("DaymapClientId", &self.client_id)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|_| ApiError::message("Can't reach Daymap. Check your connection and try again."))?;

        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(ApiError::Unauthorized);
        }

        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|_| ApiError::message("Daymap didn't respond properly."))?;

        if !status.is_success() {
            return Err(ApiError::message(error_message(&text, status)));
        }

        serde_json::from_str(&text)
            .map_err(|_| ApiError::message("Daymap returned data this app couldn't read."))
    }

    pub async fn post(
        &self,
        path: &str,
        token: &str,
        body: &Value,
    ) -> Result<Value, ApiError> {
        let mut url = Url::parse(&format!(
            "{}/{}",
            self.base_url,
            path.trim_start_matches('/')
        ))
        .map_err(|_| ApiError::message("Couldn't build a Daymap request."))?;
        url.query_pairs_mut().append_pair("api-version", "3.0");

        let response = self
            .http
            .post(url)
            .header("Authorization", format!("Bearer {token}"))
            .header("DaymapClientId", &self.client_id)
            .header("Accept", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|_| ApiError::message("Can't reach Daymap. Check your connection and try again."))?;

        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(ApiError::Unauthorized);
        }

        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|_| ApiError::message("Daymap didn't respond properly."))?;
        if !status.is_success() {
            return Err(ApiError::message(error_message(&text, status)));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text)
            .map_err(|_| ApiError::message("Daymap returned data this app couldn't read."))
    }

    pub async fn get_ignoring_response(&self, path: &str, token: &str) -> Result<(), ApiError> {
        let mut url = Url::parse(&format!(
            "{}/{}",
            self.base_url,
            path.trim_start_matches('/')
        ))
        .map_err(|_| ApiError::message("Couldn't build a Daymap request."))?;
        url.query_pairs_mut().append_pair("api-version", "3.0");

        let response = self
            .http
            .get(url)
            .header("Authorization", format!("Bearer {token}"))
            .header("DaymapClientId", &self.client_id)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|_| ApiError::message("Can't reach Daymap. Check your connection and try again."))?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(ApiError::Unauthorized);
        }
        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(ApiError::message(error_message(&text, status)));
        }
        Ok(())
    }
}

pub(crate) fn error_message(text: &str, status: StatusCode) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        if let Some(message) = value.get("Message").and_then(Value::as_str) {
            return message.to_string();
        }
        if let Some(message) = value
            .get("Error")
            .and_then(|error| error.get("Message"))
            .and_then(Value::as_str)
        {
            return message.to_string();
        }
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        format!("Daymap returned HTTP {}.", status.as_u16())
    } else {
        trimmed.chars().take(180).collect()
    }
}

pub async fn fetch_dashboard(
    client: &ApiClient,
    user: &DaymapUser,
    token: &str,
) -> Result<Dashboard, ApiError> {
    let today = Local::now().date_naive();
    let year_start = format!("{}-01-01", today.format("%Y"));
    let year_end = format!("{}-12-31", today.format("%Y"));
    let diary_from = today.format("%Y-%m-%d").to_string();
    let diary_to = (today + Duration::days(13)).format("%Y-%m-%d").to_string();
    let student_id = user.daymap_id.unwrap_or(0);

    let assessment_query = [
        ("from", year_start),
        ("to", year_end),
    ];
    let active_query = [
        ("studentId", student_id.to_string()),
        ("allCompleted", "true".to_string()),
    ];
    let message_query = [
        ("folderId", "1".to_string()),
        ("page", "1".to_string()),
        ("msgsPerPage", "200".to_string()),
        ("unreadOnly", "false".to_string()),
    ];
    let diary_query = [
        ("from", diary_from),
        ("to", diary_to),
    ];

    let all_future = client.get("assessment", token, &assessment_query);
    let active_future = async {
        if student_id > 0 {
            client
                .get("assessment/studenttasklist", token, &active_query)
                .await
        } else {
            Ok(Value::Array(Vec::new()))
        }
    };
    let messages_future = client.get("messages/folder", token, &message_query);
    let notices_future = client.get("messages/schoolcoms", token, &[]);
    let diary_future = client.get("calendar/diaryitems", token, &diary_query);

    let (all, active, messages, notices, diary) = tokio::join!(
        all_future,
        active_future,
        messages_future,
        notices_future,
        diary_future
    );

    let all = all?;
    let active = match active {
        Ok(value) => value,
        Err(ApiError::Unauthorized) => return Err(ApiError::Unauthorized),
        Err(_) => Value::Array(Vec::new()),
    };
    let messages = messages?;
    let notices = match notices {
        Ok(value) => value,
        Err(ApiError::Unauthorized) => return Err(ApiError::Unauthorized),
        Err(_) => Value::Array(Vec::new()),
    };
    let diary = diary?;

    let mut tasks = normalize_tasks(array_items(all, &["Tasks", "Assessments"]));
    let active_tasks = normalize_tasks(array_items(active, &["Tasks", "Assessments"]));
    let known: std::collections::HashSet<i64> = tasks.iter().map(|task| task.id).collect();
    tasks.extend(active_tasks.into_iter().filter(|task| !known.contains(&task.id)));

    Ok(Dashboard {
        user: user.clone(),
        tasks,
        messages: normalize_messages(array_items(messages, &["Messages", "Items"])),
        notices: normalize_messages(array_items(notices, &["Messages", "Notices", "Items"])),
        diary: normalize_diary(array_items(diary, &["Items", "DiaryItems"])),
        fetched_at: chrono::Utc::now().to_rfc3339(),
        offline: false,
    })
}

pub(crate) fn array_items(value: Value, wrapper_keys: &[&str]) -> Vec<Value> {
    match value {
        Value::Array(items) => items,
        Value::Object(map) => {
            for key in wrapper_keys {
                if let Some(Value::Array(items)) = map.get(*key) {
                    return items.clone();
                }
            }
            Vec::new()
        }
        _ => Vec::new(),
    }
}

fn field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    for key in keys {
        if let Some(value) = value.get(*key) {
            if !value.is_null() {
                return Some(value);
            }
        }
    }
    None
}

pub(crate) fn field_string(value: &Value, keys: &[&str]) -> Option<String> {
    field(value, keys).and_then(|value| match value {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}

pub(crate) fn field_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    field(value, keys).and_then(|value| match value {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    })
}

pub(crate) fn field_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    field(value, keys).and_then(|value| match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    })
}

pub(crate) fn field_bool(value: &Value, keys: &[&str]) -> Option<bool> {
    field(value, keys).and_then(|value| match value {
        Value::Bool(value) => Some(*value),
        Value::Number(number) => number.as_i64().map(|value| value != 0),
        Value::String(text) => Some(text.eq_ignore_ascii_case("true") || text == "1"),
        _ => None,
    })
}

fn normalize_tasks(items: Vec<Value>) -> Vec<AssessmentTask> {
    items
        .into_iter()
        .filter_map(|item| {
            let id = field_i64(&item, &["ID", "Id", "id", "TaskID"])?;
            Some(AssessmentTask {
                id,
                name: field_string(&item, &["Name", "name"]).unwrap_or_else(|| "Untitled task".to_string()),
                class_name: field_string(&item, &["ClassName", "className"]),
                class_code: field_string(&item, &["ClassCode", "classCode"]),
                task_type: field_string(&item, &["Type", "type"]),
                teacher_name: field_string(&item, &["TeacherName", "teacherName"]),
                status: field_string(&item, &["Status", "status"]),
                overdue: field_bool(&item, &["Overdue", "overdue"]).unwrap_or(false),
                graded: field_bool(&item, &["Graded", "graded"]).unwrap_or(false),
                marked: field_bool(&item, &["Marked", "marked"]).unwrap_or(false),
                max_mark: field_f64(&item, &["MaxMark", "maxMark"]),
                due_date: field_string(&item, &["DueDate", "dueDate"]),
                set_date: field_string(&item, &["SetDate", "setDate"]),
                work_received: field_string(&item, &["WorkReceived", "workReceived"]),
            })
        })
        .collect()
}

pub(crate) fn normalize_messages(items: Vec<Value>) -> Vec<DaymapMessage> {
    items
        .into_iter()
        .filter_map(|item| {
            let id = field_i64(&item, &["MessageID", "ID", "Id", "id"])?;
            Some(DaymapMessage {
                id,
                subject: field_string(&item, &["Subject", "subject"])
                    .unwrap_or_else(|| "(No subject)".to_string()),
                text: field_string(&item, &["Text", "text"]),
                sender_name: field_string(&item, &["SenderName", "senderName"]),
                sent_on: field_string(&item, &["SentOn", "sentOn"]),
                thread_count: field_i64(&item, &["ThreadCount", "threadCount"]).unwrap_or(0),
                has_attachments: field_bool(&item, &["HasAttachments", "hasAttachments"]).unwrap_or(false),
                read: field_bool(&item, &["Read", "read"]).unwrap_or(true),
                sent_to: field_string(&item, &["SentTo", "sentTo"]),
                priority: field_i64(&item, &["Priority", "priority"]).unwrap_or(0),
            })
        })
        .collect()
}

fn normalize_diary(items: Vec<Value>) -> Vec<DiaryItem> {
    items
        .into_iter()
        .filter_map(|item| {
            let id = field_i64(&item, &["ID", "Id", "id"])?;
            Some(DiaryItem {
                id,
                title: field_string(&item, &["Title", "title"]).unwrap_or_else(|| "Lesson".to_string()),
                start: field_string(&item, &["Start", "start"]),
                finish: field_string(&item, &["Finish", "finish"]),
                text: field_string(&item, &["Text", "text"]),
                calendar: field_string(&item, &["Calendar", "calendar"]),
                attendance_status: field_i64(&item, &["AttendanceStatus", "attendanceStatus"]),
                attendance_reason: field_string(&item, &["AttendanceReason", "attendanceReason"]),
                item_type: field_i64(&item, &["Type", "type"]),
            })
        })
        .collect()
}
