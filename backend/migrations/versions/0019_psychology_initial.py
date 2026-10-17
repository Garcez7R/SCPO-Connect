"""Preserve compatibility with databases stamped by the psychology initial release."""

revision = "0019_psychology_initial"
down_revision = "0018_psychology_referrals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Compatibility bridge; the psychology referral schema is created by 0018."""


def downgrade() -> None:
    """Keep the schema owned by 0018 intact when reversing this bridge."""
