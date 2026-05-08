from pathlib import Path
from datetime import datetime
from fastapi import UploadFile
from app.core.config import settings


def save_upload(file: UploadFile, sub: str) -> tuple[str, int]:
    """sub: inquiry / supplier_quote / export 等子目录。返回 (相对路径, size)"""
    base = settings.storage_path / sub
    base.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    safe_name = file.filename.replace("/", "_").replace("\\", "_")
    target = base / f"{ts}_{safe_name}"
    data = file.file.read()
    target.write_bytes(data)
    rel = target.relative_to(settings.storage_path).as_posix()
    return rel, len(data)
