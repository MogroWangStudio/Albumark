/// 辑印 Albumark 桌面端入口。
/// 图像处理全部在前端 Web Worker 完成，这里只注册官方插件：
/// dialog（选导出位置）、fs（写文件）、http（抓取图片链接）、opener（打开文件夹）。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
