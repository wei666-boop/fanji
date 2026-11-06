#!/usr/bin/env python3
"""番迹桌面版启动器。

启动本地 Python 服务，然后打开无地址栏、无标签页的 Edge 应用窗口。
关闭窗口后自动停止本次启动的服务。
"""

from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = Path(__file__).resolve().parent / "app.py"
DEFAULT_URL = "http://127.0.0.1:8765"
MUTEX_NAME = "FanjiAnimeArchiveDesktopLauncher"
ERROR_TITLE = "番迹 · 动漫手帐"


def app_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    candidates = [Path(base) / "Fanji", ROOT / ".fanji-data"]
    for path in candidates:
        try:
            path.mkdir(parents=True, exist_ok=True)
            probe = path / f".write-{uuid.uuid4().hex}"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()
            return path
        except OSError:
            continue
    raise RuntimeError("没有找到可写的数据目录。")


LOG_FILE = app_data_dir() / "desktop.log"


def log(message: str) -> None:
    try:
        with LOG_FILE.open("a", encoding="utf-8") as fh:
            fh.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")
    except OSError:
        pass


def message_box(text: str, error: bool = True) -> None:
    try:
        flags = 0x10 if error else 0x40
        ctypes.windll.user32.MessageBoxW(0, text, ERROR_TITLE, flags)
    except Exception:
        pass


def acquire_mutex():
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if not handle:
        return None
    if kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        kernel32.CloseHandle(handle)
        return False
    return handle


def health(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(url + "/api/health", timeout=1.5) as response:
            data = json.loads(response.read().decode("utf-8"))
        return data if data.get("app") == "番迹" else None
    except (OSError, ValueError, json.JSONDecodeError, urllib.error.URLError):
        return None


def find_python() -> Path | None:
    executable = Path(sys.executable)
    if executable.name.lower() == "pythonw.exe":
        python = executable.with_name("python.exe")
        if python.exists():
            return python
    if executable.exists():
        return executable
    for name in ("python.exe", "pythonw.exe"):
        for directory in os.environ.get("PATH", "").split(";"):
            candidate = Path(directory.strip().strip('"')) / name
            if candidate.exists() and "WindowsApps" not in str(candidate):
                return candidate
    for candidate in (
        Path(r"C:\Python314\python.exe"),
        Path(r"C:\Python313\python.exe"),
        Path(r"C:\Python312\python.exe"),
        Path(r"C:\Python311\python.exe"),
        Path(r"C:\Python310\python.exe"),
    ):
        if candidate.exists():
            return candidate
    return None


def find_edge() -> Path | None:
    candidates = [
        Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
        / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        Path(os.environ.get("LOCALAPPDATA", ""))
        / "Microsoft" / "Edge" / "Application" / "msedge.exe",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def start_server() -> tuple[subprocess.Popen | None, str]:
    existing = health(DEFAULT_URL)
    if existing:
        log("复用已在运行的服务")
        return None, DEFAULT_URL + "/"

    if not APP.exists():
        raise RuntimeError(f"没有找到 app.py：{APP}")

    python = find_python()
    if python is None:
        raise RuntimeError("没有找到 Python。请先安装 Python 3.10 或更新版本。")

    ready_file = Path(tempfile.gettempdir()) / f"fanji-ready-{uuid.uuid4().hex}.json"
    try:
        ready_file.unlink(missing_ok=True)
    except OSError:
        pass

    env = os.environ.copy()
    env["FANJI_READY_FILE"] = str(ready_file)
    env["FANJI_BASE_DIR"] = str(ROOT)
    env["FANJI_DATA_DIR"] = str(ROOT / "data")
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUNBUFFERED"] = "1"

    server_log = app_data_dir() / "server.log"
    log_handle = server_log.open("a", encoding="utf-8")
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(
        [str(python), str(APP), "--no-browser", "--port", "8765"],
        cwd=str(ROOT),
        env=env,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        creationflags=creationflags,
    )
    log(f"启动本地服务，pid={process.pid}")

    try:
        for _ in range(120):
            if ready_file.exists():
                try:
                    payload = json.loads(ready_file.read_text(encoding="utf-8"))
                    url = payload.get("url")
                    if url:
                        log(f"服务就绪：{url}")
                        return process, url.rstrip("/") + "/"
                except (OSError, json.JSONDecodeError):
                    pass
            if process.poll() is not None:
                break
            time.sleep(0.15)
    except Exception:
        stop_server(process)
        raise
    finally:
        try:
            ready_file.unlink(missing_ok=True)
        except OSError:
            pass
        log_handle.close()

    if health(DEFAULT_URL):
        return process, DEFAULT_URL + "/"

    stop_server(process)
    raise RuntimeError(
        "本地服务没有启动成功。\n\n"
        f"详细日志：{server_log}"
    )


def stop_share(url: str) -> None:
    try:
        request = urllib.request.Request(url.rstrip("/") + "/api/share/stop", data=b"", method="POST")
        urllib.request.urlopen(request, timeout=3).read()
        log("已停止临时分享")
    except Exception:
        pass


def stop_server(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    log(f"停止本地服务，pid={process.pid}")
    try:
        process.terminate()
        process.wait(timeout=4)
    except Exception:
        try:
            process.kill()
        except Exception:
            pass


def main() -> None:
    log("桌面启动器启动")
    mutex = acquire_mutex()
    if mutex is False:
        message_box("番迹已经在运行啦，去任务栏找找看。", error=False)
        return
    if mutex is None:
        log("创建单实例锁失败，继续启动")

    edge = find_edge()
    if edge is None:
        message_box("没有找到 Microsoft Edge，无法打开桌面窗口。")
        return

    server = None
    edge_process = None
    try:
        server, url = start_server()

        profile = app_data_dir() / "EdgeApp"
        profile.mkdir(parents=True, exist_ok=True)
        args = [
            str(edge),
            f"--app={url}",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-mode",
            "--window-size=1280,860",
        ]
        log("打开桌面窗口：" + " ".join(args))
        edge_process = subprocess.Popen(args, cwd=str(ROOT))

        while edge_process.poll() is None:
            if server is not None and server.poll() is not None:
                log("本地服务提前退出")
                break
            time.sleep(0.4)
    except Exception as error:
        log("启动失败：\n" + str(error))
        message_box(str(error) + f"\n\n日志：{LOG_FILE}")
    finally:
        if edge_process is not None and edge_process.poll() is None:
            try:
                edge_process.terminate()
            except OSError:
                pass
        if server is not None:
            stop_share(url)
        stop_server(server)
        log("桌面启动器退出")
        try:
            if mutex not in (None, False):
                ctypes.windll.kernel32.CloseHandle(mutex)
        except Exception:
            pass


if __name__ == "__main__":
    main()
