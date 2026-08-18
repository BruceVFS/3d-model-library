use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrintAnalysisRequest {
    model_path: String,
    slicer_path: String,
    config_path: String,
    material_density_g_per_cm3: f64,
    spool_weight_g: f64,
    spool_cost: f64,
    currency: String,
    strategy: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrintAnalysisResult {
    slicer_name: String,
    slicer_version: Option<String>,
    estimated_seconds: u64,
    filament_length_mm: Option<f64>,
    filament_volume_cm3: Option<f64>,
    filament_weight_g: Option<f64>,
    material_cost: Option<f64>,
    currency: String,
    warnings: Vec<String>,
    strategy: String,
    layer_height_mm: Option<f64>,
    perimeter_count: Option<u32>,
    infill_percent: Option<u32>,
}

#[derive(Clone, Copy)]
struct PrintStrategySpec {
    id: &'static str,
    layer_height_mm: Option<f64>,
    perimeter_count: Option<u32>,
    infill_percent: Option<u32>,
}

fn print_strategy_spec(strategy: Option<&str>) -> Result<PrintStrategySpec, String> {
    match strategy
        .unwrap_or("baseline")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "baseline" => Ok(PrintStrategySpec {
            id: "baseline",
            layer_height_mm: None,
            perimeter_count: None,
            infill_percent: None,
        }),
        "fast" => Ok(PrintStrategySpec {
            id: "fast",
            layer_height_mm: Some(0.28),
            perimeter_count: Some(2),
            infill_percent: Some(10),
        }),
        "balanced" => Ok(PrintStrategySpec {
            id: "balanced",
            layer_height_mm: Some(0.20),
            perimeter_count: Some(3),
            infill_percent: Some(15),
        }),
        "strength" => Ok(PrintStrategySpec {
            id: "strength",
            layer_height_mm: Some(0.20),
            perimeter_count: Some(5),
            infill_percent: Some(30),
        }),
        "quality" => Ok(PrintStrategySpec {
            id: "quality",
            layer_height_mm: Some(0.12),
            perimeter_count: Some(3),
            infill_percent: Some(15),
        }),
        other => Err(format!("Unknown Print Analysis strategy: {other}")),
    }
}

fn apply_strategy_overrides(command: &mut Command, strategy: PrintStrategySpec) {
    if let Some(layer_height) = strategy.layer_height_mm {
        command
            .arg("--layer-height")
            .arg(format!("{layer_height:.2}"));
    }
    if let Some(perimeters) = strategy.perimeter_count {
        command.arg("--perimeters").arg(perimeters.to_string());
    }
    if let Some(infill) = strategy.infill_percent {
        command.arg("--fill-density").arg(format!("{infill}%"));
    }
}

#[derive(Default)]
struct ParsedGcodeMetrics {
    estimated_seconds: Option<u64>,
    filament_length_mm: Option<f64>,
    filament_volume_cm3: Option<f64>,
}

fn parse_metric(line: &str, prefix: &str) -> Option<f64> {
    line.strip_prefix(prefix)?.trim().parse::<f64>().ok()
}

fn parse_duration_seconds(value: &str) -> Option<u64> {
    let mut total = 0_u64;
    let mut parsed_any = false;

    for token in value.split_whitespace() {
        if token.len() < 2 {
            continue;
        }
        let (number, unit) = token.split_at(token.len() - 1);
        let amount = number.parse::<u64>().ok()?;
        match unit {
            "d" => total = total.saturating_add(amount.saturating_mul(86_400)),
            "h" => total = total.saturating_add(amount.saturating_mul(3_600)),
            "m" => total = total.saturating_add(amount.saturating_mul(60)),
            "s" => total = total.saturating_add(amount),
            _ => continue,
        }
        parsed_any = true;
    }

    parsed_any.then_some(total)
}

fn parse_gcode_metrics(path: &Path) -> Result<ParsedGcodeMetrics, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("Unable to read temporary G-code: {error}"))?;
    let reader = BufReader::new(file);
    let mut metrics = ParsedGcodeMetrics::default();

    for line in reader.lines() {
        let line = line.map_err(|error| format!("Unable to parse temporary G-code: {error}"))?;
        if metrics.filament_length_mm.is_none() {
            metrics.filament_length_mm = parse_metric(&line, "; filament used [mm] = ");
        }
        if metrics.filament_volume_cm3.is_none() {
            metrics.filament_volume_cm3 = parse_metric(&line, "; filament used [cm3] = ");
        }
        if metrics.estimated_seconds.is_none() {
            if let Some(value) = line.strip_prefix("; estimated printing time (normal mode) = ") {
                metrics.estimated_seconds = parse_duration_seconds(value.trim());
            }
        }
    }

    Ok(metrics)
}

