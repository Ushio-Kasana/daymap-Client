use crate::api::{
    array_items, field_i64, field_string, normalize_messages, ApiClient, ApiError,
};
use crate::models::{DaymapMessage, MessageFolder, MessagePerson, StoredSession};
use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fmt;
use tokio::task::JoinSet;
use url::Url;

#[derive(Debug)]
pub enum MessageError {
    Unauthorized,
    Message(String),
}

impl fmt::Display for MessageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unauthorized => {
                formatter.write_str("Daymap rejected the request. Please sign in again.")
            }
            Self::Message(text) => formatter.write_str(text),
        }
    }
}

impl From<ApiError> for MessageError {
    fn from(error: ApiError) -> Self {
        match error {
            ApiError::Unauthorized => Self::Unauthorized,
            ApiError::Message(text) => Self::Message(text),
        }
    }
}

#[derive(Debug, Clone)]
pub struct MailboxSnapshot {
    pub folders: Vec<MessageFolder>,
    pub messages: HashMap<String, Vec<DaymapMessage>>,
    pub people: Vec<MessagePerson>,
    pub thread_people: HashMap<String, Vec<MessagePerson>>,
}

pub(crate) struct PortalClient {
    pub(crate) http: Client,
    base_url: String,
}

impl PortalClient {
    pub(crate) fn new(http: Client, api_base: &str) -> Result<Self, MessageError> {
        let url = Url::parse(api_base)
            .map_err(|_| MessageError::Message("Daymap returned an invalid API address.".to_string()))?;
        let host = url
            .host_str()
            .ok_or_else(|| MessageError::Message("Daymap returned an invalid API address.".to_string()))?;
        let mut base_url = format!("{}://{}", url.scheme(), host);
        if let Some(port) = url.port() {
            base_url.push(':');
            base_url.push_str(&port.to_string());
        }
        Ok(Self { http, base_url })
    }

    pub(crate) fn url(&self, path: &str) -> Result<Url, MessageError> {
        Url::parse(&format!(
            "{}/{}",
            self.base_url,
            path.trim_start_matches('/')
        ))
        .map_err(|_| MessageError::Message("Couldn't build a Daymap request.".to_string()))
    }

    pub(crate) async fn get(
        &self,
        path: &str,
        token: &str,
        query: &[(&str, String)],
    ) -> Result<Value, MessageError> {
        let mut url = self.url(path)?;
        if !query.is_empty() {
            let mut pairs = url.query_pairs_mut();
            for (key, value) in query {
                pairs.append_pair(key, value);
            }
        }

        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|_| {
                MessageError::Message("Can't reach Daymap. Check your connection and try again.".to_string())
            })?;

        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(MessageError::Unauthorized);
        }

        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|_| MessageError::Message("Daymap didn't respond properly.".to_string()))?;
        if !status.is_success() {
            return Err(MessageError::Message(response_error(&text, status)));
        }
        parse_value(&text)
    }

    pub(crate) async fn post(
        &self,
        path: &str,
        token: &str,
        body: &Value,
    ) -> Result<Value, MessageError> {
        let url = self.url(path)?;
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .header("Accept", "application/json")
            .json(body)
            .send()
            .await
            .map_err(|_| {
                MessageError::Message("Can't reach Daymap. Check your connection and try again.".to_string())
            })?;

        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(MessageError::Unauthorized);
        }

        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|_| MessageError::Message("Daymap didn't respond properly.".to_string()))?;
        if !status.is_success() {
            return Err(MessageError::Message(response_error(&text, status)));
        }
        parse_value(&text)
    }
}

fn parse_value(text: &str) -> Result<Value, MessageError> {
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(text)
        .map_err(|_| MessageError::Message("Daymap returned data this app couldn't read.".to_string()))
}

fn response_error(text: &str, status: StatusCode) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        for key in ["detail", "message", "Message", "title"] {
            if let Some(message) = value.get(key).and_then(Value::as_str) {
                if !message.trim().is_empty() {
                    return message.to_string();
                }
            }
        }
        if let Some(message) = value
            .get("Error")
            .and_then(|error| error.get("Message"))
            .and_then(Value::as_str)
        {
            if !message.trim().is_empty() {
                return message.to_string();
            }
        }
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        format!("Daymap returned HTTP {}.", status.as_u16())
    } else {
        trimmed.chars().take(180).collect()
    }
}

