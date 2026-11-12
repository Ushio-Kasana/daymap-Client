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

impl MessagePerson {
    /// Parent contacts are not shown anywhere in the client, whether they come
    /// from the directory or from a message thread.
    pub fn is_parent(&self) -> bool {
        self.type_label == "Parent"
    }
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
    #[serde(default)]
    pub room: Option<String>,
    #[serde(default)]
    pub teacher_name: Option<String>,
    #[serde(default)]
    pub substitute_name: Option<String>,
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentResult {
    /// The mark the teacher released, with the task's maximum when Daymap
    /// reports one. Both stay optional: schools name these fields differently.
    pub mark: Option<f64>,
    pub max_mark: Option<f64>,
    /// A letter or band grade, when the school releases one instead of a mark.
    pub grade: Option<String>,
    /// Plagiarism check percentage, when the submission was scanned.
    pub similarity: Option<f64>,
    /// Link to the full similarity report, when Daymap provides one.
    pub report_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassLesson {
    pub event_id: i64,
    pub date: Option<String>,
    pub period: Option<String>,
    pub room: Option<String>,
    pub teacher: Option<String>,
    pub subject: Option<String>,
    pub attendance_status: Option<i64>,
    pub note_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassNote {
    pub note_id: i64,
    pub event_id: i64,
    pub title: String,
    pub category: Option<String>,
    pub date: Option<String>,
    pub period: Option<String>,
    pub published: Option<String>,
    pub preview: Option<String>,
}

/// Attendance for the lessons the class overview loaded. `marked` counts the
/// lessons Daymap has marked present or absent; excused lessons are reported
/// separately so they don't drag the percentage down.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassAttendance {
    pub attended: i64,
    pub absent: i64,
    pub excused: i64,
    pub marked: i64,
    pub percentage: Option<i64>,
}

/// A file a teacher attached to a lesson. `file` keeps the same shape the
/// assignment resources use, so both can share the download command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassFile {
    pub file: AssignmentFile,
    pub event_id: i64,
    pub date: Option<String>,
    pub period: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassOverview {
    pub id: i64,
    pub name: String,
    pub code: Option<String>,
    pub subject: Option<String>,
    pub teachers: Option<String>,
    pub room: Option<String>,
    pub attendance: ClassAttendance,
    pub notes: Vec<ClassNote>,
    #[serde(default)]
    pub files: Vec<ClassFile>,
    #[serde(default)]
    pub offline: bool,
    #[serde(default)]
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentBundle {
    pub detail: AssignmentDetail,
    pub resources: Vec<AssignmentFile>,
    pub work: Vec<AssignmentFile>,
    pub work_received: Option<String>,
    #[serde(default)]
    pub result: AssignmentResult,
    /// Files Daymap attaches to the submission as results, such as marked work
    /// or the similarity report when the school releases it as a file.
    #[serde(default)]
    pub results: Vec<AssignmentFile>,
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
