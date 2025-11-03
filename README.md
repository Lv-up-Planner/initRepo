## Lv-Up Planner — 개발 가이드

간단명료하게: 이 리포지토리는 FastAPI로 구현한 단일 서비스형 애플리케이션입니다. 서버는 REST API와 SPA(단일 페이지 앱)를 함께 제공하며, 개발 환경에서는 SQLite를 사용합니다. 핵심 기능은 사용자 인증/프로필(레벨·XP), 퀘스트(투두) 생성·완료, 완료 시 XP 부여 및 레벨업, 그리고 리더보드 조회입니다.

## 한눈에 보는 아키텍처

- 앱: FastAPI (uvicorn)
- DB: SQLite 파일(개발) — 주요 테이블: `users`, `user_profiles`, `todos`, `auth_tokens`, `posts`
- 프론트엔드: `blog-service/templates/index.html` + `blog-service/static/js/app.js` (vanilla JS로 API 호출)
- 배포/로컬 실행: Docker Compose 구성 포함

프로젝트 구조(요약):

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

## 빠른 시작 (개발환경)

사전 요구사항:
- Python 3.10+ (권장)
- Docker (선택, 컨테이너로 실행 시)

1) 저장소 복제

```bash
git clone https://github.com/Lv-up-Planner/initRepo.git
cd initRepo
```

2) 가상환경 생성 및 의존성 설치 (macOS / Linux)

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r blog-service/requirements.txt
```

3) 환경 변수 준비

`.env.example` 파일이 있으니 복사해서 사용하세요.

```bash
cp .env.example .env
# 필요시 편집
```

주요 변수 예: `BLOG_DATABASE_PATH` (기본: `/data/blog.db`), `TOKEN_EXP_DAYS`, `HOST`, `PORT`

4) 로컬에서 앱 실행 (개발용)

```bash
cd blog-service
# 저장소 내부에 DB를 만들려면:
BLOG_DATABASE_PATH=blog-service/blog.db ../.venv/bin/uvicorn blog_service:app --host 127.0.0.1 --port 8005 --reload
```

브라우저: http://127.0.0.1:8005/blog/

5) Docker Compose로 실행 (배포/테스트)

```bash
# .env가 없으면 run-deploy.sh가 .env.example을 복사합니다
bash run-deploy.sh
# 또는 직접
docker compose build --pull --no-cache
docker compose up -d

# 로그 보기
docker compose logs -f blog-service
```

헬스체크: `http://localhost:8005/health` → 200 OK

## 핵심 엔드포인트 (요약)

- POST /api/register — 회원가입
	- Request: { email, password, display_name, gender }
	- Response: 201 { token, user_id, display_name }

- POST /api/login — 로그인
	- Request: { email, password }
	- Response: 200 { token, user_id, profile }

- GET /api/profile/me — 현재 사용자 프로필 (Authorization 필요)
- PATCH /api/profile — 프로필 수정
- POST /api/todos — 투두 생성 (Authorization 필요)
- GET /api/todos — 투두 목록 (Authorization 필요)
- POST /api/todos/{todo_id}/complete — 투두 완료 및 XP/레벨업 적용
	- Response: { message:'completed', xp_gain, new_level, current_xp, next_level_xp, leveled }
- GET /api/leaderboard — 레벨/XP 상위 사용자 목록

인증: Authorization: Bearer <token> (현재 클라이언트는 sessionStorage에 토큰을 저장하도록 구현되어 있습니다.)

## 데이터베이스(개발)

- 기본: SQLite 파일 (환경변수 `BLOG_DATABASE_PATH`로 경로 지정)
- 개발용 권장 경로: `blog-service/blog.db`

SQLite 간단 확인 예:

```bash
sqlite3 blog-service/blog.db ".tables"
sqlite3 blog-service/blog.db "SELECT user_id, email FROM users LIMIT 10;"
```

프로덕션 전환 시: PostgreSQL 등 서버형 DB로 이전 권장.

## 간단한 E2E(스모크) 테스트 예시

서버가 동작 중이면 다음 스크립트로 회원가입 → 투두 생성 → 완료 → 프로필 확인 흐름을 확인할 수 있습니다.

```bash
EMAIL="auto$(date +%s)@example.com"
DN="auto$(date +%s)"
RESP=$(curl -s -X POST http://127.0.0.1:8005/api/register -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"secret123\",\"display_name\":\"$DN\",\"gender\":\"male\"}")
TOKEN=$(echo "$RESP" | jq -r .token)
cURL_OPTS=( -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" )
curl -s -X POST http://127.0.0.1:8005/api/todos "${CURL_OPTS[@]}" -d '{"title":"E2E Task","description":"desc","category":"study","xp_reward":120}'
TODOS=$(curl -s "${CURL_OPTS[@]}" http://127.0.0.1:8005/api/todos)
ID=$(echo "$TODOS" | jq -r '.[0].todo_id')
curl -s -X POST http://127.0.0.1:8005/api/todos/$ID/complete "${CURL_OPTS[@]}"
curl -s "${CURL_OPTS[@]}" http://127.0.0.1:8005/api/profile/me
```

## 브라우저 수동 점검 체크리스트

1. http://127.0.0.1:8005/blog/ 접속 — 로그인 화면 노출
2. 회원가입 → 네트워크 탭에서 POST /api/register가 201 반환 확인
3. 로그인 → sessionStorage에 토큰이 저장되는지 확인
4. 투두 생성 → POST /api/todos 응답 및 목록 반영 확인
5. 투두 완료 → POST /api/todos/{id}/complete 응답(leveled 여부 포함) 및 프로필 반영
6. 리더보드 페이지 확인 (GET /api/leaderboard)

## 운영·백업 팁

- 정기 백업 예: `cp blog-service/blog.db blog-service/blog.db.bak_$(date +%F)`
- 백업 시 애플리케이션을 일시 중지하거나 SQLite 온라인 백업 API 사용 권장
- 다중 인스턴스·높은 동시성 환경에서는 PostgreSQL 등으로 전환 권장

## 보안·운영 권장 사항

- 비밀번호 해시: 개발 환경에서는 pbkdf2_sha256 등을 사용합니다. 운영에서는 scrypt/bcrypt/argon2 등 안전한 해시를 권장합니다.
- 인증 토큰: 프로덕션에서는 HTTP-only 쿠키 + CSRF 보호 고려
- 비밀값(.env): 절대 레포지토리에 커밋하지 않음

## 다음 작업(권장)

- pytest + httpx 기반 자동화 E2E 테스트 추가
- GitHub Actions로 CI 구성(빌드/테스트) 추가
- DB 마이그레이션 도구(예: Alembic) 도입 및 PostgreSQL 전환

---

더 다듬을 부분(원하시면 제가 바로 작업합니다): API 상세 문서(요청/응답 예제), Swagger/OpenAPI 문서 링크, CI 템플릿, 또는 개발 컨벤션(브랜치/커밋 규칙 등).


