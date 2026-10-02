package com.mws.albumark;

import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * 应用内更新的安装环节：把下载好的 APK 交给系统安装器。
 * path 为公共 Documents 下的相对路径（如 Albumark/updates/x.apk），
 * 经 FileProvider 分享只读 URI；Android 8+ 首次安装会由系统引导
 * 用户授权「安装未知应用」。
 */
@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {

    @PluginMethod
    public void openApk(PluginCall call) {
        String relPath = call.getString("path");
        if (relPath == null || relPath.isEmpty()) {
            call.reject("缺少 APK 路径");
            return;
        }
        try {
            File file = new File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS),
                relPath);
            if (!file.exists()) {
                call.reject("APK 文件不存在");
                return;
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开安装包：" + e.getMessage(), e);
        }
    }
}
