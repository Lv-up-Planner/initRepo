import os
import logging
import secrets
import sqlite3
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, Request, HTTPException, Depends, Query, Path
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from passlib.context import CryptContext

# --- 기본 로깅 ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('BlogServiceApp')

app = FastAPI()

# --- 정적 파일 및 템플릿 설정 ---
# Use paths relative to this file so app can be started from any CWD or via --app-dir
BASE_DIR = os.path.dirname(__file__)
templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))
app.mount("/blog/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

# --- 설정 ---
DATABASE_PATH = os.getenv('BLOG_DATABASE_PATH', '/app/blog.db')
TOKEN_EXP_DAYS = int(os.getenv('TOKEN_EXP_DAYS', '30'))

# --- 암호화 설정 ---
# Use pbkdf2_sha256 to avoid bcrypt wheel/platform issues in local dev environments.
# pbkdf2_sha256 is secure for MVP and avoids native bcrypt dependency problems.
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def get_db_conn():
    # Ensure directory exists only when a directory portion is present in the path.
    dirpath = os.path.dirname(DATABASE_PATH)
    if dirpath:
        os.makedirs(dirpath, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    return conn


def init_db():
    with get_db_conn() as conn:
        cursor = conn.cursor()
        # posts table (legacy)
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                author TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        # users
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_login TEXT
            )
            """
        )
        # user_profiles (shared PK)
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id TEXT PRIMARY KEY,
                display_name TEXT UNIQUE NOT NULL,
                gender TEXT,
                level INTEGER NOT NULL,
                current_xp INTEGER NOT NULL,
                next_level_xp INTEGER NOT NULL,
                avatar_url TEXT,
                updated_at TEXT,
                FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
            )
            """
        )
        # todos
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS todos (
                todo_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                category TEXT,
                xp_reward INTEGER NOT NULL,
                is_completed INTEGER NOT NULL DEFAULT 0,
                due_date TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                deleted_at TEXT,
                FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
            )
            """
        )
        # auth_tokens
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_tokens (
                token_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                access_token TEXT NOT NULL,
                issued_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                device_meta TEXT,
                revoked INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
            )
            """
        )
        conn.commit()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token_for_user(conn: sqlite3.Connection, user_id: str, device_meta: Optional[str] = None) -> str:
    token = secrets.token_urlsafe(32)
    token_id = uuid.uuid4().hex
    issued = datetime.utcnow().isoformat()
    expires = (datetime.utcnow() + timedelta(days=TOKEN_EXP_DAYS)).isoformat()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO auth_tokens (token_id, user_id, access_token, issued_at, expires_at, device_meta, revoked) VALUES (?, ?, ?, ?, ?, ?, 0)",
        (token_id, user_id, token, issued, expires, device_meta or '')
    )
    conn.commit()
    return token


def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    with get_db_conn() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, revoked, expires_at FROM auth_tokens WHERE access_token = ?", (token,))
        row = cursor.fetchone()
        if not row:
            return None
        if row['revoked']:
            return None
        if datetime.fromisoformat(row['expires_at']) < datetime.utcnow():
            return None
        # return user row
        cursor.execute("SELECT user_id, email, created_at, last_login FROM users WHERE user_id = ?", (row['user_id'],))
        user = cursor.fetchone()
        return dict(user) if user else None


def row_to_post(row: sqlite3.Row) -> Dict:
    return {
        "id": row[0],
        "title": row[1],
        "content": row[2],
        "author": row[3],
        "created_at": row[4],
        "updated_at": row[5],
    }


init_db()

# --- Pydantic 모델 ---
class RegisterModel(BaseModel):
    email: str
    password: str = Field(..., min_length=6)
    display_name: str
    gender: Optional[str] = 'other'


class LoginModel(BaseModel):
    email: str
    password: str


class TodoCreate(BaseModel):
    title: str = Field(..., min_length=1)
    description: Optional[str] = ''
    category: Optional[str] = 'etc'
    xp_reward: int = Field(..., ge=1, le=1000)
    due_date: Optional[str] = None


class TodoUpdate(BaseModel):
    title: Optional[str]
    description: Optional[str]
    category: Optional[str]
    xp_reward: Optional[int]
    due_date: Optional[str]


async def require_user(request: Request) -> str:
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=401, detail='Authorization header missing or invalid')
    token = auth_header.split(' ', 1)[1]
    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail='Invalid or expired token')
    return user['user_id']


