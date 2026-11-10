use crate::api::{fetch_dashboard, ApiClient, ApiError};
use crate::cache;
use crate::messages::{self, MessageError};
use crate::models::{Dashboard, DaymapUser, DiscoverInfo, MessageFolder, MessagePerson, StoredSession};
use std::future::Future;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use rand::{rngs::OsRng, RngCore};
use reqwest::Client;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl};
use url::Url;

const AUTH_WINDOW_LABEL: &str = "daymap-auth";
const KEYRING_SERVICE: &str = "com.daymap.client.tauri";
const KEYRING_ACCOUNT: &str = "session";
const AUTH_SUCCESS_EVENT: &str = "auth-success";
const AUTH_ERROR_EVENT: &str = "auth-error";

pub struct AppState {
    pub http: Client,
    pub(crate) auth: Mutex<AuthState>,
    pub(crate) mailbox_sync_running: AtomicBool,
}

pub(crate) struct AuthState {
    pending: Option<PendingAuth>,
    session: Option<StoredSession>,
}

impl AppState {
    pub fn new() -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(25))
            .user_agent(format!("DaymapTauri/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("could not create the HTTP client");
        Self {
            http,
            auth: Mutex::new(AuthState {
                pending: None,
                session: None,
            }),
            mailbox_sync_running: AtomicBool::new(false),
        }
    }
}

#[derive(Clone)]
struct PendingAuth {
    school_code: String,
    redirect_uri: String,
    api_base: String,
    id_server: String,
    client_id: String,
    verifier: String,
    state: String,
    auth_url: String,
}

struct TokenBundle {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_in: i64,
}

#[derive(Default)]
struct Callback {
    code: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    state: Option<String>,
}

#[tauri::command]
pub async fn begin_sign_in(
    school: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let code = normalize_school(&school)?;
    let info = discover(&state.http, &code).await?;
    let api_base = info
        .api
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "That school didn't return a usable Daymap configuration.".to_string())?
        .to_string();
    let client_id = info
        .client_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "That school didn't return a usable Daymap configuration.".to_string())?
        .to_string();
    let id_server = info
        .id_server
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "That school didn't return a usable Daymap configuration.".to_string())?
        .trim_end_matches('/')
        .to_string();

    let redirect_uri = format!("https://{code}.daymap.net/daymap/mobile/");
    let verifier = random_value(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state_value = random_value(24);

    let mut auth_url = Url::parse(&format!("{id_server}/connect/authorize"))
        .map_err(|_| "Couldn't start the Daymap sign-in flow.".to_string())?;
    {
        let mut pairs = auth_url.query_pairs_mut();
        pairs
            .append_pair("client_id", &client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", "openid offline_access")
            .append_pair("state", &state_value)
            .append_pair("nonce", &random_value(24))
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &challenge);
    }

    let mut guard = state
        .auth
        .lock()
        .map_err(|_| "The sign-in state is unavailable.".to_string())?;
    guard.pending = Some(PendingAuth {
        school_code: code,
        redirect_uri,
        api_base,
        id_server,
        client_id,
        verifier,
        state: state_value,
        auth_url: auth_url.to_string(),
    });
    Ok(())
}

