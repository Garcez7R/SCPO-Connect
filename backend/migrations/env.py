import os

from alembic import context
from scpo_services.common import Base, get_engine
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

config = context.config
target_metadata = Base.metadata
SUPPORTED_SERVICES = {"access", "audit", "nursing", "pharmacy", "social", "xray", "maintenance"}
LEGACY_REVISION_IDS = {
    "0022_stock_movements_emergency_arrivals": "0022_stock_emergency",
    "0024_patient_linked_medications_and_results": "0024_patient_med_results",
    "0025_patient_flow_risk_and_dashboard": "0025_patient_flow_risk",
}


def get_service() -> str:
    service = os.getenv("SCPO_SERVICE")
    if service not in SUPPORTED_SERVICES:
        raise RuntimeError(
            "Defina SCPO_SERVICE com um domínio conhecido antes da migração"
        )
    return service


def run_migrations_offline() -> None:
    service = get_service()
    engine = get_engine(service)
    context.configure(
        url=engine.url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table="alembic_version",
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    service = get_service()
    engine: Engine = get_engine(service)
    with engine.connect() as connection:
        if inspect(connection).has_table("alembic_version"):
            current_revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one_or_none()
            replacement = LEGACY_REVISION_IDS.get(current_revision)
            if replacement:
                connection.execute(
                    text(
                        "UPDATE alembic_version SET version_num = :replacement "
                        "WHERE version_num = :current"
                    ),
                    {"replacement": replacement, "current": current_revision},
                )
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            version_table="alembic_version",
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
