"""Add purchasing, asset, safety and document workflow records."""

import os

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "0033_admin_ops"
down_revision = "0032_inpatient_care"
branch_labels = None
depends_on = None


def upgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = set(inspector.get_table_names())

    if service == "pharmacy":
        if "inventory_items" in tables:
            columns = {column["name"] for column in inspector.get_columns("inventory_items")}
            for name, type_, default in (
                ("purchase_quantity", sa.String(32), ""),
                ("purchase_unit", sa.String(24), ""),
                ("units_per_purchase_unit", sa.String(32), "1"),
            ):
                if name not in columns:
                    op.add_column(
                        "inventory_items",
                        sa.Column(name, type_, nullable=False, server_default=default),
                    )
        if "purchase_requests" not in tables:
            op.create_table(
                "purchase_requests",
                sa.Column("id", sa.String(36), primary_key=True),
                sa.Column("product_id", sa.Integer(), sa.ForeignKey("pharmacy_products.id", ondelete="SET NULL"), nullable=True),
                sa.Column("item_name", sa.String(120), nullable=False),
                sa.Column("category", sa.String(40), nullable=False),
                sa.Column("active_ingredient", sa.String(120), nullable=False, server_default=""),
                sa.Column("presentation", sa.String(120), nullable=False, server_default=""),
                sa.Column("base_unit", sa.String(24), nullable=False),
                sa.Column("purchase_quantity", sa.String(32), nullable=False),
                sa.Column("purchase_unit", sa.String(24), nullable=False),
                sa.Column("units_per_purchase_unit", sa.String(32), nullable=False),
                sa.Column("received_quantity", sa.String(32), nullable=False, server_default="0"),
                sa.Column("supplier", sa.String(120), nullable=False, server_default=""),
                sa.Column("quoted_unit_price", sa.String(32), nullable=False, server_default=""),
                sa.Column("justification", sa.String(500), nullable=False),
                sa.Column("status", sa.String(16), nullable=False),
                sa.Column("requested_by", sa.String(120), nullable=False),
                sa.Column("approved_by", sa.String(120), nullable=False, server_default=""),
                sa.Column("received_by", sa.String(120), nullable=False, server_default=""),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            )
            op.create_index("ix_purchase_requests_status_created", "purchase_requests", ["status", "created_at"])

    elif service == "maintenance":
        if "equipment_assets" not in tables:
            op.create_table(
                "equipment_assets",
                sa.Column("id", sa.String(36), primary_key=True),
                sa.Column("asset_tag", sa.String(40), nullable=False, unique=True),
                sa.Column("name", sa.String(120), nullable=False),
                sa.Column("category", sa.String(60), nullable=False),
                sa.Column("unit", sa.String(100), nullable=False),
                sa.Column("location", sa.String(120), nullable=False, server_default=""),
                sa.Column("manufacturer", sa.String(100), nullable=False, server_default=""),
                sa.Column("model", sa.String(100), nullable=False, server_default=""),
                sa.Column("serial_number", sa.String(100), nullable=False, server_default=""),
                sa.Column("status", sa.String(20), nullable=False),
                sa.Column("created_by", sa.String(120), nullable=False),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            )
        if "work_orders" in tables:
            columns = {column["name"] for column in inspect(bind).get_columns("work_orders")}
            if "asset_id" not in columns:
                with op.batch_alter_table("work_orders") as batch_op:
                    batch_op.add_column(sa.Column("asset_id", sa.String(36), nullable=True))
                    batch_op.create_foreign_key(
                        "fk_work_orders_asset_id_equipment_assets",
                        "equipment_assets",
                        ["asset_id"],
                        ["id"],
                        ondelete="SET NULL",
                    )
        if "preventive_maintenance_plans" not in tables:
            op.create_table(
                "preventive_maintenance_plans",
                sa.Column("id", sa.String(36), primary_key=True),
                sa.Column("asset_id", sa.String(36), sa.ForeignKey("equipment_assets.id", ondelete="CASCADE"), nullable=False),
                sa.Column("procedure", sa.String(300), nullable=False),
                sa.Column("interval_days", sa.Integer(), nullable=False),
                sa.Column("due_date", sa.Date(), nullable=False),
                sa.Column("responsible", sa.String(120), nullable=False, server_default=""),
                sa.Column("status", sa.String(16), nullable=False),
                sa.Column("last_completed_at", sa.DateTime(timezone=True), nullable=True),
                sa.Column("created_by", sa.String(120), nullable=False),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            )
            op.create_index("ix_preventive_maintenance_due_status", "preventive_maintenance_plans", ["status", "due_date"])

    elif service == "nursing":
        if "patient_safety_incidents" not in tables:
            op.create_table(
                "patient_safety_incidents",
                sa.Column("id", sa.String(36), primary_key=True),
                sa.Column("incident_type", sa.String(32), nullable=False),
                sa.Column("severity", sa.String(16), nullable=False),
                sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
                sa.Column("unit", sa.String(100), nullable=False),
                sa.Column("location", sa.String(120), nullable=False),
                sa.Column("patient_reference", sa.String(36), sa.ForeignKey("patients.reference", ondelete="SET NULL"), nullable=True),
                sa.Column("description", sa.String(2000), nullable=False),
                sa.Column("status", sa.String(20), nullable=False),
                sa.Column("investigation", sa.String(2000), nullable=False, server_default=""),
                sa.Column("corrective_action", sa.String(2000), nullable=False, server_default=""),
                sa.Column("reported_by", sa.String(120), nullable=False),
                sa.Column("updated_by", sa.String(120), nullable=False),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            )
            op.create_index("ix_patient_safety_incidents_status_occurred", "patient_safety_incidents", ["status", "occurred_at"])
        if "institutional_documents" not in tables:
            op.create_table(
                "institutional_documents",
                sa.Column("id", sa.String(36), primary_key=True),
                sa.Column("title", sa.String(160), nullable=False),
                sa.Column("document_type", sa.String(40), nullable=False),
                sa.Column("version", sa.String(24), nullable=False),
                sa.Column("content", sa.String(10000), nullable=False),
                sa.Column("status", sa.String(16), nullable=False),
                sa.Column("valid_until", sa.Date(), nullable=True),
                sa.Column("created_by", sa.String(120), nullable=False),
                sa.Column("approved_by", sa.String(120), nullable=False, server_default=""),
                sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            )
            op.create_index("ix_institutional_documents_status_valid_until", "institutional_documents", ["status", "valid_until"])


