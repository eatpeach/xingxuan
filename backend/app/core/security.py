from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
from jose import jwt, JWTError
from .config import settings

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(raw: str) -> str:
    return pwd_ctx.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    return pwd_ctx.verify(raw, hashed)


def create_access_token(sub: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MIN)
    return jwt.encode({"sub": sub, "role": role, "exp": exp}, settings.APP_SECRET, algorithm=settings.JWT_ALG)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.APP_SECRET, algorithms=[settings.JWT_ALG])
    except JWTError:
        return None
