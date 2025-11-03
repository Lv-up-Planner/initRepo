````markdown
# Lv-Up Planner — Blog & Gamified Todo Service

FastAPI로 작성된 단일 서비스 애플리케이션입니다. 이 리포지토리는 API와 SPA UI를 함께 제공하며, 개발용으로 SQLite를 사용합니다. 현재 MVP(최소 실행 가능 제품)로 다음 핵심 도메인을 제공합니다:

- 사용자 인증 및 프로필 (레벨/XP 포함)
- 퀘스트(투두) 생성/완료 → 완료 시 XP 지급 및 레벨업
- 리더보드 조회

## 프로젝트 구조

```
.
├── blog-service/
│   ├── blog_service.py      # FastAPI 앱(엔드포인트, DB 초기화 포함)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── static/              # SPA JS/CSS
│   └── templates/           # index.html (SPA)
├── docker-compose.yml
├── k8s-manifests/
└── skaffold.yaml
```

## 빠른 시작 (개발)

1) 리포지토리 루트에서 가상환경 생성 및 의존성 설치

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r blog-service/requirements.txt
```

2) 로컬 서버 실행(개발용)

```bash
# DB를 repo 내부에 만들려면 환경변수로 경로를 지정
BLOG_DATABASE_PATH=blog-service/blog.db .venv/bin/uvicorn blog_service:app --host 127.0.0.1 --port 8005 --reload --app-dir blog-service
```

3) 브라우저 열기: http://127.0.0.1:8005/blog/

또는 Docker Compose 사용

```bash
docker compose up --build
# 서비스: http://localhost:8005/blog/
```

## 데이터베이스

- 기본: SQLite 파일 (환경변수 `BLOG_DATABASE_PATH`로 경로 지정 가능)
- 개발 기본값으로 `blog-service/blog.db`를 사용하도록 권장
- 주요 테이블: `users`, `user_profiles`, `todos`, `auth_tokens`, `posts`(legacy)

SQLite 확인 예시:

```bash
sqlite3 blog-service/blog.db ".tables"
sqlite3 blog-service/blog.db "SELECT user_id, email FROM users LIMIT 10;"
```

참고: MVP 단계에서는 SQLite로 충분하지만, 프로덕션 전환 시 PostgreSQL 같은 서버형 DB로 이전하는 것을 권장합니다.

## API 엔드포인트 (핵심)

- POST /api/register — 회원가입
	- Request: { email, password, display_name, gender }
	- Response: 201 { token, user_id, display_name }

- POST /api/login — 로그인
	- Request: { email, password }
	- Response: 200 { token, user_id, profile }

- GET /api/profile/me — 현재 사용자 프로필 (Authorization 필요)

- PATCH /api/profile — 프로필 수정 (display_name, gender, avatar_url 허용)

- POST /api/todos — 투두 생성 (Authorization 필요)
	- Request: { title, description, category, xp_reward, due_date }
	- Response: 201 { todo_id, title }

- GET /api/todos — 투두 목록 (Authorization 필요)

- POST /api/todos/{todo_id}/complete — 투두 완료 및 XP 적용/레벨업 (Authorization 필요)
	- Response: { message:'completed', xp_gain, new_level, current_xp, next_level_xp, leveled }

- GET /api/leaderboard — 레벨/XP 상위 사용자 목록

인증: `Authorization: Bearer <token>` 헤더 사용 (클라이언트는 현재 sessionStorage에 token 저장).

## 개발자용 테스트 스크립트 (간단 E2E)

프로젝트 루트에서 서버가 켜진 상태라면 다음 스크립트로 간단한 흐름(회원가입→투두 생성→완료→프로필 확인)을 실행해볼 수 있습니다.

```bash
# 예: /tmp/e2e.sh 만들고 실행
EMAIL="auto$(date +%s)@example.com"
DN="auto$(date +%s)"
RESP=$(curl -s -X POST http://127.0.0.1:8005/api/register -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\",\"display_name\":\"$DN\",\"gender\":\"male\"}")
TOKEN=$(echo "$RESP" | jq -r .token)
curl -s -X POST http://127.0.0.1:8005/api/todos -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"title":"E2E Task","description":"desc","category":"study","xp_reward":120}'
TODOS=$(curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8005/api/todos)
ID=$(echo "$TODOS" | jq -r '.[0].todo_id')
curl -s -X POST http://127.0.0.1:8005/api/todos/$ID/complete -H "Authorization: Bearer $TOKEN"
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8005/api/profile/me
```

## 브라우저로 수동 점검할 체크리스트

1. http://127.0.0.1:8005/blog/ 접속 → 로그인 화면 표시
2. 회원가입 → 네트워크 탭에서 POST /api/register가 201을 반환하는지 확인
3. 로그인 → 토큰(sessionStorage) 저장 여부 확인
4. 투두 생성 → POST /api/todos 응답 확인 및 목록 반영
5. 투두 완료 → POST /api/todos/{id}/complete 응답 확인(leveled 포함) 및 프로필 업데이트
6. 리더보드 페이지에서 GET /api/leaderboard 호출 확인

## 운영/백업 팁 (SQLite)

- 정기 백업: `cp blog-service/blog.db blog-service/blog.db.bak_$(date +%F)`
- 백업 시에는 애플리케이션을 일시 중지하거나 SQLite 온라인 백업 API 사용 권장
- 동시성/스케일 제약: 멀티 인스턴스/높은 동시성 환경에서는 PostgreSQL 등으로 이전 권장

## 향후 개선(권장)

- 인증: 현재 sessionStorage 기반 토큰 사용 → HTTP-only 쿠키 + CSRF 방지로 보안 강화
- DB: SQLite → PostgreSQL 전환(간단한 migration 또는 SQLAlchemy + Alembic 도입 권장)
- 테스트: pytest + httpx 기반 자동화 E2E 테스트 추가
- UX: 프론트엔드 로딩 인디케이터, 에러 토스트 개선

---

원하시면 바로 `README.md`에 포함된 “브라우저 점검 체크리스트”를 바탕으로 함께 브라우저에서 각 단계(회원가입→투두→완료→리더보드)를 점검해 드리겠습니다.

````