#[tauri::command]
pub fn open_auth_window(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let auth_url = {
        let guard = state
            .auth
            .lock()
            .map_err(|_| "The sign-in state is unavailable.".to_string())?;
        guard
            .pending
            .as_ref()
            .map(|pending| pending.auth_url.clone())
            .ok_or_else(|| "Start sign-in again.".to_string())?
    };

    let parsed = Url::parse(&auth_url).map_err(|_| "The Daymap sign-in address was invalid.".to_string())?;
    if let Some(existing) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        let _ = existing.close();
    }

    let navigation_app = app.clone();
    WebviewWindowBuilder::new(&app, AUTH_WINDOW_LABEL, WebviewUrl::External(parsed))
        .title("Sign in to Daymap")
        .inner_size(820.0, 860.0)
        .min_inner_size(540.0, 620.0)
        .center()
        .on_navigation(move |url| {
            if let Some(callback) = parse_callback(url) {
                handle_callback(navigation_app.clone(), callback);
                false
            } else {
                true
            }
        })
        .build()
        .map_err(|error| format!("Couldn't open the Daymap sign-in window: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn cancel_sign_in(app: AppHandle, state: State<'_, AppState>) {
    if let Ok(mut guard) = state.auth.lock() {
        guard.pending = None;
    }
    close_auth_window(&app);
}

#[tauri::command]
pub async fn restore_session(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<DaymapUser>, String> {
    let Some(mut session) = load_session() else {
        return Ok(None);
    };

    if session.expires_at <= Utc::now().timestamp() + 60 {
        if session.refresh_token.is_some() {
            if let Err(error) = refresh_and_store(&state, &mut session).await {
                // Keep the account available so cached messages and classes can
                // still be read without a connection. API commands fall back to
                // the offline cache and retry the refresh when they can.
                eprintln!("Daymap session refresh will be retried later: {error}");
            }
        }
    }

    {
        let mut guard = state
            .auth
            .lock()
            .map_err(|_| "The session state is unavailable.".to_string())?;
        guard.session = Some(session.clone());
    }
    let _ = app.emit("session-restored", &session.user);
    Ok(Some(session.user))
}

#[tauri::command]
pub async fn load_dashboard(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Dashboard, String> {
    let mut session = {
        let guard = state
            .auth
            .lock()
            .map_err(|_| "The session state is unavailable.".to_string())?;
        guard
            .session
            .clone()
            .ok_or_else(|| "You are not signed in.".to_string())?
    };

    let token = match valid_token(&state, &mut session).await {
        Ok(token) => token,
        Err(error) => {
            if let Some(cached) = cache::load_dashboard(&app, &session.user) {
                return Ok(cached);
            }
            return Err(error);
        }
    };
    let client = ApiClient::new(
        state.http.clone(),
        session.api_base.clone(),
        session.client_id.clone(),
    )
    .map_err(|error| error.to_string())?;

    let mut result = fetch_dashboard(&client, &session.user, &token).await;
    if matches!(result, Err(ApiError::Unauthorized)) {
        if refresh_and_store(&state, &mut session).await.is_ok() {
            let token = session.access_token.clone();
            result = fetch_dashboard(&client, &session.user, &token).await;
        }
    }

    match result {
        Ok(mut dashboard) => {
            dashboard.offline = false;
            let _ = cache::save_dashboard(&app, &session.user, &dashboard);
            Ok(dashboard)
        }
        Err(error) => {
            if let Some(cached) = cache::load_dashboard(&app, &session.user) {
                return Ok(cached);
            }
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn load_message_folders(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<MessageFolder>, String> {
    let user = current_user(&state).ok_or_else(|| "You are not signed in.".to_string())?;
    let http = state.http.clone();
    let result = with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        async move { messages::load_folders(&http, &session.api_base, &token).await }
    })
    .await;
    match result {
        Ok(folders) => {
            let _ = cache::save_folders(&app, &user, &folders);
            Ok(folders)
        }
        Err(error) => {
            let folders = cache::folders(&app, &user);
            if folders.is_empty() {
                Err(error)
            } else {
                Ok(folders)
            }
        }
    }
}

#[tauri::command]
pub async fn load_folder_messages(
    app: AppHandle,
    folder_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<crate::models::DaymapMessage>, String> {
    let user = current_user(&state).ok_or_else(|| "You are not signed in.".to_string())?;
    let folder_id_for_cache = folder_id.clone();
    let http = state.http.clone();
    let result = with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        let folder_id = folder_id.clone();
        async move {
            messages::load_folder_messages(&http, &session.api_base, &token, &folder_id).await
        }
    })
    .await;
    match result {
        Ok(messages) => {
            let _ = cache::save_folder_messages(&app, &user, &folder_id_for_cache, &messages);
            Ok(messages)
        }
        Err(error) => {
            let messages = cache::folder_messages(&app, &user, &folder_id_for_cache);
            if messages.is_empty() {
                Err(error)
            } else {
                Ok(messages)
            }
        }
    }
}

#[tauri::command]
pub async fn load_message_recipients(
    app: AppHandle,
    message_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<MessagePerson>, String> {
    let user = current_user(&state).ok_or_else(|| "You are not signed in.".to_string())?;
    let http = state.http.clone();
    let result = with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        async move {
            messages::load_recipients(&http, &session.api_base, &token, message_id).await
        }
    })
    .await;
    match result {
        Ok(people) => {
            if !people.is_empty() {
                let _ = cache::record_thread_people(&app, &user, message_id, &people);
            }
            Ok(people)
        }
        Err(error) => {
            let people = cache::thread_people(&app, &user, message_id);
            if people.is_empty() {
                Err(error)
            } else {
                Ok(people)
            }
        }
    }
}

#[tauri::command]
pub async fn search_contacts(
    app: AppHandle,
    term: String,
    state: State<'_, AppState>,
) -> Result<Vec<MessagePerson>, String> {
    let term = term.trim().to_string();
    if term.chars().count() < 3 {
        return Ok(Vec::new());
    }
    let user = current_user(&state).ok_or_else(|| "You are not signed in.".to_string())?;
    let local = cache::search_people(&app, &user, &term);
    // Student and parent names only exist in cached message participants.
    // Return those immediately rather than making search depend on a slow
    // directory request that only contains staff.
    if !local.is_empty() {
        return Ok(local);
    }
    let http = state.http.clone();
    let remote = with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        let term = term.clone();
        async move { messages::search_contacts(&http, &session, &token, &term).await }
    })
    .await;

    match remote {
        Ok(people) => {
            let _ = cache::merge_people(&app, &user, &people);
            Ok(merge_people_results(local, people))
        }
        Err(error) => {
            if local.is_empty() {
                Err(error)
            } else {
                Ok(local)
            }
        }
    }
}

fn merge_people_results(
    mut local: Vec<MessagePerson>,
    remote: Vec<MessagePerson>,
) -> Vec<MessagePerson> {
    for person in remote {
        if let Some(existing) = local.iter_mut().find(|item| item.id == person.id) {
            if title_quality(&person.title) > title_quality(&existing.title)
                || (existing.type_label == "Contact" && person.type_label != "Contact")
            {
                *existing = person;
            }
        } else {
            local.push(person);
        }
    }
    local.sort_by(|left, right| {
        let rank = |label: &str| match label {
            "Student" | "Parent" => 0,
            "Staff" => 1,
            _ => 2,
        };
        rank(&left.type_label)
            .cmp(&rank(&right.type_label))
            .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
    });
    local
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

#[tauri::command]
pub async fn sync_mailbox(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if state.mailbox_sync_running.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = sync_mailbox_inner(&app, state.inner()).await;
    state.mailbox_sync_running.store(false, Ordering::SeqCst);
    if result.is_ok() {
        let _ = app.emit("people-updated", true);
    }
    result
}

async fn sync_mailbox_inner(app: &AppHandle, state: &AppState) -> Result<(), String> {
    let user = current_user(state).ok_or_else(|| "You are not signed in.".to_string())?;
    if !cache::mailbox_needs_sync(app, &user) {
        return Ok(());
    }
    let known = cache::thread_ids(app, &user);
    let http = state.http.clone();
    let snapshot = with_authenticated(state, move |session, token| {
        let http = http.clone();
        let known = known.clone();
        async move {
            messages::sync_mailbox(&http, &session, &token, &known).await
        }
    })
    .await?;

    cache::save_mailbox(
        app,
        &user,
        &snapshot.folders,
        &snapshot.messages,
        &snapshot.people,
        &snapshot.thread_people,
    )?;
    Ok(())
}

#[tauri::command]
pub async fn send_new_message(
    text: String,
    contact_ids: Vec<i64>,
    attachment_ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if (text.is_empty() && attachment_ids.is_empty()) || contact_ids.is_empty() {
        return Err("Choose a recipient and write a message first.".to_string());
    }
    let http = state.http.clone();
    with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        let text = text.clone();
        let contact_ids = contact_ids.clone();
        let attachment_ids = attachment_ids.clone();
        async move {
            messages::send_new(
                &http,
                &session.api_base,
                &token,
                &text,
                &contact_ids,
                &attachment_ids,
            )
            .await
        }
    })
    .await
}