def downgrade() -> None:
    service = os.getenv("SCPO_SERVICE")
    tables = set(inspect(op.get_bind()).get_table_names())
    if service == "pharmacy":
        if "purchase_requests" in tables:
            op.drop_index("ix_purchase_requests_status_created", table_name="purchase_requests")
            op.drop_table("purchase_requests")
        if "inventory_items" in tables:
            columns = {column["name"] for column in inspect(op.get_bind()).get_columns("inventory_items")}
            for name in ("units_per_purchase_unit", "purchase_unit", "purchase_quantity"):
                if name in columns:
                    op.drop_column("inventory_items", name)
    elif service == "maintenance":
        if "preventive_maintenance_plans" in tables:
            op.drop_index("ix_preventive_maintenance_due_status", table_name="preventive_maintenance_plans")
            op.drop_table("preventive_maintenance_plans")
        if "work_orders" in tables:
            foreign_keys = {
                foreign_key["name"]
                for foreign_key in inspect(op.get_bind()).get_foreign_keys("work_orders")
            }
            columns = {column["name"] for column in inspect(op.get_bind()).get_columns("work_orders")}
            if "asset_id" in columns:
                with op.batch_alter_table("work_orders") as batch_op:
                    if "fk_work_orders_asset_id_equipment_assets" in foreign_keys:
                        batch_op.drop_constraint(
                            "fk_work_orders_asset_id_equipment_assets",
                            type_="foreignkey",
                        )
                    batch_op.drop_column("asset_id")
        if "equipment_assets" in tables:
            op.drop_table("equipment_assets")
    elif service == "nursing":
        if "institutional_documents" in tables:
            op.drop_index("ix_institutional_documents_status_valid_until", table_name="institutional_documents")
            op.drop_table("institutional_documents")
        if "patient_safety_incidents" in tables:
            op.drop_index("ix_patient_safety_incidents_status_occurred", table_name="patient_safety_incidents")
            op.drop_table("patient_safety_incidents")