@app.get("/api/posts")
async def handle_get_posts(offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)):
    """기존 블로그 포스트 유지"""
    with get_db_conn() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT id, title, content, author, created_at, updated_at FROM posts ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset))
        rows = cursor.fetchall()
        items = [row_to_post(r) for r in rows]
        summaries = []
        for p in items:
            content = (p.get("content") or "").replace("\r", " ").replace("\n", " ")
            excerpt = content[:120] + ("..." if len(content) > 120 else "")
            summaries.append({
                "id": p["id"],
                "title": p["title"],
                "author": p["author"],
                "created_at": p["created_at"],
                "excerpt": excerpt,
            })
        return JSONResponse(content=summaries)


@app.post("/api/register", status_code=201)
async def api_register(payload: RegisterModel):
    now = datetime.utcnow().isoformat()
    user_id = uuid.uuid4().hex
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM users WHERE email = ?", (payload.email,))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail={'error': 'Email already exists'})
        cursor.execute("SELECT 1 FROM user_profiles WHERE display_name = ?", (payload.display_name,))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail={'error': 'Display name already exists'})
        password_hash = hash_password(payload.password)
        cursor.execute("INSERT INTO users (user_id, email, password_hash, created_at) VALUES (?, ?, ?, ?)", (user_id, payload.email, password_hash, now))
        cursor.execute(
            "INSERT INTO user_profiles (user_id, display_name, gender, level, current_xp, next_level_xp, avatar_url, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, payload.display_name, payload.gender, 1, 0, 100, '', now)
        )
        conn.commit()
        token = create_token_for_user(conn, user_id)
        return JSONResponse(content={"token": token, "user_id": user_id, "display_name": payload.display_name})


@app.post("/api/login")
async def api_login(payload: LoginModel):
    with get_db_conn() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, password_hash FROM users WHERE email = ?", (payload.email,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail={'error': 'Invalid credentials'})
        if not verify_password(payload.password, row['password_hash']):
            raise HTTPException(status_code=401, detail={'error': 'Invalid credentials'})
        # update last_login
        cursor.execute("UPDATE users SET last_login = ? WHERE user_id = ?", (datetime.utcnow().isoformat(), row['user_id']))
        conn.commit()
        token = create_token_for_user(conn, row['user_id'])
        # fetch profile
        cursor.execute("SELECT display_name, gender, level, current_xp, next_level_xp, avatar_url FROM user_profiles WHERE user_id = ?", (row['user_id'],))
        profile = cursor.fetchone()
        return JSONResponse(content={"token": token, "user_id": row['user_id'], "profile": dict(profile) if profile else {}})


@app.get("/api/profile/me")
async def api_profile_me(user_id: str = Depends(require_user)):
    with get_db_conn() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT u.user_id, u.email, p.display_name, p.gender, p.level, p.current_xp, p.next_level_xp, p.avatar_url FROM users u JOIN user_profiles p ON u.user_id = p.user_id WHERE u.user_id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={'error': 'Profile not found'})
        return JSONResponse(content=dict(row))


@app.patch("/api/profile")
async def api_profile_update(update: dict, user_id: str = Depends(require_user)):
    # allow update of display_name, gender, avatar_url
    allowed = {'display_name', 'gender', 'avatar_url'}
    fields = []
    params = []
    for k, v in update.items():
        if k in allowed:
            if k == 'display_name':
                with get_db_conn() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT 1 FROM user_profiles WHERE display_name = ? AND user_id != ?", (v, user_id))
                    if cursor.fetchone():
                        raise HTTPException(status_code=409, detail={'error': 'Display name already exists'})
            fields.append(f"{k} = ?")
            params.append(v)
    if not fields:
        return JSONResponse(content={'message': 'No changes'})
    params.append(datetime.utcnow().isoformat())
    params.append(user_id)
    set_clause = ", ".join(fields) + ", updated_at = ?"
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE user_profiles SET {set_clause} WHERE user_id = ?", tuple(params))
        conn.commit()
        return JSONResponse(content={'message': 'Profile updated'})


@app.post("/api/todos", status_code=201)
async def api_create_todo(payload: TodoCreate, user_id: str = Depends(require_user)):
    todo_id = uuid.uuid4().hex
    now = datetime.utcnow().isoformat()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO todos (todo_id, user_id, title, description, category, xp_reward, is_completed, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
            (todo_id, user_id, payload.title, payload.description or '', payload.category or 'etc', payload.xp_reward, payload.due_date, now)
        )
        conn.commit()
        return JSONResponse(content={'todo_id': todo_id, 'title': payload.title})


@app.get("/api/todos")
async def api_get_todos(user_id: str = Depends(require_user), include_completed: bool = Query(False)):
    with get_db_conn() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        if include_completed:
            cursor.execute("SELECT * FROM todos WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC", (user_id,))
        else:
            cursor.execute("SELECT * FROM todos WHERE user_id = ? AND is_completed = 0 AND deleted_at IS NULL ORDER BY created_at DESC", (user_id,))
        rows = cursor.fetchall()
        items = [dict(r) for r in rows]
        return JSONResponse(content=items)