#[tauri::command]
pub async fn send_reply(
    text: String,
    message_id: i64,
    attachment_ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() && attachment_ids.is_empty() {
        return Err("Write a reply first.".to_string());
    }
    let http = state.http.clone();
    with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        let text = text.clone();
        let attachment_ids = attachment_ids.clone();
        async move {
            messages::send_reply(
                &http,
                &session,
                &token,
                &text,
                message_id,
                &attachment_ids,
            )
            .await
        }
    })
    .await
}

#[tauri::command]
pub async fn upload_message_attachment(
    path: String,
    mime: Option<String>,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let file_name = std::path::Path::new(&path)
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
        .unwrap_or_else(|| crate::assignments::guess_mime(&file_name));

    let http = state.http.clone();
    with_authenticated(state.inner(), move |session, token| {
        let http = http.clone();
        let file_name = file_name.clone();
        let mime = mime.clone();
        let data = data.clone();
        async move {
            let student_id = session
                .user
                .daymap_id
                .filter(|id| *id > 0)
                .ok_or_else(|| {
                    crate::messages::MessageError::Message(
                        "Daymap didn't return a student ID for this account.".to_string(),
                    )
                })?;
            messages::upload_message_file(
                &http,
                &session.api_base,
                &token,
                student_id,
                &file_name,
                &mime,
                &data,
            )
            .await
        }
    })
    .await
}

