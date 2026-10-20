"""Migration registry - add new migrations here."""
from app.migrations import runner
from app.migrations import m001_chatgpt_to_openai
from app.migrations import m002_multiuser_auth
from app.migrations import m003_coupon_system
from app.migrations import m004_coupon_max_uses
from app.migrations import m005_user_name_dob
from app.migrations import m006_tokens_to_credits
from app.migrations import m007_coupon_multiple_per_user
from app.migrations import m008_financial_spine
from app.migrations import m009_creation_soft_delete
from app.migrations import m010_password_reset_tokens
from app.migrations import m011_creation_style
from app.migrations import m012_user_soft_delete
from app.migrations import m013_creation_featured
from app.migrations import m014_recurring_expenses
from app.migrations import m015_classes
from app.migrations import m016_school_details
from app.migrations import m017_admin_actions
from app.migrations import m018_step_error_code
from app.migrations import m019_class_seat_returns


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
    ("008_financial_spine", m008_financial_spine.migrate),
    ("009_creation_soft_delete", m009_creation_soft_delete.migrate),
    ("010_password_reset_tokens", m010_password_reset_tokens.migrate),
    ("011_creation_style", m011_creation_style.migrate),
    ("012_user_soft_delete", m012_user_soft_delete.migrate),
    ("013_creation_featured", m013_creation_featured.migrate),
    ("014_recurring_expenses", m014_recurring_expenses.migrate),
    ("015_classes", m015_classes.migrate),
    ("016_school_details", m016_school_details.migrate),
    ("017_admin_actions", m017_admin_actions.migrate),
    ("018_step_error_code", m018_step_error_code.migrate),
    ("019_class_seat_returns", m019_class_seat_returns.migrate),
]


def run_migrations():
    """Run all registered migrations."""
    runner.run_all_migrations(MIGRATIONS)