fn normalize_folder(item: &Value) -> Option<MessageFolder> {
    Some(MessageFolder {
        id: field_string(item, &["ID", "Id", "id"])?,
        title: field_string(item, &["Title", "title"])
            .unwrap_or_else(|| "Folder".to_string()),
        folder_type: field_i64(item, &["FolderType", "folderType"]),
        item_count: field_i64(item, &["ItemCount", "itemCount"]).unwrap_or(0),
    })
}

fn person_type_label(code: Option<i64>) -> String {
    match code {
        Some(1) => "Staff".to_string(),
        Some(2) => "Student".to_string(),
        Some(3) => "Parent".to_string(),
        _ => "Contact".to_string(),
    }
}

fn person_type_label_from(item: &Value) -> String {
    if let Some(code) = field_i64(item, &["ContactType", "PersonType", "Type"]) {
        return person_type_label(Some(code));
    }
    let label = field_string(
        item,
        &[
            "ContactTypeName",
            "ContactType",
            "PersonType",
            "PersonTypeName",
            "Type",
        ],
    )
    .unwrap_or_default()
    .to_lowercase();
    if label.contains("student") {
        "Student".to_string()
    } else if label.contains("parent") {
        "Parent".to_string()
    } else if label.contains("staff") || label.contains("teacher") {
        "Staff".to_string()
    } else {
        "Contact".to_string()
    }
}

fn normalize_person(item: &Value) -> Option<MessagePerson> {
    let id = field_i64(
        item,
        &[
            "ContactID",
            "ContactId",
            "contactID",
            "contactId",
            "PersonID",
            "PersonId",
            "personID",
            "personId",
            "ID",
            "Id",
            "id",
        ],
    )?;
    let first = field_string(item, &["Firstname", "FirstName", "firstName"]).unwrap_or_default();
    let surname = field_string(item, &["Surname", "surname"]).unwrap_or_default();
    let full_name = format!("{first} {surname}").trim().to_string();
    let title = field_string(item, &["DisplaynameSurname", "DisplayNameSurname"])
        .or_else(|| (!full_name.is_empty()).then_some(full_name))
        .or_else(|| {
            field_string(
                item,
                &["Displayname", "DisplayName", "Name"],
            )
        })
        .unwrap_or_else(|| "Contact".to_string());
    Some(MessagePerson {
        id,
        title,
        type_label: person_type_label_from(item),
    })
}

pub async fn load_folders(
    http: &Client,
    api_base: &str,
    token: &str,
) -> Result<Vec<MessageFolder>, MessageError> {
    let portal = PortalClient::new(http.clone(), api_base)?;
    let value = portal.get("/lms/api/coms/folders", token, &[]).await?;
    Ok(array_items(value, &["Folders"])
        .iter()
        .filter_map(normalize_folder)
        .collect())
}

pub async fn load_folder_messages(
    http: &Client,
    api_base: &str,
    token: &str,
    folder_id: &str,
) -> Result<Vec<DaymapMessage>, MessageError> {
    if folder_id.is_empty() || !folder_id.chars().all(|character| character.is_ascii_alphanumeric())
    {
        return Err(MessageError::Message(
            "That message folder is not valid.".to_string(),
        ));
    }
    let portal = PortalClient::new(http.clone(), api_base)?;
    let path = format!("/lms/api/coms/folder/{folder_id}");
    let value = portal
        .get(
            &path,
            token,
            &[
                ("page", "1".to_string()),
                ("msgsPerPage", "100".to_string()),
            ],
        )
        .await?;
    Ok(normalize_messages(array_items(
        value,
        &["Messages", "Items"],
    )))
}

pub async fn load_folder_pages(
    http: &Client,
    api_base: &str,
    token: &str,
    folder_id: &str,
) -> Result<Vec<DaymapMessage>, MessageError> {
    if folder_id.is_empty() || !folder_id.chars().all(|character| character.is_ascii_alphanumeric())
    {
        return Err(MessageError::Message(
            "That message folder is not valid.".to_string(),
        ));
    }
    let portal = PortalClient::new(http.clone(), api_base)?;
    let path = format!("/lms/api/coms/folder/{folder_id}");
    let mut all = Vec::new();
    let mut seen = HashSet::new();
    for page in 1..=20 {
        let value = portal
            .get(
                &path,
                token,
                &[
                    ("page", page.to_string()),
                    ("msgsPerPage", "100".to_string()),
                ],
            )
            .await?;
        let items = normalize_messages(array_items(value, &["Messages", "Items"]));
        if items.is_empty() {
            break;
        }
        let new_items: Vec<DaymapMessage> = items
            .iter()
            .filter(|message| seen.insert(message.id))
            .cloned()
            .collect();
        all.extend(new_items.iter().cloned());
        if items.len() < 100 || new_items.is_empty() {
            break;
        }
    }
    Ok(all)
}