#[tauri::command]
pub fn sign_out(app: AppHandle, state: State<'_, AppState>) {
    // Keep the account-scoped offline cache out of the live session, but leave
    // it on disk so a later offline launch can still show saved school data.
    if let Ok(mut guard) = state.auth.lock() {
        guard.session = None;
        guard.pending = None;
    }
    delete_session();
    close_auth_window(&app);
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "That link is not valid.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only web links can be opened.".to_string());
    }
    open::that(parsed.as_str()).map_err(|error| format!("Couldn't open the link: {error}"))
}

fn handle_callback(app: AppHandle, callback: Callback) {
    if callback.code.is_none() && callback.error.is_none() {
        return;
    }

    let outcome: Result<(PendingAuth, String), String> = {
        let state = app.state::<AppState>();
        let mut guard = match state.auth.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return;
            }
        };
        let Some(pending) = guard.pending.take() else {
            return;
        };

        if let Some(error) = callback.error {
            let message = callback
                .error_description
                .filter(|description| !description.is_empty())
                .unwrap_or(error);
            Err(message)
        } else if let Some(expected) = callback.state.as_deref() {
            if expected != pending.state.as_str() {
                Err("The sign-in response didn't match this request. Please try again.".to_string())
            } else if let Some(code) = callback.code {
                Ok((pending, code))
            } else {
                Err("Daymap didn't return a sign-in code.".to_string())
            }
        } else if let Some(code) = callback.code {
            Ok((pending, code))
        } else {
            Err("Daymap didn't return a sign-in code.".to_string())
        }
    };

    close_auth_window(&app);
    match outcome {
        Ok((pending, code)) => {
            let auth_app = app.clone();
            tauri::async_runtime::spawn(async move {
                finish_sign_in(auth_app, pending, code).await;
            });
        }
        Err(message) => {
            let _ = app.emit(AUTH_ERROR_EVENT, message);
        }
    }
}

