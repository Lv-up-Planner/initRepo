## 혼합 부하 테스트 

두 가지 셸 스크립트로 블로그 API에 혼합 부하를 적용합니다.


## 스크립트
- `mixed_load.sh`: **목록/상세/생성** 3종 부하 *(읽기 위주 + 소량 쓰기)*
- `mixed_load_plus.sh`: **목록/상세/생성/수정/삭제** 5종 부하 + **종료 후 정리(삭제)**

## 전제 조건
- `sh`, `curl`  
- *(옵션)* `jq`가 있으면 `/stats` 출력이 보기 좋게 표시됨


## 사용법

### 기본 혼합 부하(목록/상세/생성)
```sh
cd load-tests
sh ./mixed_load.sh --url < LB주소:포트 > --duration 60s --rate-list 64 --rate-detail 12 --rate-create 4
```

### 수정/삭제 포함 + 종료 후 정리
```sh
cd load-tests
sh ./mixed_load_plus.sh --url < LB주소:포트 > --duration 60s --rate-list 40 --rate-detail 15 --rate-create 8 --rate-update 4 --rate-delete 3

# 생성된 테스트 게시글 정리만 실행
sh ./mixed_load_plus.sh --url < LB주소:포트 > --cleanup
```


## 시나리오 개요
- **사전 단계**: 테스트용 사용자 **등록/로그인 → JWT 발급**, **시드 게시글 5개 생성**
- **동시 실행**
  - **목록**: `GET /api/posts`
  - **상세**: `GET /api/posts/{id}` *(시드 중 랜덤)*
  - **생성**: `POST /api/posts` *(Authorization: Bearer 토큰)*
  - **(plus) 수정**: `PATCH /api/posts/{id}`
  - **(plus) 삭제**: `DELETE /api/posts/{id}`


## 모니터링 포인트
- **LB `/stats`**: `requests_per_second`, `avg_response_time_ms`, `success_rate`, `has_real_traffic`
- **실패율**을 낮게(**≈2% 미만**), **p95 지연**을 합리적인 범위 내로 유지하도록 **비율/지속시간**을 조정하세요.


## 주의
- **쓰기 부하**로 게시글이 증가합니다. **테스트 후 정리**하거나 **테스트 전용 DB 경로**(`BLOG_DATABASE_PATH`)를 사용하세요.

