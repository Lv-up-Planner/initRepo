// TItanium-v2/api-gateway/main.go

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"
)

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func newProxy(target *url.URL) *httputil.ReverseProxy {
	return httputil.NewSingleHostReverseProxy(target)
}

func main() {
	port := getEnv("API_GATEWAY_PORT", "8000")

	// 각 서비스 URL 파싱
	userServiceURL, _ := url.Parse(getEnv("USER_SERVICE_URL", "http://user-service:8001"))
	authServiceURL, _ := url.Parse(getEnv("AUTH_SERVICE_URL", "http://auth-service:8002"))
	blogServiceURL, _ := url.Parse(getEnv("BLOG_SERVICE_URL", "http://blog-service:8005"))
	// 분석 서비스는 현재 통계 집계에 직접 사용되지 않으므로 주석 처리 또는 삭제 가능
	// analyticsServiceURL, _ := url.Parse(getEnv("ANALYTICS_SERVICE_URL", "http://analytics-service:8004"))

	// 리버스 프록시 + 타임아웃이 설정된 트랜스포트
	transport := &http.Transport{
		ResponseHeaderTimeout: 2 * time.Second,
		IdleConnTimeout:       30 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	userProxy := httputil.NewSingleHostReverseProxy(userServiceURL)
	userProxy.Transport = transport
	authProxy := httputil.NewSingleHostReverseProxy(authServiceURL)
	authProxy.Transport = transport
	blogProxy := httputil.NewSingleHostReverseProxy(blogServiceURL)
	blogProxy.Transport = transport

	mux := http.NewServeMux()

	// --- [핵심 수정] /api/ 경로를 처리하고 접두사를 제거하는 핸들러 ---
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// /api/ 접두사 제거
		trimmedPath := strings.TrimPrefix(path, "/api")

		if strings.HasPrefix(trimmedPath, "/login") {
			r.URL.Path = trimmedPath
			authProxy.ServeHTTP(w, r)
		} else if strings.HasPrefix(trimmedPath, "/register") {
			// 회원가입은 User Service로 프록시하고, /users로 경로 재작성
			r.URL.Path = "/users"
			userProxy.ServeHTTP(w, r)
		} else if strings.HasPrefix(trimmedPath, "/users") {
			r.URL.Path = trimmedPath
			userProxy.ServeHTTP(w, r)
		} else if strings.HasPrefix(trimmedPath, "/posts") {
			// Blog Service는 내부 라우트를 /api/posts 로 노출하므로 게이트웨이에서는 원본 경로(path)를 유지하여 프록시
			r.URL.Path = path // e.g., /api/posts, /api/posts/{id}
			blogProxy.ServeHTTP(w, r)
		} else {
			http.NotFound(w, r)
		}
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// API Gateway 자체의 통계 정보 (LB가 수집해감)
	mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
		stats := map[string]interface{}{
			"api-gateway": map[string]interface{}{
				"service_status": "online",
				"info":           "Proxying API requests",
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(stats)
	})

	log.Printf("Go API Gateway started on :%s", port)
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 2 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
