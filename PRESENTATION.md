# Lv-Up Planner — 발표 자료
---

## 슬라이드 1 — 제목 & 한줄 요약

**제목**: Lv-Up Planner

**한줄 요약**: 투두(퀘스트)에 보상(XP)과 레벨을 부여해 생산성을 게임화하는 FastAPI 기반 서비스

**스피커 노트**: 안녕하세요. Lv-Up Planner는 할 일을 단순한 투두에서 게임화된 퀘스트로 전환해 동기 부여를 높이는 서비스입니다.

---

## 슬라이드 2 — 문제 (Problem)

**핵심 문구**: 관리만 하는 투두는 동기 유지에 약합니다.

**포인트**:
- 집중력 저하, 반복 과제의 지루함
- 진행 상황의 시각화 부족

**스피커 노트**: 많은 사용자가 할 일을 리스트로 만들지만 끝까지 해내는 경우가 적습니다. 보상과 피드백이 없기 때문입니다.

---

## 슬라이드 3 — 해결책 (Solution)

**핵심 문구**: 퀘스트 완료 시 XP 지급 → 레벨업 → 리더보드로 성취 시각화

**포인트**:
- 퀘스트(투두) 생성·완료
- XP 부여와 레벨 계산
- 프로필과 리더보드로 성장 시각화

**스피커 노트**: 사용자가 과제를 완료하면 즉시 보상을 받고, 성장은 프로필과 리더보드에 반영되어 지속적으로 동기를 제공합니다.

---

## 슬라이드 4 — 아키텍처 요약

**핵심 문구**: FastAPI + SQLite (개발) / SPA(vanilla JS) / Docker Compose

**구성 요소**:
- 백엔드: `blog-service/blog_service.py` (FastAPI)
- DB: SQLite 파일 (환경변수 `BLOG_DATABASE_PATH`)
- 프론트: `templates/index.html` + `static/js/app.js` (vanilla JS)
- 배포: Docker Compose (헬스체크 포함)

**스피커 노트**: 단순하고 빠른 프로토타이핑을 위해 설계했습니다. 운영 전환 시 DB·인증·비밀관리 강화를 계획하고 있습니다.

---

## 슬라이드 5 — 핵심 기능(데모 포인트)

**핵심 문구**: 회원가입 → 투두 생성 → 완료 → 레벨업 확인

# Lv‑Up Planner — 프로젝트 개요

아래 문서는 프로젝트 핵심 정보를 정리한 기술 문서입니다. 발표 자료로도 사용할 수 있도록 각 섹션을 간결하게 구성했습니다.

## 1) 제목

Lv‑Up Planner

## 2) 요약

Lv‑Up Planner는 투두(할 일)를 게임화하여 사용자가 퀘스트를 완료할 때 XP를 획득하고 레벨업하도록 설계된 생산성 서비스입니다. 프로필과 리더보드를 통해 성취를 시각화하여 지속적인 동기 부여를 제공합니다. 현재는 FastAPI 백엔드, 간단한 SPA, SQLite(개발)를 사용해 빠르게 프로토타이핑한 상태입니다.

## 3) 기술 스택

- Python 3.10+
- FastAPI, uvicorn
- SQLite (개발), 권장: PostgreSQL(운영)
- passlib (pbkdf2_sha256) — 개발용 비밀번호 해시
- Frontend: Vanilla JS (SPA), Jinja2
- 컨테이너: Docker, Docker Compose
- 테스트 툴(권장): pytest, httpx

## 4) 아키텍처

컴포넌트:
- 클라이언트: SPA — 브라우저에서 REST API 호출
- API 서버: FastAPI 애플리케이션 (`blog-service/blog_service.py`)
- 데이터 저장소: SQLite 파일 (개발), 운영 시 RDBMS 권장
- 인증: 서버 발급 토큰(현재는 클라이언트 보관 방식)
- 배포: Docker Compose, 헬스체크 지원

관계도(간단):

Client ↔ FastAPI(API) ↔ SQLite

## 5) 데이터 흐름

회원가입/로그인/투두 생성/완료/리더보드 조회의 흐름을 순서대로 정리합니다:

- 회원가입: 클라이언트 → POST /api/register → 서버(User 생성 + Profile 초기화 + Token 발급) → 클라이언트 토큰 보관
- 로그인: POST /api/login → 토큰 반환
- 투두 생성: POST /api/todos (Authorization 헤더 필요) → todos 테이블에 항목 생성
- 투두 완료: POST /api/todos/{id}/complete → 서버가 is_completed 업데이트, user_profiles에 xp 합산, 레벨 임계치 체크 및 레벨업 처리 → 결과 반환
- 리더보드: GET /api/leaderboard → 사용자 레벨·XP 정렬 정보 반환

## 6) 사용자 시나리오

시나리오 1 — 신규 사용자 온보딩:
- 가입 → 퀘스트 생성(간단한 과제, XP 설정) → 첫 완료로 즉시 보상 확인

시나리오 2 — 지속 성장:
- 여러 퀘스트 누적 완료 → 누적 XP로 레벨업 → 프로필의 레벨 변화 관찰

시나리오 3 — 경쟁/비교:
- 리더보드를 통해 동료와 비교 → 경쟁 동기 유발

## 7) 요구사항 분석

기능적 요구사항:
- 사용자 관리 (회원가입, 로그인, 프로필 조회/수정)
- 투두 관리 (생성, 조회, 완료)
- 레벨·XP 계산 및 리더보드

비기능적 요구사항:
- 보안: 안전한 비밀번호 저장 및 토큰 관리
- 확장성: 다중 인스턴스 환경 대응(현재 SQLite 제약)
- 신뢰성: 데이터 무결성(특히 XP/레벨 계산)
- 테스트 및 자동화: API 테스트 및 CI

제약 및 가정:
- 현재는 프로토타입/개발용 아키텍처(로컬 파일 DB, 간단한 해시). 운영 시 보안·DB·세션 전략 변경 필요

## 8) DB 개념 설계도 (Conceptual)

엔티티(요약):

- users
	- user_id (PK), email(unique), password_hash, created_at

- user_profiles
	- profile_id (PK), user_id (FK), display_name, gender, avatar_url, level, current_xp, total_xp

- todos
	- todo_id (PK), user_id (FK), title, description, category, xp_reward, is_completed, created_at, completed_at

- auth_tokens
	- token (PK), user_id (FK), issued_at, expires_at

- posts (샘플/콘텐츠)
	- post_id, title, body

관계:
- users 1──1 user_profiles
- users 1──* todos
- users 1──* auth_tokens

레벨업 로직(간단 예):
- next_level_xp = base_xp * current_level (혹은 누적 기준)
- 투두 완료 시 xp_reward를 더함 → current_xp 증가 → current_xp >= next_level_xp이면 level 증가, current_xp -= next_level_xp

---

