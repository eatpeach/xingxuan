from pydantic import BaseModel


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    name: str
    role: str


class UserOut(BaseModel):
    id: int
    username: str
    name: str
    role: str
    phone: str
    is_active: bool

    class Config:
        from_attributes = True
