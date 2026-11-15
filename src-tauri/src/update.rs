//! 更新安装编排：安装包已由前端下载 Release 的 zip 资产、解出安装包放进
//! 暂存目录（updates/），这里只负责派发"第三者"替换脚本并退出——真正的
//! 替换发生在本进程退出之后（见 relaunch）。下载与渠道检查在前端
//! （core/updater.ts，走 GitHub releases.atom），安卓走 Capacitor 系统
//! 安装器，都不经这里。

#[cfg(any(target_os = "windows", target_os = "macos"))]
use crate::relaunch;
use tauri::{AppHandle, Manager};

/// 安装已暂存的包并退出，由后台脚本完成替换与重启。
/// `staged_path` 为前端下载落地（解压后）的新包完整路径。
#[tauri::command]
pub fn prepare_and_install(app: AppHandle, staged_path: String) -> Result<(), String> {
    let staged = std::path::PathBuf::from(&staged_path);
    if !staged.is_file() {
        return Err("安装包不存在，请重新下载".into());
    }
    let current = std::env::current_exe().map_err(|e| format!("无法定位当前程序: {e}"))?;

    prepare_install(&app, &current, &staged)?;

    // 脚本已在等本进程退出；立刻退出，把替换窗口留给它
    app.exit(0);
    Ok(())
}

// ---- 平台安装动作 ----
// 三个同名函数按平台各写一份：调用点不必被 cfg 切成三块，
// 各平台的差异（exe 还是 .app）留在各自的实现里。

/// Windows：新 exe 原地覆盖当前程序文件（产物名不含版本号，更新不改名）
#[cfg(target_os = "windows")]
fn prepare_install(
    _app: &AppHandle,
    current: &std::path::Path,
    staged: &std::path::Path,
) -> Result<(), String> {
    relaunch::spawn_replace_exe(current, staged, current)
}

/// macOS：从 DMG 里取出 .app 暂存到旧包旁边，退出后整体替换
#[cfg(target_os = "macos")]
fn prepare_install(
    _app: &AppHandle,
    current: &std::path::Path,
    staged: &std::path::Path,
) -> Result<(), String> {
    let app_root = relaunch::bundle_root(current)
        .ok_or_else(|| "当前不是 .app 包，无法自动替换".to_string())?;
    // 暂存在同一个父目录：跨卷 mv 会退化成"复制 + 删除"，
    // 而此刻旧包已被移除，复制中途失败就没有退路了
    let staged_app = app_root.with_file_name(".Albumark-update.app");
    stage_from_dmg(staged, &staged_app)?;
    relaunch::spawn_replace_bundle(&app_root, &staged_app)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn prepare_install(
    _app: &AppHandle,
    _current: &std::path::Path,
    _staged: &std::path::Path,
) -> Result<(), String> {
    Err("当前平台不支持自动更新".into())
}

/// 挂载 DMG，把里面的 .app 复制到 `stage`，随即卸载。
/// 只复制不替换：替换要等本进程退出，见 `relaunch::spawn_replace_bundle`。
#[cfg(target_os = "macos")]
fn stage_from_dmg(dmg: &std::path::Path, stage: &std::path::Path) -> Result<(), String> {
    use std::fs;
    use std::process::Command;

    let mount = std::env::temp_dir().join(format!("albumark-update-{}", std::process::id()));
    let _ = fs::remove_dir_all(&mount);
    fs::create_dir_all(&mount).map_err(|e| format!("无法创建挂载点: {e}"))?;

    let attach = Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint"])
        .arg(&mount)
        .arg(dmg)
        .output()
        .map_err(|e| format!("无法挂载安装包: {e}"))?;
    if !attach.status.success() {
        let _ = fs::remove_dir_all(&mount);
        let msg = String::from_utf8_lossy(&attach.stderr).trim().to_string();
        return Err(format!("无法挂载安装包: {msg}"));
    }

    let staged = (|| -> Result<(), String> {
        let app = fs::read_dir(&mount)
            .map_err(|e| format!("无法读取安装包内容: {e}"))?
            .flatten()
            .map(|e| e.path())
            .find(|p| p.extension().map(|x| x == "app").unwrap_or(false))
            .ok_or_else(|| "安装包里没有应用".to_string())?;
        let _ = fs::remove_dir_all(stage);
        let out = Command::new("ditto")
            .arg(&app)
            .arg(stage)
            .output()
            .map_err(|e| format!("无法展开新版本: {e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            Err("无法展开新版本".into())
        }
    })();

    let _ = Command::new("hdiutil").args(["detach", "-quiet"]).arg(&mount).status();
    let _ = fs::remove_dir_all(&mount);
    staged
}
