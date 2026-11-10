mod api;
mod assignments;
mod auth;
mod cache;
mod messages;
mod models;
mod overdue;
mod touch_id;
mod updates;

use assignments::{
    cached_assignment, download_assignment_file, load_assignment, upload_assignment_file,
};
use auth::{
    begin_sign_in, cached_timetable_week, cancel_sign_in, load_cached_dashboard, load_dashboard,
    load_folder_messages, load_message_folders, load_message_recipients, load_timetable,
    open_auth_window, open_external, reset_cache, restore_session, search_contacts,
    send_new_message, send_reply, set_touch_id_enabled, sign_out, sync_mailbox,
    touch_id_enabled, upload_message_attachment, AppState,
};
use overdue::{load_overdue_settings, save_overdue_settings};
use updates::{download_update, open_update_installer, quit_app};

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
            touch_id_enabled,
            set_touch_id_enabled,
            load_overdue_settings,
            save_overdue_settings,
            load_dashboard,
            load_cached_dashboard,
            load_timetable,
            cached_timetable_week,
            reset_cache,
            cached_assignment,
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
            upload_assignment_file,
            upload_message_attachment,
            download_update,
            open_update_installer,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Daymap");
}
