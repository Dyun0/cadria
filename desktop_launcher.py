from __future__ import annotations

import os
import sys
import time
import socket
import threading
import webbrowser
from pathlib import Path

# Add backend directory to sys.path if running as bundle or source
root_dir = Path(__file__).resolve().parent
if getattr(sys, 'frozen', False):
    # Running in PyInstaller bundle
    bundle_dir = Path(sys._MEIPASS)
    sys.path.insert(0, str(bundle_dir))
    sys.path.insert(0, str(bundle_dir / "backend"))
else:
    sys.path.insert(0, str(root_dir))
    sys.path.insert(0, str(root_dir.parent))

import uvicorn
from app.main import app
from app.config import settings

def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def run_server(port: int):
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

def main():
    port = find_free_port()
    url = f"http://127.0.0.1:{port}"
    
    # Start server in background thread
    server_thread = threading.Thread(target=run_server, args=(port,), daemon=True)
    server_thread.start()
    
    # Wait for server to warm up
    time.sleep(1.2)
    
    print(f"🚀 Cadria Studio Desktop App started at: {url}")
    
    # Try pywebview for native app window, fallback to browser
    try:
        import webview
        window = webview.create_window(
            title="Cadria Studio - Video Editor",
            url=url,
            width=1440,
            height=900,
            min_size=(1024, 720),
            resizable=True,
            text_select=True
        )
        webview.start()
    except Exception as e:
        print(f"Opening browser fallback due to: {e}")
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("Exiting Cadria Studio...")

if __name__ == "__main__":
    main()
