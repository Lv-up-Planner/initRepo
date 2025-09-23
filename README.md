# Monitoring

마이크로서비스 기반의 쿠버네티스 모니터링 대시보드 프로젝트입니다. 각 서비스는 독립적으로 컨테이너화되어 있으며 로드밸런서를 통해 트래픽이 분배되고, 대시보드를 통해 실시간 상태를 확인할 수 있습니다.

## 프로젝트 구조

```
.
├── api-gateway      # Go 기반 API 게이트웨이
├── auth-service     # 사용자 인증 서비스 (FastAPI)
├── blog-service     # 블로그 예제 서비스 (FastAPI)
├── user-service     # 사용자 관리 서비스 (FastAPI + Redis)
├── load-balancer    # Go 로드밸런서 및 통계 수집기
├── dashboard-ui     # Chart.js 기반 모니터링 대시보드
├── k8s-manifests    # Kustomize 기반 쿠버네티스 매니페스트
├── docker-compose.yml
└── skaffold.yaml
```

## 서비스 개요

- **Load Balancer**: 각 서비스와 UI로의 요청을 프록시하고 `/stats` 엔드포인트에서 전체 지표를 집계합니다.
- **API Gateway**: `/api/*` 경로를 내부 서비스로 라우팅하여 인증, 사용자, 블로그 API를 단일 진입점으로 제공합니다.
- **User Service**: 사용자 등록·조회·인증 및 DB/캐시 상태를 반환하는 `/stats` 엔드포인트를 제공합니다.
- **Auth Service**: 로그인과 JWT 토큰 검증 기능을 제공하며 `/stats` 로 간단한 상태 정보를 반환합니다.
- **Blog Service**: 게시물 조회·등록 API와 샘플 SPA 페이지를 포함하는 예제 서비스입니다.

## 비기능 요구사항 (요약)

- **성능 목표**: 안정적 처리량 100 RPS.
- **확장성(기본 복제 수)**: 고가용성 확보를 위해 서비스 기본 2 Pod(상태 저장/인프라형은 1). 예) `api-gateway` 2, `load-balancer` 2, `auth-service` 2, `user-service` 2, `dashboard-ui` 2, `redis` 1, `blog-service` 1.
- **안정성(Timeouts)**: 서비스 간 호출에 짧은 타임아웃을 적용하여 장애 전파를 차단.

## 안정성 설계 (Timeouts)

- **Load Balancer → 각 서비스 `/stats` 호출**:
  - **HTTP 클라이언트 타임아웃**: `2s` 적용
  - 코드: `load-balancer/main.go`의 `/stats` 핸들러 내 `http.Client{ Timeout: 2 * time.Second }`
  - 개별 서비스 호출: 완전한 URL(`.../stats`)을 사용해 고루틴 병렬 수집
- **API Gateway → 내부 서비스 프록시**:
  - **Transport 타임아웃**: `ResponseHeaderTimeout=2s`, `IdleConnTimeout=30s`, `ExpectContinueTimeout=1s`
  - **Server 타임아웃**: `ReadHeaderTimeout=2s`, `WriteTimeout=10s`, `IdleTimeout=60s`
  - 코드: `api-gateway/main.go`의 `httputil.ReverseProxy.Transport` 및 `http.Server` 설정

## 프록시/집계 경로 구성 및 100 RPS 최적화

- **경로 구성**: `Load Balancer`는 UI(`/`), API(`/api/*`)를 프록시하고, `/stats`에서 각 서비스의 `/stats`를 병렬 수집 후 통합 응답을 제공합니다.
- **집계 최적화**: 최근 10초 윈도우로 RPS·평균 응답시간을 계산해 스파이크에도 민감하게 반응하면서 노이즈를 억제합니다.
- **오버헤드 최소화**: 통계 미들웨어가 `/api/*` 실트래픽만 집계하고, 하트비트/HEAD는 제외해 측정 비용을 줄입니다.
- **백프레셔**: 서비스 호출에 `2s` 타임아웃을 두어 느린 서비스가 전체 집계를 지연시키지 않도록 격리합니다.
- **목표 부하(100 RPS)**: 위 구성으로 평균 응답시간과 실패율을 안정화하고, 네트워크/프록시 타임아웃으로 장애 전파를 차단합니다.

## 대시보드 하트비트 (WebSocket)

- **엔드포인트**: `ws(s)://<LB>/api/ws-heartbeat` (gorilla/websocket)
- **이유**: 실제 사용자 트래픽이 없을 때도 운영 중인 상태를 반영하기 위해 WS 연결을 유지하며 활동을 신호로 보냅니다. HTTP 하트비트는 측정 제외 정책(HEAD/X-Heartbeat)과 충돌할 수 있어 WS를 채택했습니다.
- **역할**: 연결이 유지되는 동안 주기적 ping/pong 및 메시지로 “실제 활동”을 LB가 감지하여 IDLE 상태를 방지
- **대시보드 토글**: `index.html`의 `#toggle-ws-heartbeat-btn` 버튼으로 ON/OFF 제어
  - ON: 클라이언트가 5초마다 `"hb"` 메시지를 전송, 끊기면 2초 후 자동 재연결
  - OFF: 연결 종료 및 전송 중단
- **HTTP 하트비트**: 기본 비활성화. 필요 시 `script.js`의 `config.heartbeat`로 GET `/api/health`를 사용할 수 있음

## 대시보드 핵심 KPI

- **시스템 현황**: 전체 상태, 활성 서비스 수, 현재 RPS, 평균 응답시간에 집중합니다.
- **데이터 저장소 상태**: `stats.database.status`, `stats.cache.status`를 ONLINE/OFFLINE으로 단순 표기합니다.
- **알람 단순화**: 서비스 Offline 감지 위주로 노이즈를 줄였습니다.

