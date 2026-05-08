"""首次初始化：建表 + 默认 admin + 默认设置 + 默认加价规则"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.base import Base
from app.db.session import engine, SessionLocal
from app.models import User, MarkupRule
from app.core.security import hash_password
from app.services.settings import ensure_defaults


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.username == "admin").first():
            db.add(User(
                username="admin",
                password_hash=hash_password("admin123"),
                name="管理员",
                role="admin",
                is_active=True,
            ))
            print("已创建默认管理员 admin / admin123")
        ensure_defaults(db)
        if not db.query(MarkupRule).filter(MarkupRule.is_default == True).first():
            db.add(MarkupRule(
                name="整单 +15%",
                type="flat_pct",
                value=15,
                is_default=True,
                remark="默认策略，可在系统设置中修改",
            ))
            print("已创建默认加价规则 整单 +15%")
        db.commit()
        print("初始化完成。数据库：", engine.url)
    finally:
        db.close()


if __name__ == "__main__":
    main()
