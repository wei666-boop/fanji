"""临时只读分享：独立的本地分享服务 + Cloudflare Quick Tunnel（SSH fallback）。

设计原则：
- 只把「分享服务」暴露到公网，主应用的新增/编辑/删除接口不经过隧道。
- 分享内容是生成时的快照，不随主手帐继续变化。
- 访问码 + 随机 token + 24 小时过期；静态资源可以公开，数据和封面必须带会话 cookie。
"""

from __future__ import annotations

import hmac
import html
import json
import mimetypes
import re
import secrets
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

SHARE_TTL_SECONDS = 24 * 60 * 60
MAX_CODE_ATTEMPTS = 8
ATTEMPT_WINDOW_SECONDS = 10 * 60
COOKIE_NAME = "fanji_share_auth"
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
TUNNEL_RE = re.compile(r"https://[a-z0-9-]+\.lhr\.life", re.IGNORECASE)
CLOUDFLARE_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com", re.IGNORECASE)


class ShareError(Exception):
    pass


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def fmt_local(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


def safe_media_name(name: str) -> str | None:
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        return None
    return name


class CloudflareTunnel:
    """Cloudflare Quick Tunnel：比 localhost.run 更快，但同样只适合临时分享。"""

    def __init__(self, port: int, work_dir: Path, binary: Path) -> None:
        self.port = port
        self.work_dir = work_dir
        self.binary = binary
        self.proc: subprocess.Popen[str] | None = None
        self.url: str | None = None
        self._ready = threading.Event()
        self._reader: threading.Thread | None = None
        self._output: list[str] = []

    def start(self, timeout: float = 45.0) -> str:
        if not self.binary.is_file():
            raise ShareError("Cloudflare 隧道组件缺失，请重新安装番迹")
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.proc = subprocess.Popen(
            [
                str(self.binary),
                "tunnel",
                "--url", f"http://127.0.0.1:{self.port}",
                "--no-autoupdate",
                "--protocol", "http2",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=flags,
            cwd=str(self.work_dir),
        )
        self._reader = threading.Thread(target=self._read_output, daemon=True)
        self._reader.start()
        if not self._ready.wait(timeout):
            detail = "".join(self._output[-5:]).strip()
            self.stop()
            raise ShareError(f"Cloudflare 隧道连接超时。{detail[:180]}")
        if not self.url:
            detail = "".join(self._output[-5:]).strip()
            self.stop()
            raise ShareError(f"Cloudflare 隧道没有返回地址。{detail[:180]}")
        return self.url

    def _read_output(self) -> None:
        proc = self.proc
        if not proc or not proc.stdout:
            self._ready.set()
            return
        try:
            for line in proc.stdout:
                self._output.append(line)
                if len(self._output) > 40:
                    self._output = self._output[-40:]
                if not self.url:
                    match = CLOUDFLARE_RE.search(line)
                    if match:
                        self.url = match.group(0)
                        self._ready.set()
        finally:
            self._ready.set()

    def stop(self) -> None:
        proc = self.proc
        self.proc = None
        if proc and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=6)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        if self._reader and self._reader.is_alive():
            self._reader.join(timeout=2)


class LocalhostRunTunnel:
    """使用 Windows 自带 OpenSSH 连接 localhost.run，不依赖额外 exe。"""

    def __init__(self, port: int, work_dir: Path) -> None:
        self.port = port
        self.work_dir = work_dir
        self.proc: subprocess.Popen[str] | None = None
        self.url: str | None = None
        self.error = ""
        self._ready = threading.Event()
        self._reader: threading.Thread | None = None
        self._output: list[str] = []

    def start(self, timeout: float = 40.0) -> str:
        ssh = shutil.which("ssh") or r"C:\Windows\System32\OpenSSH\ssh.exe"
        if not Path(ssh).exists():
            raise ShareError("系统里没有找到 OpenSSH，无法建立临时公网链接")
        self.work_dir.mkdir(parents=True, exist_ok=True)
        known_hosts = self.work_dir / "known_hosts"
        command = [
            ssh,
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", f"UserKnownHostsFile={known_hosts}",
            "-o", "ServerAliveInterval=30",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "ConnectTimeout=20",
            "-R", f"80:127.0.0.1:{self.port}",
            "nokey@localhost.run",
        ]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self.proc = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=flags,
        )
        self._reader = threading.Thread(target=self._read_output, daemon=True)
        self._reader.start()
        if not self._ready.wait(timeout):
            detail = "".join(self._output[-6:]).strip()
            self.stop()
            raise ShareError(f"临时公网隧道连接超时。{detail[:180]}")
        if not self.url:
            detail = "".join(self._output[-6:]).strip()
            self.stop()
            raise ShareError(f"临时公网隧道没有返回地址。{detail[:180]}")
        return self.url

    def _read_output(self) -> None:
        proc = self.proc
        if not proc or not proc.stdout:
            self._ready.set()
            return
        try:
            for line in proc.stdout:
                self._output.append(line)
                if len(self._output) > 40:
                    self._output = self._output[-40:]
                if not self.url:
                    match = TUNNEL_RE.search(line)
                    if match:
                        self.url = match.group(0)
                        self._ready.set()
        finally:
            if not self.url:
                code = proc.poll()
                self.error = f"隧道进程退出（{code}）"
            self._ready.set()

    def stop(self) -> None:
        proc = self.proc
        self.proc = None
        if proc and proc.poll() is None:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        if self._reader and self._reader.is_alive():
            self._reader.join(timeout=2)


class ShareHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, server_address, handler, manager: ShareManager) -> None:
        super().__init__(server_address, handler)
        self.manager = manager


class ShareHandler(BaseHTTPRequestHandler):
    server: ShareHTTPServer
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    @property
    def manager(self) -> ShareManager:
        return self.server.manager

    # ---- helpers ---------------------------------------------------------

    def _token_from_path(self, path: str) -> tuple[str | None, str]:
        parts = path.split("/", 3)
        if len(parts) < 3 or parts[1] != "s":
            return None, ""
        token = parts[2]
        rest = "/" + parts[3] if len(parts) > 3 else "/"
        return token, rest

    def _valid_token(self, token: str) -> bool:
        return bool(TOKEN_RE.fullmatch(token or "")) and hmac.compare_digest(token, self.manager.token or "")

    def _expired(self) -> bool:
        return bool(self.manager.expires_at and time.time() >= self.manager.expires_at)

    def _cookie_ok(self, token: str) -> bool:
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            name, _, value = part.strip().partition("=")
            if name != COOKIE_NAME:
                continue
            expected = self.manager.cookie_value
            return bool(expected) and hmac.compare_digest(value, expected)
        return False

    def _send_html(self, body: str, status: int = 200) -> None:
        raw = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(raw)

    def _send_json(self, payload: dict, status: int = 200) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)

    def _redirect(self, location: str, cookie: str | None = None) -> None:
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", location)
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _secure_cookie(self) -> bool:
        return (self.headers.get("X-Forwarded-Proto") or "").lower() == "https"

    def _client_ip(self) -> str:
        forwarded = self.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",", 1)[0].strip()
        return self.client_address[0] if self.client_address else "unknown"

    def _record_attempt(self) -> bool:
        return self.manager.record_attempt(self._client_ip())

    # ---- pages -----------------------------------------------------------

    def _gate_html(self, token: str, error: str = "") -> str:
        action = f"/s/{quote(token)}/unlock"
        expiry = fmt_local(self.manager.expires_at or time.time())
        error_html = f'<p class="gate-error">{html.escape(error)}</p>' if error else ""
        return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>番迹 · 私密分享</title>
