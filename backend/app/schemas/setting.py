from pydantic import BaseModel


class SettingItem(BaseModel):
    key: str
    value: str
    description: str = ""

    class Config:
        from_attributes = True


class SettingUpdateIn(BaseModel):
    value: str
