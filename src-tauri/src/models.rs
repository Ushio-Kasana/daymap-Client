use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DaymapUser {
    #[serde(default, alias = "Username")]
    pub username: Option<String>,
    #[serde(default, alias = "SchoolCode")]
    pub school_code: Option<String>,
    #[serde(default, alias = "SchoolName")]
    pub school_name: Option<String>,
    #[serde(default, rename = "daymapID", alias = "DaymapID")]
    pub daymap_id: Option<i64>,
    #[serde(default, rename = "contactID", alias = "ContactID")]
    pub contact_id: Option<i64>,
    #[serde(default, alias = "Firstname")]
    pub firstname: Option<String>,
    #[serde(default, alias = "Surname")]
    pub surname: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession {
    pub school_code: String,
    pub api_base: String,
    pub id_server: String,
    pub client_id: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    pub expires_at: i64,
    pub user: DaymapUser,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentTask {
    pub id: i64,
    pub name: String,
    pub class_name: Option<String>,
    pub class_code: Option<String>,
    #[serde(rename = "type")]
    pub task_type: Option<String>,
    pub teacher_name: Option<String>,
    pub status: Option<String>,
    pub overdue: bool,
    pub graded: bool,
    pub marked: bool,
    pub max_mark: Option<f64>,
    pub due_date: Option<String>,
    pub set_date: Option<String>,
    pub work_received: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaymapMessage {
    pub id: i64,
    pub subject: String,
    pub text: Option<String>,
    pub sender_name: Option<String>,
    pub sent_on: Option<String>,
    pub thread_count: i64,
    pub has_attachments: bool,
    pub read: bool,
    pub sent_to: Option<String>,
    pub priority: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageFolder {
    pub id: String,
    pub title: String,
    pub folder_type: Option<i64>,
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePerson {
    pub id: i64,
    pub title: String,
    pub type_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryItem {
    pub id: i64,
    pub title: String,
    pub start: Option<String>,
    pub finish: Option<String>,
    pub text: Option<String>,
    pub calendar: Option<String>,
    pub attendance_status: Option<i64>,
    pub attendance_reason: Option<String>,
    #[serde(rename = "type")]
    pub item_type: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub user: DaymapUser,
    pub tasks: Vec<AssessmentTask>,
    pub messages: Vec<DaymapMessage>,
    pub notices: Vec<DaymapMessage>,
    pub diary: Vec<DiaryItem>,
    pub fetched_at: String,
    #[serde(default)]
    pub offline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentFile {
    pub id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub modified: Option<String>,
    pub external_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentDetail {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub class_name: Option<String>,
    pub class_code: Option<String>,
    #[serde(rename = "type")]
    pub task_type: Option<String>,
    pub teacher_name: Option<String>,
    pub status: Option<String>,
    pub max_mark: Option<f64>,
    pub due_date: Option<String>,
    pub set_date: Option<String>,
    pub work_received: Option<String>,
    pub student_can_upload: bool,
    pub student_can_delete_work: bool,
    pub overdue: bool,
    pub marked: bool,
    pub graded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentBundle {
    pub detail: AssignmentDetail,
    pub resources: Vec<AssignmentFile>,
    pub work: Vec<AssignmentFile>,
    pub work_received: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DiscoverInfo {
    #[serde(default)]
    pub api: Option<String>,
    #[serde(default, alias = "clientid", alias = "clientId")]
    pub client_id: Option<String>,
    #[serde(default, alias = "idserver", alias = "idServer")]
    pub id_server: Option<String>,
}
