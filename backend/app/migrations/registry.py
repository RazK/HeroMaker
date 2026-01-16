"""Migration registry - add new migrations here."""
from app.migrations import runner
from app.migrations import m001_chatgpt_to_openai
from app.migrations import m002_multiuser_auth
from app.migrations import m003_coupon_system
from app.migrations import m004_coupon_max_uses
from app.migrations import m005_user_name_dob
from app.migrations import m006_tokens_to_credits
from app.migrations import m007_coupon_multiple_per_user


# Register all migrations in order
# Format: (migration_name, migration_function)
MIGRATIONS = [
    ("001_chatgpt_to_openai", m001_chatgpt_to_openai.migrate),
    ("002_multiuser_auth", m002_multiuser_auth.migrate),
    ("003_coupon_system", m003_coupon_system.migrate),
    ("004_coupon_max_uses", m004_coupon_max_uses.migrate),
    ("005_user_name_dob", m005_user_name_dob.migrate),
    ("006_tokens_to_credits", m006_tokens_to_credits.migrate),
    ("007_coupon_multiple_per_user", m007_coupon_multiple_per_user.migrate),
]


def run_migrations():
    """Run all registered migrations."""
    runner.run_all_migrations(MIGRATIONS)

