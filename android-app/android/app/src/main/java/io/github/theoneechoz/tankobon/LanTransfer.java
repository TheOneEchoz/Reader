package io.github.theoneechoz.tankobon;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/**
 * Direct Wi-Fi transfer between two Tankobon apps.
 * One app serves its (already encrypted) library files on the local network, protected by a one-time token;
 * the other downloads them in parallel and writes them straight into its own library.
 */
public class LanTransfer {
    /** Only library record files can be served or written. */
    static final Pattern REL = Pattern.compile("^lib/(pages|thumbs|galleries)/([A-Za-z0-9_]{1,4}/)?[A-Za-z0-9_-]{1,64}\\.tkb$");

    private final File root;
    private ServerSocket server;
    private ExecutorService pool;
    private volatile String token = "";
    private volatile long lastUse = 0;

    LanTransfer(File root) { this.root = root; }

    /* ---------- server ---------- */

    synchronized int start(String tok) throws Exception {
        token = tok;
        lastUse = System.currentTimeMillis();
        if (server != null && !server.isClosed()) return server.getLocalPort();
        server = new ServerSocket(0, 50);
        pool = Executors.newFixedThreadPool(8);
        final ServerSocket s = server;
        Thread t = new Thread(() -> {
            while (!s.isClosed()) {
                try {
                    Socket c = s.accept();
                    pool.execute(() -> handle(c));
                } catch (Exception e) {
                    if (s.isClosed()) break;
                }
            }
        }, "tankobon-lan");
        t.setDaemon(true);
        t.start();
        return server.getLocalPort();
    }

    synchronized void stop() {
        try { if (server != null) server.close(); } catch (Exception ignored) {}
        server = null;
        if (pool != null) pool.shutdownNow();
        pool = null;
        token = "";
    }

    boolean running() { return server != null && !server.isClosed(); }
    long idleMs() { return System.currentTimeMillis() - lastUse; }

    private void handle(Socket c) {
        try (Socket sock = c) {
            sock.setSoTimeout(15000);
            InputStream in = sock.getInputStream();
            BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.ISO_8859_1));
            String line = r.readLine();
            if (line == null) return;
            String auth = "";
            String h;
            while ((h = r.readLine()) != null && !h.isEmpty()) {
                int i = h.indexOf(':');
                if (i > 0 && h.substring(0, i).trim().equalsIgnoreCase("x-tankobon")) auth = h.substring(i + 1).trim();
            }
            String[] parts = line.split(" ");
            OutputStream out = sock.getOutputStream();
            if (parts.length < 2 || !"GET".equals(parts[0])) { reply(out, 405, null); return; }
            String path = parts[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            if (token.isEmpty() || !token.equals(auth)) { reply(out, 403, null); return; }
            lastUse = System.currentTimeMillis();
            if (path.equals("/ping")) { reply(out, 200, "ok".getBytes(StandardCharsets.UTF_8)); return; }
            if (!path.startsWith("/f/")) { reply(out, 404, null); return; }
            String rel = path.substring(3);
            if (!REL.matcher(rel).matches()) { reply(out, 404, null); return; }
            File f = new File(root, rel);
            if (!f.isFile()) { reply(out, 404, null); return; }
            long len = f.length();
            out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: " + len + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
            try (FileInputStream fin = new FileInputStream(f)) {
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = fin.read(buf)) > 0) out.write(buf, 0, n);
            }
            out.flush();
        } catch (Exception ignored) {
        }
    }

    private static void reply(OutputStream out, int code, byte[] body) throws Exception {
        String msg = code == 200 ? "OK" : code == 403 ? "Forbidden" : code == 404 ? "Not Found" : "Error";
        int len = body == null ? 0 : body.length;
        out.write(("HTTP/1.1 " + code + " " + msg + "\r\nContent-Length: " + len + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
        if (body != null) out.write(body);
        out.flush();
    }

    /** IPv4 addresses of this device on local networks (Wi-Fi, hotspot, Ethernet). */
    static List<String> addresses() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && (a.isSiteLocalAddress() || a.isLinkLocalAddress())) out.add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) {}
        return out;
    }

    /* ---------- client ---------- */

    interface Progress { void update(int done, int total); }

    /** Try every address at once and return the first that answers (the phone may have several networks). */
    static String pick(List<String> bases, String tok) {
        if (bases.isEmpty()) return null;
        ExecutorService ex = Executors.newFixedThreadPool(Math.min(bases.size(), 8));
        java.util.concurrent.ExecutorCompletionService<String> cs = new java.util.concurrent.ExecutorCompletionService<>(ex);
        for (final String b : bases) cs.submit(() -> {
            HttpURLConnection c = (HttpURLConnection) new URL(b + "/ping").openConnection();
            c.setConnectTimeout(2500);
            c.setReadTimeout(2500);
            c.setRequestProperty("x-tankobon", tok);
            int code = c.getResponseCode();
            c.disconnect();
            return code == 200 ? b : null;
        });
        String found = null;
        try {
            for (int i = 0; i < bases.size() && found == null; i++) {
                try { found = cs.take().get(); } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        ex.shutdownNow();
        return found;
    }

    /** Download files in parallel, straight into this app's library. Returns the relative paths that failed. */
    List<String> fetch(String base, String tok, List<String> rels, int parallel, Progress p) throws InterruptedException {
        final List<String> failed = Collections.synchronizedList(new ArrayList<>());
        final AtomicInteger done = new AtomicInteger();
        final int total = rels.size();
        ExecutorService ex = Executors.newFixedThreadPool(Math.max(1, Math.min(parallel, 12)));
        for (final String rel : rels) {
            ex.execute(() -> {
                boolean ok = false;
                if (REL.matcher(rel).matches()) {
                    for (int attempt = 0; attempt < 2 && !ok; attempt++) {
                        HttpURLConnection c = null;
                        File tmp = null;
                        try {
                            c = (HttpURLConnection) new URL(base + "/f/" + rel).openConnection();
                            c.setConnectTimeout(5000);
                            c.setReadTimeout(20000);
                            c.setRequestProperty("x-tankobon", tok);
                            if (c.getResponseCode() == 200) {
                                File f = new File(root, rel);
                                File dir = f.getParentFile();
                                if (dir != null) dir.mkdirs();
                                tmp = new File(f.getAbsolutePath() + ".part" + Thread.currentThread().getId());
                                try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(tmp)) {
                                    byte[] buf = new byte[1 << 16];
                                    int n;
                                    long got = 0;
                                    while ((n = in.read(buf)) > 0) { os.write(buf, 0, n); got += n; }
                                    if (got < 28) throw new Exception("short");
                                }
                                if (f.exists()) f.delete();
                                ok = tmp.renameTo(f);
                            }
                        } catch (Exception e) {
                            ok = false;
                        } finally {
                            if (c != null) c.disconnect();
                            if (tmp != null && tmp.exists()) tmp.delete();
                        }
                    }
                }
                if (!ok) failed.add(rel);
                int d = done.incrementAndGet();
                if (p != null && (d % 5 == 0 || d == total)) p.update(d, total);
            });
        }
        ex.shutdown();
        ex.awaitTermination(2, TimeUnit.HOURS);
        return failed;
    }
}