pub async fn load_recipients(
    http: &Client,
    api_base: &str,
    token: &str,
    message_id: i64,
) -> Result<Vec<MessagePerson>, MessageError> {
    let portal = PortalClient::new(http.clone(), api_base)?;
    let path = format!("/lms/api/coms/message/{message_id}/thread");
    let value = portal.get(&path, token, &[]).await?;
    let mut seen = HashSet::new();
    let mut people = Vec::new();
    for message in array_items(value, &["Messages", "messages", "Items", "items"]) {
        for recipient in array_items(
            message,
            &["Recipients", "recipients", "People", "people", "Contacts", "contacts"],
        ) {
            if let Some(person) = normalize_person(&recipient) {
                if seen.insert(person.id) {
                    people.push(person);
                }
            }
        }
    }
    Ok(people)
}

pub async fn search_contacts(
    http: &Client,
    session: &StoredSession,
    token: &str,
    term: &str,
) -> Result<Vec<MessagePerson>, MessageError> {
    let client = ApiClient::new(
        http.clone(),
        session.api_base.clone(),
        session.client_id.clone(),
    )?;
    let value = client
        .get("contacts/find", token, &[("filter", term.to_string())])
        .await?;
    Ok(normalize_people(array_items(
        value,
        &["Contacts", "contacts", "Results", "results", "Items", "items"],
    )))
}

pub async fn directory_people(
    http: &Client,
    session: &StoredSession,
    token: &str,
) -> Result<Vec<MessagePerson>, MessageError> {
    let client = ApiClient::new(
        http.clone(),
        session.api_base.clone(),
        session.client_id.clone(),
    )?;
    let value = client
        .get("contacts/find", token, &[("filter", String::new())])
        .await?;
    Ok(normalize_people(array_items(
        value,
        &["Contacts", "contacts", "Results", "results", "Items", "items"],
    )))
}

pub async fn sync_mailbox(
    http: &Client,
    session: &StoredSession,
    token: &str,
    known_threads: &HashSet<i64>,
) -> Result<MailboxSnapshot, MessageError> {
    let folders = load_folders(http, &session.api_base, token).await?;
    let mut messages = HashMap::new();
    let mut message_ids = HashSet::new();

    for folder in &folders {
        let folder_messages =
            load_folder_pages(http, &session.api_base, token, &folder.id).await?;
        message_ids.extend(folder_messages.iter().map(|message| message.id));
        messages.insert(folder.id.clone(), folder_messages);
    }

    let mut people = directory_people(http, session, token)
        .await
        .unwrap_or_default();
    let mut thread_people = HashMap::new();
    let pending: Vec<i64> = message_ids
        .into_iter()
        .filter(|message_id| !known_threads.contains(message_id))
        .collect();

    if !pending.is_empty() {
        let http = http.clone();
        let api_base = session.api_base.clone();
        let token = token.to_string();
        let mut queue = pending.into_iter();
        let mut set = JoinSet::new();
        for _ in 0..6 {
            if let Some(message_id) = queue.next() {
                let http = http.clone();
                let api_base = api_base.clone();
                let token = token.clone();
                set.spawn(async move {
                    let members = load_recipients(&http, &api_base, &token, message_id)
                        .await
                        .unwrap_or_default();
                    (message_id, members)
                });
            }
        }

        while let Some(result) = set.join_next().await {
            if let Ok((message_id, members)) = result {
                if !members.is_empty() {
                    thread_people.insert(message_id.to_string(), members.clone());
                    people.extend(members);
                }
            }
            if let Some(message_id) = queue.next() {
                let http = http.clone();
                let api_base = api_base.clone();
                let token = token.clone();
                set.spawn(async move {
                    let members = load_recipients(&http, &api_base, &token, message_id)
                        .await
                        .unwrap_or_default();
                    (message_id, members)
                });
            }
        }
    }

    merge_people(&mut people);
    Ok(MailboxSnapshot {
        folders,
        messages,
        people,
        thread_people,
    })
}

