// TItanium-v2/load-balancer/main.go (최종 완성본)

package main

import (
    "encoding/json"
    "io"
    "log"
    "net/http"
    "net/http/httputil"
    "net/url"
    "os"
    "strings"
    "sync"
    "time"
    
    "github.com/gorilla/websocket"
)

// --- 통계 데이터 구조체 ---
type StatsCollector struct {
    mu                sync.RWMutex
    requests          []time.Time // RPS 계산을 위해 요청 시간 기록
    totalRequests     int64
    successCount      int64
    totalResponseTime time.Duration

	// 최근 응답시간 샘플
	responseSamples []struct{ ts time.Time; dur time.Duration }

	// 실제 API 요청만 분리 집계 (대시보드 지표 반영용)
    apiRequests          []time.Time
    apiTotalRequests     int64
    apiSuccessCount      int64
    apiTotalResponseTime time.Duration
    apiResponseSamples   []struct{ ts time.Time; dur time.Duration }

    // WebSocket 하트비트 집계를 위한 최근 활동 타임스탬프
    wsActivities []time.Time
    wsActiveCount int
}
type requestMetrics map[string]interface{}

var stats = &StatsCollector{}

// --- 통계 측정 미들웨어 ---
func statsMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        startTime := time.Now()
        resWrapper := &responseWriterInterceptor{ResponseWriter: w, statusCode: http.StatusOK}
        next.ServeHTTP(resWrapper, r)
        duration := time.Since(startTime)

        stats.mu.Lock()
        now := time.Now()
        stats.totalRequests++
        stats.requests = append(stats.requests, now)
        if resWrapper.statusCode >= 200 && resWrapper.statusCode < 400 {
            stats.successCount++
        }
        stats.totalResponseTime += duration
        stats.responseSamples = append(stats.responseSamples, struct{ ts time.Time; dur time.Duration }{ts: now, dur: duration})

        // 실제 API 요청만 별도로 집계 (하트비트/정적자원 제외)
        isAPI := strings.HasPrefix(r.URL.Path, "/api/")
        isHeartbeat := r.Header.Get("X-Heartbeat") == "true" || r.Method == "HEAD"
        if isAPI && !isHeartbeat {
            stats.apiTotalRequests++
            stats.apiRequests = append(stats.apiRequests, now)
            if resWrapper.statusCode >= 200 && resWrapper.statusCode < 400 {
                stats.apiSuccessCount++
            }
            stats.apiTotalResponseTime += duration
            stats.apiResponseSamples = append(stats.apiResponseSamples, struct{ ts time.Time; dur time.Duration }{ts: now, dur: duration})
        }

        // 오래된 샘플 정리 (60초 이전 제거)
        cutoff := now.Add(-60 * time.Second)
        if len(stats.responseSamples) > 0 {
            var kept []struct{ ts time.Time; dur time.Duration }
            for _, s := range stats.responseSamples {
                if s.ts.After(cutoff) { kept = append(kept, s) }
            }
            stats.responseSamples = kept
        }
        if len(stats.apiResponseSamples) > 0 {
            var kept []struct{ ts time.Time; dur time.Duration }
            for _, s := range stats.apiResponseSamples {
                if s.ts.After(cutoff) { kept = append(kept, s) }
            }
            stats.apiResponseSamples = kept
        }
        stats.mu.Unlock()
    })
}

// ... responseWriterInterceptor, getEnv, newProxy는 이전과 동일 ...
type responseWriterInterceptor struct {
	http.ResponseWriter
	statusCode int
}

func (i *responseWriterInterceptor) WriteHeader(statusCode int) {
	i.statusCode = statusCode
	i.ResponseWriter.WriteHeader(statusCode)
}
func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
func newProxy(target *url.URL) *httputil.ReverseProxy {
	return httputil.NewSingleHostReverseProxy(target)
}