fn looks_like_progress_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    let digit_count = trimmed
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .count();
    digit_count > 0 && trimmed[digit_count..].trim_start().starts_with("=>")
}

fn extract_slicer_warnings(output: &str) -> Vec<String> {
    let mut warnings = Vec::new();
    let mut capturing = false;

    for raw_line in output.lines() {
        let line = raw_line.trim();
        if line.to_ascii_lowercase().starts_with("print warning:") {
            capturing = true;
            let message = line
                .split_once(':')
                .map(|(_, value)| value.trim())
                .unwrap_or("");
            if !message.is_empty() {
                warnings.push(message.to_string());
            }
            continue;
        }

        if !capturing {
            continue;
        }
        if looks_like_progress_line(line) || line.starts_with("Slicing result") {
            capturing = false;
            continue;
        }
        if !line.is_empty() && !warnings.iter().any(|existing| existing == line) {
            warnings.push(line.to_string());
        }
    }

    warnings
}

fn prusaslicer_version(slicer: &Path) -> Option<String> {
    let output = Command::new(slicer).arg("--help").output().ok()?;
    let combined = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    combined.lines().find_map(|line| {
        let line = line.trim();
        let remainder = line.strip_prefix("PrusaSlicer-")?;
        remainder.split_whitespace().next().map(str::to_string)
    })
}

fn canonical_external_file(requested: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(requested)
        .canonicalize()
        .map_err(|error| format!("Unable to access {label}: {error}"))?;
    if !path.is_file() {
        return Err(format!("The selected {label} is not a file."));
    }
    Ok(path)
}

fn run_print_analysis(
    request: PrintAnalysisRequest,
    app: &AppHandle,
) -> Result<PrintAnalysisResult, String> {
    if !request.material_density_g_per_cm3.is_finite() || request.material_density_g_per_cm3 <= 0.0
    {
        return Err("Material density must be greater than zero.".to_string());
    }
    if !request.spool_weight_g.is_finite() || request.spool_weight_g <= 0.0 {
        return Err("Spool weight must be greater than zero.".to_string());
    }
    if !request.spool_cost.is_finite() || request.spool_cost <= 0.0 {
        return Err("Spool cost must be greater than zero.".to_string());
    }

    let model = validated_library_path(app, &request.model_path)?;
    if !model.is_file()
        || model
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| !value.eq_ignore_ascii_case("stl"))
            .unwrap_or(true)
    {
        return Err("Print Analysis currently supports STL files only.".to_string());
    }

    let slicer = canonical_external_file(&request.slicer_path, "PrusaSlicer executable")?;
    let slicer_name = slicer
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if !slicer_name.eq_ignore_ascii_case("prusa-slicer-console.exe") {
        return Err("For this proof of concept, select prusa-slicer-console.exe.".to_string());
    }

    let config = canonical_external_file(&request.config_path, "PrusaSlicer configuration")?;
    if config
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| !value.eq_ignore_ascii_case("ini"))
        .unwrap_or(true)
    {
        return Err("The baseline PrusaSlicer configuration must be an .ini file.".to_string());
    }

    let strategy = print_strategy_spec(request.strategy.as_deref())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let temp_gcode = std::env::temp_dir().join(format!(
        "modelarium-analysis-{}-{}-{timestamp}.gcode",
        std::process::id(),
        strategy.id
    ));

    let mut command = Command::new(&slicer);
    command.arg("--load").arg(&config);
    apply_strategy_overrides(&mut command, strategy);
    let output = command
        .arg("--export-gcode")
        .arg("--output")
        .arg(&temp_gcode)
        .arg(&model)
        .output()
        .map_err(|error| format!("Unable to start PrusaSlicer: {error}"))?;

    let console_output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let mut warnings = extract_slicer_warnings(&console_output);

    if !output.status.success() {
        let _ = fs::remove_file(&temp_gcode);
        let detail = console_output
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("PrusaSlicer returned an error.");
        return Err(format!("PrusaSlicer analysis failed: {detail}"));
    }
    if !temp_gcode.is_file() {
        return Err(
            "PrusaSlicer completed without producing the expected temporary G-code file."
                .to_string(),
        );
    }

    let metrics = parse_gcode_metrics(&temp_gcode);
    if let Err(error) = fs::remove_file(&temp_gcode) {
        warnings.push(format!("Temporary G-code cleanup failed: {error}"));
    }
    let metrics = metrics?;
    let estimated_seconds = metrics
        .estimated_seconds
        .ok_or_else(|| "The G-code did not contain an estimated printing time.".to_string())?;

    let filament_weight_g = metrics
        .filament_volume_cm3
        .map(|volume| volume * request.material_density_g_per_cm3);
    let material_cost =
        filament_weight_g.map(|weight| (weight / request.spool_weight_g) * request.spool_cost);

    Ok(PrintAnalysisResult {
        strategy: strategy.id.to_string(),
        slicer_name: "PrusaSlicer".to_string(),
        slicer_version: prusaslicer_version(&slicer),
        estimated_seconds,
        filament_length_mm: metrics.filament_length_mm,
        filament_volume_cm3: metrics.filament_volume_cm3,
        filament_weight_g,
        material_cost,
        currency: if request.currency.trim().is_empty() {
            "R".to_string()
        } else {
            request.currency.trim().to_string()
        },
        warnings,
        layer_height_mm: strategy.layer_height_mm,
        perimeter_count: strategy.perimeter_count,
        infill_percent: strategy.infill_percent,
    })
}