async fn finish_sign_in(app: AppHandle, pending: PendingAuth, code: String) {
    let result = async {
        let http = app.state::<AppState>().http.clone();
        let tokens = exchange(&http, &pending, &code).await?;
        let user = fetch_user(&http, &pending, &tokens.access_token).await?;
        let session = StoredSession {
            school_code: pending.school_code.clone(),
            api_base: pending.api_base.clone(),
            id_server: pending.id_server.clone(),
            client_id: pending.client_id.clone(),
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            id_token: tokens.id_token,
            expires_at: Utc::now().timestamp() + tokens.expires_in.max(60),
            user: user.clone(),
        };

        if let Err(error) = save_session(&session) {
            eprintln!("Daymap session was not persisted to the OS keychain: {error}");
        }
        {
            let state = app.state::<AppState>();
            let mut guard = state
                .auth
                .lock()
                .map_err(|_| "The session state is unavailable.".to_string())?;
            guard.session = Some(session);
        }
        Ok::<DaymapUser, String>(user)
    }
    .await;

    match result {
        Ok(user) => {
            let _ = app.emit(AUTH_SUCCESS_EVENT, user);
        }
        Err(message) => {
            let _ = app.emit(AUTH_ERROR_EVENT, message);
        }
    }
}

async fn discover(http: &Client, school: &str) -> Result<DiscoverInfo, String> {
    let url = format!("https://{school}.daymap.net/daymap/dws/discover.ashx");
    let response = http
        .get(url)
        .send()
        .await
        .map_err(|error| {
            eprintln!("Daymap discovery request failed for {school}: {error}");
            format!(
                "Couldn't reach {}. Check the school code and your connection.",
                school.to_uppercase()
            )
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "Couldn't reach {}. Check the school code and your connection.",
            school.to_uppercase()
        ));
    }
    response
        .json::<DiscoverInfo>()
        .await
        .map_err(|_| "That school code doesn't look like a Daymap school.".to_string())
}

async fn exchange(http: &Client, pending: &PendingAuth, code: &str) -> Result<TokenBundle, String> {
    let token_url = format!(
        "{}/connect/token",
        pending.id_server.trim_end_matches('/')
    );
    if let Ok(response) = http
        .post(token_url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", pending.client_id.as_str()),
            ("code", code),
            ("redirect_uri", pending.redirect_uri.as_str()),
            ("code_verifier", pending.verifier.as_str()),
        ])
        .send()
        .await
    {
        if response.status().is_success() {
            if let Ok(text) = response.text().await {
                if let Some(tokens) = parse_tokens(&text) {
                    return Ok(tokens);
                }
            }
        }
    }

    let mut fallback = Url::parse(&format!(
        "{}/authentication/getToken",
        pending.api_base.trim_end_matches('/')
    ))
    .map_err(|_| "Daymap rejected the sign-in. Please try again.".to_string())?;
    {
        let mut pairs = fallback.query_pairs_mut();
        pairs
            .append_pair("code", code)
            .append_pair("redirectUri", &pending.redirect_uri)
            .append_pair("codeVerifier", &pending.verifier);
    }

    let response = http
        .get(fallback)
        .header("DaymapClientId", &pending.client_id)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| "Couldn't reach Daymap to finish sign-in.".to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        let detail = token_error(&text);
        return Err(detail.unwrap_or_else(|| {
            format!("Daymap rejected the sign-in (HTTP {}). Please try again.", status.as_u16())
        }));
    }
    let text = response
        .text()
        .await
        .map_err(|_| "Daymap didn't return an access token.".to_string())?;
    parse_tokens(&text).ok_or_else(|| "Daymap didn't return an access token.".to_string())
}

async fn fetch_user(
    http: &Client,
    pending: &PendingAuth,
    token: &str,
) -> Result<DaymapUser, String> {
    let mut url = Url::parse(&format!(
        "{}/authentication",
        pending.api_base.trim_end_matches('/')
    ))
    .map_err(|_| "Couldn't load your Daymap profile.".to_string())?;
    url.query_pairs_mut().append_pair("api-version", "3.0");

    let response = http
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("DaymapClientId", &pending.client_id)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| "Couldn't load your Daymap profile.".to_string())?;
    if !response.status().is_success() {
        return Err("Signed in, but Daymap wouldn't return your profile.".to_string());
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|_| "Your Daymap profile came back in an unexpected format.".to_string())?;
    serde_json::from_value::<DaymapUser>(value)
        .map_err(|_| "Your Daymap profile came back in an unexpected format.".to_string())
}

