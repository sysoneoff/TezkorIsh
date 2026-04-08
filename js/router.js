// ═══════════════════════════════
// TezkorIsh — Router v2.0
// ═══════════════════════════════
'use strict';

const Router = (() => {
  const stack = [];
  const NAV_SCREENS = ['home', 'chats', 'post', 'profile'];
  const PROTECTED_SCREENS = ['home', 'chats', 'post', 'profile', 'detail', 'saved', 'admin', 'about', 'settings', 'contracts'];

  function isAuthed() {
    return !!(AppState.user && AppState.user.id && AppState.user.name && AppState.user.role);
  }

  function showNav(visible) {
    const allowed = visible && isAuthed();
    document.getElementById('bottom-nav').classList.toggle('hidden', !allowed);
    const sidebar = document.getElementById('desktop-sidebar');
    sidebar.classList.toggle('hidden', !allowed);
    sidebar.querySelectorAll('.sidebar-item, .sidebar-post-btn, .sidebar-user')
      .forEach(el => el.style.pointerEvents = allowed ? 'auto' : 'none');
  }

  function canAccess(id) {
    if (PROTECTED_SCREENS.includes(id) && !isAuthed()) return false;
    if (id === 'post') return AppState.user?.role === 'beruvchi';
    if (id === 'saved') return AppState.user?.role === 'ishchi';
    if (id === 'admin') return typeof Store?.isAdminUser === 'function' ? Store.isAdminUser(AppState.user) : false;
    return true;
  }

  function normalizeTarget(id) {
    const authScreens = ['onboarding', 'auth-telegram', 'auth-phone', 'auth-otp', 'auth-name'];
    if (authScreens.includes(id) && isAuthed()) {
      return 'home';
    }
    if (PROTECTED_SCREENS.includes(id) && !isAuthed()) {
      Toast.show("Avval ro‘yxatdan o‘ting.");
      return 'auth-telegram';
    }
    if (canAccess(id)) return id;
    if (id === 'post') Toast.show('Bu bo‘lim faqat ish beruvchilar uchun ochiq.');
    else if (id === 'saved') Toast.show('Saqlanganlar bo‘limi faqat ishchilar uchun ochiq.');
    else if (id === 'admin') Toast.show('Bu bo‘lim faqat admin uchun ochiq.');
    else Toast.show('Bu bo‘lim siz uchun yopiq.');
    return 'home';
  }

  function go(id, replace = false) {
    const target = normalizeTarget(id);
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active');
      s.classList.remove('slide-back');
    });

    const next = document.getElementById('screen-' + target);
    if (!next) return;

    next.classList.add('active');
    next.scrollTop = 0;

    if (replace && stack.length > 0) stack[stack.length - 1] = target;
    else stack.push(target);

    const isNavScreen = NAV_SCREENS.includes(target);
    showNav(isNavScreen);

    if (isNavScreen) {
      document.querySelectorAll('#bottom-nav .nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.screen === target);
      });
      document.querySelectorAll('#desktop-sidebar .sidebar-item').forEach(el => {
        el.classList.toggle('active', el.dataset.screen === target);
      });
    }

    if (target === 'home') {
      setTimeout(() => {
        if (!sessionStorage.getItem('pwa-dismissed')) PWA.maybeShowBanner();
      }, 1200);
    }

    if (target === 'auth-name') {
      setTimeout(() => {
        if (typeof syncAuthNameScreen === 'function') syncAuthNameScreen();
      }, 0);
    }
  }

  function back() {
    if (stack.length <= 1) {
      go('home', true);
      return;
    }
    stack.pop();
    const prev = stack[stack.length - 1] || 'home';
    go(prev, true);
  }

  function current() {
    return stack[stack.length - 1];
  }

  return { go, back, current, stack };
})();
