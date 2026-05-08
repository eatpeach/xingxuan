from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.core.config import settings  # noqa
from app.db.base import Base  # noqa
from app import models  # noqa: 触发模型导入

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
if config.config_file_name:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