pub(crate) fn current_user(state: &AppState) -> Option<DaymapUser> {
    state
        .auth
        .lock()
        .ok()
        .and_then(|guard| guard.session.as_ref().map(|session| session.user.clone()))
}

pub(crate) async fn with_authenticated<T, F, Fut>(state: &AppState, operation: F) -> Result<T, String>
where
    T: Send,
    F: Fn(StoredSession, String) -> Fut + Send,
    Fut: Future<Output = Result<T, MessageError>> + Send,
{
    let mut session = {
        let guard = state
            .auth
            .lock()
            .map_err(|_| "The session state is unavailable.".to_string())?;
        guard
            .session
            .clone()
            .ok_or_else(|| "You are not signed in.".to_string())?
    };
    let token = valid_token(state, &mut session).await?;
    match operation(session.clone(), token).await {
        Ok(value) => Ok(value),
        Err(MessageError::Unauthorized) => {
            refresh_and_store(state, &mut session).await?;
            let token = session.access_token.clone();
            operation(session, token)
                .await
                .map_err(|error| error.to_string())
        }
        Err(error) => Err(error.to_string()),
    }
}

async fn valid_token(state: &AppState, session: &mut StoredSession) -> Result<String, String> {
    if session.expires_at > Utc::now().timestamp() + 60 {
        return Ok(session.access_token.clone());
    }
    if session.refresh_token.is_none() {
        return Err("Your Daymap session has expired. Please sign in again.".to_string());
    }
    refresh_and_store(state, session).await?;
    Ok(session.access_token.clone())
}

async fn refresh_and_store(state: &AppState, session: &mut StoredSession) -> Result<(), String> {
    let refresh_token = session
        .refresh_token
        .clone()
        .ok_or_else(|| "Your Daymap session has expired. Please sign in again.".to_string())?;
    let token_url = format!("{}/connect/token", session.id_server.trim_end_matches('/'));
    let response = state
        .http
        .post(token_url)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", session.client_id.as_str()),
            ("refresh_token", refresh_token.as_str()),
        ])
        .send()
        .await
        .map_err(|_| "Couldn't refresh your Daymap session.".to_string())?;

    if response.status().as_u16() == 400 || response.status().as_u16() == 401 {
        return Err("Your Daymap session has expired. Please sign in again.".to_string());
    }
    if !response.status().is_success() {
        return Err("Couldn't refresh your Daymap session.".to_string());
    }
    let text = response
        .text()
        .await
        .map_err(|_| "Couldn't read the refreshed Daymap session.".to_string())?;
    let tokens = parse_tokens(&text)
        .ok_or_else(|| "Daymap didn't return a refreshed access token.".to_string())?;

    session.access_token = tokens.access_token;
    session.refresh_token = tokens.refresh_token.or_else(|| session.refresh_token.clone());
    session.id_token = tokens.id_token.or_else(|| session.id_token.clone());
    session.expires_at = Utc::now().timestamp() + tokens.expires_in.max(60);

    if let Err(error) = save_session(session) {
        eprintln!("Daymap session was not persisted to the OS keychain: {error}");
    }
    if let Ok(mut guard) = state.auth.lock() {
        guard.session = Some(session.clone());
    }
    Ok(())
}

