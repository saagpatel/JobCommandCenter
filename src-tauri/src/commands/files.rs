use std::path::Path;

#[tauri::command]
#[specta::specta]
pub fn validate_file_path(path: String) -> Result<bool, String> {
    let expanded = shellexpand::tilde(&path);
    let file_path = Path::new(expanded.as_ref());
    Ok(file_path.exists() && file_path.is_file())
}

#[tauri::command]
#[specta::specta]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path);
    let file_path = Path::new(expanded.as_ref());

    if !file_path.exists() {
        return Err(format!("File not found: {path}"));
    }

    std::process::Command::new("open")
        .arg("-R")
        .arg(file_path)
        .spawn()
        .map_err(|e| {
            log::error!("Failed to reveal in Finder: {e}");
            format!("Failed to reveal in Finder: {e}")
        })?;

    Ok(())
}
