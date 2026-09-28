"""The Postgres driver is named, never left to SQLAlchemy's default.

SQLAlchemy 2.1 changed what `postgresql://` means from psycopg2 to psycopg 3.
requirements.txt installs psycopg2 and does not cap SQLAlchemy, so the first
image built after 2.1 shipped crashed on import - on Railway, where
DATABASE_URL is always `postgresql://` - while every test here ran on SQLite
and stayed green. These build a real engine from the URL Railway sends, which
loads the driver without connecting to anything.
"""
from sqlalchemy import create_engine

from app.config.settings import with_explicit_postgres_driver

RAILWAY_STYLE = "postgresql://user:pw@postgres.railway.internal:5432/railway"


def test_railway_url_loads_the_installed_driver():
    engine = create_engine(with_explicit_postgres_driver(RAILWAY_STYLE))
    assert engine.dialect.name == "postgresql"
    assert engine.dialect.driver == "psycopg2"


def test_legacy_postgres_scheme_is_normalised_too():
    url = with_explicit_postgres_driver("postgres://u:p@h:5432/db")
    assert url == "postgresql+psycopg2://u:p@h:5432/db"


def test_explicit_driver_and_sqlite_are_left_alone():
    explicit = "postgresql+psycopg2://u:p@h/db"
    assert with_explicit_postgres_driver(explicit) == explicit
    assert with_explicit_postgres_driver("sqlite:////tmp/x.db") == "sqlite:////tmp/x.db"
