"""Create or remove clearly labeled synthetic patients and vital-sign samples."""

import argparse
import os
import random
import uuid
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import MetaData, Table, delete, inspect, select
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session

from scpo_services.common import (
    DemoPrincipal,
    emit_audit_event,
    get_engine,
    verify_database_migrated,
)
from scpo_services.nursing import Patient, VitalRecord

SEED_NAMESPACE = uuid.UUID("71c1bc35-f56f-4a5b-8e35-74c460a9b1a8")
DEMO_ACTOR = "Dados sinteticos - demonstracao"
PATIENTS = (
    ("ana-silva", "DEMO - Ana Silva"),
    ("bruno-souza", "DEMO - Bruno Souza"),
    ("carla-lima", "DEMO - Carla Lima"),
    ("daniel-costa", "DEMO - Daniel Costa"),
    ("elisa-martins", "DEMO - Elisa Martins"),
    ("fabio-rocha", "DEMO - Fabio Rocha"),
    ("heloisa-alves", "DEMO - Heloisa Alves"),
)
SAO_PAULO = ZoneInfo("America/Sao_Paulo")


def patient_reference(slug: str) -> str:
    return str(uuid.uuid5(SEED_NAMESPACE, slug))


def make_vital_values(patient_index: int, day_offset: int) -> dict[str, str]:
    randomizer = random.Random(patient_index * 10_000 + day_offset)
    systolic = 112 + patient_index * 2 + randomizer.randint(-8, 9)
    diastolic = 72 + patient_index + randomizer.randint(-6, 7)
    return {
        "saturation": str(randomizer.randint(95, 100)),
        "pressure": f"{systolic}/{diastolic}",
        "heartRate": str(randomizer.randint(62, 96)),
        "respiratoryRate": str(randomizer.randint(13, 20)),
        "temperature": f"{randomizer.randint(365, 375) / 10:.1f}",
        "glucose": str(randomizer.randint(78, 152)),
        "notes": "DADO SINTETICO PARA APRESENTACAO. Nao usar para cuidado real.",
    }


def measured_at(day: date, day_offset: int, patient_index: int, now: datetime) -> datetime:
    hour = 7 + patient_index % 4
    minute = (patient_index * 7) % 60
    if day_offset == 0:
        local_now = now.astimezone(SAO_PAULO)
        hour = min(hour, local_now.hour)
        if hour == local_now.hour:
            minute = min(minute, local_now.minute)
    return datetime.combine(day, time(hour, minute), tzinfo=SAO_PAULO).astimezone(UTC)


def require_non_production_confirmation(confirmed: bool) -> None:
    if not confirmed:
        raise RuntimeError("Use --confirm-non-production somente após confirmar que o banco não é de produção.")

    environments = [
        os.getenv(name, "").strip().lower()
        for name in ("SCPO_ENV", "APP_ENV", "ENVIRONMENT")
        if os.getenv(name, "").strip()
    ]
    if any("prod" in environment or environment == "live" for environment in environments):
        raise RuntimeError("A geração de dados sintéticos foi bloqueada no ambiente de produção.")
    if not environments or not set(environments).issubset(
        {"dev", "development", "test", "testing", "demo"}
    ):
        raise RuntimeError(
            "Defina SCPO_ENV como development, test ou demo para habilitar dados sintéticos."
        )

    database_url = os.getenv("SCPO_NURSING_DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "Defina SCPO_NURSING_DATABASE_URL explicitamente para selecionar o banco demonstrativo."
        )
    demo_data_dir = os.getenv("SCPO_DEMO_DATA_DIR")
    if not demo_data_dir:
        raise RuntimeError(
            "Defina SCPO_DEMO_DATA_DIR como um diretório dedicado chamado demo."
        )
    resolved_demo_dir = Path(demo_data_dir).expanduser().resolve()
    if resolved_demo_dir.name != "demo":
        raise RuntimeError(
            "SCPO_DEMO_DATA_DIR deve apontar para um diretório dedicado chamado demo."
        )

    parsed_url = make_url(database_url)
    endpoint = f"{parsed_url.host or ''} {parsed_url.database or ''}".lower()
    if "prod" in endpoint or "live" in endpoint:
        raise RuntimeError("A geração de dados sintéticos foi bloqueada para um banco identificado como produção.")
    if not parsed_url.drivername.startswith("sqlite"):
        raise RuntimeError(
            "O gerador de demonstração aceita somente um banco SQLite isolado; bancos remotos não são alterados."
        )
    if not parsed_url.database:
        raise RuntimeError("O banco demonstrativo deve ser um arquivo SQLite, não um banco em memória.")
    database_path = Path(parsed_url.database).expanduser().resolve()
    try:
        database_path.relative_to(resolved_demo_dir)
    except ValueError as error:
        raise RuntimeError(
            "O arquivo SQLite deve estar dentro de SCPO_DEMO_DATA_DIR para proteger outros bancos locais."
        ) from error


