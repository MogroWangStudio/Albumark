//! 进程自我替换的"第三者"脚本投递。
//!
//! 便携版没有安装器，替换正在运行的可执行文件必须由第三方完成：本进程先起
//! 一个极小的系统脚本（Windows 用 PowerShell、macOS 用 sh），脚本等本进程
//! 退出后再替换文件 / 拉起新实例。脚本本身不落盘——经 `-EncodedCommand` 或
//! `sh -c` 直接投递，既不受路径里的中文与引号影响，也不会在用户磁盘上留下
//! 残留文件。
//!
//! 所有函数只负责"把脚本送出去"，真正的退出由调用方（`app.exit(0)`）触发。

use std::path::Path;
use std::process::{Command, Stdio};

/// 本进程 PID：脚本以它的存活状态作为"可以动手"的信号
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn pid() -> u32 {
    std::process::id()
}

// ---------------------------------------------------------------- Windows

/// PowerShell 单引号字符串转义：把 `'` 双写。
#[cfg(target_os = "windows")]
fn ps_quote(p: &Path) -> String {
    p.to_string_lossy().replace('\'', "''")
}

/// 最小 Base64 编码器：仅用于 `-EncodedCommand` 的投递，不引入 base64 依赖。
#[cfg(target_os = "windows")]
fn b64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b1 = chunk.first().copied().unwrap_or(0) as u32;
        let b2 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b3 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b1 << 16) | (b2 << 8) | b3;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

/// UTF-16LE + Base64：`-EncodedCommand` 的唯一合法编码，
/// 中文路径与引号都不需要再经过命令行解析。
#[cfg(target_os = "windows")]
fn encode_command(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    b64(&bytes)
}

#[cfg(target_os = "windows")]
fn run_powershell(script: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    /// CREATE_NO_WINDOW：不闪控制台窗口
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        &encode_command(script),
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
        .map_err(|e| format!("无法启动更新进程: {e}"))?;
    Ok(())
}

/// 等待本进程退出 → 用下载好的新 exe 覆盖 `target` → 删掉旧文件 → 启动新版本。
/// 覆盖带重试：Windows 释放文件句柄有少量延迟，首次 Move 失败很常见。
#[cfg(target_os = "windows")]
pub fn spawn_replace_exe(current: &Path, staged: &Path, target: &Path) -> Result<(), String> {
    let script = format!(
        "$ErrorActionPreference = 'SilentlyContinue'\n\
Wait-Process -Id {pid} -Timeout 120 -ErrorAction SilentlyContinue\n\
Start-Sleep -Milliseconds 400\n\
$src = '{src}'\n\
$dst = '{dst}'\n\
$old = '{old}'\n\
for ($i = 0; $i -lt 120; $i++) {{\n\
  try {{\n\
    Move-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop\n\
    break\n\
  }} catch {{\n\
    Start-Sleep -Milliseconds 500\n\
  }}\n\
}}\n\
if (Test-Path -LiteralPath $dst) {{\n\
  if ($old -ne $dst) {{ Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }}\n\
  Start-Process -FilePath $dst\n\
}} else {{\n\
  Start-Process -FilePath $old\n\
}}\n",
        pid = pid(),
        src = ps_quote(staged),
        dst = ps_quote(target),
        old = ps_quote(current)
    );
    run_powershell(&script)
}

// ---------------------------------------------------------------- macOS

/// sh 脚本里的单引号字符串转义：结尾引号、转义引号、重开引号。
#[cfg(target_os = "macos")]
fn sh_quote(p: &Path) -> String {
    p.to_string_lossy().replace('\'', "'\\''")
}

#[cfg(target_os = "macos")]
fn run_sh(script: &str) -> Result<(), String> {
    Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("无法启动更新进程: {e}"))?;
    Ok(())
}

/// 运行时自身所在的 .app 包根目录（macOS 为 Some，其余平台为 None）。
/// `current_exe` 在 macOS 上是 `X.app/Contents/MacOS/X`，向上找第一层
/// 以 `.app` 结尾的祖先即是包根。
#[cfg(target_os = "macos")]
pub fn bundle_root(exe: &Path) -> Option<std::path::PathBuf> {
    exe.ancestors()
        .find(|p| p.extension().map(|e| e == "app").unwrap_or(false))
        .map(Path::to_path_buf)
}

/// 等待本进程退出 → 用暂存的新包替换旧包 → 去隔离属性 → 打开。
/// 旧包先改名留作退路：`mv` 失败（权限、磁盘满）时把它换回去并照常启动，
/// 用户至少不会因为一次更新失败而丢掉整个应用。
#[cfg(target_os = "macos")]
pub fn spawn_replace_bundle(app_root: &Path, staged: &Path) -> Result<(), String> {
    let script = format!(
        "while kill -0 {pid} 2>/dev/null; do sleep 0.2; done\n\
sleep 0.4\n\
mv '{dest}' '{backup}'\n\
if ! mv '{staged}' '{dest}'; then\n\
  rm -rf '{dest}'\n\
  mv '{backup}' '{dest}'\n\
  open -n '{dest}'\n\
  exit 1\n\
fi\n\
rm -rf '{backup}'\n\
xattr -dr com.apple.quarantine '{dest}' 2>/dev/null\n\
open -n '{dest}'\n",
        pid = pid(),
        dest = sh_quote(app_root),
        backup = sh_quote(&app_root.with_extension("app.old")),
        staged = sh_quote(staged)
    );
    run_sh(&script)
}