// --- 개별 서비스 통계 수집 함수 ---
func fetchServiceStats(client *http.Client, serviceURL string) requestMetrics {
    // serviceURL은 완전한 /stats URL이어야 함
    resp, err := client.Get(serviceURL)
	if err != nil {
		log.Printf("Error fetching stats from %s: %v", serviceURL, err)
		return requestMetrics{"service_status": "offline"}
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return requestMetrics{"service_status": "offline", "error": "failed to read body"}
	}
	var data requestMetrics
	if err := json.Unmarshal(body, &data); err != nil {
		return requestMetrics{"service_status": "offline", "error": "invalid json response"}
	}
	// [수정] 응답이 {"service_name": {...}} 형태이므로 내부 객체를 꺼내서 반환
	for _, value := range data {
		if v, ok := value.(map[string]interface{}); ok {
			return v
		}
	}
	return data
}

func main() {
	// --- 서비스 URL 설정 ---
	apiGatewayURL, _ := url.Parse(getEnv("API_GATEWAY_URL", "http://local-api-gateway-service:8000"))
	dashboardUIURL, _ := url.Parse(getEnv("DASHBOARD_UI_URL", "http://local-dashboard-ui-service:80"))
	authServiceURL := getEnv("AUTH_SERVICE_URL", "http://local-auth-service:8002")
	blogServiceURL := getEnv("BLOG_SERVICE_URL", "http://local-blog-service:8005")
	userServiceURL := getEnv("USER_SERVICE_URL", "http://local-user-service:8001")

	// 블로그 SPA 프록시용 URL 파싱
	blogProxyURL, _ := url.Parse(blogServiceURL)

	port := getEnv("LB_PORT", "7100")
	mux := http.NewServeMux()
    apiProxy := newProxy(apiGatewayURL)
    uiProxy := newProxy(dashboardUIURL)
    blogProxy := newProxy(blogProxyURL)

    // --- WebSocket 하트비트 엔드포인트 ---
    upgrader := websocket.Upgrader{ CheckOrigin: func(r *http.Request) bool { return true } }
    mux.HandleFunc("/api/ws-heartbeat", func(w http.ResponseWriter, r *http.Request) {
        // 업그레이드
        conn, err := upgrader.Upgrade(w, r, nil)
        if err != nil {
            log.Printf("WS upgrade error: %v", err)
            return
        }
        defer conn.Close()

        // 접속 증가 기록
        stats.mu.Lock()
        stats.wsActiveCount++
        stats.wsActivities = append(stats.wsActivities, time.Now())
        stats.mu.Unlock()
        defer func() {
            stats.mu.Lock()
            stats.wsActiveCount--
            stats.mu.Unlock()
        }()

        // Pong 수신 시 최근 활동 기록
        conn.SetPongHandler(func(appData string) error {
            stats.mu.Lock()
            stats.wsActivities = append(stats.wsActivities, time.Now())
            stats.mu.Unlock()
            return nil
        })

        // 주기적으로 ping 전송하여 연결 유지 및 활동 기록 유도
        pingTicker := time.NewTicker(5 * time.Second)
        defer pingTicker.Stop()

        done := make(chan struct{})
        go func() {
            for {
                select {
                case <-pingTicker.C:
                    // Ping 전송. 타임아웃을 짧게 설정
                    _ = conn.WriteControl(websocket.PingMessage, []byte("hb"), time.Now().Add(2*time.Second))
                case <-done:
                    return
                }
            }
        }()

        // 메시지 루프: 클라이언트 메시지 수신 시 활동 기록
        for {
            _, _, err := conn.ReadMessage()
            if err != nil {
                close(done)
                break
            }
            stats.mu.Lock()
            stats.wsActivities = append(stats.wsActivities, time.Now())
            stats.mu.Unlock()
        }
    })

	// --- [핵심] /stats 핸들러 최종 수정 ---
    mux.HandleFunc("/stats", func(w http.ResponseWriter, r *http.Request) {
        stats.mu.Lock()
        // RPS 계산: 최근 10초간의 실제 API 요청 수를 10으로 나눔
        now := time.Now()
        tenSecondsAgo := now.Add(-10 * time.Second)
        var recentRequests int
        var newRequests []time.Time
        for _, t := range stats.apiRequests {
            if t.After(tenSecondsAgo) {
                recentRequests++
                newRequests = append(newRequests, t)
            }
        }
        stats.apiRequests = newRequests // 오래된 요청 기록은 삭제

        // 최근 WS 활동도 같이 집계 (합성 하트비트이지만 실제 연결 상태를 반영)
        var wsRecent int
        var keptWS []time.Time
        for _, t := range stats.wsActivities {
            if t.After(tenSecondsAgo) {
                wsRecent++
                keptWS = append(keptWS, t)
            }
        }
        stats.wsActivities = keptWS

        rps := float64(recentRequests) / 10.0

        // 평균 응답시간 (최근 10초, 실제 API 요청 기준)
        var rollingDurSum time.Duration
        var rollingCount int64
        var keptSamples []struct{ ts time.Time; dur time.Duration }
        for _, s := range stats.apiResponseSamples {
            if s.ts.After(tenSecondsAgo) {
                rollingDurSum += s.dur
                rollingCount++
                keptSamples = append(keptSamples, s)
            }
        }
        stats.apiResponseSamples = keptSamples

        var avgResponseTimeMs float64
        if rollingCount > 0 {
            avgResponseTimeMs = float64(rollingDurSum.Milliseconds()) / float64(rollingCount)
        }

        // lifetime 평균 및 성공률(실제 API 요청 기준)
        var lifetimeAvgMs float64
        if stats.apiTotalRequests > 0 {
            lifetimeAvgMs = float64(stats.apiTotalResponseTime.Milliseconds()) / float64(stats.apiTotalRequests)
        }
        var successRate float64
        if stats.apiTotalRequests > 0 {
            successRate = (float64(stats.apiSuccessCount) / float64(stats.apiTotalRequests)) * 100
        }

        hasRealTraffic := recentRequests > 0 || wsRecent > 0

        combinedStats := requestMetrics{
            "load-balancer": requestMetrics{
                "total_requests": stats.totalRequests, "success_rate": successRate,
                "avg_response_time_ms": avgResponseTimeMs,
                "avg_response_time_ms_lifetime": lifetimeAvgMs,
                "requests_per_second": rps, "status": "healthy",
                "has_real_traffic": hasRealTraffic,
            },
        }
        stats.mu.Unlock()

		// --- [수정] 모든 서비스의 통계를 가져오도록 확장 ---
		var wg sync.WaitGroup
        client := &http.Client{Timeout: 2 * time.Second}
        serviceUrls := map[string]string{
            "api-gateway": apiGatewayURL.String() + "/stats",
            "user_service": userServiceURL + "/stats",
            "auth": authServiceURL + "/stats",
            "blog_service": blogServiceURL + "/stats",
        }
		resultsChan := make(chan struct {
			key  string
			data requestMetrics
		}, len(serviceUrls))

		for key, url := range serviceUrls {
			wg.Add(1)
			go func(key, url string) {
				defer wg.Done()
				serviceStats := fetchServiceStats(client, url)
				resultsChan <- struct {
					key  string
					data requestMetrics
				}{key, serviceStats}
			}(key, url)
		}
		wg.Wait()
		close(resultsChan)

        for result := range resultsChan {
            // fetchServiceStats에서 이미 언랩된 형태를 반환하므로 key로 분기
            if result.key == "user_service" {
                if db, ok := result.data["database"]; ok {
                    combinedStats["database"] = db
                }
                if cache, ok := result.data["cache"]; ok {
                    combinedStats["cache"] = cache
                }
                combinedStats["user_service"] = result.data
                continue
            }
            combinedStats[result.key] = result.data
        }

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(combinedStats)
	})

	// --- 라우팅 등록 순서 수정 ---
	mux.HandleFunc("/lb-health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

	// 블로그 SPA 경로 프록시 (/blog 및 /blog/*)
	mux.HandleFunc("/blog", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/blog" {
			http.Redirect(w, r, "/blog/", http.StatusPermanentRedirect)
			return
		}
		blogProxy.ServeHTTP(w, r)
	})
	mux.Handle("/blog/", statsMiddleware(blogProxy))

	// API 및 기본 UI 라우팅
	mux.Handle("/api/", statsMiddleware(apiProxy))
	mux.Handle("/", statsMiddleware(uiProxy)) // 모든 요청을 통계 미들웨어로 감쌈

	log.Printf("Go Load Balancer (with Stats Aggregation) started on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}
