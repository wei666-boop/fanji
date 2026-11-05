from __future__ import annotations

import io
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class SmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp = tempfile.TemporaryDirectory(prefix="fanji-test-")
        cls.data_dir = Path(cls.temp.name) / "data"
        cls.ready = Path(cls.temp.name) / "ready.json"
        cls.port = free_port()
        env = os.environ.copy()
        env.update({
            "FANJI_BASE_DIR": str(ROOT),
            "FANJI_STATIC_DIR": str(ROOT / "static"),
            "FANJI_DATA_DIR": str(cls.data_dir),
            "FANJI_READY_FILE": str(cls.ready),
            "PYTHONIOENCODING": "utf-8",
            "PYTHONUNBUFFERED": "1",
        })
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        cls.process = subprocess.Popen(
            [sys.executable, str(ROOT / "appcore" / "app.py"), "--no-browser", "--port", str(cls.port)],
            cwd=str(ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=flags,
        )
        deadline = time.time() + 30
        while time.time() < deadline:
            if cls.ready.is_file():
                try:
                    cls.base = json.loads(cls.ready.read_text(encoding="utf-8"))["url"].rstrip("/")
                    break
                except (OSError, KeyError, json.JSONDecodeError):
                    pass
            if cls.process.poll() is not None:
                output = cls.process.stdout.read() if cls.process.stdout else ""
                raise RuntimeError(f"server exited early:\n{output}")
            time.sleep(0.2)
        else:
            cls.process.terminate()
            output = cls.process.stdout.read() if cls.process.stdout else ""
            raise RuntimeError(f"server did not become ready:\n{output}")

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.process.poll() is None:
            cls.process.terminate()
            try:
                cls.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                cls.process.kill()
        cls.temp.cleanup()

    def request(self, path: str, method: str = "GET", payload: dict | None = None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"} if payload is not None else {}
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as error:
            return error.code, error.read(), error.headers

    def json_request(self, path: str, method: str = "GET", payload: dict | None = None):
        status, body, _ = self.request(path, method, payload)
        self.assertLess(status, 400, body[:300])
        return json.loads(body.decode("utf-8"))

    def test_health_crud_and_backup(self) -> None:
        health = self.json_request("/api/health")
        self.assertEqual(health["items"], 0)

        item = self.json_request("/api/anime", "POST", {
            "title": "测试作品",
            "altTitle": "Test Anime",
            "status": "completed",
            "rating": 5,
            "finishedYear": 2024,
            "episodesTotal": 12,
            "episodesWatched": 12,
            "tags": ["测试", "日常"],
            "notes": "这是一条测试短评。",
        })["item"]
        self.assertTrue(item["id"])
        self.assertEqual(len(self.json_request("/api/anime")["items"]), 1)

        created = self.json_request("/api/backups/create", "POST")["backup"]
        self.assertEqual(created["count"], 1)

        status, blob, headers = self.request("/api/backup/export")
        self.assertEqual(status, 200)
        self.assertIn("zip", (headers.get("Content-Type") or "").lower())
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            names = archive.namelist()
            self.assertIn("anime.json", names)
            self.assertIn("manifest.json", names)

        restored = self.json_request("/api/backups/restore", "POST", {"name": created["name"]})
        self.assertEqual(restored["count"], 1)
        self.assertEqual(len(self.json_request("/api/anime")["items"]), 1)

        status, _, _ = self.request(f"/api/anime/{item['id']}", "DELETE")
        self.assertLess(status, 400)
        self.assertEqual(len(self.json_request("/api/anime")["items"]), 0)


if __name__ == "__main__":
    unittest.main()
