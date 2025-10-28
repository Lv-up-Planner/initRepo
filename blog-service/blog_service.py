import os
import logging
import secrets
import sqlite3
from datetime import datetime
from typing import Optional, Dict
from fastapi import FastAPI, Request, HTTPException, Depends, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

# --- 기본 로깅 ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('BlogServiceApp')

app = FastAPI()

# --- 정적 파일 및 템플릿 설정 ---
templates = Jinja2Templates(directory="templates")
app.mount("/blog/static", StaticFiles(directory="static"), name="static")

# --- 설정 ---
DATABASE_PATH = os.getenv('BLOG_DATABASE_PATH', '/app/blog.db')

# --- SQLite 초기화 ---
def init_db():
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    with sqlite3.connect(DATABASE_PATH) as conn:
        cursor = conn.cursor()
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
        conn.commit()

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

# --- 인메모리 사용자/세션 저장소 ---
users_db: Dict[str, Dict[str, str]] = {
    'admin': {'password': 'password123', 'email': 'admin@example.com'},
    'dev': {'password': 'devpass', 'email': 'dev@example.com'}
}
sessions: Dict[str, str] = {}

# --- Pydantic 모델 ---
class UserLogin(BaseModel):
    username: str
    password: str

class UserRegister(BaseModel):
    username: str
    password: str
    email: Optional[str] = None

class PostCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    content: str = Field(..., min_length=1, max_length=20000)

class PostUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=120)
    content: Optional[str] = Field(None, min_length=1, max_length=20000)

# --- 인증 유틸 ---
async def require_user(request: Request) -> str:
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=401, detail='Authorization header missing or invalid')
    token = auth_header.split(' ')[1]
    username = sessions.get(token)
    if not username:
        raise HTTPException(status_code=401, detail='Invalid or expired token')
    return username

# --- API 핸들러 함수 ---
@app.get("/api/posts")
async def handle_get_posts(offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)):
    """모든 블로그 게시물 목록을 반환합니다(최신순, 페이지네이션)."""
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT id, title, content, author, created_at, updated_at FROM posts ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset))
        rows = cursor.fetchall()
        items = [row_to_post(r) for r in rows]
        # 목록 응답은 요약 정보 위주로 반환 + 발췌(excerpt)
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

@app.get("/api/posts/{post_id}")
async def handle_get_post_by_id(post_id: int):
    """ID로 특정 게시물을 찾아 반환합니다."""
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT id, title, content, author, created_at, updated_at FROM posts WHERE id = ?", (post_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={'error': 'Post not found'})
        return JSONResponse(content=row_to_post(row))

@app.post("/api/login")
async def handle_login(user_login: UserLogin):
    """사용자 로그인을 처리합니다."""
    user = users_db.get(user_login.username)
    if user and user['password'] == user_login.password:
        token = secrets.token_urlsafe(32)
        sessions[token] = user_login.username
        return JSONResponse(content={'token': token, 'username': user_login.username})
    raise HTTPException(status_code=401, detail={'error': 'Invalid credentials'})

@app.post("/api/register", status_code=201)
async def handle_register(user_register: UserRegister):
    """사용자 등록을 처리합니다."""
    if not user_register.username or not user_register.password:
        raise HTTPException(status_code=400, detail={'error': 'Username and password are required'})
    if user_register.username in users_db:
        raise HTTPException(status_code=409, detail={'error': 'Username already exists'})

    users_db[user_register.username] = {
        'password': user_register.password,
        'email': user_register.email or ''
    }
    logger.info(f"New user registered: {user_register.username}")
    return JSONResponse(content={'message': 'Registration successful'})

@app.post("/api/posts", status_code=201)
async def create_post(request: Request, payload: PostCreate, username: str = Depends(require_user)):
    now = datetime.utcnow().isoformat()
    with sqlite3.connect(DATABASE_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO posts (title, content, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (payload.title, payload.content, username, now, now)
        )
        post_id = cursor.lastrowid
        conn.commit()
    return JSONResponse(content={
        "id": post_id,
        "title": payload.title,
        "content": payload.content,
        "author": username,
        "created_at": now,
        "updated_at": now,
    })

@app.patch("/api/posts/{post_id}")
async def update_post_partial(post_id: int, request: Request, payload: PostUpdate, username: str = Depends(require_user)):
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT author FROM posts WHERE id = ?", (post_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={'error': 'Post not found'})
        if row[0] != username:
            raise HTTPException(status_code=403, detail='Forbidden: not the author')
        fields = []
        params = []
        if payload.title is not None:
            fields.append("title = ?")
            params.append(payload.title)
        if payload.content is not None:
            fields.append("content = ?")
            params.append(payload.content)
        if not fields:
            return JSONResponse(content={"message": "No changes"})
        fields.append("updated_at = ?")
        params.append(datetime.utcnow().isoformat())
        params.append(post_id)
        cursor.execute(f"UPDATE posts SET {', '.join(fields)} WHERE id = ?", tuple(params))
        conn.commit()
        cursor.execute("SELECT id, title, content, author, created_at, updated_at FROM posts WHERE id = ?", (post_id,))
        out = cursor.fetchone()
        return JSONResponse(content=row_to_post(out))

@app.delete("/api/posts/{post_id}", status_code=204)
async def delete_post(post_id: int, request: Request, username: str = Depends(require_user)):
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT author FROM posts WHERE id = ?", (post_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={'error': 'Post not found'})
        if row[0] != username:
            raise HTTPException(status_code=403, detail='Forbidden: not the author')
        cursor.execute("DELETE FROM posts WHERE id = ?", (post_id,))
        conn.commit()
    return JSONResponse(status_code=204, content=None)

@app.get("/health")
async def handle_health():
    """쿠버네티스를 위한 헬스 체크 엔드포인트"""
    return {"status": "ok", "service": "blog-service"}

@app.get("/")
async def serve_root(request: Request):
    """기본 경로에서 블로그 SPA를 제공합니다."""
    return templates.TemplateResponse("index.html", {"request": request})

# --- 웹 페이지 서빙 (SPA) ---
@app.get("/blog/{path:path}")
async def serve_spa(request: Request, path: str):
    """메인 블로그 페이지를 렌더링합니다."""
    return templates.TemplateResponse("index.html", {"request": request})


# --- 애플리케이션 시작 시 샘플 데이터 설정 ---
@app.on_event("startup")
def setup_sample_data():
    """서비스 시작 시 샘플 데이터를 생성합니다."""
    with sqlite3.connect(DATABASE_PATH) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM posts")
        count = cursor.fetchone()[0]
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
            logger.info("샘플 게시물이 데이터베이스에 초기화되었습니다.")
    logger.info(f"{len(users_db)}명의 사용자 정보가 로드되었습니다.")

if __name__ == "__main__":
    import uvicorn
    port = 8005
    logger.info(f"✅ Blog Service starting on http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
