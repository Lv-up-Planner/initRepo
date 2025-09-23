# 1. 베이스 이미지 설정
FROM python:3.11-slim

# 2. 작업 디렉토리 설정
WORKDIR /app

# 3. 의존성 파일 복사 및 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. 프로젝트의 모든 소스 코드 복사
COPY . .

# 5. 서비스 포트 노출 (config.py에 정의된 8002 포트)
EXPOSE 8002

# 6. 컨테이너 실행 시 시작될 메인 스크립트 지정 (Uvicorn 사용)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]