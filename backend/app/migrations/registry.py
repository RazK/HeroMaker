"""Migration registry - add new migrations here."""
from app.migrations import runner
from app.migrations import m001_chatgpt_to_openai
from app.migrations import m002_multiuser_auth


# Register all migrations in order
# Format: (migration_name, migration_function)
MIGRATIONS = [
    ("001_chatgpt_to_openai", m001_chatgpt_to_openai.migrate),
    ("002_multiuser_auth", m002_multiuser_auth.migrate),
    # Add future migrations here:
    # ("003_migration_name", migration_module.migrate),
]


def run_migrations():
    """Run all registered migrations."""
    runner.run_all_migrations(MIGRATIONS)

