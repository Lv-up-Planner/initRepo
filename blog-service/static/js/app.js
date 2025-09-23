document.addEventListener('DOMContentLoaded', () => {
    const mainContent = document.getElementById('main-content');
    const authStatus = document.getElementById('auth-status');

    // 홈 버튼 클릭 시 /blog/로 리다이렉트
    const bindHomeButton = () => {
        const homeBtn = document.getElementById('home-btn');
        if (homeBtn) {
            homeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                window.location.href = '/blog/';
            });
        }
    };
    bindHomeButton();

    // 라우터 설정
    const routes = {
        '/': 'post-list-template',
        '/login': 'login-template',
        '/signup': 'signup-template',
        '/posts/:id': 'post-detail-template',
        '/posts/new': 'post-form-template',
        '/posts/:id/edit': 'post-form-template'
    };

    // JWT helpers
    const getToken = () => sessionStorage.getItem('authToken') || '';
    const parseJwt = (t) => {
        try {
            const base = t.split('.')[1];
            const b = atob(base.replace(/-/g,'+').replace(/_/g,'/'));
            return JSON.parse(b);
        } catch { return null; }
    };
    const getUsernameFromToken = () => {
        const p = parseJwt(getToken());
        return (p && p.username) ? p.username : '';
    };
    const authHeader = () => ({ 'Authorization': `Bearer ${getToken()}` });

    const renderTemplate = (templateId, container) => {
        const template = document.getElementById(templateId);
        if (template) {
            container.innerHTML = '';
            container.appendChild(template.content.cloneNode(true));
        }
    };

    const router = async () => {
        const path = window.location.hash.slice(1) || '/';
        let view, params;

        if (path === '/posts/new') {
            view = routes['/posts/new'];
        } else if (path.startsWith('/posts/') && path.endsWith('/edit')) {
            view = routes['/posts/:id/edit'];
            params = { id: path.split('/')[2] };
        } else if (path.startsWith('/posts/')) {
            view = routes['/posts/:id'];
            params = { id: path.split('/')[2] };
        } else {
            view = routes[path];
        }

        if (view) {
            renderTemplate(view, mainContent);
            await activateView(path, params);
        }
    };

    // 라우팅 후 view 활성화 시 폼 로직 연결
    const activateView = async (path, params) => {
        updateAuthStatus();
        if (path === '/') {
            await loadPosts();
        } else if (path.startsWith('/posts/') && path.endsWith('/edit')) {
            await setupPostForm('edit', params.id);
        } else if (path === '/posts/new') {
            await setupPostForm('create');
        } else if (path.startsWith('/posts/')) {
            await loadPostDetail(params.id);
        } else if (path === '/login') {
            setupLoginForm();
        } else if (path === '/signup') {
            setupSignupForm();
        }
    };

    // 인증 관련
    const updateAuthStatus = () => {
        const token = sessionStorage.getItem('authToken');
        const homeBtn = document.getElementById('home-btn');
        if (token) {
            // 로그인 시: 홈(파랑), 글쓰기(흰), 로그아웃(파랑)
            if (homeBtn) { homeBtn.classList.remove('btn-outline'); homeBtn.classList.add('btn'); }
            authStatus.innerHTML = '<button class="btn-outline" id="new-post-btn">글쓰기</button><button class="btn" id="logout-btn">로그아웃</button>';
            const newBtn = document.getElementById('new-post-btn');
            if (newBtn) newBtn.addEventListener('click', () => { window.location.hash = '/posts/new'; });
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                sessionStorage.removeItem('authToken');
                window.location.href = '/blog/';
            });
        } else {
            // 비로그인 시: 홈(흰), 로그인(파랑)
            if (homeBtn) { homeBtn.classList.remove('btn'); homeBtn.classList.add('btn-outline'); }
            authStatus.innerHTML = '<button class="btn" id="login-btn">로그인</button>';
            const loginBtn = document.getElementById('login-btn');
            if (loginBtn) loginBtn.addEventListener('click', () => { window.location.hash = '/login'; });
        }
    };

    const setupLoginForm = () => {
        const form = document.getElementById('login-form');
        document.getElementById('go-to-signup').addEventListener('click', () => {
            window.location.hash = '/signup';
        });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const errorEl = document.getElementById('login-error');

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await response.json();
                if (response.ok) {
                    sessionStorage.setItem('authToken', data.token);
                    window.location.hash = '/';
                } else {
                    errorEl.textContent = data.error || '로그인 실패';
                }
            } catch (err) {
                errorEl.textContent = '서버와 통신할 수 없습니다.';
            }
        });
    };

    // 회원가입 폼 처리
    const setupSignupForm = () => {
        const form = document.getElementById('signup-form');
        document.getElementById('go-to-login').addEventListener('click', () => {
            window.location.hash = '/login';
        });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            // [수정] 회원가입 폼의 고유 ID를 사용
            const username = document.getElementById('signup-username').value;
            const email = document.getElementById('signup-email').value;
            const password = document.getElementById('signup-password').value;
            const errorEl = document.getElementById('signup-error');

            try {
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, email, password })
                });
                const data = await response.json();
                if (response.ok) {
                    alert('회원가입 성공! 로그인 페이지로 이동합니다.');
                    window.location.hash = '/login';
                } else {
                    // FastAPI 422 등의 detail 포맷 대응
                    if (data && data.detail) {
                        if (typeof data.detail === 'string') {
                            errorEl.textContent = data.detail;
                        } else if (Array.isArray(data.detail) && data.detail.length > 0) {
                            errorEl.textContent = (data.detail[0].msg || '유효하지 않은 입력');
                        } else if (data.error) {
                            errorEl.textContent = data.error;
                        } else {
                            errorEl.textContent = '회원가입 실패';
                        }
                    } else if (data && data.error) {
                        errorEl.textContent = data.error;
                    } else {
                        errorEl.textContent = '회원가입 실패';
                    }
                }
            } catch (err) {
                errorEl.textContent = '서버와 통신할 수 없습니다.';
            }
        });
    };

    // 글 작성/수정 폼 처리
    const setupPostForm = async (mode, id) => {
        const token = getToken();
        if (!token) { alert('로그인이 필요합니다.'); window.location.hash = '/login'; return; }
        const titleEl = document.getElementById('post-title');
        const contentEl = document.getElementById('post-content');
        const errorEl = document.getElementById('post-error');
        const h2 = document.getElementById('post-form-title');

        if (mode === 'edit') {
            h2.textContent = '글 수정';
            try {
                const res = await fetch(`/api/posts/${id}`);
                if (!res.ok) throw new Error('load failed');
                const post = await res.json();
                if (getUsernameFromToken() !== post.author) { alert('작성자만 수정할 수 있습니다.'); window.location.hash = `#/posts/${id}`; return; }
                titleEl.value = post.title;
                contentEl.value = post.content;
            } catch (_) { errorEl.textContent = '게시물을 불러오지 못했습니다.'; }
        } else {
            h2.textContent = '글 작성';
        }

        const cancelBtn = document.getElementById('post-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => window.history.back());

        document.getElementById('post-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            errorEl.textContent = '';
            const payload = { title: (titleEl.value || '').trim(), content: (contentEl.value || '').trim() };
            if (!payload.title || !payload.content) { errorEl.textContent = '제목/내용을 입력하세요.'; return; }
            try {
                let url = '/api/posts', method = 'POST';
                if (mode === 'edit') { url = `/api/posts/${id}`; method = 'PATCH'; }
                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json', ...authHeader() },
                    body: JSON.stringify(payload)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) { errorEl.textContent = (data.detail?.[0]?.msg || data.detail || data.error || '저장 실패'); return; }
                const postId = (mode === 'edit') ? id : data.id;
                window.location.hash = `#/posts/${postId}`;
            } catch (_) { errorEl.textContent = '서버와 통신할 수 없습니다.'; }
        });
    };

    // 데이터 로딩
    const loadPosts = async () => {
        try {
            const response = await fetch('/api/posts');
            if (!response.ok) throw new Error('Network response was not ok');
            const posts = await response.json();
            const container = document.getElementById('posts-container');
            container.innerHTML = '';
            posts.forEach(post => {
                const li = document.createElement('li');
                li.className = 'post-list-item';
                li.innerHTML = `
                    <div class="post-list-header">
                        <h3 class="post-title"><a href="#/posts/${post.id}">${post.title}</a></h3>
                        <span class="post-author">by ${post.author}</span>
                    </div>
                    <div class="post-excerpt">${(post.excerpt || '').replace(/</g, '&lt;')}</div>
                `;
                container.appendChild(li);
            });
        } catch (err) {
            console.error('게시물을 불러오는 데 실패했습니다.', err);
            const container = document.getElementById('posts-container');
            if(container) container.innerHTML = '<p>게시물을 불러오는 데 실패했습니다.</p>';
        }
    };

    const loadPostDetail = async (id) => {
        try {
            const response = await fetch(`/api/posts/${id}`);
            if (!response.ok) throw new Error('Network response was not ok');
            const post = await response.json();
            const container = document.getElementById('post-detail-container');
            container.innerHTML = `
                <div class="post-detail-header">
                    <div class="post-header-left">
                        <h2 class="post-title">${post.title}</h2>
                        <span class="meta">by ${post.author}</span>
                    </div>
                    <div class="post-actions" id="post-actions"></div>
                </div>
                <div class="content">${post.content.replace(/\n/g, '<br>')}</div>
            `;
            // 작성자에게만 수정/삭제 버튼 제공
            if (getToken() && getUsernameFromToken() === post.author) {
                const actions = document.getElementById('post-actions');
                actions.innerHTML = `
                    <button class="btn btn-outline" id="edit-post-btn">수정</button>
                    <button class="btn" id="delete-post-btn">삭제</button>
                `;
                document.getElementById('edit-post-btn').onclick = () => { window.location.hash = `#/posts/${post.id}/edit`; };
                document.getElementById('delete-post-btn').onclick = async () => {
                    if (!confirm('삭제하시겠습니까?')) return;
                    const res = await fetch(`/api/posts/${post.id}`, { method: 'DELETE', headers: authHeader() });
                    if (res.status === 204) { alert('삭제되었습니다.'); window.location.hash = '/'; }
                    else { alert('삭제 실패'); }
                };
            }
        } catch (err) {
            console.error('게시물 상세 정보를 불러오는 데 실패했습니다.', err);
            const container = document.getElementById('post-detail-container');
            if(container) container.innerHTML = '<p>게시물 정보를 불러올 수 없습니다.</p>';
        }
    };

    // 초기화
    window.addEventListener('hashchange', router);
    router();

});
