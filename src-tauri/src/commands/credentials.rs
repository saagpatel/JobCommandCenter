use keyring::Entry;

const SERVICE_NAME: &str = "com.jcc.app";

#[tauri::command]
#[specta::specta]
pub fn store_credential(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| {
        log::error!("Failed to create keychain entry for '{key}': {e}");
        format!("Failed to access keychain: {e}")
    })?;

    entry.set_password(&value).map_err(|e| {
        log::error!("Failed to store credential '{key}': {e}");
        format!("Failed to store credential: {e}")
    })
}

#[tauri::command]
#[specta::specta]
pub fn get_credential(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| {
        log::error!("Failed to create keychain entry for '{key}': {e}");
        format!("Failed to access keychain: {e}")
    })?;

    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => {
            log::error!("Failed to get credential '{key}': {e}");
            Err(format!("Failed to get credential: {e}"))
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn delete_credential(key: String) -> Result<bool, String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| {
        log::error!("Failed to create keychain entry for '{key}': {e}");
        format!("Failed to access keychain: {e}")
    })?;

    match entry.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => {
            log::error!("Failed to delete credential '{key}': {e}");
            Err(format!("Failed to delete credential: {e}"))
        }
    }
}
