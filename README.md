# Blog Service

간단한 FastAPI 기반 블로그 애플리케이션입니다. 이전 프로젝트에서 제공하던 모니터링 및 대시보드 구성 요소는 모두 제거하고, 블로그 기능만을 남도록 구조를 정리했습니다. 하나의 서비스가 API와 SPA 형태의 웹 UI를 동시에 제공하며 SQLite 데이터베이스를 사용합니다.

## 프로젝트 구조

```
.
├── blog-service/
│   ├── blog_service.py      # FastAPI 애플리케이션 엔트리포인트
│   ├── Dockerfile           # 컨테이너 빌드 정의
│   ├── requirements.txt
│   ├── static/              # SPA 스크립트 및 스타일
│   └── templates/           # 블로그 메인 페이지 템플릿
├── docker-compose.yml       # 로컬 개발용 단일 서비스 Compose 정의
├── k8s-manifests/           # 간단한 Kubernetes Deployment/Service 매니페스트
└── skaffold.yaml            # skaffold dev 배포 설정
```

## 주요 기능

- FastAPI 기반 CRUD REST API (`/api/posts`, `/api/posts/{id}` 등)
- SPA 형태의 블로그 UI (`/` 또는 `/blog/` 하위 경로)
- 간단한 토큰 기반 인증/인가: 로그인 성공 시 발급되는 세션 토큰으로 글 작성·수정·삭제 가능
- SQLite 사용, 최초 기동 시 샘플 게시물과 테스트 계정(`admin/password123`, `dev/devpass`) 자동 생성

## 로컬 실행 방법

### 1. Docker Compose

```bash
docker compose up --build
# http://localhost:8005 접속
```

- 컨테이너 내부의 `/data/blog.db`가 볼륨(`blog_data`)으로 마운트되어 있어 컨테이너 재기동 시에도 데이터가 유지됩니다.

### 2. Python 가상환경에서 직접 실행

```bash
cd blog-service
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn blog_service:app --reload --port 8005
```

기본 브라우저에서 `http://127.0.0.1:8005`를 열면 됩니다.

## API 개요

| 메서드 | 경로 | 설명 |
| ------ | ---- | ---- |
| `GET` | `/api/posts` | 최신 글 목록 및 요약 |
| `GET` | `/api/posts/{id}` | 단일 글 상세 조회 |
| `POST` | `/api/register` | 사용자 등록 (본문: `{"username", "password"}`) |
| `POST` | `/api/login` | 로그인 및 세션 토큰 발급 |
| `POST` | `/api/posts` | 새 글 작성 (Authorization 헤더 필요) |
| `PATCH` | `/api/posts/{id}` | 글 수정 (작성자 본인만) |
| `DELETE` | `/api/posts/{id}` | 글 삭제 (작성자 본인만) |

- 인증이 필요한 엔드포인트는 `Authorization: Bearer <token>` 헤더가 필요합니다.
- SPA에서 로그인하면 세션 스토리지에 토큰과 사용자명이 저장되며, 이를 이용해 API 호출이 이루어집니다.

## Kubernetes 배포 (옵션)

Skaffold를 이용해 로컬 클러스터(minikube, kind 등)에 배포할 수 있습니다.

```bash
skaffold dev
```

- `k8s-manifests/blog-service.yaml`에는 Deployment와 ClusterIP Service가 포함되어 있습니다.
- 외부 접속은 `kubectl port-forward svc/blog-service 8005:80`로 열거나, minikube를 사용한다면 `minikube service blog-service --url`로 전달된 URL을 사용하면 됩니다.

## 변경 요약

- 모니터링을 위한 로드밸런서, API 게이트웨이, 대시보드 UI, 부하 테스트 스크립트 등은 모두 제거했습니다.
- 블로그 서비스는 외부 의존성 없이 자체적으로 인증과 게시물 관리를 처리하도록 단순화했습니다.
- Docker Compose / Skaffold / Kubernetes 매니페스트 역시 단일 서비스 구성에 맞게 정리했습니다.