@app.post("/api/todos/{todo_id}/complete")
async def api_complete_todo(todo_id: str = Path(...), user_id: str = Depends(require_user)):
    now = datetime.utcnow().isoformat()
    with get_db_conn() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, is_completed, xp_reward FROM todos WHERE todo_id = ? AND deleted_at IS NULL", (todo_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={'error': 'Todo not found'})
        if row['user_id'] != user_id:
            raise HTTPException(status_code=403, detail='Forbidden')
        if row['is_completed']:
            return JSONResponse(content={'message': 'Already completed'})

        xp_gain = int(row['xp_reward'])
        try:
            # atomic update
            cursor.execute("UPDATE todos SET is_completed = 1, completed_at = ? WHERE todo_id = ?", (now, todo_id))
            # update profile XP and level-up logic
            cursor.execute("SELECT current_xp, next_level_xp, level FROM user_profiles WHERE user_id = ?", (user_id,))
            prof = cursor.fetchone()
            if not prof:
                raise HTTPException(status_code=500, detail={'error': 'Profile missing'})
            current_xp = int(prof['current_xp'])
            next_req = int(prof['next_level_xp'])
            level = int(prof['level'])
            new_xp = current_xp + xp_gain
            leveled = False
            while new_xp >= next_req:
                new_xp -= next_req
                level += 1
                next_req += 20
                leveled = True
            cursor.execute("UPDATE user_profiles SET current_xp = ?, next_level_xp = ?, level = ? WHERE user_id = ?", (new_xp, next_req, level, user_id))
            conn.commit()
        except Exception:
            conn.rollback()
            raise

        return JSONResponse(content={'message': 'completed', 'xp_gain': xp_gain, 'new_level': level, 'current_xp': new_xp, 'next_level_xp': next_req, 'leveled': leveled})


@app.get("/api/leaderboard")
async def api_leaderboard(limit: int = Query(10, ge=1, le=100)):
    with get_db_conn() as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT user_id, display_name, gender, level, current_xp, next_level_xp FROM user_profiles ORDER BY level DESC, current_xp DESC LIMIT ?", (limit,))
        rows = cursor.fetchall()
        items = [dict(r) for r in rows]
        # add rank
        for idx, it in enumerate(items, start=1):
            it['rank'] = idx
        return JSONResponse(content=items)


@app.get("/health")
async def handle_health():
    return {"status": "ok", "service": "blog-service"}


@app.get("/")
async def serve_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/blog/{path:path}")
async def serve_spa(request: Request, path: str):
    return templates.TemplateResponse("index.html", {"request": request})


@app.on_event("startup")
def setup_sample_data():
    # ensure some sample users/profiles exist for leaderboard/demo
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM posts")
        try:
            count = cursor.fetchone()[0]
        except Exception:
            count = 0
        if count == 0:
            now = datetime.utcnow().isoformat()
            sample_posts = [
                ("첫 번째 블로그 글", "admin", "마이크로서비스 아키텍처에 오신 것을 환영합니다! 이 블로그는 FastAPI로 리팩터링되었습니다."),
                ("Kustomize와 Skaffold 활용하기", "dev", "인프라 관리는 CI/CD 파이프라인과 함께 자동화할 수 있습니다."),
            ]
            for title, author, content in sample_posts:
                cursor.execute(
                    "INSERT INTO posts (title, content, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (title, content, author, now, now)
                )
            conn.commit()
        # sample profiles for leaderboard
        cursor.execute("SELECT COUNT(*) FROM user_profiles")
        try:
            pcount = cursor.fetchone()[0]
        except Exception:
            pcount = 0
        if pcount == 0:
            now = datetime.utcnow().isoformat()
            # create sample users
            users = [
                (uuid.uuid4().hex, 'admin@example.com', hash_password('password123'), now, None),
                (uuid.uuid4().hex, 'dev@example.com', hash_password('devpass'), now, None)
            ]
            for u in users:
                cursor.execute("INSERT OR IGNORE INTO users (user_id, email, password_hash, created_at) VALUES (?, ?, ?, ?)", (u[0], u[1], u[2], u[3]))
            # profiles
            profiles = [
                (users[0][0], 'DragonSlayer', 'male', 15, 50, 150, '', now),
                (users[1][0], '박지수', 'female', 3, 50, 150, '', now),
            ]
            for p in profiles:
                cursor.execute("INSERT OR IGNORE INTO user_profiles (user_id, display_name, gender, level, current_xp, next_level_xp, avatar_url, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", p)
            conn.commit()
    logger.info("Database initialized and sample data ensured.")


if __name__ == "__main__":
    import uvicorn
    port = 8005
    logger.info(f"✅ Blog Service starting on http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
