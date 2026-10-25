"""Seed or remove clearly synthetic arrivals for isolated reception demos."""

import argparse
import os
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from scpo_services import demo_vitals
from scpo_services.common import get_engine, verify_database_migrated
from scpo_services.nursing import EmergencyArrival, ReceptionQueueSettings

SEED_NAMESPACE = uuid.UUID("f377074f-b0b0-4e10-8587-981c5e2a662b")
DEMO_ARRIVALS = (
    ("common-ana", "Ana (DEMO)", "common", 4),
    ("common-bruno", "Bruno (DEMO)", "common", 3),
    ("common-carla", "Carla (DEMO)", "common", 2),
    ("priority-luiza", "Luiza (DEMO)", "priority", 1),
)
DEMO_ACTOR = "Dados sinteticos - demonstracao"


def arrival_id(slug: str) -> str:
    return str(uuid.uuid5(SEED_NAMESPACE, slug))


def seed_demo_queue(session: Session, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    ids = [arrival_id(slug) for slug, _, _, _ in DEMO_ARRIVALS]
    existing = session.scalars(
        select(EmergencyArrival.id).where(EmergencyArrival.id.in_(ids))
    ).all()
    if existing:
        raise RuntimeError(
            "A fila demonstrativa já está semeada parcialmente ou por completo; "
            "execute cleanup antes de semear novamente."
        )
    settings = session.get(ReceptionQueueSettings, 1)
    if settings is None:
        raise RuntimeError("As configurações da fila de recepção não foram inicializadas.")
    for slug, name, queue_type, minutes_ago in DEMO_ARRIVALS:
        created_at = now - timedelta(minutes=minutes_ago)
        session.add(
            EmergencyArrival(
                id=arrival_id(slug),
                patient_reference=None,
                patient_name=name,
                arrival_mode="walk_in",
                reason="Registro fictício para validar a fila de chamadas. Não usar em atendimento.",
                status="waiting",
                created_by=DEMO_ACTOR,
                updated_by=DEMO_ACTOR,
                created_at=created_at,
                updated_at=created_at,
                clinical_priority="routine",
                queue_type=queue_type,
            )
        )
    return len(DEMO_ARRIVALS)


def cleanup_demo_queue(session: Session) -> int:
    ids = [arrival_id(slug) for slug, _, _, _ in DEMO_ARRIVALS]
    return session.query(EmergencyArrival).filter(EmergencyArrival.id.in_(ids)).delete(
        synchronize_session=False
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cria ou remove quatro chegadas fictícias para validar a fila da recepção."
    )
    parser.add_argument("action", choices=("seed", "cleanup"))
    parser.add_argument(
        "--confirm-non-production",
        action="store_true",
        help="confirma explicitamente que o banco conectado não é de produção",
    )
    args = parser.parse_args()
    demo_vitals.require_non_production_confirmation(args.confirm_non_production)
    os.environ.setdefault("SCPO_SERVICE", "nursing")
    verify_database_migrated("nursing")
    with Session(get_engine("nursing")) as session, session.begin():
        count = seed_demo_queue(session) if args.action == "seed" else cleanup_demo_queue(session)
    verb = "criadas" if args.action == "seed" else "removidas"
    print(f"Chegadas fictícias {verb}: {count}.")


if __name__ == "__main__":
    main()
