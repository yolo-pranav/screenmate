package com.yolopranav.screenmate;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Downloads a release APK into the app cache and hands it to the system package installer.
 * The web layer decides when an update is available; this plugin only does the native parts.
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    private static final String TAG = "ApkUpdater";
    private static final String UPDATES_DIR = "updates";
    private static final int MAX_REDIRECTS = 5;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    private final AtomicBoolean downloading = new AtomicBoolean(false);

    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("A https url is required");
            return;
        }
        String sha = call.getString("sha256");
        final String expectedSha = sha == null || sha.isEmpty() ? null : sha.toLowerCase(Locale.ROOT);
        if (expectedSha != null && !expectedSha.matches("[0-9a-f]{64}")) {
            call.reject("sha256 must be 64 hex characters");
            return;
        }
        if (!downloading.compareAndSet(false, true)) {
            call.reject("A download is already in progress");
            return;
        }

        new Thread(
            () -> {
                try {
                    File apk = downloadApk(url, expectedSha);
                    JSObject result = new JSObject();
                    result.put("path", apk.getAbsolutePath());
                    call.resolve(result);
                } catch (Exception e) {
                    Logger.error(TAG, "Update download failed", e);
                    call.reject(e.getMessage() != null ? e.getMessage() : "Download failed", e);
                } finally {
                    downloading.set(false);
                }
            },
            "ApkUpdater-download"
        ).start();
    }

    /** False in the Google Play build, which is updated by Play, not by this plugin. */
    @PluginMethod
    public void isEnabled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("value", BuildConfig.IN_APP_UPDATES);
        call.resolve(result);
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean value = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject result = new JSObject();
        result.put("value", value);
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(intent);
            } catch (ActivityNotFoundException e) {
                call.reject("Install settings are not available on this device", e);
                return;
            }
        }
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        File apk;
        try {
            apk = new File(path).getCanonicalFile();
            File dir = updatesDir().getCanonicalFile();
            if (!dir.equals(apk.getParentFile()) || !apk.getName().endsWith(".apk") || !apk.isFile()) {
                call.reject("Update file not found");
                return;
            }
        } catch (IOException e) {
            call.reject("Update file not found", e);
            return;
        }

        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject());
        } catch (Exception e) {
            Logger.error(TAG, "Could not start the installer", e);
            call.reject("Could not start the installer", e);
        }
    }

    private File updatesDir() {
        return new File(getContext().getCacheDir(), UPDATES_DIR);
    }

    private File downloadApk(String url, String expectedSha) throws IOException, NoSuchAlgorithmException {
        File dir = updatesDir();
        if (!dir.isDirectory() && !dir.mkdirs()) {
            throw new IOException("Could not create update folder");
        }
        File target = new File(dir, fileNameFor(url));
        File partial = new File(dir, target.getName() + ".part");

        if (expectedSha != null && target.isFile() && expectedSha.equals(sha256Of(target))) {
            deleteAllExcept(dir, target);
            return target;
        }

        HttpURLConnection connection = open(url);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(partial)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
                out.write(buffer, 0, read);
            }
        } catch (IOException e) {
            partial.delete();
            throw e;
        } finally {
            connection.disconnect();
        }

        if (expectedSha != null) {
            String actual = toHex(digest.digest());
            if (!expectedSha.equals(actual)) {
                partial.delete();
                throw new IOException("Downloaded update failed the checksum check");
            }
        }

        if (target.exists() && !target.delete()) {
            partial.delete();
            throw new IOException("Could not replace the previous download");
        }
        if (!partial.renameTo(target)) {
            partial.delete();
            throw new IOException("Could not save the update");
        }

        deleteAllExcept(dir, target);
        return target;
    }

    /** Removes older APKs and leftover .part files; only one download runs at a time, so none is in use. */
    private static void deleteAllExcept(File dir, File keep) {
        File[] others = dir.listFiles();
        if (others != null) {
            for (File other : others) {
                if (!other.equals(keep) && other.isFile()) {
                    other.delete();
                }
            }
        }
    }

    private static String sha256Of(File file) throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        return toHex(digest.digest());
    }

    /** Opens the URL, following redirects manually (https only) so cross-host hops work. */
    private HttpURLConnection open(String url) throws IOException {
        String current = url;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpURLConnection connection = (HttpURLConnection) new URL(current).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/octet-stream");
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = connection.getHeaderField("Location");
                    if (location == null) {
                        throw new IOException("Redirect without a location");
                    }
                    current = new URL(new URL(current), location).toString();
                    if (!current.startsWith("https://")) {
                        throw new IOException("Refusing a non-https redirect");
                    }
                    connection.disconnect();
                    continue;
                }
                if (status < 200 || status >= 300) {
                    throw new IOException("Download failed with HTTP " + status);
                }
                return connection;
            } catch (IOException | RuntimeException e) {
                connection.disconnect();
                throw e;
            }
        }
        throw new IOException("Too many redirects");
    }

    private static String fileNameFor(String url) {
        String path = Uri.parse(url).getLastPathSegment();
        String name = path == null ? "" : path.replaceAll("[^A-Za-z0-9._-]", "_");
        if (name.isEmpty() || name.startsWith(".")) {
            name = "update";
        }
        return name.endsWith(".apk") ? name : name + ".apk";
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.ROOT, "%02x", b));
        }
        return sb.toString();
    }
}