#[tauri::command]
async fn detect_prusaslicer() -> Result<Option<String>, String> {
    let standard = PathBuf::from(r"C:\Program Files\Prusa3D\PrusaSlicer\prusa-slicer-console.exe");
    if standard.is_file() {
        return Ok(Some(standard.to_string_lossy().into_owned()));
    }

    #[cfg(target_os = "windows")]
    if let Ok(output) = Command::new("where.exe")
        .arg("prusa-slicer-console.exe")
        .output()
    {
        if output.status.success() {
            if let Some(first) = String::from_utf8_lossy(&output.stdout)
                .lines()
                .find(|line| !line.trim().is_empty())
            {
                let candidate = PathBuf::from(first.trim());
                if candidate.is_file() {
                    return Ok(Some(candidate.to_string_lossy().into_owned()));
                }
            }
        }
    }

    Ok(None)
}

#[tauri::command]
async fn choose_prusaslicer_executable(app: AppHandle) -> Result<Option<String>, String> {
    let selection = app
        .dialog()
        .file()
        .set_title("Choose PrusaSlicer console executable")
        .add_filter("PrusaSlicer console", &["exe"])
        .blocking_pick_file();
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|error| format!("Unable to use the selected executable: {error}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn choose_prusaslicer_config(app: AppHandle) -> Result<Option<String>, String> {
    let selection = app
        .dialog()
        .file()
        .set_title("Choose exported PrusaSlicer configuration")
        .add_filter("PrusaSlicer configuration", &["ini"])
        .blocking_pick_file();
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|error| format!("Unable to use the selected configuration: {error}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn analyse_print(
    request: PrintAnalysisRequest,
    app: AppHandle,
) -> Result<PrintAnalysisResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_print_analysis(request, &app))
        .await
        .map_err(|error| format!("Print Analysis task failed: {error}"))?
}

#[cfg(test)]
mod print_analysis_tests {
    use super::{extract_slicer_warnings, parse_duration_seconds, print_strategy_spec};

    #[test]
    fn parses_prusaslicer_duration() {
        assert_eq!(parse_duration_seconds("31m 0s"), Some(1_860));
        assert_eq!(parse_duration_seconds("1h 2m 3s"), Some(3_723));
    }

    #[test]
    fn defines_four_strategy_overlays() {
        let fast = print_strategy_spec(Some("fast")).expect("fast strategy");
        assert_eq!(fast.layer_height_mm, Some(0.28));
        assert_eq!(fast.perimeter_count, Some(2));
        assert_eq!(fast.infill_percent, Some(10));

        let balanced = print_strategy_spec(Some("balanced")).expect("balanced strategy");
        assert_eq!(balanced.layer_height_mm, Some(0.20));
        assert_eq!(balanced.perimeter_count, Some(3));
        assert_eq!(balanced.infill_percent, Some(15));

        let strength = print_strategy_spec(Some("strength")).expect("strength strategy");
        assert_eq!(strength.perimeter_count, Some(5));
        assert_eq!(strength.infill_percent, Some(30));

        let quality = print_strategy_spec(Some("quality")).expect("quality strategy");
        assert_eq!(quality.layer_height_mm, Some(0.12));

        assert!(print_strategy_spec(Some("unknown")).is_err());
    }

    #[test]
    fn captures_warning_block() {
        let sample = "69 => Alert if supports needed\nprint warning: Detected print stability issues:\n\nWedgeScraper.stl\nLow bed adhesion\n\nConsider enabling brim.\n89 => Calculating overhanging perimeters";
        let warnings = extract_slicer_warnings(sample);
        assert!(warnings
            .iter()
            .any(|line| line.contains("Low bed adhesion")));
        assert!(warnings
            .iter()
            .any(|line| line.contains("Consider enabling brim")));
    }
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
            reveal_library_file,
            detect_prusaslicer,
            choose_prusaslicer_executable,
            choose_prusaslicer_config,
            analyse_print
        ])
        .run(tauri::generate_context!())
        .expect("error while running 3D Model Library");
}
