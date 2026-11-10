mod api;
mod assignments;
mod auth;
mod cache;
mod messages;
mod models;

use assignments::{download_assignment_file, load_assignment, upload_assignment_file};
use auth::{
    begin_sign_in, cancel_sign_in, load_dashboard, load_folder_messages, load_message_folders,
    load_message_recipients, open_auth_window, open_external, restore_session, search_contacts,
    send_new_message, send_reply, sign_out, sync_mailbox, AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            begin_sign_in,
            open_auth_window,
            cancel_sign_in,
            restore_session,
            load_dashboard,
            load_message_folders,
            load_folder_messages,
            load_message_recipients,
            search_contacts,
            sync_mailbox,
            send_new_message,
            send_reply,
            sign_out,
            open_external,
            load_assignment,
            download_assignment_file,
            upload_assignment_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Daymap");
}
