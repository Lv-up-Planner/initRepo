// Minimal frontend integration for MVP: login, register, profile, todos, complete
(function(){
  const apiBase = '/api';

  function apiFetch(path, opts={}){
    const token = sessionStorage.getItem('token');
    const headers = opts.headers || {};
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    if(token){ headers['Authorization'] = `Bearer ${token}`; }
    return fetch(path, {...opts, headers}).then(async res => {
      const text = await res.text();
      let json = null;
      try{ json = text ? JSON.parse(text) : null; }catch(e){ json = text; }
      if(!res.ok){ const err = json || {error: res.statusText}; throw err; }
      return json;
    });
  }

  // Login form
  const loginForm = document.querySelector('#login-form form') || document.querySelector('#login-form');
  if(loginForm){
    loginForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      try{
        const r = await apiFetch(`${apiBase}/login`, { method: 'POST', body: JSON.stringify({email, password}) });
                sessionStorage.setItem('token', r.token);
                if(r.user_id) sessionStorage.setItem('user_id', r.user_id);
        await loadProfile();
        showNav();
        showPage('page-dashboard');
      }catch(err){ console.error(err); alert(err.error || JSON.stringify(err)); }
    });
  }

  // Register form
  const regForm = document.querySelector('#register-form form') || document.querySelector('#register-form');
  if(regForm){
    regForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const email = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-password').value;
      const display_name = document.getElementById('reg-nickname').value;
      const genderEl = document.querySelector('#register-form input[name="gender"]:checked');
      const gender = genderEl ? genderEl.value : 'other';
      try{
        const r = await apiFetch(`${apiBase}/register`, { method: 'POST', body: JSON.stringify({email, password, display_name, gender}) });
                sessionStorage.setItem('token', r.token);
                if(r.user_id) sessionStorage.setItem('user_id', r.user_id);
        await loadProfile();
        showNav();
        showPage('page-dashboard');
      }catch(err){ console.error(err); alert(err.error || JSON.stringify(err)); }
    });
  }

  // Todo create
  const todoForm = document.querySelector('#page-dashboard form');
  if(todoForm){
    todoForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const title = document.getElementById('todo-title').value;
      const category = document.getElementById('todo-category').value || 'etc';
      const xp_reward = parseInt(document.getElementById('todo-xp').value || '10', 10);
      const due_date = document.getElementById('todo-due-date').value || null;
      try{
        await apiFetch(`${apiBase}/todos`, { method: 'POST', body: JSON.stringify({ title, description: '', category, xp_reward, due_date }) });
        await loadTodos();
        document.getElementById('todo-title').value = '';
      }catch(err){ console.error(err); alert(err.error || JSON.stringify(err)); }
    });
  }

  async function loadProfile(){
    try{
      const p = await apiFetch(`${apiBase}/profile/me`);
      // update UI
      const levelEl = document.getElementById('user-level');
      const nickEl = document.getElementById('user-nickname');
      const xpEl = document.getElementById('user-xp');
      const nextXpEl = document.getElementById('user-next-xp');
      const xpBar = document.getElementById('xp-bar');
      if(levelEl) levelEl.innerText = p.level;
      if(nickEl) nickEl.innerText = `${p.display_name} (${p.gender === 'male' ? '👨' : p.gender === 'female' ? '👩' : ''})`;
      if(xpEl) xpEl.innerText = p.current_xp;
      if(nextXpEl) nextXpEl.innerText = p.next_level_xp;
      if(xpBar && p.next_level_xp){
        const pct = Math.round((p.current_xp / p.next_level_xp) * 100);
        xpBar.style.width = (Math.max(0, Math.min(100, pct))) + '%';
      }
            // populate profile form fields if present
            try{
                const emailEl = document.getElementById('profile-email');
                const nickInput = document.getElementById('profile-nickname');
                const avatarInput = document.getElementById('profile-avatar');
                if(emailEl) emailEl.value = p.email || '';
                if(nickInput) nickInput.value = p.display_name || '';
                if(avatarInput) avatarInput.value = p.avatar_url || '';
                // set gender radio
                if(p.gender){
                    const g = p.gender;
                    const genderRadio = document.querySelectorAll('input[name="profile-gender"]');
                    if(genderRadio && genderRadio.length){
                        genderRadio.forEach(r => { if(r.value === g) r.checked = true; else r.checked = false; });
                    }
                }
                // store user_id for client use
                if(p.user_id) sessionStorage.setItem('user_id', p.user_id);
            }catch(e){ console.debug('populate profile form', e); }
    }catch(err){ console.debug('profile load error', err); }
  }

  async function loadTodos(){
    try{
      const list = await apiFetch(`${apiBase}/todos`);
      const ul = document.querySelector('#page-dashboard ul.space-y-4');
      if(!ul) return;
      ul.innerHTML = '';
      if(list.length === 0){ ul.innerHTML = '<li class="p-4 text-gray-600">오늘의 퀘스트가 없습니다.</li>'; return; }
      for(const t of list){
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200';
        const left = document.createElement('div');
        left.innerHTML = `<div><div class="flex items-center gap-2 mb-1"><span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-800">${t.category || ''}</span></div><span class="font-semibold text-gray-800">${escapeHtml(t.title)}</span><span class="text-sm text-blue-600 font-medium ml-2">+${t.xp_reward} XP</span></div>`;
        const right = document.createElement('div');
        right.className = 'flex space-x-2 flex-shrink-0';
        const completeBtn = document.createElement('button');
        completeBtn.className = 'bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-semibold hover:bg-blue-200';
        completeBtn.innerText = '완료';
        completeBtn.addEventListener('click', async ()=>{
          try{
            const res = await apiFetch(`${apiBase}/todos/${t.todo_id}/complete`, { method: 'POST' });
            await loadProfile();
            if(res.leveled){ triggerLevelFlash(); }
            await loadTodos();
          }catch(err){ console.error(err); alert(err.error || JSON.stringify(err)); }
        });
        const delBtn = document.createElement('button');
        delBtn.className = 'bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-sm font-semibold hover:bg-gray-200';
        delBtn.innerText = '삭제';
        delBtn.addEventListener('click', async ()=>{
          try{
            await apiFetch(`${apiBase}/todos/${t.todo_id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
            await loadTodos();
          }catch(err){ console.error(err); alert(err.error || JSON.stringify(err)); }
        });
        right.appendChild(completeBtn);
        right.appendChild(delBtn);
        li.appendChild(left);
        li.appendChild(right);
        ul.appendChild(li);
      }
    }catch(err){ console.error('loadTodos', err); }
  }

    // Leaderboard loader
    async function loadLeaderboard(){
        try{
            const list = await apiFetch(`${apiBase}/leaderboard`);
            const ul = document.getElementById('leaderboard-list');
            if(!ul) return;
            ul.innerHTML = '';
            const currentId = sessionStorage.getItem('user_id') || '';
            if(!list || list.length === 0){ ul.innerHTML = '<li class="p-4 text-gray-600">참가한 유저가 없습니다.</li>'; return; }
            for(const p of list){
                const li = document.createElement('li');
                li.className = 'flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200';
                const left = document.createElement('div');
                const isMe = (p.user_id === currentId);
                left.innerHTML = `<div class="flex items-center space-x-4"><span class="text-2xl font-bold">${p.rank <= 3 ? (p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : '🥉') : p.rank}</span><div><div class="font-bold text-lg text-gray-800">${escapeHtml(p.display_name)} ${p.gender === 'male' ? ' (👨)' : p.gender === 'female' ? ' (👩)' : ''} ${isMe ? '(나)' : ''}</div><div class="text-sm text-gray-600">Lv. ${p.level}</div></div></div>`;
                const right = document.createElement('div');
                right.className = 'text-lg font-semibold text-gray-700';
                right.innerText = `${p.current_xp} / ${p.next_level_xp} XP`;
                li.appendChild(left);
                li.appendChild(right);
                ul.appendChild(li);
            }
        }catch(err){ console.error('loadLeaderboard', err); }
    }

    // Load completed todos (for history page)
    async function loadCompletedTodos(){
        try{
            const list = await apiFetch(`${apiBase}/todos?include_completed=true`);
            const ul = document.querySelector('#page-history ul.space-y-4');
            if(!ul) return;
            ul.innerHTML = '';
            if(!list || list.length === 0){ ul.innerHTML = '<li class="p-4 text-gray-600">완료된 퀘스트가 없습니다.</li>'; return; }
            for(const t of list){
                if(!t.is_completed) continue;
                const li = document.createElement('li');
                li.className = 'flex items-center justify-between p-4 bg-gray-100 rounded-lg border border-gray-200 opacity-80';
                const left = document.createElement('div');
                const completedAt = t.completed_at ? new Date(t.completed_at).toLocaleString() : '';
                left.innerHTML = `<div><span class="font-semibold text-gray-600 line-through">${escapeHtml(t.title)}</span> <span class="text-sm text-blue-500 font-medium ml-2">+${t.xp_reward} XP</span> <span class="text-xs text-gray-500 ml-4">(완료: ${completedAt})</span></div>`;
                const right = document.createElement('div');
                right.className = 'flex space-x-2';
                const restoreForm = document.createElement('form'); restoreForm.onsubmit = async (e)=>{ e.preventDefault(); try{ await apiFetch(`${apiBase}/todos/${t.todo_id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: null, is_completed: 0, completed_at: null }) }); await loadCompletedTodos(); await loadTodos(); }catch(err){ alert(err.error || JSON.stringify(err)); } };
                const restoreBtn = document.createElement('button');
                restoreBtn.type='submit';
                restoreBtn.className = 'bg-gray-200 text-gray-700 px-3 py-1 rounded-full text-sm font-semibold hover:bg-gray-300';
                restoreBtn.innerText = '복구';
                restoreForm.appendChild(restoreBtn);
                right.appendChild(restoreForm);
                li.appendChild(left);
                li.appendChild(right);
                ul.appendChild(li);
            }
        }catch(err){ console.error('loadCompletedTodos', err); }
    }

  function escapeHtml(str){ return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function triggerLevelFlash(){
    const card = document.querySelector('#page-dashboard #user-nickname') || document.getElementById('user-nickname');
    if(!card) return;
    card.classList.add('level-up-flash');
    setTimeout(()=> card.classList.remove('level-up-flash'), 1500);
  }

  // if token exists, load profile & todos on startup
  document.addEventListener('DOMContentLoaded', async ()=>{
    if(sessionStorage.getItem('token')){
      try{ await loadProfile(); await loadTodos(); showNav(); }catch(e){ console.debug(e); }
    }
  });

  // expose for inline template scripts
        window.app = { loadProfile, loadTodos, loadCompletedTodos, loadLeaderboard, triggerLevelFlash };
})();
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

    // 인증 헬퍼
    const getToken = () => sessionStorage.getItem('authToken') || '';
    const getCurrentUser = () => sessionStorage.getItem('authUser') || '';
    const authHeader = () => {
        const token = getToken();
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    };

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
                sessionStorage.removeItem('authUser');
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
                // The backend expects { email, password } — map username -> email
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: username, password })
                });
                const data = await response.json().catch(() => ({}));
                if (response.ok) {
                    // store token under both keys for compatibility with other scripts
                    if (data.token) {
                        sessionStorage.setItem('token', data.token);
                        sessionStorage.setItem('authToken', data.token);
                    }
                    sessionStorage.setItem('authUser', data.username || username || data.user_id || '');
                    window.location.hash = '/';
                } else {
                    errorEl.textContent = data.error || (data.detail && (data.detail.error || JSON.stringify(data.detail))) || '로그인 실패';
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
                // Backend expects { email, password, display_name }
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password, display_name: username })
                });
                const data = await response.json().catch(() => ({}));
                if (response.ok) {
                    alert('회원가입 성공! 로그인 페이지로 이동합니다.');
                    window.location.hash = '/login';
                } else {
                    // FastAPI error handling
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
                if (getCurrentUser() !== post.author) { alert('작성자만 수정할 수 있습니다.'); window.location.hash = `#/posts/${id}`; return; }
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
            if (getToken() && getCurrentUser() === post.author) {
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
