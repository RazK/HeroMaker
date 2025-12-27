"""Migration registry - add new migrations here."""
from app.migrations import runner
from app.migrations import m001_chatgpt_to_openai


# Register all migrations in order
# Format: (migration_name, migration_function)
MIGRATIONS = [
    ("001_chatgpt_to_openai", m001_chatgpt_to_openai.migrate),
    # Add future migrations here:
    # ("002_migration_name", migration_module.migrate),
]


def run_migrations():
    """Run all registered migrations."""
    runner.run_all_migrations(MIGRATIONS)