fn normalize_people(items: Vec<Value>) -> Vec<MessagePerson> {
    let mut people: Vec<MessagePerson> = items.iter().filter_map(normalize_person).collect();
    merge_people(&mut people);
    people
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

fn merge_people(people: &mut Vec<MessagePerson>) {
    let mut by_id: HashMap<i64, MessagePerson> = HashMap::new();
    for person in people.drain(..) {
        let replace = match by_id.get(&person.id) {
            Some(existing) => title_quality(&person.title) > title_quality(&existing.title),
            None => true,
        };
        if replace {
            by_id.insert(person.id, person);
        }
    }
    let mut merged: Vec<MessagePerson> = by_id.into_values().collect();
    merged.sort_by(|left, right| {
        let left_rank = match left.type_label.as_str() {
            "Student" | "Parent" => 0,
            "Staff" => 1,
            _ => 2,
        };
        let right_rank = match right.type_label.as_str() {
            "Student" | "Parent" => 0,
            "Staff" => 1,
            _ => 2,
        };
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
    });
    *people = merged;
}

/// Uploads a message attachment through the portal's SAS flow. Daymap names
/// this purpose differently across portal versions, so try the plain message
/// purpose and fall back to the older name before giving up.
pub async fn upload_message_file(
    http: &Client,
    api_base: &str,
    token: &str,
    student_id: i64,
    file_name: &str,
    mime: &str,
    data: &[u8],
) -> Result<i64, MessageError> {
    let portal = PortalClient::new(http.clone(), api_base)?;
    let query = [
        ("studentId", student_id.to_string()),
        ("fileName", file_name.to_string()),
        ("size", data.len().to_string()),
    ];
    let mut sas = portal
        .get("/lms/api/files/upload/sas/message", token, &query)
        .await;
    if let Err(MessageError::Message(text)) = &sas {
        if text.contains("404") {
            sas = portal
                .get("/lms/api/files/upload/sas/messageattachment", token, &query)
                .await;
        }
    }
    let sas = sas?;

    let failure = |text: &str| MessageError::Message(text.to_string());
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
    // The SAS token is already URL-encoded, so append it verbatim.
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
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|_| failure("Couldn't send the file. Check your connection and try again."))?;

    if !response.status().is_success() {
        return Err(MessageError::Message(format!(
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
    Ok(file_id)
}

pub async fn send_new(
    http: &Client,
    api_base: &str,
    token: &str,
    text: &str,
    contact_ids: &[i64],
    attachment_ids: &[i64],
) -> Result<(), MessageError> {
    let portal = PortalClient::new(http.clone(), api_base)?;
    let mut payload = json!({
        "body": text,
        "threadID": Value::Null,
        "replyAll": false,
        "properties": {},
        "messageType": 10,
        "contactIds": contact_ids,
        "subject": ""
    });
    if !attachment_ids.is_empty() {
        payload["attachmentIds"] = json!(attachment_ids);
    }
    let draft = portal
        .post("/lms/api/coms/message/create", token, &payload)
        .await?;
    let message_id = field_i64(&draft, &["MessageID", "ID"]).ok_or_else(|| {
        MessageError::Message("Daymap didn't return the created message.".to_string())
    })?;
    let thread_id = field_i64(&draft, &["ThreadID"]).unwrap_or(message_id);
    let message_type = field_i64(&draft, &["MessageType"]).unwrap_or(10);
    portal
        .post(
            "/lms/api/coms/draft/send",
            token,
            &json!({
                "ThreadID": thread_id,
                "MessageID": message_id,
                "MessageType": message_type
            }),
        )
        .await?;
    Ok(())
}

pub async fn send_reply(
    http: &Client,
    session: &StoredSession,
    token: &str,
    text: &str,
    message_id: i64,
    attachment_ids: &[i64],
) -> Result<(), MessageError> {
    let client = ApiClient::new(
        http.clone(),
        session.api_base.clone(),
        session.client_id.clone(),
    )?;
    let mut payload = json!({
        "threadId": message_id,
        "text": text,
        "messageType": 10,
        "replyAll": false
    });
    if !attachment_ids.is_empty() {
        payload["attachmentIds"] = json!(attachment_ids);
    }
    let value = client.post("messages", token, &payload).await?;
    let sent_id = field_i64(&value, &["MessageID", "ID"])
        .ok_or_else(|| MessageError::Message("Daymap didn't return a message ID.".to_string()))?;
    client
        .get_ignoring_response(&format!("messages/send/{sent_id}"), token)
        .await?;
    Ok(())
}