## 트래픽 집계 기준 (IDLE 관련)

- **집계 기준**: LB 미들웨어는 `/api/*` 경로의 요청만 “실제 API 트래픽”으로 집계하며, `HEAD` 요청과 `X-Heartbeat: true`는 제외
- **IDLE 판단**: 최근 10초간 실제 API 트래픽(또는 WS 활동)이 없으면 `has_real_traffic=false`로 보고, 대시보드가 IDLE을 표기
- **해결 방법**: 실제 API 호출 또는 WS 하트비트(권장)를 활성화하면 IDLE이 해제되고 지표가 업데이트됨

## 부하 테스트

**위치:** `load-tests/mixed_load.sh`, `load-tests/mixed_load_plus.sh`  
**의존성:** `sh`, `curl` *(옵션: `jq`가 있으면 `/stats` 출력이 보기 좋게 표시됨)*


### 실행 방법

- 기본 혼합 부하(목록/상세/생성)
```sh
cd load-tests
sh ./mixed_load.sh --url http://127.0.0.1:30700 --duration 60s --rate-list 64 --rate-detail 12 --rate-create 4
```

- 확장 혼합 부하(수정/삭제 포함 + 종료 후 일부 정리)
```sh
cd load-tests
sh ./mixed_load_plus.sh --url http://127.0.0.1:30700 --duration 60s --rate-list 40 --rate-detail 15 --rate-create 8 --rate-update 4 --rate-delete 3
```

- 생성된 테스트 게시글 정리만 실행
```sh
sh ./mixed_load_plus.sh --url http://127.0.0.1:30700 --cleanup
```


### 실행 시나리오(요약)

- **사전:** 테스트 사용자 **등록/로그인 → JWT 발급**, 상세 조회용 **시드 게시글 5개 생성**
- **동시:** 
  - 목록 `GET /api/posts`
  - 상세 `GET /api/posts/{id}` *(시드 랜덤)*
  - 생성 `POST /api/posts`
- **확장:** 
  - 수정 `PATCH /api/posts/{id}`
  - 삭제 `DELETE /api/posts/{id}` 포함


### 결과/모니터링

- **LB `/stats`**: `requests_per_second`, `avg_response_time_ms`, `success_rate`, `has_real_traffic` 확인
- **실패율**은 낮게(**≈2% 미만**), **p95 지연**은 허용 범위 내로 유지되도록 **RPS/지속시간**을 조정

> **주의:** 시드 글은 제목이 `seed-` → **수정 시** `upd-`로 바뀔 수 있고, 확장 스크립트 정리는 **“이번 실행에서 생성한 글”** 위주로 진행됩니다. 동일 제목의 다른 글이 남아 보일 수 있으니 **ID 기준**으로 확인하세요.

## 로컬 실행

### Docker Compose

```bash
docker-compose up --build
```

- 로드밸런서: <http://localhost:7100>
- 대시보드: <http://localhost:7100>
- API 게이트웨이: <http://localhost:7100/api/>

### Kubernetes (Skaffold)

아래 단계대로 실행하면 로컬 클러스터에서 대시보드를 확인할 수 있습니다.

1) 전제 조건 설치
- Docker, kubectl, Skaffold
- 로컬 K8s 클러스터(택1): minikube 또는 kind

2) 클러스터 준비
- minikube 사용 시
  ```bash
  minikube start
  # skaffold가 빌드한 이미지를 바로 사용하도록 로컬 Docker 데몬 연결
  eval "$(minikube -p minikube docker-env)"
  ```
- kind 사용 시 (최초 1회)
  ```bash
  kind create cluster
  # skaffold가 빌드 이미지를 kind 노드에 자동 로드하도록 설정
  skaffold config set --global local-cluster true
  ```

3) 배포 실행 (프로젝트 루트에서)
```bash
skaffold dev
```
빌드 완료 후 `titanium-local` 네임스페이스로 리소스가 배포됩니다.

4) 상태 확인
```bash
kubectl -n titanium-local get pods,svc
```

5) 브라우저 접속
- minikube:
  ```bash
  minikube service local-load-balancer-service -n titanium-local --url
  ```
  출력된 URL을 브라우저로 열기 (예: http://127.0.0.1:30700)
- kind/그 외:
  ```bash
  kubectl -n titanium-local port-forward svc/local-load-balancer-service 7100:7100
  ```
  브라우저에서 http://localhost:7100 접속

6) 동작 확인
```bash
curl -s http://localhost:7100/stats | jq .   # 집계 지표
```

7) 종료/정리
```bash
# skaffold 개발 모드 중지
Ctrl + C
# 배포 리소스 정리
skaffold delete
```

## 의존성

- Docker / Docker Compose
- kubectl, Skaffold, Kustomize
- Go 1.22+, Python 3.10+
-
## 데이터 백업 CronJob

- **목적**: `user-service`의 SQLite(`users.db`)를 주기적으로 백업하여 디스크 장애·실수로 인한 손상에 대비합니다.
- **스케줄**: 매일 자정(UTC) 실행. 파일명을 타임스탬프와 함께 `/backup/users.db.YYYY-mm-dd-HHMMSS`로 보관합니다.
- **구성**: CronJob 컨테이너에서 PVC를 `/data`(원본, RO)와 `/backup`(백업)으로 마운트하여 단순 복사합니다.
- **참고 파일**: `k8s-manifests/base/user-service-backup-cronjob.yaml`
- **운영 권장**: 데모 환경은 동일 PVC를 재사용하지만, 실제 운영은 별도 PV/PVC 또는 외부 스토리지(NFS/S3 등) 사용을 권장합니다.