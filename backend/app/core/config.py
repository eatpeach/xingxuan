from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_ENV: str = "dev"
    APP_SECRET: str = "change-me"
    DATABASE_URL: str = "sqlite:///./data/xingxuan.db"
    STORAGE_DIR: str = "./storage"
    JWT_ALG: str = "HS256"
    JWT_EXPIRE_MIN: int = 720
    PUBLIC_BASE_URL: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def storage_path(self) -> Path:
        p = Path(self.STORAGE_DIR).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()
