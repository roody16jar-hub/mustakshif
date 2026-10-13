"""Local server with no caching: python tools/serve.py  ->  http://localhost:8765"""
import http.server, os, sys
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".geojson": "application/geo+json"}
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
    def log_message(self, *a): pass
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f"http://localhost:{port}"); http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
