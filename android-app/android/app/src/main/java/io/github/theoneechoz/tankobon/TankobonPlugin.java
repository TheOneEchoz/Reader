package io.github.theoneechoz.tankobon;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.activity.result.ActivityResult;
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

/**
 * Small native helpers for Tankobon:
 * picking a folder of images, copying a picked file where the app can read it fast,
 * full screen, keeping the screen on, hiding the app in the recent-apps list,
 * and switching between downloaded versions of the app's screens.
 */
@CapacitorPlugin(name = "Tankobon")
public class TankobonPlugin extends Plugin {

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
}
