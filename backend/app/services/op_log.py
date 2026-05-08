from sqlalchemy.orm import Session
from app.models.op_log import OpLog


def log(db: Session, *, entity: str, entity_id: int, action: str, detail: str = "",
        user_id: int | None = None, actor_label: str = "") -> None:
    db.add(OpLog(
        user_id=user_id,
        actor_label=actor_label,
        entity=entity,
        entity_id=entity_id,
        action=action,
        detail=detail,
    ))
