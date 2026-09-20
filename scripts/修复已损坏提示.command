#!/bin/bash
# 修复 macOS 提示「“Albumark.app” 已损坏，无法打开」。
# 原因：应用未经 Apple 公证，从网络下载后会被系统打上 quarantine（隔离）标记。
# 本脚本移除该标记，让应用可以正常打开。

APP="/Applications/Albumark.app"
if [ ! -d "$APP" ]; then
  APP="$(cd "$(dirname "$0")" && pwd)/Albumark.app"
fi

if [ ! -d "$APP" ]; then
  osascript -e 'display alert "未找到 Albumark.app" message "请先把 Albumark 拖入「应用程序」文件夹，再运行本脚本。"' >/dev/null 2>&1
  exit 1
fi

if xattr -cr "$APP" 2>/dev/null; then
  osascript -e 'display alert "修复完成" message "已移除隔离标记，现在可以正常打开 Albumark 了。"' >/dev/null 2>&1
else
  osascript -e 'display alert "修复失败" message "请打开「终端」，手动执行：xattr -cr /Applications/Albumark.app"' >/dev/null 2>&1
  exit 1
fi
