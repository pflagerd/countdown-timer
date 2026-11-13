#!/usr/bin/env python3
"""Tiny static file server for the countdown-timer PWA (Python standard library only).

Serves ./app on http://localhost:<port>/ . A service worker requires a
"secure context"; http://localhost qualifies, so no TLS is needed.
"""

import argparse
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent / "app"


class Handler(http.server.SimpleHTTPRequestHandler):
    # Don't rely on /etc/mime.types being complete; these matter for PWAs.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
    }

    quiet = False

    def end_headers(self):
        # "no-cache" = always revalidate; the service worker handles offline use.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        if not self.quiet:
            super().log_message(format, *args)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--port", type=int, default=8765, help="TCP port (default: 8765)")
    p.add_argument("--bind", default="127.0.0.1",
                   help="address to listen on (default: 127.0.0.1, i.e. this machine only)")
    p.add_argument("--quiet", action="store_true", help="don't log each request")
    args = p.parse_args()

    Handler.quiet = args.quiet
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer((args.bind, args.port), handler) as httpd:
        print(f"Serving {ROOT} at http://localhost:{args.port}/  (Ctrl+C to stop)", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
