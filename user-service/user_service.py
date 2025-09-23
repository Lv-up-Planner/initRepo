# TItanium-v2/user-service/user_service.py

# ... (기존 import 및 모델 정의는 그대로 유지) ...
import logging
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional

from database_service import UserServiceDatabase
from cache_service import CacheService

class UserIn(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: int
    username: str
    email: EmailStr

class Credentials(BaseModel):
    username: str
    password: str

app = FastAPI()
db = UserServiceDatabase()
cache = CacheService()

# --- User Service의 통계 및 DB/Cache 상태를 반환하는 엔드포인트 ---
@app.get("/stats")
async def handle_stats():
    # DB와 Cache의 상태를 실시간으로 확인
    is_db_healthy = await db.health_check()
    is_cache_healthy = await cache.ping()

    # 전체 서비스 상태 결정
    service_status = "online"
    if not is_db_healthy or not is_cache_healthy:
        service_status = "degraded"

    return {
        "user_service": {
            "service_status": service_status,
            # 대시보드가 인식할 수 있는 키로 DB와 Cache 상태를 제공
            "database": {
                "status": "healthy" if is_db_healthy else "unhealthy"
            },
            "cache": {
                "status": "healthy" if is_cache_healthy else "unhealthy",
                "hit_ratio": 0 # 이 예제에서는 단순화를 위해 0으로 고정
            }
        }
    }


# ... (기존 /health, /users 엔드포인트들은 그대로 유지) ...
@app.get("/health")
async def handle_health():
    return {"status": "healthy"}

@app.post("/users", response_model=UserOut, status_code=201)
async def create_user(user: UserIn):
    user_id = await db.add_user(user.username, user.email, user.password)
    if user_id is None:
        raise HTTPException(status_code=400, detail="Username already exists")
    created_user = await db.get_user_by_id(user_id)
    return created_user

@app.get("/users/{username}", response_model=UserOut)
async def get_user(username: str):
    cached_user = await cache.get_user(username)
    if cached_user:
        return cached_user

    user_from_db = await db.get_user_by_username(username)
    if not user_from_db:
        raise HTTPException(status_code=404, detail="User not found")
    
    await cache.set_user(username, user_from_db)
    return user_from_db

@app.post("/users/verify-credentials")
async def verify_credentials(creds: Credentials):
    user = await db.verify_user_credentials(creds.username, creds.password)
    if user:
        return user
    raise HTTPException(status_code=401, detail="Invalid credentials")