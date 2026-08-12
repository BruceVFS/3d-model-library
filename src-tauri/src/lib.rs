use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{ipc::Response, AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const SUPPORTED_EXTENSIONS: &[&str] = &["stl", "3mf", "zip", "jpg", "jpeg", "png", "webp"];

#[derive(Default)]
struct LibraryState {
    root: Mutex<Option<PathBuf>>,
}

#[derive(Default)]
struct ScanCounters {
    folders_visited: usize,
    files_visited: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeScannedFile {
    name: String,
    extension: String,
    relative_path: String,
    folder_path: String,
    size: u64,
    last_modified: u64,
    native_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeLibraryScan {
    root_name: String,
    root_path: String,
    folders_visited: usize,
    files_visited: usize,
    files: Vec<NativeScannedFile>,
    warnings: Vec<String>,
}

fn supported_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    SUPPORTED_EXTENSIONS
        .contains(&extension.as_str())
        .then_some(extension)
}

fn relative_string(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|error| format!("Unable to resolve relative path: {error}"))?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn modified_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn walk_directory(
    root: &Path,
    directory: &Path,
    files: &mut Vec<NativeScannedFile>,
    counters: &mut ScanCounters,
    warnings: &mut Vec<String>,
) {
    counters.folders_visited += 1;

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => {
            warnings.push(format!(
                "Unable to read folder {}: {error}",
                directory.to_string_lossy()
            ));
            return;
        }
    };

    for entry_result in entries {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(format!("Unable to read a directory entry: {error}"));
                continue;
            }
        };

        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                warnings.push(format!(
                    "Unable to inspect {}: {error}",
                    path.to_string_lossy()
                ));
                continue;
            }
        };

        // Deliberately do not follow symlinks/reparse points during a catalogue scan.
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            walk_directory(root, &path, files, counters, warnings);
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        counters.files_visited += 1;
        let Some(extension) = supported_extension(&path) else {
            continue;
        };

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(format!(
                    "Unable to read metadata for {}: {error}",
                    path.to_string_lossy()
                ));
                continue;
            }
        };

        let relative_path = match relative_string(root, &path) {
            Ok(value) => value,
            Err(error) => {
                warnings.push(error);
                continue;
            }
        };

        let folder_path = Path::new(&relative_path)
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .filter(|parent| parent != ".")
            .unwrap_or_default();

        files.push(NativeScannedFile {
            name: entry.file_name().to_string_lossy().into_owned(),
            extension,
            relative_path,
            folder_path,
            size: metadata.len(),
            last_modified: modified_millis(&metadata),
            native_path: path.to_string_lossy().into_owned(),
        });
    }
}

fn scan_root(root: &Path) -> Result<NativeLibraryScan, String> {
    if !root.is_dir() {
        return Err("The selected library path is not a folder.".to_string());
    }

    let root_name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());

    let mut files = Vec::new();
    let mut counters = ScanCounters::default();
    let mut warnings = Vec::new();
    walk_directory(root, root, &mut files, &mut counters, &mut warnings);

    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    Ok(NativeLibraryScan {
        root_name,
        root_path: root.to_string_lossy().into_owned(),
        folders_visited: counters.folders_visited,
        files_visited: counters.files_visited,
        files,
        warnings,
    })
}

fn selected_root(app: &AppHandle) -> Result<PathBuf, String> {
    let state = app.state::<LibraryState>();

    let root = state
        .root
        .lock()
        .map_err(|_| "Unable to access the selected library state.".to_string())?
        .clone();

    root.ok_or_else(|| "Choose a library folder before accessing source files.".to_string())
}

fn validated_library_path(app: &AppHandle, requested: &str) -> Result<PathBuf, String> {
    let root = selected_root(app)?;
    let candidate = PathBuf::from(requested)
        .canonicalize()
        .map_err(|error| format!("Unable to access source path: {error}"))?;

    if !candidate.starts_with(&root) {
        return Err("The requested path is outside the selected library.".to_string());
    }

    Ok(candidate)
}

#[tauri::command]
async fn choose_and_scan_library(app: AppHandle) -> Result<Option<NativeLibraryScan>, String> {
    let selection = app
        .dialog()
        .file()
        .set_title("Choose 3D model library folder")
        .blocking_pick_folder();

    let Some(selection) = selection else {
        return Ok(None);
    };

    let root = selection
        .into_path()
        .map_err(|error| format!("Unable to use the selected folder: {error}"))?
        .canonicalize()
        .map_err(|error| format!("Unable to access the selected folder: {error}"))?;

    let scan = scan_root(&root)?;
    let state = app.state::<LibraryState>();
    *state
        .root
        .lock()
        .map_err(|_| "Unable to update the selected library state.".to_string())? = Some(root);

    Ok(Some(scan))
}

#[tauri::command]
async fn read_library_file(path: String, app: AppHandle) -> Result<Response, String> {
    let path = validated_library_path(&app, &path)?;
    if !path.is_file() {
        return Err("The requested source path is not a file.".to_string());
    }

    let data = fs::read(&path)
        .map_err(|error| format!("Unable to read {}: {error}", path.to_string_lossy()))?;
    Ok(Response::new(data))
}

#[tauri::command]
async fn open_containing_folder(path: String, app: AppHandle) -> Result<(), String> {
    let path = validated_library_path(&app, &path)?;
    let folder = if path.is_dir() {
        path
    } else {
        path.parent()
            .ok_or_else(|| "Unable to determine the source folder.".to_string())?
            .to_path_buf()
    };

    tauri_plugin_opener::open_path(&folder, None::<&str>)
        .map_err(|error| format!("Unable to open source folder: {error}"))
}

#[tauri::command]
async fn reveal_library_file(path: String, app: AppHandle) -> Result<(), String> {
    let path = validated_library_path(&app, &path)?;
    if !path.is_file() {
        return Err("The requested source path is not a file.".to_string());
    }

    tauri_plugin_opener::reveal_item_in_dir(&path)
        .map_err(|error| format!("Unable to reveal source file: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(LibraryState::default())
        .invoke_handler(tauri::generate_handler![
            choose_and_scan_library,
            read_library_file,
            open_containing_folder,
            reveal_library_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running 3D Model Library");
}
