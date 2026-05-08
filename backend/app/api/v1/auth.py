from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.deps import get_db, get_current_user
from app.core.security import verify_password, create_access_token
from app.models.user import User
from app.schemas.auth import LoginIn, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == body.username).first()
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户名或密码错误")
    token = create_access_token(user.username, user.role)
    return TokenOut(access_token=token, name=user.name or user.username, role=user.role)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