fn parse_tokens(text: &str) -> Option<TokenBundle> {
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        if let Value::String(raw) = &value {
            if !raw.is_empty() {
                return Some(TokenBundle {
                    access_token: raw.clone(),
                    refresh_token: None,
                    id_token: None,
                    expires_in: 3600,
                });
            }
        }
        if value.is_object() {
            let access = token_string(&value, &["access_token", "accessToken", "Token", "token"])?;
            return Some(TokenBundle {
                access_token: access,
                refresh_token: token_string(&value, &["refresh_token", "refreshToken"]),
                id_token: token_string(&value, &["id_token", "idToken"]),
                expires_in: token_number(&value, &["expires_in", "expiresIn"])
                    .map(|value| value as i64)
                    .filter(|value| *value > 0)
                    .unwrap_or(3600),
            });
        }
    }

    let trimmed = text.trim();
    if trimmed.starts_with("eyJ")
        || (trimmed.len() > 100 && !trimmed.chars().any(char::is_whitespace))
    {
        return Some(TokenBundle {
            access_token: trimmed.to_string(),
            refresh_token: None,
            id_token: None,
            expires_in: 3600,
        });
    }
    None
}

fn token_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

fn token_number(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        value.get(*key).and_then(|value| match value {
            Value::Number(number) => number.as_f64(),
            Value::String(text) => text.parse().ok(),
            _ => None,
        })
    })
}

fn token_error(text: &str) -> Option<String> {
    let value: Value = serde_json::from_str(text).ok()?;
    token_string(&value, &["error_description", "error"])
}

fn parse_callback(url: &Url) -> Option<Callback> {
    let mut callback = Callback::default();
    let mut found = false;

    for (key, value) in url.query_pairs() {
        let key = key.to_string();
        let value = value.to_string();
        found = true;
        match key.as_str() {
            "code" => callback.code = Some(value),
            "error" => callback.error = Some(value.replace('+', " ")),
            "error_description" => {
                callback.error_description = Some(value.replace('+', " "))
            }
            "state" => callback.state = Some(value),
            _ => {}
        }
    }

    if let Some(fragment) = url.fragment() {
        for (key, value) in url::form_urlencoded::parse(fragment.as_bytes()) {
            found = true;
            match key.as_ref() {
                "code" => callback.code = Some(value.into_owned()),
                "error" => callback.error = Some(value.replace('+', " ")),
                "error_description" => {
                    callback.error_description = Some(value.replace('+', " "))
                }
                "state" => callback.state = Some(value.into_owned()),
                _ => {}
            }
        }
    }

    if found && (callback.code.is_some() || callback.error.is_some()) {
        Some(callback)
    } else {
        None
    }
}

fn normalize_school(raw: &str) -> Result<String, String> {
    let mut value = raw.trim().to_lowercase();
    if value.contains("://") {
        if let Ok(url) = Url::parse(&value) {
            value = url.host_str().unwrap_or("").to_string();
        }
    }
    if value.ends_with(".daymap.net") {
        value.truncate(value.len() - ".daymap.net".len());
    }
    value = value.replace('/', "");
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Enter your school's Daymap code, for example school.".to_string());
    }
    Ok(value)
}

fn random_value(bytes: usize) -> String {
    let mut buffer = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut buffer);
    URL_SAFE_NO_PAD.encode(buffer)
}

fn close_auth_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        let _ = window.close();
    }
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| format!("Couldn't access the OS keychain: {error}"))
}

fn save_session(session: &StoredSession) -> Result<(), String> {
    let data = serde_json::to_string(session)
        .map_err(|_| "Couldn't encode the Daymap session.".to_string())?;
    keyring_entry()?
        .set_password(&data)
        .map_err(|error| format!("Couldn't save the Daymap session: {error}"))
}

fn load_session() -> Option<StoredSession> {
    let entry = match keyring_entry() {
        Ok(entry) => entry,
        Err(error) => {
            eprintln!("{error}");
            return None;
        }
    };
    let data = match entry.get_password() {
        Ok(data) => data,
        Err(keyring::Error::NoEntry) => return None,
        Err(error) => {
            eprintln!("Couldn't read the Daymap session: {error}");
            return None;
        }
    };
    serde_json::from_str(&data).ok()
}

fn delete_session() {
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
}
