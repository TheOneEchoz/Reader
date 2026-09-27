package io.github.theoneechoz.tankobon;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * Small native helpers for Tankobon:
 * picking a folder of images, copying a picked file where the app can read it fast,
 * full screen, keeping the screen on, hiding the app in the recent-apps list,
 * and switching between downloaded versions of the app's screens.
 */
@CapacitorPlugin(name = "Tankobon")
public class TankobonPlugin extends Plugin {

    /* ---------- files shared with the app or opened with it ---------- */

    private static final List<Uri> incoming = new ArrayList<>();
    private static TankobonPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Called by the activity for every intent it receives. */
    @SuppressWarnings("deprecation")
    public static void receive(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        if (uris.isEmpty()) return;
        synchronized (incoming) { incoming.addAll(uris); }
        if (instance != null) instance.notifyListeners("incoming", new JSObject(), true);
    }

    /** Copy every waiting file into the app's cache and say where they are. */
    @PluginMethod
    public void takeIncoming(PluginCall call) {
        final List<Uri> list;
        synchronized (incoming) { list = new ArrayList<>(incoming); incoming.clear(); }
        new Thread(() -> {
            JSArray files = new JSArray();
            ContentResolver cr = getContext().getContentResolver();
            File dir = new File(getContext().getCacheDir(), "import");
            if (!dir.exists()) dir.mkdirs();
            for (Uri u : list) {
                try {
                    String name = null, type = cr.getType(u);
                    if ("content".equals(u.getScheme())) {
                        try (Cursor c = cr.query(u, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                            if (c != null && c.moveToFirst()) name = c.getString(0);
                        } catch (Exception ignored) {}
                    }
                    if (name == null) name = u.getLastPathSegment();
                    if (name == null) name = "shared.zip";
                    File out = File.createTempFile("in", ".bin", dir);
                    try (InputStream in = cr.openInputStream(u); OutputStream os = new FileOutputStream(out)) {
                        if (in == null) throw new Exception("cannot open");
                        byte[] buf = new byte[1 << 16];
                        int n;
                        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    }
                    JSObject f = new JSObject();
                    f.put("path", out.getAbsolutePath());
                    f.put("name", name);
                    f.put("type", type == null ? "" : type);
                    f.put("size", out.length());
                    files.put(f);
                } catch (Exception e) {
                    // skip files that cannot be read
                }
            }
            JSObject ret = new JSObject();
            ret.put("files", files);
            call.resolve(ret);
        }).start();
    }

    /* ---------- folder picking ---------- */

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject none = new JSObject();
            none.put("files", new JSArray());
            call.resolve(none);
            return;
        }
        final Uri tree = result.getData().getData();
        new Thread(() -> {
            try {
                ContentResolver cr = getContext().getContentResolver();
                String rootId = DocumentsContract.getTreeDocumentId(tree);
                JSArray files = new JSArray();
                walk(cr, tree, rootId, "", files, 0);
                JSObject ret = new JSObject();
                ret.put("name", displayName(cr, DocumentsContract.buildDocumentUriUsingTree(tree, rootId)));
                ret.put("files", files);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Could not read that folder: " + e.getMessage());
            }
        }).start();
    }

    private static final String[] COLS = {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE
    };

    private void walk(ContentResolver cr, Uri tree, String docId, String prefix, JSArray out, int depth) {
        if (depth > 12) return;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        try (Cursor c = cr.query(children, COLS, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                long size = c.isNull(3) ? 0 : c.getLong(3);
                if (name == null || name.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    walk(cr, tree, id, prefix + name + "/", out, depth + 1);
                } else {
                    JSObject f = new JSObject();
                    f.put("path", prefix + name);
                    f.put("name", name);
                    f.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                    f.put("size", size);
                    f.put("type", mime == null ? "" : mime);
                    out.put(f);
                }
            }
        }
    }

    private String displayName(ContentResolver cr, Uri doc) {
        try (Cursor c = cr.query(doc, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        return "";
    }

    /** Copy a picked file (content:// uri) into the app's cache so the page can read it quickly. */
    @PluginMethod
    public void copyToCache(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) { call.reject("No file"); return; }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "import");
                if (!dir.exists()) dir.mkdirs();
                File out = File.createTempFile("in", ".bin", dir);
                try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(uri));
                     OutputStream os = new FileOutputStream(out)) {
                    if (in == null) throw new Exception("cannot open");
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                JSObject ret = new JSObject();
                ret.put("path", out.getAbsolutePath());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Could not read the file: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void removeCached(PluginCall call) {
        String path = call.getString("path");
        File cache = new File(getContext().getCacheDir(), "import");
        if (path == null) {
            File[] all = cache.listFiles();
            if (all != null) for (File f : all) f.delete();
        } else {
            File f = new File(path);
            if (f.getAbsolutePath().startsWith(cache.getAbsolutePath())) f.delete();
        }
        call.resolve();
    }

    /* ---------- screen ---------- */

    @PluginMethod
    public void setImmersive(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        getActivity().runOnUiThread(() -> {
            Window w = getActivity().getWindow();
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, w.getDecorView());
            if (on) {
                c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                c.show(WindowInsetsCompat.Type.systemBars());
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    /** Blank the app in the recent-apps list (this also blocks screenshots while it is on). */
    @PluginMethod
    public void setSecure(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }

    /* ---------- versions of the app's screens ---------- */

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Activity.MODE_PRIVATE);
    }

    /** Switch to a downloaded version (a folder holding index.html) and keep using it on the next start. */
    @PluginMethod
    public void useVersion(PluginCall call) {
        String path = call.getString("path");
        if (path == null || !new File(path, "index.html").exists()) { call.reject("That version is not complete"); return; }
        prefs().edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, path).commit();
        call.resolve();
        getBridge().setServerBasePath(path);
    }

    /** Go back to the version that came inside the app. */
    @PluginMethod
    public void useBuiltIn(PluginCall call) {
        prefs().edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "").commit();
        call.resolve();
        getBridge().setServerAssetPath("public");
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("serverPath", getBridge().getServerBasePath());
        ret.put("filesDir", getContext().getFilesDir().getAbsolutePath());
        try {
            ret.put("appVersion", getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName);
        } catch (Exception e) {
            ret.put("appVersion", "");
        }
        call.resolve(ret);
    }

    /* ---------- direct Wi-Fi transfer ---------- */

    private LanTransfer lan;
    private android.net.wifi.WifiManager.WifiLock wifiLock;
    /** Keep Wi-Fi at full speed while pages are shared or fetched (Android slows it down to save power). */
    private synchronized void wifiFast(boolean on) {
        try {
            if (on) {
                if (wifiLock == null) {
                    android.net.wifi.WifiManager wm = (android.net.wifi.WifiManager) getContext().getApplicationContext().getSystemService(android.content.Context.WIFI_SERVICE);
                    int mode = Build.VERSION.SDK_INT >= 29 ? android.net.wifi.WifiManager.WIFI_MODE_FULL_LOW_LATENCY : android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifiLock = wm.createWifiLock(mode, "tankobon:transfer");
                    wifiLock.setReferenceCounted(false);
                }
                if (!wifiLock.isHeld()) wifiLock.acquire();
            } else if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception ignored) {}
    }
    private LanTransfer lan() { if (lan == null) lan = new LanTransfer(getContext().getFilesDir()); return lan; }

    /** Serve this app's library files on the local network for a paired device holding the token. */
    @PluginMethod
    public void lanServe(PluginCall call) {
        String tok = call.getString("token");
        if (tok == null || tok.length() < 16) { call.reject("bad token"); return; }
        try {
            int port = lan().start(tok);
            wifiFast(true);
            JSArray ips = new JSArray();
            for (String a : LanTransfer.addresses()) ips.put(a);
            JSObject ret = new JSObject();
            ret.put("port", port);
            ret.put("ips", ips);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not start the transfer: " + e.getMessage());
        }
    }

    @PluginMethod
    public void lanStop(PluginCall call) {
        if (lan != null) lan.stop();
        wifiFast(false);
        call.resolve();
    }

    /** Download library files from the other device, straight into this app's library. */
    @PluginMethod
    public void lanFetch(PluginCall call) {
        final String tok = call.getString("token");
        final JSArray bases = call.getArray("bases"), rels = call.getArray("rels");
        final int parallel = call.getInt("parallel", 6);
        if (tok == null || bases == null || rels == null) { call.reject("missing arguments"); return; }
        new Thread(() -> {
            try {
                List<String> bl = new ArrayList<>(), rl = new ArrayList<>();
                for (int i = 0; i < bases.length(); i++) bl.add(bases.getString(i));
                for (int i = 0; i < rels.length(); i++) rl.add(rels.getString(i));
                wifiFast(true);
                String base = LanTransfer.pick(bl, tok);
                if (base == null) { if (lan == null || !lan.running()) wifiFast(false); call.reject("unreachable"); return; }
                List<String> failed = lan().fetch(base, tok, rl, parallel, (d, t) -> {
                    JSObject ev = new JSObject();
                    ev.put("done", d);
                    ev.put("total", t);
                    notifyListeners("lanProgress", ev);
                });
                if (lan == null || !lan.running()) wifiFast(false);
                JSArray f = new JSArray();
                for (String x : failed) f.put(x);
                JSObject ret = new JSObject();
                ret.put("base", base);
                ret.put("failed", f);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Transfer failed: " + e.getMessage());
            }
        }).start();
    }

    /* ---------- updating the app file itself ---------- */

    /** Which app file is installed: its build number (the GitHub build it came from) and version name. */
    @PluginMethod
    public void appInfo(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            android.content.pm.PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            ret.put("build", PackageInfoCompat.getLongVersionCode(pi));
            ret.put("name", pi.versionName);
        } catch (Exception e) {
            ret.put("build", 0);
        }
        call.resolve(ret);
    }

    /** Has the person allowed Tankobon to install app files? */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(ret);
    }

    /** Open Android's "Install unknown apps" switch for Tankobon. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the setting: " + e.getMessage());
        }
    }

    /** Download a new app file from GitHub into the app's cache. */
    @PluginMethod
    public void downloadApk(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) { call.reject("bad address"); return; }
        new Thread(() -> {
            File out = new File(getContext().getCacheDir(), "update.apk");
            HttpURLConnection c = null;
            try {
                String u = url;
                for (int hop = 0; hop < 6; hop++) {
                    c = (HttpURLConnection) new URL(u).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                        u = new URL(new URL(u), c.getHeaderField("Location")).toString();
                        c.disconnect();
                        continue;
                    }
                    if (code != 200) throw new Exception("HTTP " + code);
                    break;
                }
                long total = c.getContentLengthLong(), got = 0, last = 0;
                try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        os.write(buf, 0, n);
                        got += n;
                        if (got - last > 256 * 1024) {
                            last = got;
                            JSObject ev = new JSObject();
                            ev.put("done", got);
                            ev.put("total", total);
                            notifyListeners("apkProgress", ev);
                        }
                    }
                }
                if (out.length() < 100000) throw new Exception("the download was incomplete");
                JSObject ret = new JSObject();
                ret.put("path", out.getAbsolutePath());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Download failed: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    /** Hand the downloaded app file to Android's installer. The person confirms with Install. */
    @PluginMethod
    public void installApk(PluginCall call) {
        try {
            File f = new File(getContext().getCacheDir(), "update.apk");
            if (!f.isFile()) { call.reject("No downloaded app file"); return; }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start the installer: " + e.getMessage());
        }
    }
}
