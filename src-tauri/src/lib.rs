/// 辑印 Albumark 桌面端入口。
/// 图像处理全部在前端 Web Worker 完成，这里只注册官方插件与少量自定义命令：
/// dialog（选位置）、fs（读写文件）、http（抓取图片链接）、opener（打开文件夹）；
/// exe_dir 提供程序所在目录（官方 path.executableDir 在 Windows/macOS 取不到值）。
use tauri::Manager;

#[tauri::command]
fn exe_dir() -> Result<String, String> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .map(|d| d.to_string_lossy().into_owned())
        .ok_or_else(|| "无法定位程序目录".to_string())
}

#[tauri::command]
fn app_data_root(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![exe_dir, app_data_root])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