<style>
:root {{ color-scheme: light; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
  background: #100d18; color: #241d2f; font-family: "Microsoft YaHei", system-ui, sans-serif; }}
body::before {{ content: ""; position: fixed; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse 60% 50% at 50% 10%, rgba(255,93,158,.22), transparent 65%),
              radial-gradient(ellipse 40% 40% at 85% 90%, rgba(255,216,77,.08), transparent 70%); }}
.card {{ position: relative; width: min(440px, 100%); padding: 30px 30px 24px; border: 2.5px solid #241d2f;
  border-radius: 22px; background: #fff7e8; box-shadow: 0 28px 80px rgba(0,0,0,.45), 7px 7px 0 rgba(0,0,0,.35);
  transform: rotate(-.5deg); }}
.tape {{ position: absolute; top: -13px; left: 28px; padding: 4px 14px; border: 1.5px solid #241d2f;
  background: #ffd84d; font-size: 9px; font-weight: 900; letter-spacing: .14em; transform: rotate(-2deg); }}
.eyebrow {{ margin: 0 0 10px; color: #e94f8a; font-size: 9px; font-weight: 800; letter-spacing: .18em; }}
h1 {{ margin: 0; font-size: 31px; line-height: 1.3; letter-spacing: -.04em; }}
h1 span {{ background: linear-gradient(180deg, transparent 60%, #ffc5da 60%); padding: 0 4px; }}
.lead {{ margin: 12px 0 0; color: #6d6479; font-size: 12px; line-height: 1.8; }}
form {{ margin-top: 20px; }}
label {{ display: block; margin-bottom: 7px; color: #6d6479; font-size: 10px; font-weight: 700; }}
.code-input {{ width: 100%; padding: 13px 14px; border: 2px solid #241d2f; border-radius: 10px; background: #fff;
  color: #241d2f; font: 900 24px/1 "Segoe UI", sans-serif; letter-spacing: .35em; text-align: center; outline: none; }}
.code-input:focus {{ box-shadow: 0 0 0 4px rgba(255,93,158,.18); }}
button {{ width: 100%; margin-top: 12px; padding: 12px 18px; border: 2px solid #241d2f; border-radius: 10px;
  background: #ff5d9e; color: #fff; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer;
  box-shadow: 3px 3px 0 #241d2f; }}
button:hover {{ background: #f0448a; }}
.gate-error {{ margin: 10px 0 0; padding: 8px 10px; border: 1.5px solid #e94f8a; border-radius: 8px;
  background: #ffe3ed; color: #b4235a; font-size: 11px; }}
.hint {{ margin: 16px 0 0; padding-top: 12px; border-top: 1px dashed rgba(36,29,47,.22);
  color: #938a9e; font-size: 9px; line-height: 1.7; text-align: center; }}
</style>
</head>
<body>
<main class="card">
  <span class="tape">PRIVATE SHARE</span>
  <p class="eyebrow">FANJI / READ ONLY ARCHIVE</p>
  <h1>这是一本<br><span>只读的动漫手帐。</span></h1>
  <p class="lead">请输入分享者给你的 6 位访问码。<br>这里只能浏览，不能修改原手帐。</p>
  <form method="post" action="{action}">
    <label for="code">访问码</label>
    <input class="code-input" id="code" name="code" inputmode="numeric" pattern="[0-9]{{6}}"
           maxlength="6" autocomplete="one-time-code" placeholder="••••••" required autofocus>
    {error_html}
    <button type="submit">打开这本手帐</button>
  </form>
  <p class="hint">这条链接将在 {expiry} 失效 · 访问码错误次数过多会暂时锁定</p>
</main>
</body>
</html>"""

    def _expired_html(self) -> str:
        return """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>番迹 · 链接已失效</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#100d18;color:#241d2f;
font-family:"Microsoft YaHei",system-ui,sans-serif}.card{width:min(420px,100%);padding:32px;border:2.5px solid #241d2f;
border-radius:20px;background:#fff7e8;box-shadow:8px 8px 0 rgba(0,0,0,.35);text-align:center}
h1{margin:0;font-size:27px;line-height:1.35}p{margin:12px 0 0;color:#6d6479;font-size:12px;line-height:1.8}
.stamp{display:inline-block;margin-bottom:14px;padding:5px 12px;border:2px solid #e94f8a;border-radius:8px;
color:#e94f8a;font-size:10px;font-weight:900;letter-spacing:.14em;transform:rotate(-3deg)}
</style></head><body><main class="card"><span class="stamp">CLOSED / 已合上</span>
<h1>这页手帐已经<br>合上了。</h1><p>分享链接已过期或被分享者停止。<br>如果还需要查看，请让对方重新生成一条链接。</p>
</main></body></html>"""

    # ---- GET -------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/":
            if not self.manager.token:
                self._send_html(self._expired_html(), HTTPStatus.GONE)
                return
            self._redirect(f"/s/{self.manager.token}/")
            return

        token, rest = self._token_from_path(path)
        if not token or not self._valid_token(token):
            self._send_html(self._expired_html(), HTTPStatus.NOT_FOUND)
            return
        if self._expired():
            self._send_html(self._expired_html(), HTTPStatus.GONE)
            return
        if rest == "/":
            if not self._cookie_ok(token):
                self._send_html(self._gate_html(token))
                return
            self._serve_static("share.html", "text/html; charset=utf-8")
            return
        if rest == "/data":
            if not self._cookie_ok(token):
                self._send_json({"error": "需要访问码"}, HTTPStatus.UNAUTHORIZED)
                return
            try:
                payload = json.loads((self.manager.session_dir / "data.json").read_text("utf-8"))
            except (OSError, json.JSONDecodeError):
                self._send_json({"error": "分享内容不可用"}, HTTPStatus.GONE)
                return
            self._send_json(payload)
            return
        if rest.startswith("/media/"):
            if not self._cookie_ok(token):
                self._send_json({"error": "需要访问码"}, HTTPStatus.UNAUTHORIZED)
                return
            filename = safe_media_name(rest[len("/media/"):])
            if not filename:
                self._send_json({"error": "图片不存在"}, HTTPStatus.NOT_FOUND)
                return
            path_obj = (self.manager.session_dir / "images" / filename).resolve()
            try:
                path_obj.relative_to((self.manager.session_dir / "images").resolve())
            except ValueError:
                self._send_json({"error": "图片不存在"}, HTTPStatus.NOT_FOUND)
                return
            if not path_obj.is_file():
                self._send_json({"error": "图片不存在"}, HTTPStatus.NOT_FOUND)
                return
            body = path_obj.read_bytes()
            ctype = mimetypes.guess_type(path_obj.name)[0] or "application/octet-stream"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "private, max-age=3600")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
            return
        if rest in ("/styles.css", "/share.css", "/share.js", "/favicon.svg"):
            self._serve_static(rest.lstrip("/"), None)
            return
        self._send_html(self._expired_html(), HTTPStatus.NOT_FOUND)

    # ---- POST ------------------------------------------------------------

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        token, rest = self._token_from_path(path)
        if not token or not self._valid_token(token):
            self._send_html(self._expired_html(), HTTPStatus.NOT_FOUND)
            return
        if self._expired():
            self._send_html(self._expired_html(), HTTPStatus.GONE)
            return
        if rest != "/unlock":
            self._send_html(self._expired_html(), HTTPStatus.NOT_FOUND)
            return
        if not self._record_attempt():
            self._send_html(self._gate_html(token, "尝试次数太多，请十分钟后再试。"), HTTPStatus.TOO_MANY_REQUESTS)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 4096:
            self._send_html(self._gate_html(token, "访问码格式不正确。"), HTTPStatus.BAD_REQUEST)
            return
        raw = self.rfile.read(length).decode("utf-8", "replace")
        form = parse_qs(raw)
        code = (form.get("code") or [""])[0].strip()
        if not hmac.compare_digest(code, self.manager.code or ""):
            self._send_html(self._gate_html(token, "访问码不对，再试一次。"), HTTPStatus.UNAUTHORIZED)
            return
        cookie = (
            f"{COOKIE_NAME}={self.manager.cookie_value}; Path=/s/{token}/; "
            f"Max-Age={SHARE_TTL_SECONDS}; HttpOnly; SameSite=Lax"
        )
        if self._secure_cookie():
            cookie += "; Secure"
        self._redirect(f"/s/{token}/", cookie)

    # ---- static ----------------------------------------------------------

    def _serve_static(self, rel: str, content_type: str | None) -> None:
        candidate = (self.manager.static_dir / rel).resolve()
        try:
            candidate.relative_to(self.manager.static_dir.resolve())
        except ValueError:
            self._send_html(self._expired_html(), HTTPStatus.NOT_FOUND)
            return
        if not candidate.is_file():
            self._send_html(self._expired_html(), HTTPStatus.NOT_FOUND)
            return
        body = candidate.read_bytes()
        ctype = content_type or mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)


class ShareManager:
    def __init__(self, base_dir: Path, static_dir: Path, data_dir: Path) -> None:
        self.base_dir = base_dir
        self.static_dir = static_dir
        self.data_dir = data_dir
        self.shares_dir = data_dir / "shares"
        self.lock = threading.RLock()
        self.server: ShareHTTPServer | None = None
        self.server_thread: threading.Thread | None = None
        self.tunnel: CloudflareTunnel | LocalhostRunTunnel | None = None
        self.token: str | None = None
        self.code: str | None = None
        self.cookie_value: str | None = None
        self.expires_at: float = 0
        self.created_at: float = 0
        self.link: str | None = None
        self.count = 0
        self.warning = ""
        self.last_error = ""
        self.attempts: dict[str, list[float]] = {}
        self._secret = secrets.token_bytes(32)
        self._cleanup_stale()

    # ---- public API ------------------------------------------------------

    def start(self) -> dict:
        with self.lock:
            if self.server and self.expires_at > time.time():
                return self.status()
            if self.server:
                self.stop()
            self.last_error = ""
            self.shares_dir.mkdir(parents=True, exist_ok=True)
            self.token = secrets.token_urlsafe(18)
            self.code = f"{secrets.randbelow(1_000_000):06d}"
            self.created_at = time.time()
            self.expires_at = self.created_at + SHARE_TTL_SECONDS
            self.cookie_value = f"{self.token}.{hmac.new(self._secret, self.token.encode(), 'sha256').hexdigest()}"
            self.session_dir = self.shares_dir / self.token
            self.session_dir.mkdir(parents=True, exist_ok=True)
            try:
                self.count = self._snapshot()
                self.server = ShareHTTPServer(("127.0.0.1", 0), ShareHandler, self)
                port = self.server.server_address[1]
                self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
                self.server_thread.start()
                binary = self.base_dir / "appcore" / "bin" / "cloudflared.exe"
                if binary.is_file():
                    self.tunnel = CloudflareTunnel(port, self.shares_dir, binary)
                else:
                    self.tunnel = LocalhostRunTunnel(port, self.shares_dir)
                root = self.tunnel.start()
                self.warning = "" if self._wait_public(root, timeout=24.0) else "链接刚生成，域名可能还需要十几秒才能打开"
                self.link = f"{root}/s/{self.token}/"
                return self.status()
            except Exception:
                self.stop()
                raise

    def stop(self) -> None:
        with self.lock:
            if self.tunnel:
                self.tunnel.stop()
                self.tunnel = None
            if self.server:
                try:
                    self.server.shutdown()
                    self.server.server_close()
                except Exception:
                    pass
                self.server = None
            if self.server_thread and self.server_thread.is_alive():
                self.server_thread.join(timeout=2)
            self.server_thread = None
            if getattr(self, "session_dir", None):
                shutil.rmtree(self.session_dir, ignore_errors=True)
            self.session_dir = None
            self.token = None
            self.code = None
            self.cookie_value = None
            self.expires_at = 0
            self.created_at = 0
            self.link = None
            self.count = 0
            self.warning = ""
            self.attempts.clear()

    def status(self) -> dict:
        with self.lock:
            if not self.server or not self.token:
                return {"active": False}
            if time.time() >= self.expires_at:
                self.stop()
                return {"active": False, "expired": True}
            left = max(0, int(self.expires_at - time.time()))
            return {
                "active": True,
                "link": self.link,
                "code": self.code,
                "warning": self.warning,
                "expiresAt": iso(datetime.fromtimestamp(self.expires_at, timezone.utc)),
                "expiresAtLocal": fmt_local(self.expires_at),
                "secondsLeft": left,
                "count": self.count,
            }

    def record_attempt(self, ip: str) -> bool:
        with self.lock:
            now = time.time()
            bucket = [t for t in self.attempts.get(ip, []) if now - t < ATTEMPT_WINDOW_SECONDS]
            if len(bucket) >= MAX_CODE_ATTEMPTS:
                self.attempts[ip] = bucket
                return False
            bucket.append(now)
            self.attempts[ip] = bucket
            return True

    # ---- snapshot --------------------------------------------------------

    def _wait_public(self, root: str, timeout: float = 35.0) -> bool:
        """等新域名的 DNS 生效，避免用户拿到一条刚生成就打不开的链接。"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(root + "/", timeout=6) as response:
                    if response.status < 500:
                        return True
            except urllib.error.HTTPError as exc:
                if exc.code < 500:
                    return True
            except Exception:
                pass
            time.sleep(1.2)
        return False

    def _snapshot(self) -> int:
        source = self.data_dir / "anime.json"
        try:
            payload = json.loads(source.read_text("utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ShareError(f"读取手帐数据失败：{exc}") from exc
        raw_items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(raw_items, list):
            raise ShareError("手帐数据格式异常")

        images_dir = self.session_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        allowed = (
            "id", "title", "altTitle", "status", "rating", "finishedYear",
            "episodesTotal", "episodesWatched", "tags", "notes", "accent",
            "createdAt", "updatedAt", "demo",
        )
        items = []
        used_images: dict[str, str] = {}
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            item = {key: raw.get(key) for key in allowed if key in raw}
            cover = str(raw.get("cover") or "")
            if cover and cover not in used_images:
                source_image = (self.data_dir / "images" / cover).resolve()
                try:
                    source_image.relative_to((self.data_dir / "images").resolve())
                except ValueError:
                    source_image = Path("")
                if source_image and source_image.is_file():
                    target = images_dir / cover
                    shutil.copy2(source_image, target)
                    used_images[cover] = f"media/{quote(cover)}"
            item["coverUrl"] = used_images.get(cover) if cover else None
            items.append(item)

        data = {
            "version": 1,
            "generatedAt": iso(now_utc()),
            "expiresAt": iso(datetime.fromtimestamp(self.expires_at, timezone.utc)),
            "items": items,
        }
        (self.session_dir / "data.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return len(items)

    def _cleanup_stale(self) -> None:
        if not self.shares_dir.exists():
            return
        cutoff = time.time() - SHARE_TTL_SECONDS
        for child in self.shares_dir.iterdir():
            if not child.is_dir():
                continue
            try:
                if child.stat().st_mtime < cutoff:
                    shutil.rmtree(child, ignore_errors=True)
            except OSError:
                pass
