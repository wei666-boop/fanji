#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""番迹 · Anime Archive

一个完全本地运行的动漫收藏馆。数据保存在 data/anime.json，
封面图片保存在 data/images/，不需要联网、不需要安装任何第三方依赖。

启动：
    python app.py

可选参数：
    --port 8765      指定端口
    --no-browser     启动后不自动打开浏览器
"""

from __future__ import annotations

import argparse
import atexit
import base64
import json
import mimetypes
import os
import re
import shutil
import socket
import sys
import threading
import time
import uuid
import webbrowser
import zipfile
from datetime import datetime, timezone
from http import HTTPStatus
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from share_server import ShareManager, ShareError

BASE_DIR = Path(os.environ.get("FANJI_BASE_DIR") or Path(__file__).resolve().parent.parent).expanduser().resolve()
STATIC_DIR = Path(os.environ.get("FANJI_STATIC_DIR") or (BASE_DIR / "static")).expanduser().resolve()
DATA_DIR = Path(os.environ.get("FANJI_DATA_DIR") or (BASE_DIR / "data")).expanduser().resolve()
IMAGE_DIR = DATA_DIR / "images"
MUSIC_DIR = DATA_DIR / "music"
BACKUP_DIR = DATA_DIR / "backups"
DB_FILE = DATA_DIR / "anime.json"
MUSIC_INDEX = DATA_DIR / "music.json"

DEFAULT_PORT = 8765
MAX_BODY_BYTES = 64 * 1024 * 1024      # 单次请求上限（导入备份可能较大）
MAX_COVER_BYTES = 8 * 1024 * 1024      # 单张封面解压后上限
MAX_MUSIC_BYTES = 30 * 1024 * 1024     # 背景音乐上限
MAX_ITEMS = 2000

STATUSES = ("completed", "watching", "planned", "dropped")
STATUS_LABELS = {
    "completed": "已看完",
    "watching": "在看",
    "planned": "想看",
    "dropped": "弃番",
}
ACCENTS = (
    "#8b5cf6", "#f472b6", "#22d3ee", "#fbbf24", "#34d399",
    "#fb7185", "#a78bfa", "#60a5fa", "#f97316", "#2dd4bf",
)

DB_LOCK = threading.RLock()
BACKUP_LOCK = threading.RLock()
SHARE: ShareManager | None = None
FULL_BACKUP_PREFIX = "fanji-full-"
FULL_BACKUP_KEEP = 7
AUTO_BACKUP_INTERVAL = 24 * 60 * 60
MAX_BACKUP_BYTES = 120 * 1024 * 1024


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


# --------------------------------------------------------------------------
# 存储
# --------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def year_from_iso(value) -> int:
    """从 YYYY 或 YYYY-MM-DD 中取出年份，兼容旧版“看完日期”数据。"""
    match = re.match(r"^(\d{4})(?:-\d{2}-\d{2})?$", str(value or "").strip())
    if not match:
        return 0
    year = int(match.group(1))
    return year if 1900 <= year <= 2100 else 0


def normalize_year(value) -> int:
    try:
        year = int(value)
    except (TypeError, ValueError):
        return 0
    return year if 1900 <= year <= 2100 else 0


def ensure_dirs() -> None:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def load_db() -> dict:
    ensure_dirs()
    if not DB_FILE.exists():
        return {"version": 1, "items": []}
    try:
        with DB_FILE.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        raise ApiError(500, f"读取数据文件失败：{exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise ApiError(500, "数据文件格式异常，请检查 data/anime.json")
    # 兼容上一版保存的完整看完日期：只取年份，不修改磁盘上的原始数据。
    for item in data["items"]:
        if not isinstance(item, dict):
            continue
        if not normalize_year(item.get("finishedYear")):
            item["finishedYear"] = year_from_iso(item.get("finishedAt"))
    return data


def save_db(data: dict) -> None:
    ensure_dirs()
    tmp = DB_FILE.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, DB_FILE)


def backup_database(reason: str = "manual") -> Path | None:
    if not DB_FILE.exists():
        return None
    ensure_dirs()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = BACKUP_DIR / f"anime-{reason}-{stamp}.json"
    shutil.copy2(DB_FILE, target)
    # 只保留最近 30 份旧版 JSON 备份
    backups = sorted(BACKUP_DIR.glob("anime-*.json"))
    for old in backups[:-30]:
        try:
            old.unlink()
        except OSError:
            pass
    return target


# --------------------------------------------------------------------------
# 完整备份：数据 + 封面 + 背景音乐
# --------------------------------------------------------------------------

def create_full_backup(reason: str = "manual") -> Path | None:
    """把当前数据、封面和背景音乐打成一个可恢复的 zip。"""
    with BACKUP_LOCK:
        ensure_dirs()
        if not DB_FILE.exists():
            return None
        try:
            payload = json.loads(DB_FILE.read_text("utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ApiError(500, f"读取数据失败，无法备份：{exc}") from exc
        items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            raise ApiError(500, "数据格式异常，无法备份")
        has_music = bool(
            MUSIC_INDEX.exists()
            and MUSIC_DIR.exists()
            and any(path.is_file() for path in MUSIC_DIR.iterdir())
        )
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        safe_reason = re.sub(r"[^a-z0-9_-]+", "-", reason.lower()).strip("-") or "manual"
        target = BACKUP_DIR / f"{FULL_BACKUP_PREFIX}{stamp}-{safe_reason}-{uuid.uuid4().hex[:4]}.zip"
        tmp = target.with_suffix(".zip.tmp")
        manifest = {
            "app": "番迹",
            "version": 2,
            "createdAt": now_iso(),
            "reason": reason,
            "count": len(items),
            "hasMusic": has_music,
        }
        try:
            with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
                archive.write(DB_FILE, "anime.json")
                if IMAGE_DIR.exists():
                    for path in sorted(IMAGE_DIR.rglob("*")):
                        if path.is_file():
                            archive.write(path, "images/" + path.relative_to(IMAGE_DIR).as_posix())
                if MUSIC_INDEX.exists():
                    archive.write(MUSIC_INDEX, "music.json")
                if MUSIC_DIR.exists():
                    for path in sorted(MUSIC_DIR.rglob("*")):
                        if path.is_file():
                            archive.write(path, "music/" + path.relative_to(MUSIC_DIR).as_posix())
            os.replace(tmp, target)
        except Exception:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        _prune_full_backups()
        return target


def _prune_full_backups() -> None:
    backups = sorted(
        BACKUP_DIR.glob(f"{FULL_BACKUP_PREFIX}*.zip"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for old in backups[FULL_BACKUP_KEEP:]:
        try:
            old.unlink()
        except OSError:
            pass


def latest_full_backup_time() -> float:
    latest = 0.0
    for path in BACKUP_DIR.glob(f"{FULL_BACKUP_PREFIX}*.zip"):
        try:
            latest = max(latest, path.stat().st_mtime)
        except OSError:
            pass
    return latest


def maybe_auto_backup() -> None:
    if latest_full_backup_time() >= time.time() - AUTO_BACKUP_INTERVAL:
        return

    def worker() -> None:
        with BACKUP_LOCK:
            if latest_full_backup_time() >= time.time() - AUTO_BACKUP_INTERVAL:
                return
            try:
                create_full_backup("auto")
            except Exception:
                pass

    threading.Thread(target=worker, daemon=True).start()


def backup_info(path: Path) -> dict | None:
    try:
        stat = path.stat()
        with zipfile.ZipFile(path) as archive:
            raw = archive.read("manifest.json")
            manifest = json.loads(raw.decode("utf-8"))
    except (OSError, KeyError, zipfile.BadZipFile, json.JSONDecodeError):
        return None
    name = path.name
    return {
        "name": name,
        "createdAt": manifest.get("createdAt") or datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "reason": manifest.get("reason") or "manual",
        "count": int(manifest.get("count") or 0),
        "hasMusic": bool(manifest.get("hasMusic")),
        "size": stat.st_size,
        "downloadUrl": f"/api/backups/download?name={quote(name)}",
    }


def list_full_backups() -> list[dict]:
    result = []
    paths = sorted(
        BACKUP_DIR.glob(f"{FULL_BACKUP_PREFIX}*.zip"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for path in paths[:30]:
        info = backup_info(path)
        if info:
            result.append(info)
    return result


def find_full_backup(name: str) -> Path | None:
    if not name or "/" in name or "\\" in name or not name.startswith(FULL_BACKUP_PREFIX):
        return None
    path = (BACKUP_DIR / name).resolve()
    try:
        path.relative_to(BACKUP_DIR.resolve())
    except ValueError:
        return None
    return path if path.is_file() and path.suffix.lower() == ".zip" else None


def _safe_extract(archive: zipfile.ZipFile, target_dir: Path) -> None:
    total = 0
    for info in archive.infolist():
        name = info.filename.replace("\\", "/")
        parts = Path(name).parts
        if name.startswith("/") or ".." in parts:
            raise ApiError(400, "备份文件包含不安全的路径")
        total += max(0, info.file_size)
        if total > MAX_BACKUP_BYTES:
            raise ApiError(400, "备份解压后仍然太大")
        if info.is_dir():
            continue
        destination = (target_dir / name).resolve()
        try:
            destination.relative_to(target_dir.resolve())
        except ValueError:
            raise ApiError(400, "备份文件包含不安全的路径")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(info) as source, destination.open("wb") as output:
            shutil.copyfileobj(source, output)


def restore_full_backup(path: Path) -> dict:
    """恢复完整备份；失败时尽量回滚，成功后返回安全备份信息。"""
    with BACKUP_LOCK:
        try:
            archive = zipfile.ZipFile(path)
        except (OSError, zipfile.BadZipFile) as exc:
            raise ApiError(400, "这不是有效的番迹完整备份") from exc
        with archive:
            if "anime.json" not in archive.namelist():
                raise ApiError(400, "备份里缺少 anime.json")
            try:
                raw_db = archive.read("anime.json")
                data = json.loads(raw_db.decode("utf-8"))
            except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ApiError(400, "备份里的手帐数据损坏") from exc
            if not isinstance(data, dict) or not isinstance(data.get("items"), list):
                raise ApiError(400, "备份里的手帐数据格式不正确")
            if len(data["items"]) > MAX_ITEMS:
                raise ApiError(400, f"备份中的条目太多（最多 {MAX_ITEMS} 条）")
            for item in data["items"]:
                if not isinstance(item, dict):
                    raise ApiError(400, "备份中有无法识别的条目")
            temp_dir = BACKUP_DIR / f"restore-temp-{uuid.uuid4().hex}"
            temp_dir.mkdir(parents=True, exist_ok=False)
            try:
                _safe_extract(archive, temp_dir)
            except Exception:
                shutil.rmtree(temp_dir, ignore_errors=True)
                raise

        ensure_dirs()
        safety = create_full_backup("before-restore")
        holding = BACKUP_DIR / f"restore-old-{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"
        holding.mkdir(parents=True, exist_ok=True)
        moved: list[tuple[Path, Path]] = []
        try:
            for source in (DB_FILE, IMAGE_DIR, MUSIC_DIR, MUSIC_INDEX):
                if source.exists():
                    destination = holding / source.name
                    shutil.move(str(source), str(destination))
                    moved.append((source, destination))

            staged_db = temp_dir / "anime.json"
            shutil.copy2(staged_db, DB_FILE)
            IMAGE_DIR.mkdir(parents=True, exist_ok=True)
            staged_images = temp_dir / "images"
            if staged_images.is_dir():
                shutil.copytree(staged_images, IMAGE_DIR, dirs_exist_ok=True)
            MUSIC_DIR.mkdir(parents=True, exist_ok=True)
            staged_music = temp_dir / "music"
            if staged_music.is_dir():
                shutil.copytree(staged_music, MUSIC_DIR, dirs_exist_ok=True)
            staged_music_index = temp_dir / "music.json"
            if staged_music_index.is_file():
                shutil.copy2(staged_music_index, MUSIC_INDEX)
            else:
                MUSIC_INDEX.unlink(missing_ok=True)
        except Exception as exc:
            # 尝试把恢复前的数据放回去；安全备份仍然保留。
            try:
                for source in (DB_FILE, IMAGE_DIR, MUSIC_DIR, MUSIC_INDEX):
                    if source.is_dir():
                        shutil.rmtree(source, ignore_errors=True)
                    else:
                        source.unlink(missing_ok=True)
                for source, destination in moved:
                    if destination.exists():
                        shutil.move(str(destination), str(source))
                ensure_dirs()
            except Exception:
                pass
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise ApiError(500, f"恢复失败，原数据已保留；安全备份：{safety.name if safety else '无'}") from exc
        shutil.rmtree(temp_dir, ignore_errors=True)
        shutil.rmtree(holding, ignore_errors=True)
        ensure_dirs()
        return {
            "ok": True,
            "count": len(data["items"]),
            "safetyBackup": safety.name if safety else None,
        }


# --------------------------------------------------------------------------
# 数据清洗
# --------------------------------------------------------------------------

def _text(value, max_len: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    return value.strip()[:max_len]


def _int(value, default: int = 0, low: int = 0, high: int = 9999) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def _tags(value) -> list[str]:
    if isinstance(value, str):
        raw = re.split(r"[,，、/|]+", value)
    elif isinstance(value, list):
        raw = value
    else:
        raw = []
    result: list[str] = []
    seen: set[str] = set()
    for tag in raw:
        tag = _text(tag, 18)
        key = tag.casefold()
        if tag and key not in seen:
            seen.add(key)
            result.append(tag)
        if len(result) >= 8:
            break
    return result


def _accent(value, title: str) -> str:
    if isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        return value.lower()
    return ACCENTS[sum(ord(ch) for ch in title) % len(ACCENTS)]


def normalize_item(payload: dict, existing: dict | None = None) -> dict:
    if not isinstance(payload, dict):
        raise ApiError(400, "请求内容格式不正确")
    title = _text(payload.get("title"), 80)
    if not title:
        raise ApiError(400, "请填写动漫名称")

    status = payload.get("status", "completed")
    if status not in STATUSES:
        status = "completed"

    total = _int(payload.get("episodesTotal"), 0, 0, 9999)
    watched = _int(payload.get("episodesWatched"), 0, 0, 9999)
    if total > 0 and watched > total:
        watched = total

    if "finishedYear" in payload:
        finished_year = normalize_year(payload.get("finishedYear"))
    elif "finishedAt" in payload:
        finished_year = year_from_iso(payload.get("finishedAt"))
    else:
        finished_year = normalize_year(existing.get("finishedYear")) if existing else 0
        if not finished_year and existing:
            finished_year = year_from_iso(existing.get("finishedAt"))

    created = existing.get("createdAt") if existing else None
    timestamp = now_iso()
    item = {
        "id": existing.get("id") if existing else uuid.uuid4().hex,
        "title": title,
        "altTitle": _text(payload.get("altTitle"), 120),
        "status": status,
        "rating": _int(payload.get("rating"), 0, 0, 5),
        "finishedYear": finished_year,
        "episodesTotal": total,
        "episodesWatched": watched,
        "tags": _tags(payload.get("tags")),
        "notes": _text(payload.get("notes"), 2000),
        "accent": _accent(payload.get("accent"), title),
        "cover": existing.get("cover") if existing else None,
        "demo": bool(existing.get("demo")) if existing else False,
        "createdAt": created or timestamp,
        "updatedAt": timestamp,
    }
    return item


def public_item(item: dict) -> dict:
    result = {k: v for k, v in item.items() if k != "cover"}
    cover = item.get("cover")
    result["coverUrl"] = f"/media/{quote(cover)}" if cover else None
    return result


# --------------------------------------------------------------------------
# 封面
# --------------------------------------------------------------------------

DATA_URL_RE = re.compile(r"^data:image/(jpeg|jpg|png|webp|gif);base64,(.+)$", re.I | re.S)


def save_cover(data_url: str) -> str:
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
        raise ApiError(400, "封面图片格式不正确")
    match = DATA_URL_RE.match(data_url.strip())
    if not match:
        raise ApiError(400, "仅支持 JPG、PNG、WebP、GIF 图片")
    mime = match.group(1).lower()
    encoded = match.group(2)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise ApiError(400, "封面图片数据无法解析") from exc
    if len(raw) < 32:
        raise ApiError(400, "封面图片内容为空")
    if len(raw) > MAX_COVER_BYTES:
        raise ApiError(413, "封面图片太大了，请压缩到 8MB 以内")

    ext = detect_image_ext(raw, mime)
    if not ext:
        raise ApiError(400, "无法识别的图片格式")
    ensure_dirs()
    filename = f"{uuid.uuid4().hex}.{ext}"
    (IMAGE_DIR / filename).write_bytes(raw)
    return filename


def detect_image_ext(raw: bytes, mime: str) -> str | None:
    if raw.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if raw.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return "webp"
    return None


def cover_path(filename: str) -> Path | None:
    if not filename or "/" in filename or "\\" in filename:
        return None
    path = (IMAGE_DIR / filename).resolve()
    try:
        path.relative_to(IMAGE_DIR.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def delete_cover(filename: str | None) -> None:
    path = cover_path(filename or "")
    if path:
        try:
            path.unlink()
        except OSError:
            pass


def cover_file_to_data_url(filename: str) -> str | None:
    path = cover_path(filename or "")
    if not path:
        return None
    ext = path.suffix.lower().lstrip(".")
    mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "webp": "webp", "gif": "gif"}.get(ext, "jpeg")
    try:
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError:
        return None
    return f"data:image/{mime};base64,{encoded}"


# --------------------------------------------------------------------------
# 背景音乐
# --------------------------------------------------------------------------

AUDIO_MIME_EXT = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "m4a",
}
AUDIO_EXT_MIME = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "m4a": "audio/mp4",
}


def audio_ext(raw: bytes, mime: str) -> str | None:
    if raw.startswith(b"ID3") or raw[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"\xff\xf1"):
        return "mp3"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WAVE":
        return "wav"
    if raw.startswith(b"OggS"):
        return "ogg"
    if len(raw) > 12 and raw[4:8] == b"ftyp":
        return "m4a"
    return AUDIO_MIME_EXT.get(mime.split(";", 1)[0].strip().lower())


def music_path(filename: str) -> Path | None:
    if not filename or "/" in filename or "\\" in filename:
        return None
    path = (MUSIC_DIR / filename).resolve()
    try:
        path.relative_to(MUSIC_DIR.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def load_music_meta() -> dict | None:
    if not MUSIC_INDEX.exists():
        return None
    try:
        with MUSIC_INDEX.open("r", encoding="utf-8") as fh:
            meta = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(meta, dict):
        return None
    filename = str(meta.get("filename") or "")
    path = music_path(filename)
    if not path:
        return None
    return {
        "filename": filename,
        "name": str(meta.get("name") or "背景音乐")[:120],
        "size": path.stat().st_size,
        "contentType": AUDIO_EXT_MIME.get(path.suffix.lower().lstrip("."), "audio/mpeg"),
        "updatedAt": str(meta.get("updatedAt") or ""),
    }


def public_music(meta: dict | None) -> dict | None:
    if not meta:
        return None
    return {
        "name": meta["name"],
        "size": meta["size"],
        "contentType": meta["contentType"],
        "updatedAt": meta["updatedAt"],
        "url": f"/audio/{quote(meta['filename'])}",
    }


def save_music_meta(meta: dict) -> None:
    ensure_dirs()
    tmp = MUSIC_INDEX.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, MUSIC_INDEX)


def remove_music() -> None:
    meta = load_music_meta()
    if meta:
        path = music_path(meta["filename"])
        if path:
            try:
                path.unlink()
            except OSError:
                pass
    try:
        MUSIC_INDEX.unlink(missing_ok=True)
    except OSError:
        pass


# --------------------------------------------------------------------------
# 示例数据
# --------------------------------------------------------------------------

DEMO_ITEMS = [
    {
        "title": "进击的巨人 最终季 完结篇",
        "altTitle": "進撃の巨人 The Final Season",
        "status": "completed", "rating": 5, "finishedYear": 2024,
        "episodesTotal": 2, "episodesWatched": 2,
        "tags": ["热血", "奇幻", "剧情"],
        "notes": "自由，到底是什么？看完之后很久都没能缓过来。",
        "accent": "#b45309",
    },
    {
        "title": "葬送的芙莉莲",
        "altTitle": "葬送のフリーレン",
        "status": "completed", "rating": 5, "finishedYear": 2024,
        "episodesTotal": 28, "episodesWatched": 28,
        "tags": ["奇幻", "治愈", "冒险"],
        "notes": "时间尺度拉长之后，告别也变得温柔。每一集都像一首安静的诗。",
        "accent": "#0ea5e9",
    },
    {
        "title": "孤独摇滚！",
        "altTitle": "ぼっち・ざ・ろっく！",
        "status": "completed", "rating": 4, "finishedYear": 2023,
        "episodesTotal": 12, "episodesWatched": 12,
        "tags": ["音乐", "日常", "喜剧"],
        "notes": "社恐少女的乐队成长记，演出作画燃到起鸡皮疙瘩。",
        "accent": "#ec4899",
    },
    {
        "title": "冰菓",
        "altTitle": "氷菓",
        "status": "completed", "rating": 4, "finishedYear": 2025,
        "episodesTotal": 22, "episodesWatched": 22,
        "tags": ["推理", "校园", "日常"],
        "notes": "我很好奇。京都动画把日常里的微小谜题拍得闪闪发光。",
        "accent": "#10b981",
    },
    {
        "title": "赛博朋克：边缘行者",
        "altTitle": "Cyberpunk: Edgerunners",
        "status": "completed", "rating": 5, "finishedYear": 2024,
        "episodesTotal": 10, "episodesWatched": 10,
        "tags": ["科幻", "悲剧", "动作"],
        "notes": "夜之城的霓虹再亮，也照不亮所有人的结局。",
        "accent": "#eab308",
    },
    {
        "title": "夏日重现",
        "altTitle": "サマータイムレンダ",
        "status": "watching", "rating": 4, "finishedYear": 0,
        "episodesTotal": 25, "episodesWatched": 18,
        "tags": ["悬疑", "轮回", "热血"],
        "notes": "节奏紧凑，每一轮循环都有新信息，正在补完中。",
        "accent": "#6366f1",
    },
]


# --------------------------------------------------------------------------
# 请求处理
# --------------------------------------------------------------------------

class AnimeHandler(BaseHTTPRequestHandler):
    server_version = "AnimeArchive/1.0"
    protocol_version = "HTTP/1.1"

    # ---- 基础工具 ---------------------------------------------------------

    def log_message(self, fmt: str, *args) -> None:
        sys.stdout.write(f"[{datetime.now():%H:%M:%S}] {fmt % args}\n")

    def handle(self) -> None:
        # 浏览器刷新 / 关闭标签页时会直接断开 keep-alive 连接，
        # 这属于正常现象，不必打印整段 traceback。
        try:
            super().handle()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

    def _send(self, status: int, body: bytes, content_type: str, *,
              cache: str = "no-store", download: str | None = None,
              extra_headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        if download:
            self.send_header("Content-Disposition", f'attachment; filename="{download}"')
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def send_json(self, obj, status: int = 200, *, download: str | None = None) -> None:
        body = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8", download=download)

    def error_json(self, status: int, message: str) -> None:
        self.send_json({"error": message}, status)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(400, "请求长度不正确")
        if length <= 0:
            raise ApiError(400, "请求内容为空")
        if length > MAX_BODY_BYTES:
            raise ApiError(413, "请求内容过大，请压缩封面或减少条目后再试")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiError(400, "请求内容不是有效的 JSON") from exc
        if not isinstance(payload, dict):
            raise ApiError(400, "请求内容格式不正确")
        return payload

    def read_raw(self, max_bytes: int) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError(400, "请求长度不正确")
        if length <= 0:
            raise ApiError(400, "请求内容为空")
        if length > max_bytes:
            raise ApiError(413, f"文件太大了，最大支持 {max_bytes // (1024 * 1024)}MB")
        return self.rfile.read(length)

    # ---- 路由 -------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/api/health":
                data = load_db()
                self.send_json({"ok": True, "app": "番迹", "items": len(data["items"]), "time": now_iso()})
            elif path == "/api/anime":
                data = load_db()
                items = sorted(data["items"], key=lambda x: x.get("createdAt", ""), reverse=True)
                self.send_json({"items": [public_item(x) for x in items]})
            elif path == "/api/export":
                self.handle_export()
            elif path == "/api/music":
                self.send_json({"music": public_music(load_music_meta())})
            elif path == "/api/share/status":
                self.send_json(SHARE.status() if SHARE else {"active": False})
            elif path == "/api/backups":
                self.send_json({"backups": list_full_backups()})
            elif path == "/api/backups/download":
                name = (parse_qs(urlparse(self.path).query).get("name") or [""])[0]
                backup = find_full_backup(name)
                if not backup:
                    raise ApiError(404, "备份不存在")
                self._send(
                    HTTPStatus.OK,
                    backup.read_bytes(),
                    "application/zip",
                    cache="no-store",
                    download=backup.name,
                )
            elif path == "/api/backup/export":
                self.handle_backup_export()
            elif path.startswith("/audio/"):
                self.serve_audio(path[len("/audio/"):])
            elif path.startswith("/media/"):
                self.serve_media(path[len("/media/"):])
            elif path == "/favicon.ico":
                self.serve_static("favicon.svg")
            else:
                rel = "index.html" if path in ("/", "") else path.lstrip("/")
                self.serve_static(rel)
        except ApiError as exc:
            self.error_json(exc.status, exc.message)
        except Exception as exc:  # noqa: BLE001
            self.log_error("GET %s failed: %r", path, exc)
            self.error_json(500, "服务器出了点小问题，请稍后再试")

    def do_HEAD(self) -> None:  # noqa: N802
        self.do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/api/anime":
                self.handle_create()
            elif path == "/api/demo":
                self.handle_demo_create()
            elif path == "/api/import":
                self.handle_import()
            elif path == "/api/music":
                self.handle_music_upload()
            elif path == "/api/share/start":
                if not SHARE:
                    raise ApiError(503, "分享服务还没有准备好")
                try:
                    info = SHARE.start()
                except ShareError as exc:
                    raise ApiError(502, str(exc)) from exc
                self.send_json(info)
            elif path == "/api/share/stop":
                if SHARE:
                    SHARE.stop()
                self.send_json({"ok": True})
            elif path == "/api/backups/create":
                self.handle_backup_create()
            elif path == "/api/backups/restore":
                self.handle_backup_restore()
            elif path == "/api/backup/import":
                self.handle_backup_upload()
            else:
                raise ApiError(404, "接口不存在")
        except ApiError as exc:
            self.error_json(exc.status, exc.message)
        except Exception as exc:  # noqa: BLE001
            self.log_error("POST %s failed: %r", path, exc)
            self.error_json(500, "服务器出了点小问题，请稍后再试")

    def do_PUT(self) -> None:  # noqa: N802
        path = unquote(urlparse(self.path).path)
        match = re.fullmatch(r"/api/anime/([a-f0-9]{32})", path)
        try:
            if not match:
                raise ApiError(404, "接口不存在")
            self.handle_update(match.group(1))
        except ApiError as exc:
            self.error_json(exc.status, exc.message)
        except Exception as exc:  # noqa: BLE001
            self.log_error("PUT %s failed: %r", path, exc)
            self.error_json(500, "服务器出了点小问题，请稍后再试")

    def do_DELETE(self) -> None:  # noqa: N802
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/api/demo":
                self.handle_demo_clear()
                return
            if path == "/api/music":
                with DB_LOCK:
                    remove_music()
                self.send_json({"ok": True})
                maybe_auto_backup()
                return
            match = re.fullmatch(r"/api/anime/([a-f0-9]{32})", path)
            if not match:
                raise ApiError(404, "接口不存在")
            self.handle_delete(match.group(1))
        except ApiError as exc:
            self.error_json(exc.status, exc.message)
        except Exception as exc:  # noqa: BLE001
            self.log_error("DELETE %s failed: %r", path, exc)
            self.error_json(500, "服务器出了点小问题，请稍后再试")

    # ---- 业务 -------------------------------------------------------------

    def handle_create(self) -> None:
        payload = self.read_json()
        with DB_LOCK:
            data = load_db()
            if len(data["items"]) >= MAX_ITEMS:
                raise ApiError(400, f"最多保存 {MAX_ITEMS} 部动漫")
            item = normalize_item(payload)
            cover_data = payload.get("coverData")
            if cover_data:
                item["cover"] = save_cover(cover_data)
            data["items"].append(item)
            try:
                save_db(data)
            except Exception:
                delete_cover(item.get("cover"))
                raise
            self.send_json({"item": public_item(item)}, 201)
        maybe_auto_backup()

    def handle_update(self, item_id: str) -> None:
        payload = self.read_json()
        with DB_LOCK:
            data = load_db()
            index = next((i for i, x in enumerate(data["items"]) if x.get("id") == item_id), None)
            if index is None:
                raise ApiError(404, "没有找到这部动漫，可能已经被删除")
            existing = data["items"][index]
            item = normalize_item(payload, existing)
            item["demo"] = False
            old_cover = existing.get("cover")
            new_cover_file = None
            if payload.get("coverData"):
                new_cover_file = save_cover(payload["coverData"])
                item["cover"] = new_cover_file
            elif payload.get("removeCover"):
                item["cover"] = None
            if not payload.get("coverData") and not payload.get("removeCover"):
                item["cover"] = old_cover
            data["items"][index] = item
            try:
                save_db(data)
            except Exception:
                delete_cover(new_cover_file)
                raise
            if (new_cover_file or payload.get("removeCover")) and old_cover:
                delete_cover(old_cover)
            self.send_json({"item": public_item(item)})
        maybe_auto_backup()

    def handle_delete(self, item_id: str) -> None:
        with DB_LOCK:
            data = load_db()
            index = next((i for i, x in enumerate(data["items"]) if x.get("id") == item_id), None)
            if index is None:
                raise ApiError(404, "没有找到这部动漫，可能已经被删除")
            item = data["items"].pop(index)
            save_db(data)
            delete_cover(item.get("cover"))
            self.send_json({"ok": True, "id": item_id})
        maybe_auto_backup()

    def handle_demo_create(self) -> None:
        with DB_LOCK:
            data = load_db()
            existing_demo = [x for x in data["items"] if x.get("demo")]
            if existing_demo:
                self.send_json({"items": [public_item(x) for x in existing_demo], "already": True})
                return
            created = []
            base = time.time()
            for offset, template in enumerate(DEMO_ITEMS):
                item = normalize_item(template)
                item["demo"] = True
                stamp = datetime.fromtimestamp(base - offset * 60, tz=timezone.utc)
                item["createdAt"] = stamp.isoformat(timespec="seconds").replace("+00:00", "Z")
                item["updatedAt"] = item["createdAt"]
                created.append(item)
            data["items"].extend(created)
            save_db(data)
            self.send_json({"items": [public_item(x) for x in created]}, 201)
        maybe_auto_backup()

    def handle_demo_clear(self) -> None:
        with DB_LOCK:
            data = load_db()
            demo = [x for x in data["items"] if x.get("demo")]
            data["items"] = [x for x in data["items"] if not x.get("demo")]
            save_db(data)
            for item in demo:
                delete_cover(item.get("cover"))
            self.send_json({"ok": True, "removed": len(demo)})
        maybe_auto_backup()

    def handle_export(self) -> None:
        with DB_LOCK:
            data = load_db()
            items = []
            for item in sorted(data["items"], key=lambda x: x.get("createdAt", ""), reverse=True):
                exported = public_item(item)
                exported.pop("coverUrl", None)
                exported["coverData"] = cover_file_to_data_url(item.get("cover"))
                items.append(exported)
        filename = f"fanji-backup-{datetime.now():%Y%m%d-%H%M%S}.json"
        self.send_json(
            {
                "app": "番迹",
                "version": 1,
                "exportedAt": now_iso(),
                "count": len(items),
                "items": items,
            },
            download=filename,
        )

    def handle_import(self) -> None:
        payload = self.read_json()
        raw_items = payload.get("items")
        if not isinstance(raw_items, list):
            raise ApiError(400, "备份文件格式不正确：缺少 items")
        if len(raw_items) > MAX_ITEMS:
            raise ApiError(400, f"备份中的条目太多（最多 {MAX_ITEMS} 条）")
        with DB_LOCK:
            old_data = load_db()
            old_covers = {x.get("cover") for x in old_data["items"] if x.get("cover")}
            new_items: list[dict] = []
            new_covers: list[str] = []
            try:
                for raw in raw_items:
                    if not isinstance(raw, dict):
                        raise ApiError(400, "备份中有无法识别的条目")
                    item = normalize_item(raw)
                    item["id"] = uuid.uuid4().hex
                    item["demo"] = False
                    item["createdAt"] = _text(raw.get("createdAt"), 40) or now_iso()
                    item["updatedAt"] = now_iso()
                    cover_data = raw.get("coverData")
                    if cover_data:
                        filename = save_cover(cover_data)
                        item["cover"] = filename
                        new_covers.append(filename)
                    new_items.append(item)
            except Exception:
                for filename in new_covers:
                    delete_cover(filename)
                raise

            try:
                create_full_backup("before-import")
                save_db({"version": 1, "items": new_items})
            except Exception:
                for filename in new_covers:
                    delete_cover(filename)
                raise
            # 新数据已经安全落盘，再把旧封面移入备份目录，避免误删后无法找回
            if old_covers:
                stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                trash = BACKUP_DIR / f"images-{stamp}"
                trash.mkdir(parents=True, exist_ok=True)
                for filename in old_covers:
                    path = cover_path(filename or "")
                    if path:
                        try:
                            shutil.move(str(path), str(trash / path.name))
                        except OSError:
                            pass
            self.send_json({"ok": True, "count": len(new_items)})
            maybe_auto_backup()

    def handle_backup_export(self) -> None:
        backup = create_full_backup("download")
        if not backup:
            raise ApiError(400, "当前没有可备份的数据")
        self._send(
            HTTPStatus.OK,
            backup.read_bytes(),
            "application/zip",
            cache="no-store",
            download=backup.name,
        )

    def handle_backup_create(self) -> None:
        backup = create_full_backup("manual")
        if not backup:
            raise ApiError(400, "当前没有可备份的数据")
        info = backup_info(backup)
        self.send_json({"ok": True, "backup": info}, 201)

    def handle_backup_restore(self) -> None:
        payload = self.read_json()
        name = str(payload.get("name") or "").strip()
        backup = find_full_backup(name)
        if not backup:
            raise ApiError(404, "没有找到这份备份")
        with DB_LOCK:
            result = restore_full_backup(backup)
        self.send_json(result)

    def handle_backup_upload(self) -> None:
        raw = self.read_raw(MAX_BACKUP_BYTES)
        if len(raw) < 100:
            raise ApiError(400, "备份文件内容为空")
        temp = DATA_DIR / f".upload-{uuid.uuid4().hex}.zip"
        try:
            temp.write_bytes(raw)
            with DB_LOCK:
                result = restore_full_backup(temp)
        except zipfile.BadZipFile as exc:
            raise ApiError(400, "这不是有效的番迹完整备份") from exc
        finally:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass
        self.send_json(result)

    def handle_music_upload(self) -> None:
        raw = self.read_raw(MAX_MUSIC_BYTES)
        mime = (self.headers.get("Content-Type") or "application/octet-stream").split(";", 1)[0].strip().lower()
        ext = audio_ext(raw, mime)
        if not ext:
            raise ApiError(400, "仅支持 MP3、WAV、OGG、M4A 音频")

        query = parse_qs(urlparse(self.path).query)
        name = (query.get("name") or ["背景音乐"])[0].strip()[:120] or "背景音乐"

        ensure_dirs()
        filename = f"bgm-{uuid.uuid4().hex}.{ext}"
        target = MUSIC_DIR / filename
        target.write_bytes(raw)
        meta = {
            "filename": filename,
            "name": name,
            "contentType": AUDIO_EXT_MIME.get(ext, "audio/mpeg"),
            "updatedAt": now_iso(),
        }
        old = load_music_meta()
        try:
            save_music_meta(meta)
        except Exception:
            try:
                target.unlink()
            except OSError:
                pass
            raise
        if old:
            old_path = music_path(old["filename"])
            if old_path:
                try:
                    old_path.unlink()
                except OSError:
                    pass
        self.send_json({"music": public_music(load_music_meta())}, 201)
        maybe_auto_backup()

    # ---- 静态文件 ---------------------------------------------------------

    def serve_static(self, rel: str) -> None:
        rel = rel.replace("\\", "/").lstrip("/")
        candidate = (STATIC_DIR / rel).resolve()
        try:
            candidate.relative_to(STATIC_DIR.resolve())
        except ValueError:
            raise ApiError(404, "页面不存在")
        if candidate.is_dir():
            candidate = candidate / "index.html"
        if not candidate.is_file():
            raise ApiError(404, "页面不存在")
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
            content_type += "; charset=utf-8"
        body = candidate.read_bytes()
        cache = "no-cache"
        self._send(HTTPStatus.OK, body, content_type, cache=cache)

    def serve_media(self, filename: str) -> None:
        path = cover_path(filename)
        if not path:
            raise ApiError(404, "图片不存在")
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body = path.read_bytes()
        self._send(HTTPStatus.OK, body, content_type, cache="public, max-age=31536000, immutable")

    def serve_audio(self, filename: str) -> None:
        path = music_path(filename)
        if not path:
            raise ApiError(404, "没有这段背景音乐")
        ext = path.suffix.lower().lstrip(".")
        content_type = AUDIO_EXT_MIME.get(ext, "audio/mpeg")
        size = path.stat().st_size
        range_header = self.headers.get("Range") or ""
        start, end = 0, size - 1
        if range_header.startswith("bytes="):
            try:
                range_value = range_header[len("bytes="):].split(",", 1)[0]
                start_text, _, end_text = range_value.partition("-")
                start = int(start_text) if start_text else 0
                end = int(end_text) if end_text else size - 1
            except ValueError:
                raise ApiError(416, "音频范围不正确")
            if start < 0 or start >= size:
                raise ApiError(416, "音频范围不正确")
            end = min(end, size - 1)
            with path.open("rb") as fh:
                fh.seek(start)
                chunk = fh.read(end - start + 1)
            self._send(
                HTTPStatus.PARTIAL_CONTENT,
                chunk,
                content_type,
                cache="public, max-age=31536000, immutable",
                extra_headers={
                    "Accept-Ranges": "bytes",
                    "Content-Range": f"bytes {start}-{end}/{size}",
                },
            )
            return
        body = path.read_bytes()
        self._send(
            HTTPStatus.OK,
            body,
            content_type,
            cache="public, max-age=31536000, immutable",
            extra_headers={"Accept-Ranges": "bytes"},
        )


# --------------------------------------------------------------------------
# 启动
# --------------------------------------------------------------------------

def build_server(host: str, preferred_port: int) -> ThreadingHTTPServer:
    last_error: OSError | None = None
    for port in range(preferred_port, preferred_port + 20):
        try:
            server = ThreadingHTTPServer((host, port), AnimeHandler)
            server.daemon_threads = True
            return server
        except OSError as exc:
            last_error = exc
            continue
    raise SystemExit(f"无法启动服务：{last_error}")


def find_running_app(preferred_port: int) -> int | None:
    """如果同一份程序已经在运行，直接复用，避免两个服务同时写一份数据。"""
    for port in range(preferred_port, preferred_port + 20):
        # 先快速判断端口是否有人监听，避免在 20 个空闲端口上逐个等超时。
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.settimeout(0.08)
                if probe.connect_ex(("127.0.0.1", port)) != 0:
                    continue
        except OSError:
            continue
        connection = None
        try:
            connection = HTTPConnection("127.0.0.1", port, timeout=0.5)
            connection.request("GET", "/api/health")
            response = connection.getresponse()
            payload = json.loads(response.read().decode("utf-8"))
            if response.status == 200 and payload.get("app") == "番迹":
                return port
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        finally:
            if connection is not None:
                connection.close()
    return None


def write_ready_file(url: str) -> None:
    """桌面版启动时，把实际监听地址写进握手文件。"""
    target = os.environ.get("FANJI_READY_FILE")
    if not target:
        return
    path = Path(target)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(
            json.dumps({"url": url, "pid": os.getpid()}, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(temp, path)
    except OSError:
        pass


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    parser = argparse.ArgumentParser(description="番迹 · 本地动漫收藏馆")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="监听端口，默认 8765")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认仅本机")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()

    mimetypes.add_type("image/webp", ".webp")
    mimetypes.add_type("image/svg+xml", ".svg")
    mimetypes.add_type("application/javascript", ".js")

    existing_port = find_running_app(args.port)
    if existing_port:
        existing_url = f"http://{'127.0.0.1' if args.host in ('0.0.0.0', '::') else args.host}:{existing_port}"
        write_ready_file(existing_url)
        print(f"\n  番迹已经在运行：{existing_url}")
        if args.no_browser:
            print("  无需重复启动，直接使用上面的地址即可。\n")
        else:
            print("  已直接为你打开浏览器，无需重复启动。\n")
            webbrowser.open(existing_url)
        return

    ensure_dirs()
    global SHARE
    SHARE = ShareManager(BASE_DIR, STATIC_DIR, DATA_DIR)
    atexit.register(SHARE.stop)
    server = build_server(args.host, args.port)
    port = server.server_address[1]
    display_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
    url = f"http://{display_host}:{port}"
    write_ready_file(url)

    print()
    print("  ┌─────────────────────────────────────────────┐")
    print("  │   番迹 · ANIME ARCHIVE                      │")
    print("  │   把看过的故事，留在这里。                  │")
    print("  └─────────────────────────────────────────────┘")
    print(f"  本地地址 : {url}")
    print(f"  数据目录 : {DATA_DIR}")
    print("  停止服务 : 按 Ctrl + C")
    print()

    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    threading.Thread(target=maybe_auto_backup, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止服务，数据已安全保存在本地。")
    finally:
        server.server_close()
        if SHARE:
            SHARE.stop()


if __name__ == "__main__":
    main()
