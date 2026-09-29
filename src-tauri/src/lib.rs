use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use std::{fs, path::Path};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedImage {
    filename: String,
    data_url: String,
}

const ALLOWED_FILES: [&str; 4] = [
    "01-drop.png",
    "02-cover.png",
    "03-hold-on.png",
    "results-collage.png",
];

fn safe_session_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value.split('/').all(|part| {
            !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}

fn valid_image_set(images: &[SavedImage]) -> bool {
    images.len() == ALLOWED_FILES.len()
        && ALLOWED_FILES.iter().all(|allowed| {
            images
                .iter()
                .filter(|image| image.filename == *allowed)
                .count()
                == 1
        })
}

#[tauri::command]
fn save_earthquake_session(
    app: tauri::AppHandle,
    session_name: String,
    images: Vec<SavedImage>,
) -> Result<String, String> {
    if !safe_session_name(&session_name) || !valid_image_set(&images) {
        return Err("Invalid photo session".into());
    }
    let pictures = app
        .path()
        .picture_dir()
        .map_err(|error| format!("Pictures folder is unavailable: {error}"))?;
    let folder = pictures
        .join("Resilient 4 DRRM AR Games")
        .join(Path::new(&session_name));
    fs::create_dir_all(&folder)
        .map_err(|error| format!("Could not create photo folder: {error}"))?;
    for image in images {
        if !ALLOWED_FILES.contains(&image.filename.as_str()) {
            return Err("Invalid photo filename".into());
        }
        let encoded = image
            .data_url
            .strip_prefix("data:image/png;base64,")
            .ok_or_else(|| "Only PNG photos are supported".to_string())?;
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| "Photo data is invalid".to_string())?;
        fs::write(folder.join(&image.filename), bytes)
            .map_err(|error| format!("Could not save {}: {error}", image.filename))?;
    }
    Ok(folder.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(filename: &str) -> SavedImage {
        SavedImage {
            filename: filename.into(),
            data_url: "data:image/png;base64,AA==".into(),
        }
    }

    #[test]
    fn accepts_only_scoped_session_paths() {
        assert!(safe_session_name("2026-09-29/14-22-03-group-5"));
        assert!(!safe_session_name("../outside"));
        assert!(!safe_session_name("2026-09-29/group_5"));
        assert!(!safe_session_name(""));
    }

    #[test]
    fn requires_each_approved_filename_exactly_once() {
        let valid = ALLOWED_FILES
            .iter()
            .map(|name| image(name))
            .collect::<Vec<_>>();
        assert!(valid_image_set(&valid));

        let duplicate = vec![
            image("01-drop.png"),
            image("01-drop.png"),
            image("03-hold-on.png"),
            image("results-collage.png"),
        ];
        assert!(!valid_image_set(&duplicate));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_earthquake_session])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
