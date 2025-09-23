import logging
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse

from config import config
from auth_service import AuthService

# 로깅 설정
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('AuthServiceApp')

# FastAPI 앱 생성
app = FastAPI()
auth_service = AuthService()

# --- API 엔드포인트 ---
@app.post("/login")
async def handle_login(request: Request):
    """로그인 요청을 처리하고 JWT 토큰을 반환합니다."""
    try:
        data = await request.json()
        result = await auth_service.login(data.get('username'), data.get('password'))
        status_code = 200 if result.get('status') == 'success' else 401
        return JSONResponse(content=result, status_code=status_code)
    except Exception:
        raise HTTPException(status_code=400, detail={"status": "failed", "message": "Invalid request body"})

@app.get("/verify")
async def validate_token(request: Request):
    """토큰 유효성을 검증합니다."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=400, detail={'valid': False, 'error': 'Authorization header missing or invalid'})

    token = auth_header.split(' ')[1]
    result = auth_service.verify_token(token)
    is_valid = result.get('status') == 'success'
    status_code = 200 if is_valid else 401
    return JSONResponse(content=result, status_code=status_code)

@app.get("/health")
async def handle_health():
    """헬스 체크 엔드포인트"""
    return {"status": "ok", "service": "auth-service"}

@app.get("/stats")
async def handle_stats():
    """서비스의 간단한 통계를 반환합니다."""
    stats_data = {
        "auth": {
            "service_status": "online",
            "active_session_count": 0  # 실제 구현에서는 세션 수를 추적해야 합니다.
        }
    }
    return stats_data

# --- Uvicorn으로 앱 실행 ---
if __name__ == "__main__":
    import uvicorn
    logger.info(f"✅ Auth Service starting on http://{config.server.host}:{config.server.port}")
    uvicorn.run(app, host=config.server.host, port=config.server.port)