def seed_demo_data(session: Session, now: datetime | None = None) -> tuple[int, int]:
    now = now or datetime.now(UTC)
    references = [patient_reference(slug) for slug, _ in PATIENTS]
    existing = session.scalars(select(Patient).where(Patient.reference.in_(references))).all()
    if existing:
        raise RuntimeError("Dados demonstrativos já existem parcialmente ou por completo. Execute cleanup antes de semear novamente.")

    patients: list[Patient] = []
    records: list[VitalRecord] = []
    for patient_index, (slug, name) in enumerate(PATIENTS):
        reference = patient_reference(slug)
        patients.append(
            Patient(
                reference=reference,
                name=name,
                mother_name="",
                health_plan="",
                same_number="",
                room="DEMO",
                bed=f"S{patient_index + 1:02d}",
                cpf="",
                sus_card="",
                allergies="",
                allergies_status="unknown",
                treatment_track="unclassified",
                birth_date=None,
                sex="",
                phone="",
                email="",
                address="",
                address_number="",
                address_complement="",
                neighborhood="",
                city="",
                state="",
                postal_code="",
                responsible_name="",
                responsible_status="unknown",
                responsible_relationship="",
                responsible_phone="",
                responsible_address="",
                responsible_address_number="",
                responsible_address_complement="",
                responsible_neighborhood="",
                responsible_city="",
                responsible_state="",
                responsible_postal_code="",
                photo_data="",
                created_at=now,
                updated_at=now,
                updated_by=DEMO_ACTOR,
                active=True,
            )
        )
        for day_offset in range(29, -1, -1):
            day = (now.astimezone(SAO_PAULO).date() - timedelta(days=day_offset))
            records.append(
                VitalRecord(
                    patient_reference=reference,
                    actor_id="demo-vitals-seeder",
                    actor_name=DEMO_ACTOR,
                    values=make_vital_values(patient_index, day_offset),
                    glucose_unit="mg/dL",
                    not_applicable=[],
                    measured_at=measured_at(day, day_offset, patient_index, now),
                    recorded_at=now,
                    voided_at=None,
                    voided_by="",
                    void_reason="",
                )
            )

    session.add_all(patients)
    session.add_all(records)
    principal = DemoPrincipal(
        user_id="demo-vitals-seeder",
        username="demo-vitals-seeder",
        actor_name=DEMO_ACTOR,
        role="system",
        modules=["nursing"],
        permissions={"nursing": ["criar"]},
    )
    emit_audit_event(principal, "nursing", "demo_vitals_seeded", "demo-vitals-v1", db=session)
    session.flush()
    return len(patients), len(records)


def cleanup_demo_data(session: Session, engine: Engine) -> tuple[int, int]:
    expected = {patient_reference(slug): name for slug, name in PATIENTS}
    patients = session.scalars(select(Patient).where(Patient.reference.in_(expected))).all()
    if any(patient.name != expected[patient.reference] for patient in patients):
        raise RuntimeError("Um identificador reservado para dados demonstrativos pertence a um paciente inesperado; limpeza cancelada.")
    if not patients:
        return 0, 0

    references = list(expected)
    vital_records = session.scalars(
        select(VitalRecord).where(VitalRecord.patient_reference.in_(references))
    ).all()
    if any(
        record.actor_id != "demo-vitals-seeder"
        or record.actor_name != DEMO_ACTOR
        or not record.values.get("notes", "").startswith(
            "DADO SINTETICO PARA APRESENTACAO"
        )
        or record.voided_at is not None
        for record in vital_records
    ):
        raise RuntimeError(
            "A limpeza foi interrompida porque há aferições não demonstrativas ou alteradas vinculadas aos pacientes demonstrativos."
        )

    inspector = inspect(engine)
    protected_references: list[str] = []
    metadata = MetaData()
    for table_name in inspector.get_table_names():
        if table_name in {"patients", "vital_records"}:
            continue
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "patient_reference" not in columns:
            continue
        table = Table(table_name, metadata, autoload_with=engine)
        if session.execute(
            select(table.c.patient_reference)
            .where(table.c.patient_reference.in_(references))
            .limit(1)
        ).first():
            protected_references.append(table_name)
    if protected_references:
        raise RuntimeError(
            "A limpeza foi interrompida porque há registros vinculados aos pacientes demonstrativos: "
            + ", ".join(sorted(protected_references))
        )

    removed_records = session.execute(
        delete(VitalRecord).where(VitalRecord.patient_reference.in_(references))
    ).rowcount or 0
    for patient in patients:
        session.delete(patient)
    principal = DemoPrincipal(
        user_id="demo-vitals-seeder",
        username="demo-vitals-seeder",
        actor_name=DEMO_ACTOR,
        role="system",
        modules=["nursing"],
        permissions={"nursing": ["alterar"]},
    )
    emit_audit_event(principal, "nursing", "demo_vitals_cleaned", "demo-vitals-v1", db=session)
    session.flush()
    return len(patients), removed_records


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Gera ou remove sete pacientes e 30 dias de sinais vitais exclusivamente sintéticos."
    )
    parser.add_argument("action", choices=("seed", "cleanup"), help="semeia os dados ou remove o conjunto demonstrativo")
    parser.add_argument(
        "--confirm-non-production",
        action="store_true",
        help="confirma explicitamente que o banco conectado não é de produção",
    )
    args = parser.parse_args()
    require_non_production_confirmation(args.confirm_non_production)

    os.environ.setdefault("SCPO_SERVICE", "nursing")
    verify_database_migrated("nursing")
    engine = get_engine("nursing")
    with Session(engine) as session, session.begin():
        counts = seed_demo_data(session) if args.action == "seed" else cleanup_demo_data(session, engine)
    if args.action == "seed":
        print(f"Dados demonstrativos criados: {counts[0]} pacientes e {counts[1]} afericoes sinteticas.")
    else:
        print(f"Dados demonstrativos removidos: {counts[0]} pacientes e {counts[1]} afericoes.")


if __name__ == "__main__":
    main()
