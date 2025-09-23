# user-service/Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8001

# CMD 명령어 형식을 다른 서비스와 통일합니다.
CMD ["uvicorn", "user_service:app", "--host", "0.0.0.0", "--port", "8001"]