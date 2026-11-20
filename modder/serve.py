#!/usr/bin/env python3
"""Runs the engine page at http://localhost:8765/  (a browser needs a web address, not a double-click on index.html)."""
import http.server, socketserver, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
socketserver.TCPServer.allow_reuse_address = True
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')   # always the newest files, never an old copy from the browser's cache
        super().end_headers()
with socketserver.TCPServer(('127.0.0.1', 8765), H) as s:
    print('Open http://localhost:8765/   (Ctrl+C to stop)'); s.serve_forever()
