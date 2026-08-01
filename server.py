import http.server
import socketserver

PORT = 80
DIRECTORY = "site"

class StaticFileHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

with socketserver.TCPServer(("", PORT), StaticFileHandler) as httpd:
    print(f"Serving static files from '{DIRECTORY}' -> http://localhost:{PORT}")
    httpd.serve_forever()