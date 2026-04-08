// ═══════════════════════════════
// TezkorIsh — App Logic v6.0
// real pilot web build v28
// ═══════════════════════════════
'use strict';

const Toast = (() => {
  let timer;
  const el = document.getElementById('toast');
  function show(msg, duration = 2400) {
    clearTimeout(timer);
    el.textContent = msg;
    el.classList.add('visible');
    timer = setTimeout(() => el.classList.remove('visible'), duration);
  }
  return { show };
})();

const PWA = (() => {
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
  });

  function maybeShowBanner() {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) return;
    const banner = document.getElementById('pwa-banner');
    if (deferredPrompt || isIOS) banner.classList.add('show');
  }

  function install() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(() => { deferredPrompt = null; });
    } else {
      Toast.show('Safari menyusidan “Add to Home Screen” tanlang.');
    }
    dismiss();
  }

  function dismiss() {
    document.getElementById('pwa-banner').classList.remove('show');
    sessionStorage.setItem('pwa-dismissed', '1');
  }

  return { maybeShowBanner, install, dismiss };
})();

const SYS_ONE = {
  company: 'SysOne',
  supportTelegram: 'https://t.me/SysOneTeam',
  channelTelegram: 'https://t.me/SysOneoff',
  email: 'sysoneoff@gmail.com',
  youtube: 'https://www.youtube.com/@SysOneOff',
  instagram: 'https://www.instagram.com/sysoneoff/',
  description: "SysOne — web va mobil ilovalar, avtomatlashtirish, CRM integratsiya va raqamli mahsulotlar yaratishga ixtisoslashgan IT kompaniya. TezkorIsh platformasi foydalanuvchilarga sodda, tez va ishonchli tajriba berishi uchun ishlab chiqilgan.",
};

const PILOT_CONFIG = window.TEZKOR_PILOT_CONFIG || {
  pilotMode: 'server',
  apiBaseUrl: '/api',
  allowLocalFallback: false,
  telegram: {
    botUsername: '',
    loginUrl: '',
    widgetCallbackUrl: '/api/auth/telegram/callback',
    deepLinkUrl: '',
    loginButtonText: 'Telegram orqali kirish',
    callbackKeys: {
      id: ['telegram_user_id', 'tg_user_id', 'id'],
      username: ['telegram_username', 'tg_username', 'username'],
      firstName: ['first_name', 'tg_first_name'],
      lastName: ['last_name', 'tg_last_name'],
      photoUrl: ['photo_url', 'tg_photo_url'],
      verified: ['tg_verified', 'telegram_verified']
    }
  }
};


function isServerPilotMode() {
  return String(PILOT_CONFIG?.pilotMode || '').toLowerCase() === 'server' && !isFileProtocol();
}

function getPilotApi(path = '') {
  const base = String(PILOT_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
  return `${base}${path}`;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(getPilotApi(path), {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `API xato (${response.status})`);
  }
  return payload;
}

const AuthAPI = {
  async bootstrap() {
    if (!isServerPilotMode()) return { authenticated: false, user: null, pendingTelegram: null };
    return apiRequest('/auth/bootstrap', { method: 'GET', headers: {} });
  },
  async saveProfile(payload) {
    return apiRequest('/auth/profile', { method: 'POST', body: JSON.stringify(payload) });
  },
  async logout() {
    if (!isServerPilotMode()) return { ok: true };
    return apiRequest('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  },
  async telegramConfig() {
    if (!isServerPilotMode()) return null;
    try {
      return await apiRequest('/auth/telegram/config', { method: 'GET', headers: {} });
    } catch {
      return null;
    }
  }
};


function getAppSettings() {
  return typeof Store?.getSettings === 'function'
    ? Store.getSettings()
    : { theme: 'sysone', preferredCats: [], nearbyRadiusKm: 10, workerLocation: null, workerAddress: '' };
}

function saveAppSettings(patch) {
  const next = typeof Store?.saveSettings === 'function'
    ? Store.saveSettings({ ...getAppSettings(), ...(patch || {}) })
    : { ...getAppSettings(), ...(patch || {}) };
  applyTheme(next.theme);
  return next;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', 'sysone');
}

function normalizeDisplayName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function getTelegramPilotConfig() {
  return PILOT_CONFIG?.telegram || {};
}

function getTelegramParam(params, keys = []) {
  for (const key of keys) {
    const value = params.get(key);
    if (value) return value;
  }
  return '';
}

function sanitizeTelegramHandle(value = '') {
  return String(value || '').trim().replace(/^@/, '');
}

function normalizeUzPhoneDigits(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('998')) digits = digits.slice(3);
  if (digits.length > 9) digits = digits.slice(-9);
  return digits;
}

function safeExternalUrl(raw, options = {}) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const allowedProtocols = Array.isArray(options.allowedProtocols) && options.allowedProtocols.length
    ? options.allowedProtocols
    : ['https:'];
  const allowedHosts = Array.isArray(options.allowedHosts) ? options.allowedHosts.map(h => String(h).toLowerCase()) : [];
  try {
    const url = new URL(value, window.location.origin);
    if (!allowedProtocols.includes(url.protocol)) return null;
    if (allowedHosts.length) {
      const host = String(url.hostname || '').toLowerCase();
      const ok = allowedHosts.some(allowed => host === allowed || host.endsWith('.' + allowed));
      if (!ok) return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}


function buildTelegramProfilePayloadFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const keys = getTelegramPilotConfig().callbackKeys || {};
  const telegramUserId = getTelegramParam(params, keys.id || ['telegram_user_id', 'tg_user_id', 'id']);
  if (!telegramUserId) return null;

  const firstName = getTelegramParam(params, keys.firstName || ['first_name']) || '';
  const lastName = getTelegramParam(params, keys.lastName || ['last_name']) || '';
  const username = sanitizeTelegramHandle(getTelegramParam(params, keys.username || ['username']) || '');
  const photoUrl = getTelegramParam(params, keys.photoUrl || ['photo_url']) || '';
  const verifiedRaw = getTelegramParam(params, keys.verified || ['tg_verified', 'telegram_verified']);
  const verified = ['1', 'true', 'yes', 'verified'].includes(String(verifiedRaw || '').toLowerCase()) || !!params.get('hash');
  const fullName = normalizeDisplayName(`${firstName} ${lastName}`) || params.get('name') || username || 'Telegram foydalanuvchi';
  return { telegramUserId, username, photoUrl, fullName, verified };
}

function clearTelegramParamsFromUrl() {
  const url = new URL(window.location.href);
  ['telegram_user_id','tg_user_id','id','first_name','last_name','username','telegram_username','tg_username','photo_url','tg_photo_url','tg_verified','telegram_verified','hash','auth_date','name'].forEach(key => url.searchParams.delete(key));
  window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : '') + url.hash);
}


let realtimeStarted = false;
let realtimeBusy = false;
let realtimeIntervalId = null;
let realtimeLastSignature = '';
let presenceIntervalId = null;
let authRedirectInProgress = false;

async function fetchRealtimeSignature() {
  try {
    if (isServerPilotMode()) {
      const response = await fetch(getPilotApi('/state/signature'), { credentials: 'include' });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.signature) return payload.signature;
      }
      return '';
    }
    const keys = [
      'tezkorish.user','tezkorish.users','tezkorish.jobs','tezkorish.applications','tezkorish.reports',
      'tezkorish.savedJobs','tezkorish.contracts','tezkorish.reviews','tezkorish.chats','tezkorish.settings'
    ];
    return keys.map(key => {
      const value = localStorage.getItem(key) || '';
      return `${key}:${value.length}:${value.slice(-32)}`;
    }).join('|');
  } catch {
    return '';
  }
}

function stopBackgroundServices() {
  if (realtimeIntervalId) clearInterval(realtimeIntervalId);
  if (presenceIntervalId) clearInterval(presenceIntervalId);
  realtimeIntervalId = null;
  presenceIntervalId = null;
  realtimeStarted = false;
  realtimeBusy = false;
  realtimeLastSignature = '';
}

function handleUnauthorizedState(reason = '') {
  if (authRedirectInProgress) return;
  authRedirectInProgress = true;
  try { stopBackgroundServices(); } catch {}
  try { Store.clearUser(); } catch {}
  AppState.user = null;
  clearUserUI();
  try { sessionStorage.removeItem('tezkorish.authenticated'); } catch {}
  if (reason) Toast.show(reason);
  Router.go('auth-telegram', true);
  setTimeout(() => { authRedirectInProgress = false; }, 800);
}

function startRealtimeRefresh() {
  if (realtimeStarted) return;
  realtimeStarted = true;

  const triggerRefresh = async (reason) => {
    if (realtimeBusy || !AppState.user || authRedirectInProgress) return;
    realtimeBusy = true;
    try {
      if (isServerPilotMode() && typeof Store?.syncRemoteMirror === 'function') {
        const syncState = await Store.syncRemoteMirror();
        if (syncState?.reason === 'unauthorized') {
          handleUnauthorizedState('Sessiya tugagan. Qaytadan Telegram orqali kiring.');
          return;
        }
      }
      const nextSig = await fetchRealtimeSignature();
      if (nextSig && nextSig !== realtimeLastSignature) {
        realtimeLastSignature = nextSig;
        refreshCurrentScreen(reason);
      } else {
        renderUserPresenceBadges();
      }
    } catch (err) {
      console.warn('realtime refresh error:', reason, err);
      if (String(err?.message || '').includes('Avval tizimga kiring') || String(err?.message || '').includes('(401)')) {
        handleUnauthorizedState('Sessiya tugagan. Qaytadan Telegram orqali kiring.');
      }
    } finally {
      realtimeBusy = false;
    }
  };

  window.addEventListener('storage', () => { triggerRefresh('storage-event'); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') triggerRefresh('visibility');
  });
  window.addEventListener('focus', () => { triggerRefresh('focus'); });

  realtimeIntervalId = setInterval(() => { triggerRefresh('interval'); }, isServerPilotMode() ? 15000 : 7000);
  triggerRefresh('initial');
}

function startPresenceHeartbeat() {
  if (presenceIntervalId) return;
  presenceIntervalId = setInterval(() => {
    try { updatePresence(); } catch (err) { console.warn('presence heartbeat error:', err); }
  }, 90000);
}

function updatePresence() {
  if (AppState.user && typeof Store?.touchUserPresence === 'function') {
    AppState.user = Store.touchUserPresence(AppState.user.id) || AppState.user;
    renderUserPresenceBadges();
  }
}

function startBackgroundServices() {
  if (!AppState.user) return;
  startPresenceHeartbeat();
  startRealtimeRefresh();
}

window.addEventListener('tezkorish:remote-unauthorized', () => {
  handleUnauthorizedState('Sessiya tugagan. Qaytadan Telegram orqali kiring.');
});

function escapeAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderUserPresenceBadges() {
  const totalEl = document.getElementById('user-count-total');
  const onlineEl = document.getElementById('user-count-online');
  if (!totalEl || !onlineEl || typeof Store?.getPresenceSummary !== 'function') return;
  const summary = Store.getPresenceSummary();
  totalEl.textContent = summary.total || 0;
  onlineEl.textContent = summary.online || 0;
}

function renderAvatar(containerId, user) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const name = String(user?.name || '?').trim();
  if (user?.avatar) {
    el.innerHTML = `<img src="${escapeAttr(user.avatar)}" alt="avatar" class="avatar-img">`;
  } else {
    el.textContent = (name[0] || '?').toUpperCase();
  }
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('reverse geocode failed');
    const data = await res.json();
    return data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

function parseJobCoords(job) {
  if (!job) return null;
  if (job.lat && job.lng) return { lat: Number(job.lat), lng: Number(job.lng) };
  const link = String(job.mapLink || '');
  const match = link.match(/([-+]?\d+\.\d+),\s*([-+]?\d+\.\d+)/);
  if (match) return { lat: Number(match[1]), lng: Number(match[2]) };
  return null;
}

function haversineKm(a, b) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildMapsLink(lat, lng) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function copyPhone(phone) {
  const digits = normalizeUzPhoneDigits(phone);
  if (!digits) return Toast.show('Telefon topilmadi.');
  const value = `+998${digits}`;
  navigator.clipboard?.writeText(value).then(() => Toast.show('Telefon nusxalandi.')).catch(() => Toast.show(value));
}

function openWhatsApp(phone, name = '') {
  const digits = normalizeUzPhoneDigits(phone);
  if (!digits) return Toast.show('Telefon topilmadi.');
  const text = encodeURIComponent(`Salom, ${name || 'siz'}! TezkorIsh orqali bog'lanmoqdaman.`);
  const url = `https://wa.me/998${digits}?text=${text}`;
  window.open(url, '_blank', 'noopener');
}

function openTelegramContact(handle) {
  const raw = String(handle || '').trim();
  if (!raw) return Toast.show('Telegram kontakti kiritilmagan.');
  const direct = raw.startsWith('http') ? raw : `https://t.me/${sanitizeTelegramHandle(raw)}`;
  const url = safeExternalUrl(direct, { allowedProtocols: ['https:'], allowedHosts: ['t.me', 'telegram.me'] });
  if (!url) return Toast.show('Telegram havolasi noto‘g‘ri.');
  window.open(url, '_blank', 'noopener');
}

function openMapForCurrentJob() {
  const job = Store.getJob(AppState.currentJobId);
  if (!job?.mapLink) return Toast.show('Xarita havolasi kiritilmagan.');
  const url = safeExternalUrl(job.mapLink, {
    allowedProtocols: ['https:'],
    allowedHosts: ['google.com', 'maps.google.com', 'www.google.com', 'goo.gl', 'maps.app.goo.gl', 'yandex.uz', 'yandex.com', 'yandex.ru']
  });
  if (!url) return Toast.show('Xarita havolasi noto‘g‘ri yoki qo‘llab-quvvatlanmaydi.');
  window.open(url, '_blank', 'noopener');
}

function duplicateCurrentJob() {
  if (!AppState.currentJobId || !AppState.user || typeof Store?.duplicateJob !== 'function') return;
  try {
    Store.duplicateJob(AppState.currentJobId, AppState.user.id);
    initHome();
    Toast.show('E’lon nusxalab yaratildi.');
    Router.go('chats');
  } catch (err) {
    Toast.show(err.message || 'Nusxa yaratishda xato.');
  }
}

function toggleHomeMatchedOnly() {
  AppState.homeFilter.matchedOnly = !AppState.homeFilter.matchedOnly;
  renderHomeQuickFilters();
  renderHomeRolePanel();
  renderJobs(getFilteredJobs());
}

function setHomePriceOrder(order) {
  AppState.homeFilter.priceOrder = AppState.homeFilter.priceOrder === order ? 'none' : order;
  renderHomeQuickFilters();
  renderJobs(getFilteredJobs());
}

function toggleHomeNearbyOnly() {
  const settings = getAppSettings();
  if (!settings.workerLocation) {
    Toast.show('Avval Sozlamalar ichida joriy joylashuvingizni saqlang.');
    openSettingsScreen();
    return;
  }
  AppState.homeFilter.nearbyOnly = !AppState.homeFilter.nearbyOnly;
  renderHomeQuickFilters();
  renderJobs(getFilteredJobs());
}

function renderHomeQuickFilters() {
  const wrap = document.getElementById('home-quick-filters');
  if (!wrap || !AppState.user) return;
  if (AppState.user.role !== 'ishchi') {
    wrap.innerHTML = '';
    return;
  }
  const settings = getAppSettings();
  wrap.innerHTML = `
    <button class="quick-filter-btn ${AppState.homeFilter.matchedOnly ? 'active' : ''}" onclick="toggleHomeMatchedOnly()">Menga mos</button>
    <button class="quick-filter-btn ${AppState.homeFilter.priceOrder === 'desc' ? 'active' : ''}" onclick="setHomePriceOrder('desc')">Narx yuqori</button>
    <button class="quick-filter-btn ${AppState.homeFilter.nearbyOnly ? 'active' : ''}" onclick="toggleHomeNearbyOnly()">Yaqin joylar</button>
    <span class="quick-filter-note">Mos toifalar: ${settings.preferredCats?.length ? settings.preferredCats.map(getCatName).join(', ') : 'tanlanmagan'}</span>
  `;
}

function openSettingsScreen() {
  renderSettingsScreen();
  Router.go('settings');
}

function setTheme(theme) {
  saveAppSettings({ theme });
  renderSettingsScreen();
  Toast.show('Mavzu yangilandi.');
}

function togglePreferredCat(cat) {
  const settings = getAppSettings();
  const set = new Set(settings.preferredCats || []);
  if (set.has(cat)) set.delete(cat); else set.add(cat);
  saveAppSettings({ preferredCats: Array.from(set) });
  renderSettingsScreen();
  renderHomeQuickFilters();
  renderJobs(getFilteredJobs());
}

function saveNearbyRadius(value) {
  const radius = Math.max(1, Math.min(100, Number(value || 10)));
  saveAppSettings({ nearbyRadiusKm: radius });
  renderSettingsScreen();
}

function detectWorkerLocation() {
  if (!navigator.geolocation) return Toast.show('Geolokatsiya brauzeringizda yoqilmagan.');
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = Number(pos.coords.latitude.toFixed(6));
    const lng = Number(pos.coords.longitude.toFixed(6));
    saveAppSettings({ workerLocation: { lat, lng }, workerAddress: `${lat}, ${lng}` });
    renderSettingsScreen();
    Toast.show('Joriy joylashuv saqlandi.');
  }, () => Toast.show('Joriy joylashuvni olib bo‘lmadi.'));
}

function clearWorkerLocation() {
  saveAppSettings({ workerLocation: null, workerAddress: '' });
  AppState.homeFilter.nearbyOnly = false;
  renderSettingsScreen();
  renderHomeQuickFilters();
  renderJobs(getFilteredJobs());
}

function renderSettingsScreen() {
  const body = document.getElementById('settings-body');
  if (!body) return;
  const settings = getAppSettings();
  body.innerHTML = `
    <div class="profile-section about-page-section">
      <div class="psec-title">Ilova mavzusi</div>
      <div class="settings-note">SysOne theme doimiy yoqilgan.</div>
    </div>
    <div class="profile-section about-page-section">
      <div class="psec-title">Ishchi filtrlari</div>
      <div class="support-faq-a">Menga mos ishlar filtrida shu toifalar ishlatiladi.</div>
      <div class="pref-cat-grid">${POST_CATEGORIES.map(c => `<button class="pref-cat-chip ${(settings.preferredCats || []).includes(c.id) ? 'active' : ''}" onclick="togglePreferredCat('${c.id}')">${c.icon} ${c.name}</button>`).join('')}</div>
      <div class="settings-location-box">
        <div><strong>Joriy joylashuv:</strong> ${settings.workerAddress ? escapeHtml(settings.workerAddress) : (settings.workerLocation ? `${settings.workerLocation.lat}, ${settings.workerLocation.lng}` : 'saqlanmagan')}</div>
        <div class="settings-action-row">
          <button class="mini-btn accept" onclick="detectWorkerLocation()">Joylashuvni olish</button>
          <button class="mini-btn" onclick="clearWorkerLocation()">Tozalash</button>
        </div>
        <label class="field-label mt-12">Yaqin joylar radiusi (km)</label>
        <input class="text-field" type="number" min="1" max="100" value="${settings.nearbyRadiusKm || 10}" onchange="saveNearbyRadius(this.value)">
      </div>
    </div>`;
}

function openContractsScreen() {
  renderContracts();
  Router.go('contracts');
}

function renderContracts() {
  const list = document.getElementById('contracts-list');
  if (!list || !AppState.user || typeof Store?.getContractsForUser !== 'function') return;
  const contracts = Store.getContractsForUser(AppState.user.id);
  list.innerHTML = contracts.length ? `<div class="activity-wrap">${contracts.map(contract => `
    <div class="activity-card">
      <div class="activity-card-head">
        <div>
          <div class="activity-card-title">${escapeHtml(contract.title)}</div>
          <div class="activity-card-sub">${escapeHtml(contract.employerName)} ↔ ${escapeHtml(contract.workerName)}</div>
        </div>
        <span class="activity-status ${contract.status}">${statusLabel(contract.status)}</span>
      </div>
      <div class="activity-meta">${escapeHtml(contract.location)} · ${contract.schedule ? escapeHtml(contract.schedule) : 'Jadval kiritilmagan'}</div>
      <div class="activity-actions">
        ${contract.mapLink ? `<button class="mini-btn" onclick="window.open('${escapeJsString(contract.mapLink)}','_blank','noopener')">Xarita</button>` : ''}
        <button class="mini-btn" onclick="copyPhone('${escapeJsString(contract.employerPhone || contract.workerPhone || '')}')">Telefon</button>
      </div>
    </div>`).join('')}</div>` : `<div class="empty-state"><div class="empty-icon"></div><div class="empty-title">Shartnomalar hali yo‘q</div><div class="empty-desc">Ishchi qabul qilinganda shartnoma arxivi shu yerda saqlanadi.</div></div>`;
}

function openReviewPrompt(contractId, toUserId) {
  const score = prompt('Bahoni kiriting (1 dan 5 gacha)', '5');
  if (!score) return;
  const text = prompt('Qisqa izoh (ixtiyoriy)', '');
  try {
    Store.submitReview({ contractId, toUserId, score: Number(score), text: text || '' });
    AppState.user = Store.loadUser();
    hydrateUserUI();
    initHome();
    Toast.show('Baho saqlandi.');
  } catch (err) {
    Toast.show(err.message || 'Bahoni saqlab bo‘lmadi.');
  }
}

function syncHelpCenterUI() {
  const about = document.getElementById('sysone-about-text');
  if (about) about.textContent = SYS_ONE.description;
  const versionText = SETTINGS.appVersion || 'demo';
  const version = document.getElementById('sysone-app-version');
  if (version) version.textContent = versionText;
  const badge = document.getElementById('about-version-badge');
  if (badge) badge.textContent = versionText;
  updateRuntimeNotes();
  updateOtpHint();
}

function getCatName(id) {
  return CATEGORIES.find(c => c.id === id)?.name || id;
}

function getCatIcon(id) {
  return '';
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function escapeJsString(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\"/g, '\\"')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ');
}


function isFileProtocol() {
  return window.location.protocol === 'file:';
}

function isLocalhostHost() {
  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function isSecureAppContext() {
  return window.isSecureContext || isLocalhostHost();
}

function canUseWorkerNotifications() {
  return !isFileProtocol() && isSecureAppContext() && 'Notification' in window;
}

function updateRuntimeNotes() {
  const note = document.getElementById('storage-runtime-note');
  if (!note) return;
  if (isFileProtocol()) {
    note.textContent = "Hozirgi build file:// rejimida ochilgan. Notification va service worker to‘liq ishlashi uchun localhost yoki https kerak bo‘ladi.";
    return;
  }
  if (!isSecureAppContext()) {
    note.textContent = "Hozirgi build xavfsiz bo‘lmagan muhitda ishlayapti. To‘liq push va service worker uchun localhost yoki https kerak.";
    return;
  }
  note.textContent = "Pilot build: productionda Telegram website login + backend verification kerak bo‘ladi. Hozircha ma'lumotlar lokal-first saqlanadi, shuning uchun zaxira eksportidan foydalaning.";
}

function updateOtpHint() {
  const hint = document.getElementById('otp-hint');
  if (!hint) return;
  const code = AppState.authDraft?.otpCode;
  hint.innerHTML = code
    ? `Lokal sinov kodi: <strong>${String(code).split('').join(' ')}</strong>`
    : 'Lokal sinov kodi shu yerda ko‘rinadi';
}

function formatRelative(ts) {
  const diffMin = Math.max(1, Math.floor((Date.now() - ts) / 60000));
  if (diffMin < 60) return `${diffMin} daqiqa`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `${hours} soat`;
  return `${Math.floor(hours / 24)} kun`;
}

function formatHoursLeft(expiresAt) {
  const diff = Math.max(0, expiresAt - Date.now());
  const hours = Math.ceil(diff / 3600000);
  if (hours < 24) return `${hours} soat qoldi`;
  const days = Math.ceil(hours / 24);
  return `${days} kun qoldi`;
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('ru-RU');
}

function statusLabel(status) {
  const map = {
    active: 'Aktiv',
    assigned: 'Biriktirildi',
    in_progress: 'Jarayonda',
    closed: 'Yopilgan',
    expired: 'Muddati tugagan',
    pending: 'Kutilmoqda',
    accepted: 'Qabul qilindi',
    completed: 'Bajarildi',
    rejected: 'Rad etildi',
    withdrawn: 'Bekor qilindi',
    job_closed: 'E’lon yopilgan',
    open: 'Ochiq',
    resolved: 'Ko‘rib chiqildi',
  };
  return map[status] || status;
}

let obIndex = 0;
let dutyPulseTimer = null;

function clearAuthDraft() {
  AppState.authDraft = {
    role: null,
    phoneDigits: '',
    otpVerified: false,
    otpCode: '',
    name: '',
    authMode: 'telegram',
    telegramVerified: false,
    telegramUserId: '',
    telegramUsername: '',
    telegramPhotoUrl: '',
  };
  const phoneInput = document.getElementById('phone-input');
  if (phoneInput) phoneInput.value = '';
  const profilePhoneInput = document.getElementById('profile-phone-input');
  if (profilePhoneInput) profilePhoneInput.value = '';
  const nameInput = document.getElementById('name-input');
  if (nameInput) nameInput.value = '';
  document.querySelectorAll('.otp-cell').forEach(cell => {
    cell.value = '';
    cell.classList.remove('filled');
  });
  document.getElementById('btn-phone-continue').disabled = true;
  document.getElementById('btn-otp-confirm').disabled = true;
  document.getElementById('btn-name-continue').disabled = true;
  updateOtpHint();
  document.getElementById('role-ishchi').classList.remove('selected');
  document.getElementById('role-beruvchi').classList.remove('selected');
}

function clearUserUI() {
  document.getElementById('home-username').textContent = "Do'st";
  document.getElementById('profile-name-text').textContent = "Ro'yxatdan o'ting";
  document.getElementById('profile-phone-text').textContent = 'Telefon raqam kiritilmagan';
  const pa=document.getElementById('profile-avatar-letter'); if (pa) { pa.textContent='?'; pa.innerHTML='?'; }
  document.getElementById('sidebar-user-name').textContent = 'Profil';
  document.getElementById('sidebar-user-role').textContent = 'Kirish kerak';
  document.getElementById('profile-role-text').textContent = 'Profil mavjud emas';
  const sa=document.getElementById('sidebar-avatar-letter'); if (sa) { sa.textContent='?'; sa.innerHTML='?'; }
  document.getElementById('desktop-sidebar').classList.add('hidden');
  document.querySelector('.sidebar-user')?.classList.add('guest');
  document.getElementById('saved-menu-item')?.classList.remove('is-hidden');
  document.getElementById('admin-menu-item')?.classList.add('is-hidden');
  document.getElementById('report-count-badge').textContent = '0';
  document.getElementById('saved-count-badge').textContent = '0';
  document.getElementById('home-start-btn')?.classList.add('is-hidden');
  const bottomNav = document.getElementById('bottom-nav');
  bottomNav?.classList.add('hidden');
  bottomNav?.classList.remove('role-worker', 'role-beruvchi');
}

function initSplash() {
  if (isServerPilotMode()) {
    AppState.user = null;
    try { Store.clearUser(); } catch {}
    clearUserUI();
    clearAuthDraft();
    setTimeout(() => Router.go('auth-telegram', true), 100);
    return;
  }
  const existingUser = Store.loadUser();
  if (existingUser && Store.isValidUser(existingUser)) {
    AppState.user = existingUser;
    setTimeout(() => {
      hydrateUserUI();
      initHome();
      Router.go('home', true);
    }, 900);
    return;
  }
  AppState.user = null;
  clearUserUI();
  clearAuthDraft();
  setTimeout(() => Router.go('onboarding'), 1200);
}


function obNext() {
  const track = document.querySelector('.ob-slides-track');
  const dots = document.querySelectorAll('.ob-dot');
  const btn = document.getElementById('ob-next-btn');
  if (obIndex < 2) {
    obIndex++;
    track.style.transform = `translateX(-${obIndex * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === obIndex));
    if (obIndex === 2) btn.textContent = 'Boshlash →';
  } else {
    Router.go('auth-telegram');
  }
}

function checkPhone() {
  const val = digitsOnly(document.getElementById('phone-input').value);
  document.getElementById('btn-phone-continue').disabled = val.length < 9;
}

function syncAuthNameScreen() {
  const nameInput = document.getElementById('name-input');
  const phoneInput = document.getElementById('profile-phone-input');
  if (!nameInput || !phoneInput) return;
  const savedName = AppState.authDraft?.name || '';
  const savedPhone = digitsOnly(AppState.authDraft?.phoneDigits || '');
  if (savedName && !nameInput.value) nameInput.value = savedName;
  if (savedPhone && !phoneInput.value) phoneInput.value = savedPhone;

  if (!AppState.authDraft?.role) {
    AppState.authDraft = { ...(AppState.authDraft || {}), role: 'ishchi' };
  }

  const note = document.getElementById('auth-identity-note');
  const sub = document.getElementById('auth-name-subheading');
  const isTelegram = AppState.authDraft?.authMode === 'telegram';
  if (note) {
    note.textContent = isTelegram
      ? 'Telefon raqam login uchun emas. Telegram akkaunt tasdiqlangach, bu raqam profil va bog‘lanish uchun saqlanadi.'
      : 'Bu lokal sinov rejimi. Production pilotda asosiy kirish Telegram orqali bo‘ladi.';
  }
  if (sub) {
    sub.textContent = isTelegram
      ? 'Telegram orqali kirish tasdiqlandi. Endi rol va aloqa ma’lumotlarini yakunlang.'
      : 'Sinov foydalanuvchisi uchun profil ma’lumotlarini yakunlang.';
  }

  document.getElementById('role-ishchi').classList.toggle('selected', AppState.authDraft.role === 'ishchi');
  document.getElementById('role-beruvchi').classList.toggle('selected', AppState.authDraft.role === 'beruvchi');
  applyAuthPrefillForRole(AppState.authDraft.role);
  checkName();
}

function getExistingTelegramProfiles() {
  const direct = Array.isArray(AppState.authDraft?.existingProfiles) ? AppState.authDraft.existingProfiles : [];
  if (direct.length) return direct;
  const telegramUserId = String(AppState.authDraft?.telegramUserId || '');
  if (!telegramUserId || typeof Store?.getUsersByTelegramId !== 'function') return [];
  return Store.getUsersByTelegramId(telegramUserId);
}

function applyAuthPrefillForRole(role, force = false) {
  const nameInput = document.getElementById('name-input');
  const phoneInput = document.getElementById('profile-phone-input');
  const targetRole = role || AppState.authDraft?.role || 'ishchi';
  const existing = getExistingTelegramProfiles().find(item => String(item.role || '') === String(targetRole));
  if (!nameInput || !phoneInput) return existing || null;
  const shouldFill = force || !nameInput.value.trim() || !phoneInput.value.trim() || AppState.authDraft?.prefilledRole !== targetRole;
  if (existing && shouldFill) {
    nameInput.value = existing.name || '';
    phoneInput.value = digitsOnly(existing.phoneDigits || existing.phone || '');
    AppState.authDraft = {
      ...(AppState.authDraft || {}),
      name: nameInput.value.trim(),
      phoneDigits: digitsOnly(phoneInput.value),
      prefilledRole: targetRole,
    };
  }
  if (!existing && force) {
    nameInput.value = AppState.authDraft?.telegramSuggestedName || AppState.authDraft?.name || '';
    phoneInput.value = '';
    AppState.authDraft = {
      ...(AppState.authDraft || {}),
      name: nameInput.value.trim(),
      phoneDigits: '',
      prefilledRole: targetRole,
    };
  }
  return existing || null;
}

function backFromNameScreen() {
  if (AppState.authDraft?.authMode === 'telegram') {
    Router.go('auth-telegram');
    return;
  }
  Router.go('auth-otp');
}

function startLocalPilotLogin() {
  if (!PILOT_CONFIG?.allowLocalFallback) {
    Toast.show('Bu buildda lokal login o‘chirilgan. Telegram auth ishlating.');
    return;
  }
  AppState.authDraft = {
    ...(AppState.authDraft || {}),
    authMode: 'local',
    telegramVerified: false,
    telegramUserId: '',
    telegramUsername: '',
    telegramPhotoUrl: '',
    phoneDigits: AppState.authDraft?.phoneDigits || '',
  };
  Router.go('auth-phone');
}

async function renderTelegramLoginOptions() {
  const cfg = getTelegramPilotConfig();
  const statusEl = document.getElementById('telegram-auth-status');
  const metaEl = document.getElementById('telegram-auth-meta');
  const widgetHost = document.getElementById('telegram-login-widget');
  const btn = document.getElementById('btn-telegram-login');
  const localCard = document.querySelector('.telegram-auth-card.muted');
  const btnWrap = btn?.closest('.telegram-auth-btn-wrap') || document.getElementById('telegram-auth-btn-wrap');
  if (!statusEl || !metaEl || !widgetHost || !btn) return;

  const allowLocal = Boolean(PILOT_CONFIG?.allowLocalFallback) && !isServerPilotMode();
  if (localCard) localCard.classList.toggle('is-hidden', !allowLocal);

  btn.textContent = cfg.loginButtonText || 'Telegram orqali kirish';
  btn.disabled = true;
  btn.classList.add('is-hidden');
  if (btnWrap) btnWrap.classList.add('is-hidden');
  widgetHost.innerHTML = '';
  statusEl.textContent = 'Telegram login sozlanmoqda...';
  metaEl.textContent = 'Konfiguratsiya tekshirilmoqda...';

  let liveCfg = null;
  if (isServerPilotMode()) {
    try {
      liveCfg = await AuthAPI.telegramConfig();
    } catch (error) {
      console.warn('Telegram config fetch failed:', error);
    }
  }
  const botUsername = cfg.botUsername || liveCfg?.botUsername || '';
  const widgetCallbackUrl = cfg.widgetCallbackUrl || liveCfg?.callbackUrl || '';
  const loginUrl = cfg.loginUrl || liveCfg?.loginUrl || '';
  const hasWidget = Boolean(botUsername && widgetCallbackUrl);
  const hasFallbackLogin = Boolean(loginUrl || cfg.deepLinkUrl || botUsername);

  if (hasWidget) {
    statusEl.textContent = `Telegram login tayyor: @${botUsername}`;
    metaEl.textContent = 'Telegram akkauntingiz orqali xavfsiz kirish mumkin. Widget chiqmasa, pastdagi tugmadan davom eting.';

    let widgetReady = false;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-auth-url', widgetCallbackUrl);
    script.setAttribute('data-request-access', 'write');
    script.onload = () => { widgetReady = true; };
    script.onerror = () => {
      statusEl.textContent = 'Telegram widget yuklanmadi';
      metaEl.textContent = 'Widget bloklangan yoki yuklanmadi. Pastdagi tugma bilan davom eting.';
      btn.disabled = false;
      btn.classList.remove('is-hidden');
      if (btnWrap) btnWrap.classList.remove('is-hidden');
    };
    widgetHost.appendChild(script);

    setTimeout(() => {
      const hasIframe = widgetHost.querySelector('iframe');
      if (!hasIframe) {
        btn.disabled = false;
        btn.classList.remove('is-hidden');
        if (btnWrap) btnWrap.classList.remove('is-hidden');
        if (!widgetReady) {
          statusEl.textContent = 'Telegram login tayyor';
          metaEl.textContent = 'Widget bloklangan bo‘lishi mumkin. Pastdagi tugma orqali davom eting.';
        }
      }
    }, 3500);
    return;
  }

  if (hasFallbackLogin) {
    statusEl.textContent = botUsername ? `Telegram login tayyor: @${botUsername}` : 'Telegram login tayyor';
    metaEl.textContent = 'Pastdagi tugma orqali Telegram login oynasini oching.';
    btn.disabled = false;
    btn.classList.remove('is-hidden');
    if (btnWrap) btnWrap.classList.remove('is-hidden');
    return;
  }

  statusEl.textContent = 'Telegram login hali sozlanmagan';
  metaEl.textContent = "Server konfiguratsiyasida TELEGRAM_BOT_USERNAME va login URL/callback yo'q. Render env va deployni tekshiring.";
}

async function startTelegramLogin() {
  const cfg = getTelegramPilotConfig();
  let liveCfg = null;
  if (isServerPilotMode()) {
    try { liveCfg = await AuthAPI.telegramConfig(); } catch {}
  }
  const loginUrl = cfg.loginUrl || liveCfg?.loginUrl || '';
  const deepLinkUrl = cfg.deepLinkUrl || '';
  const botUsername = cfg.botUsername || liveCfg?.botUsername || '';
  if (loginUrl) {
    window.location.href = loginUrl;
    return;
  }
  if (deepLinkUrl) {
    window.open(deepLinkUrl, '_blank', 'noopener');
    return;
  }
  if (botUsername) {
    window.open(`https://t.me/${sanitizeTelegramHandle(botUsername)}`, '_blank', 'noopener');
    return;
  }
  Toast.show('Telegram login sozlamasi topilmadi. Sahifani Ctrl+F5 bilan yangilang yoki admin deployni tekshirsin.');
}

function beginTelegramAuthProfileFlow(payload) {
  if (!payload?.telegramUserId) return false;
  const existing = typeof Store?.findUserByTelegramId === 'function' ? Store.findUserByTelegramId(payload.telegramUserId) : null;
  if (existing && typeof Store?.isValidUser === 'function' && Store.isValidUser(existing)) {
    AppState.user = Store.saveUser({
      ...existing,
      name: payload.fullName || existing.name,
      telegramUserId: payload.telegramUserId,
      telegramUsername: payload.username || existing.telegramUsername || '',
      telegramPhotoUrl: payload.photoUrl || existing.telegramPhotoUrl || '',
      avatar: existing.avatar || payload.photoUrl || existing.telegramPhotoUrl || '',
      authProvider: 'telegram',
    });
    try { sessionStorage.setItem('tezkorish.authenticated', '1'); } catch {}
    clearAuthDraft();
    hydrateUserUI();
    initHome();
    Router.go('home', true);
    Toast.show('Telegram profili orqali kirildi.');
    return true;
  }

  AppState.authDraft = {
    ...(AppState.authDraft || {}),
    authMode: 'telegram',
    telegramVerified: !!payload.verified,
    telegramUserId: String(payload.telegramUserId || ''),
    telegramUsername: sanitizeTelegramHandle(payload.username || ''),
    telegramPhotoUrl: payload.photoUrl || '',
    existingProfiles: Array.isArray(payload.existingProfiles) ? payload.existingProfiles : [],
    telegramSuggestedName: payload.fullName || AppState.authDraft?.name || '',
    name: payload.fullName || AppState.authDraft?.name || '',
    otpVerified: true,
  };
  const nameInput = document.getElementById('name-input');
  if (nameInput) nameInput.value = AppState.authDraft.name || '';
  const preview = document.getElementById('profile-edit-preview');
  if (preview && AppState.authDraft.telegramPhotoUrl) {
    preview.src = AppState.authDraft.telegramPhotoUrl;
  }
  syncAuthNameScreen();
  applyAuthPrefillForRole(AppState.authDraft?.role || 'ishchi', true);
  Router.go('auth-name', true);
  Toast.show(payload.verified ? 'Telegram tasdiqlandi. Profilni yakunlang.' : 'Telegram ma’lumoti olindi. Profilni yakunlang.');
  return true;
}

function handleTelegramCallbackFromUrl() {
  if (isServerPilotMode()) return false;
  const payload = buildTelegramProfilePayloadFromUrl();
  if (!payload) return false;
  clearTelegramParamsFromUrl();
  return beginTelegramAuthProfileFlow(payload);
}

async function bootstrapServerAuthSession() {
  if (!isServerPilotMode()) return false;
  try {
    const state = await AuthAPI.bootstrap();
    if (state?.authenticated && state.user) {
      AppState.user = state.user;
      if (typeof Store?.syncRemoteMirror === 'function') {
        try { await Store.syncRemoteMirror(); } catch (err) { console.warn('syncRemoteMirror bootstrap failed:', err); }
      }
      AppState.user = typeof Store?.loadUser === 'function' ? (Store.loadUser() || state.user) : state.user;
      try { sessionStorage.setItem('tezkorish.authenticated', '1'); } catch {}
      hydrateUserUI();
      Router.go('home', true);
      try {
        initHome();
        startBackgroundServices();
      } catch (err) {
        console.error('initHome after bootstrap failed:', err);
        Toast.show('Bosh sahifani yuklashda xato bo‘ldi. Sahifani yangilang.');
      }
      clearTelegramParamsFromUrl();
      return true;
    }
    if (state?.pendingTelegram && state.pendingTelegram.telegramUserId) {
      const fullName = normalizeDisplayName(`${state.pendingTelegram.firstName || ''} ${state.pendingTelegram.lastName || ''}`) || state.pendingTelegram.username || 'Telegram foydalanuvchi';
      try { Store.clearUser(); } catch {}
      AppState.user = null;
      clearUserUI();
      try { sessionStorage.removeItem('tezkorish.authenticated'); } catch {}
      beginTelegramAuthProfileFlow({
        telegramUserId: state.pendingTelegram.telegramUserId,
        username: state.pendingTelegram.username || '',
        photoUrl: state.pendingTelegram.photoUrl || '',
        fullName,
        existingProfiles: Array.isArray(state.pendingTelegram.existingProfiles) ? state.pendingTelegram.existingProfiles : [],
        verified: true,
      });
      clearTelegramParamsFromUrl();
      return true;
    }
    if (state?.pendingTelegram?.error) {
      try { sessionStorage.removeItem('tezkorish.authenticated'); } catch {}
      Toast.show(state.pendingTelegram.error);
      clearTelegramParamsFromUrl();
    }
  } catch (err) {
    console.warn('bootstrapServerAuthSession failed:', err);
    if (isServerPilotMode()) { try { Store.clearUser(); } catch {} AppState.user = null; clearUserUI(); }
  }
  try { Store.clearUser(); } catch {}
  AppState.user = null;
  clearUserUI();
  try { sessionStorage.removeItem('tezkorish.authenticated'); } catch {}
  return false;
}


function submitPhone() {
  const phone = digitsOnly(document.getElementById('phone-input').value);
  if (phone.length < 9) {
    Toast.show('Sinov telefon raqamini to‘liq kiriting.');
    return;
  }
  const otpCode = String(Math.floor(1000 + Math.random() * 9000));
  AppState.authDraft = {
    ...(AppState.authDraft || {}),
    phoneDigits: phone,
    otpVerified: false,
    otpCode,
  };
  document.getElementById('phone-input').value = phone;
  document.getElementById('otp-sub-text').textContent = `+998 ${phone.slice(0, 2)} *** ** ${phone.slice(-2)} lokal sinov kodi tayyorlandi`;
  updateOtpHint();
  Router.go('auth-otp');
  setTimeout(() => document.querySelector('.otp-cell')?.focus(), 300);
}

function otpKeyup(el, idx) {
  const val = el.value.replace(/\D/g, '');
  el.value = val ? val[0] : '';
  el.classList.toggle('filled', !!el.value);
  const cells = document.querySelectorAll('.otp-cell');
  if (el.value && idx < cells.length - 1) cells[idx + 1].focus();
  document.getElementById('btn-otp-confirm').disabled = !Array.from(cells).every(c => c.value);
}

function otpKeydown(e, idx) {
  const cells = document.querySelectorAll('.otp-cell');
  if (e.key === 'Backspace' && !cells[idx].value && idx > 0) cells[idx - 1].focus();
}

function submitOtp() {
  const code = Array.from(document.querySelectorAll('.otp-cell')).map(c => c.value).join('');
  const expectedCode = String(AppState.authDraft?.otpCode || '');
  if (!expectedCode || code !== expectedCode) {
    Toast.show('Sinov kodi noto‘g‘ri.');
    updateOtpHint();
    return;
  }
  AppState.authDraft = {
    ...(AppState.authDraft || {}),
    otpVerified: true,
  };
  Router.go('auth-name');
  setTimeout(() => {
    syncAuthNameScreen();
    document.getElementById('name-input')?.focus();
  }, 300);
}

function checkName() {
  const name = document.getElementById('name-input').value.trim();
  const phoneDigits = digitsOnly(document.getElementById('profile-phone-input')?.value || AppState.authDraft?.phoneDigits || '');
  AppState.authDraft = { ...(AppState.authDraft || {}), name, phoneDigits };
  const roleSelected = !!AppState.authDraft?.role;
  document.getElementById('btn-name-continue').disabled = name.length < 2 || phoneDigits.length < 9 || !roleSelected;
}

function selectRole(role) {
  AppState.authDraft = AppState.authDraft || {};
  AppState.authDraft.role = role;
  document.getElementById('role-ishchi').classList.toggle('selected', role === 'ishchi');
  document.getElementById('role-beruvchi').classList.toggle('selected', role === 'beruvchi');
  applyAuthPrefillForRole(role, true);
  checkName();
}

async function finishAuth() {
  const name = normalizeDisplayName(document.getElementById('name-input').value.trim());
  const phoneDigits = digitsOnly(document.getElementById('profile-phone-input')?.value || AppState.authDraft?.phoneDigits || '');
  const role = AppState.authDraft?.role || 'ishchi';
  const isTelegram = AppState.authDraft?.authMode === 'telegram';

  if (name.length < 2) {
    Toast.show('Ismni to‘liq kiriting.');
    return;
  }
  if (phoneDigits.length < 9) {
    Toast.show('Telefon raqamni to‘liq kiriting.');
    return;
  }
  if (isTelegram && !AppState.authDraft?.telegramUserId) {
    Toast.show('Telegram ma’lumoti topilmadi. Qaytadan kirib ko‘ring.');
    Router.go('auth-telegram');
    return;
  }
  if (!isTelegram && !AppState.authDraft?.otpVerified) {
    Toast.show('Avval sinov kodini tasdiqlang.');
    Router.go('auth-otp');
    return;
  }

  if (isServerPilotMode() && isTelegram) {
    try {
      const payload = {
        name,
        phoneDigits,
        role,
        avatar: AppState.authDraft?.telegramPhotoUrl || '',
      };
      const result = await AuthAPI.saveProfile(payload);
      if (typeof Store?.syncRemoteMirror === 'function') {
        try { await Store.syncRemoteMirror(); } catch (err) { console.warn('syncRemoteMirror saveProfile failed:', err); }
      }
      AppState.user = typeof Store?.loadUser === 'function' ? (Store.loadUser() || result.user) : result.user;
      clearAuthDraft();
      hydrateUserUI();
      initHome();
      startBackgroundServices();
      Router.go('home', true);
      Toast.show(role === 'beruvchi' ? 'Ish beruvchi profili yaratildi.' : 'Ishchi profili yaratildi.');
      return;
    } catch (err) {
      Toast.show(err.message || 'Profilni saqlashda xato.');
      return;
    }
  }

  const existingByTelegram = isTelegram && typeof Store?.findUserByTelegramIdRole === 'function'
    ? Store.findUserByTelegramIdRole(AppState.authDraft.telegramUserId, role)
    : (isTelegram && typeof Store?.findUserByTelegramId === 'function' ? Store.findUserByTelegramId(AppState.authDraft.telegramUserId) : null);
  const existing = existingByTelegram || null;

  const user = existing ? {
    ...existing,
    name,
    phoneDigits,
    phone: '+998 ' + phoneDigits,
    role,
    district: SETTINGS.district,
    telegramUserId: isTelegram ? String(AppState.authDraft.telegramUserId || existing.telegramUserId || '') : String(existing.telegramUserId || ''),
    telegramUsername: isTelegram ? sanitizeTelegramHandle(AppState.authDraft.telegramUsername || existing.telegramUsername || '') : String(existing.telegramUsername || ''),
    telegramPhotoUrl: isTelegram ? String(AppState.authDraft.telegramPhotoUrl || existing.telegramPhotoUrl || '') : String(existing.telegramPhotoUrl || ''),
    avatar: existing.avatar || (isTelegram ? String(AppState.authDraft.telegramPhotoUrl || '') : ''),
    authProvider: isTelegram ? 'telegram' : 'local',
    availability: {
      ...(existing.availability || {}),
      onDuty: false,
      lastShiftStartedAt: null,
      lastSeenJobAt: existing.availability?.lastSeenJobAt || 0,
    },
  } : {
    id: 'u-' + Date.now(),
    name,
    phoneDigits,
    phone: '+998 ' + phoneDigits,
    role,
    rating: 0,
    completedJobs: 0,
    district: SETTINGS.district,
    telegramUserId: isTelegram ? String(AppState.authDraft.telegramUserId || '') : '',
    telegramUsername: isTelegram ? sanitizeTelegramHandle(AppState.authDraft.telegramUsername || '') : '',
    telegramPhotoUrl: isTelegram ? String(AppState.authDraft.telegramPhotoUrl || '') : '',
    avatar: isTelegram ? String(AppState.authDraft.telegramPhotoUrl || '') : '',
    authProvider: isTelegram ? 'telegram' : 'local',
    availability: {
      onDuty: false,
      lastShiftStartedAt: null,
      lastSeenJobAt: 0,
    },
  };

  AppState.user = Store.saveUser(user);
  clearAuthDraft();
  hydrateUserUI();
  initHome();
  Router.go('home', true);
  Toast.show(existing
    ? (role === 'beruvchi' ? 'Ish beruvchi profili qayta ochildi.' : 'Ishchi profili qayta ochildi.')
    : (role === 'beruvchi' ? 'Ish beruvchi profili ochildi.' : 'Ishchi profili ochildi.'));
}

function hydrateUserUI() {
  const user = AppState.user;
  if (!user) return;
  const fullName = normalizeDisplayName(user.name);
  document.getElementById('home-username').textContent = fullName;
  document.getElementById('profile-name-text').textContent = fullName;
  document.getElementById('profile-phone-text').textContent = user.phone;
  renderAvatar('profile-avatar-letter', user);
  document.getElementById('sidebar-user-name').textContent = fullName;
  document.getElementById('sidebar-user-role').textContent = user.role === 'ishchi' ? 'Ishchi' : 'Ish beruvchi';
  document.getElementById('profile-role-text').textContent = user.role === 'ishchi' ? 'Ishchi' : 'Ish beruvchi';
  renderAvatar('sidebar-avatar-letter', user);
  document.querySelector('.sidebar-user')?.classList.remove('guest');
  document.getElementById('desktop-sidebar')?.classList.remove('hidden');
  updatePresence();
  const bottomNav = document.getElementById('bottom-nav');
  bottomNav?.classList.remove('hidden');
  bottomNav?.classList.remove('role-worker', 'role-beruvchi');
  bottomNav?.classList.add(user.role === 'beruvchi' ? 'role-beruvchi' : 'role-worker');
  const postPhone = document.getElementById('post-phone');
  if (postPhone) postPhone.value = user.phoneDigits || '';
  updateRoleVisibility();
  updateProfileStats();
}

function updateRoleVisibility() {
  if (!AppState.user) {
    clearUserUI();
    return;
  }
  const isEmployer = AppState.user?.role === 'beruvchi';
  const isAdmin = typeof Store?.isAdminUser === 'function' ? Store.isAdminUser(AppState.user) : false;
  document.querySelectorAll('[data-role-only="beruvchi"]').forEach(el => {
    el.classList.toggle('is-hidden', !isEmployer);
  });
  document.getElementById('saved-menu-item')?.classList.toggle('is-hidden', isEmployer);
  document.getElementById('admin-menu-item')?.classList.toggle('is-hidden', !isAdmin);

  document.getElementById('profile-primary-action-text').textContent = isEmployer ? "Mening e'lonlarim" : 'Mening murojaatlarim';
  document.getElementById('profile-jobs-label').textContent = isEmployer ? "E'lonlar" : 'Murojaatlar';
  document.getElementById('activity-title').textContent = isEmployer ? "E'lonlar va nomzodlar" : 'Mening murojaatlarim';
  const homeStartBtn = document.getElementById('home-start-btn');
  if (homeStartBtn) {
    if (!isEmployer) {
      homeStartBtn.classList.remove('is-hidden');
      homeStartBtn.textContent = AppState.user?.availability?.onDuty ? "Ishni to'xtatish" : 'Ish qidirishni boshlash';
      homeStartBtn.classList.toggle('danger', !!AppState.user?.availability?.onDuty);
    } else {
      homeStartBtn.classList.add('is-hidden');
    }
  }

  const oldNote = document.getElementById('home-role-note');
  if (oldNote) oldNote.remove();
  const note = document.createElement('div');
  note.id = 'home-role-note';
  note.className = 'note-chip';
  note.textContent = isEmployer
    ? "Ish beruvchi uchun bosh sahifada faqat siz joylagan e'lonlar ko'rinadi. Yangi e'lon qo'shish uchun chap menyudagi yoki pastdagi E'lon berish bo'limidan foydalaning."
    : 'Ishchi uchun barcha ochiq vakantlar ko‘rinadi. Ish qidirish rejimi yoqilganda yangi vakantlar haqida bildirishnoma keladi.';
  const homeScreen = document.getElementById('screen-home');
  const firstSectionHead = document.querySelector('#screen-home .section-head');
  if (homeScreen) {
    if (firstSectionHead) homeScreen.insertBefore(note, firstSectionHead);
    else homeScreen.appendChild(note);
  }
  syncWorkerDutyUI();
}


function saveCurrentUser() {
  if (!AppState.user) return;
  AppState.user = Store.saveUser(AppState.user);
}

async function requestWebNotifications() {
  if (!canUseWorkerNotifications()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch {
    return false;
  }
}

async function showLocalVacancyNotification(jobs) {
  try {
    if (!Array.isArray(jobs) || !jobs.length || !canUseWorkerNotifications()) return;
    const latest = jobs[0];
    const text = jobs.length === 1
      ? `${latest.title} · ${latest.location}`
      : `${jobs.length} ta yangi vakant bor. Eng so‘nggisi: ${latest.title}`;

    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && Notification.permission === 'granted' && typeof reg.showNotification === 'function') {
        await reg.showNotification('TezkorIsh — yangi vakant', {
          body: text,
          icon: 'icons/icon-192.png',
          badge: 'icons/icon-192.png',
          tag: 'tezkorish-new-job',
        });
        return;
      }
    }
    if (Notification.permission === 'granted') {
      new Notification('TezkorIsh — yangi vakant', { body: text, icon: 'icons/icon-192.png' });
    }
  } catch (err) {
    console.warn('Vacancy notification skipped:', err);
  }
}

function renderWorkerDutyCard() {
  syncWorkerDutyUI();
}

function syncWorkerDutyUI() {
  if (!AppState.user || AppState.user.role !== 'ishchi') {
    const hz = document.getElementById('home-duty-zone');
    const pz = document.getElementById('profile-duty-zone');
    const az = document.getElementById('activity-top-zone');
    if (hz) hz.innerHTML = '';
    if (pz) pz.innerHTML = '';
    if (az) az.innerHTML = '';
    if (dutyPulseTimer) clearInterval(dutyPulseTimer);
    dutyPulseTimer = null;
    return;
  }

  const onDuty = !!AppState.user.availability?.onDuty;
  const newestJobs = Store.getNewJobsSince(AppState.user.availability?.lastSeenJobAt || 0);
  const newCount = newestJobs.length;
  const dutyHtml = `
    <div class="duty-card ${onDuty ? 'compact' : ''}">
      <div class="duty-card-top">
        <div>
          <div class="duty-card-title">${onDuty ? 'Siz hozir ish qidirish rejimidasiz' : 'Ishga chiqish rejimi o‘chiq'}</div>
          <div class="duty-card-sub">${onDuty ? 'Yangi vakantlar paydo bo‘lsa belgicha va lokal xabar ko‘rsatiladi. localhost/https rejimi tavsiya etiladi.' : 'Start tugmasi yoqilganda tizim yangi vakantlarni kuzatadi. file:// rejimida xabarlar cheklangan bo‘lishi mumkin.'}</div>
        </div>
        <div class="duty-status-pill ${onDuty ? 'live' : ''}">${onDuty ? 'Faol' : 'Kutilmoqda'}</div>
      </div>
      <div class="duty-actions">
        <button class="btn-soft ${onDuty ? 'danger' : ''}" onclick="toggleWorkerDuty()">${onDuty ? 'Ishni to‘xtatish' : 'Ishga chiqdim'}</button>
      </div>
      <div class="mini-note">
        <span class="meta-tag">${Store.getPublicFeedJobs().length} ta ochiq vakant</span>
        <span class="meta-tag">${newCount} ta yangi</span>
      </div>
    </div>`;

  const homeZone = document.getElementById('home-duty-zone');
  const profileZone = document.getElementById('profile-duty-zone');
  const activityZone = document.getElementById('activity-top-zone');
  if (homeZone) homeZone.innerHTML = dutyHtml;
  if (profileZone) profileZone.innerHTML = dutyHtml;
  if (activityZone) {
    activityZone.innerHTML = onDuty
      ? `<div class="activity-focus-banner"><div class="activity-focus-title">Yangi vakant kuzatuvi yoqilgan</div><div class="activity-focus-sub">Start rejimi ishlayapti. Feed’da faqat ochiq va ishlatilmagan vakantlar ko‘rinadi.</div></div>`
      : '';
  }

  if (dutyPulseTimer) clearInterval(dutyPulseTimer);
  if (onDuty) {
    dutyPulseTimer = setInterval(() => {
      checkDutyVacancyPulse().catch(err => console.error('Duty pulse interval error:', err));
    }, 15000);
  } else {
    dutyPulseTimer = null;
  }
}

async function toggleWorkerDuty() {
  if (!AppState.user || AppState.user.role !== 'ishchi') return;
  const next = !AppState.user.availability?.onDuty;
  AppState.user.availability = AppState.user.availability || {};
  AppState.user.availability.onDuty = next;
  AppState.user.availability.lastShiftStartedAt = next ? Date.now() : null;
  AppState.user.availability.lastSeenJobAt = Date.now();
  saveCurrentUser();
  if (next) {
    const granted = await requestWebNotifications();
    Toast.show(granted || !canUseWorkerNotifications()
      ? 'Ishga chiqish rejimi yoqildi. Endi yangi vakantlar kuzatiladi.'
      : 'Ishga chiqish rejimi yoqildi. Bildirishnoma ruxsati berilmagan, lekin feed kuzatuvi ishlaydi.');
  } else {
    Toast.show('Ishga chiqish rejimi o‘chirildi.');
  }
  initHome();
}

async function checkDutyVacancyPulse() {
  try {
    if (!AppState.user || AppState.user.role !== 'ishchi' || !AppState.user.availability?.onDuty) return;
    const lastSeen = Number(AppState.user.availability?.lastSeenJobAt || 0);
    const newJobs = Store.getNewJobsSince(lastSeen);
    if (!Array.isArray(newJobs) || !newJobs.length) return;
    AppState.user.availability.lastSeenJobAt = Math.max(lastSeen, ...newJobs.map(j => Number(j.createdAt || 0)));
    saveCurrentUser();
    updateNotificationBadge();
    await showLocalVacancyNotification(newJobs.slice(0, 3));
    const feed = document.getElementById('jobs-feed');
    if (feed) renderJobs(getFilteredJobs());
  } catch (err) {
    console.error('checkDutyVacancyPulse error:', err);
  }
}

function initHome() {
  if (typeof Store?.ensureSeeded === 'function') {
    try { Store.ensureSeeded(); } catch (err) { console.warn('ensureSeeded in initHome failed:', err); }
  }
  startBackgroundServices();
  renderCategories();
  renderHomeQuickFilters();
  renderJobs(getFilteredJobs());
  AppState.homeLastRefreshAt = Date.now();
  renderActivity();
  renderSavedJobs();
  renderAdmin();
  updateHomeStats();
  updateProfileStats();
  updateNotificationBadge();
  syncWorkerDutyUI();
  checkDutyVacancyPulse().catch(err => console.error('initHome duty pulse error:', err));
}

function handleSearch(value) {
  AppState.searchQuery = String(value || '').trim().toLowerCase();
  renderJobs(getFilteredJobs());
}

function refreshHomeJobs(showToast = false) {
  const refreshBtn = document.getElementById('home-refresh-btn');
  const previousIds = Array.isArray(AppState.homeVisibleJobIds) ? [...AppState.homeVisibleJobIds] : [];
  if (refreshBtn) {
    refreshBtn.classList.add('is-loading');
    refreshBtn.textContent = 'Yangilanmoqda';
  }

  window.setTimeout(() => {
    const jobs = getFilteredJobs();
    renderJobs(jobs);
    updateHomeStats();
    updateNotificationBadge();
    const nextIds = jobs.map(j => String(j.id));
    const newCount = nextIds.filter(id => !previousIds.includes(id)).length;
    AppState.homeLastRefreshAt = Date.now();

    if (refreshBtn) {
      refreshBtn.classList.remove('is-loading');
      refreshBtn.textContent = '⟳ Reflesh';
    }

    if (showToast) {
      if (newCount > 0) {
        Toast.show(`${newCount} ta yangi e'lon topildi`);
      } else {
        Toast.show(`Faol e'lonlar yangilandi`);
      }
    }
  }, 220);
}

function getFilteredJobs() {
  let jobs = AppState.user?.role === 'beruvchi'
    ? Store.getEmployerHomeJobs(AppState.user.id)
    : Store.getPublicFeedJobs();
  if (AppState.user?.role === 'beruvchi' && AppState.homeFilter?.employerStatus && AppState.homeFilter.employerStatus !== 'all') {
    jobs = jobs.filter(j => j.status === AppState.homeFilter.employerStatus);
  }
  if (AppState.selectedCat !== 'hammasi') {
    jobs = jobs.filter(j => j.cat === AppState.selectedCat);
  }
  if (AppState.searchQuery) {
    jobs = jobs.filter(j => [j.title, j.desc, j.location, j.phone || '', j.schedule || '', j.telegram || '', getCatName(j.cat)].join(' ').toLowerCase().includes(AppState.searchQuery));
  }
  if (AppState.user?.role === 'ishchi') {
    const settings = getAppSettings();
    if (AppState.homeFilter.matchedOnly && Array.isArray(settings.preferredCats) && settings.preferredCats.length) {
      jobs = jobs.filter(j => settings.preferredCats.includes(j.cat));
    }
    if (AppState.homeFilter.nearbyOnly && settings.workerLocation) {
      jobs = jobs.filter(j => {
        const coords = parseJobCoords(j);
        if (!coords) return false;
        return haversineKm(settings.workerLocation, coords) <= Number(settings.nearbyRadiusKm || 10);
      });
    }
    if (AppState.homeFilter.priceOrder === 'desc') jobs = jobs.slice().sort((a,b)=>Number(b.price||0)-Number(a.price||0));
    if (AppState.homeFilter.priceOrder === 'asc') jobs = jobs.slice().sort((a,b)=>Number(a.price||0)-Number(b.price||0));
  }
  return jobs;
}


function renderHomeRolePanel() {
  const zone = document.getElementById('home-duty-zone');
  if (!zone || !AppState.user) return;
  if (AppState.user.role === 'beruvchi') {
    const myJobs = typeof Store?.getMyJobs === 'function' ? Store.getMyJobs(AppState.user.id) : [];
    const activeCount = myJobs.filter(job => ['active', 'assigned', 'in_progress'].includes(job.status)).length;
    const archivedCount = myJobs.filter(job => ['closed', 'expired'].includes(job.status)).length;
    zone.innerHTML = `
      <div class="role-panel role-panel-employer">
        <div>
          <div class="role-panel-title">Ish beruvchi boshqaruvi</div>
          <div class="role-panel-desc">Yangi e'lon joylashtirish, faol e'lonlarni kuzatish va nomzodlarni boshqarish shu bo'limdan amalga oshiriladi.</div>
        </div>
        <div class="role-panel-metrics">
          <div class="role-panel-metric"><strong>${activeCount}</strong><span>Faol</span></div>
          <div class="role-panel-metric"><strong>${archivedCount}</strong><span>Arxiv</span></div>
        </div>
        <div class="role-panel-actions">
          <button class="btn-primary" type="button" onclick="Router.go('post')">E'lon berish</button>
          <button class="btn-outline" type="button" onclick="Router.go('chats')">Nomzodlarni ko'rish</button>
        </div>
      </div>`;
    return;
  }
  syncWorkerDutyUI();
}

function renderCategories() {
  const wrap = document.getElementById('cats-scroll');
  wrap.innerHTML = CATEGORIES.map(c => `
    <button class="cat-chip ${c.id === AppState.selectedCat ? 'active' : ''}" data-cat="${c.id}" onclick="filterCat('${c.id}', this)">
      <span class="cat-chip-icon">${c.icon}</span>
      <span class="cat-chip-name">${c.name}</span>
    </button>
  `).join('');
}

function filterCat(catId, el) {
  AppState.selectedCat = catId;
  document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderJobs(getFilteredJobs());
}

function renderJobs(jobs) {
  const feed = document.getElementById('jobs-feed');
  const isEmployerView = AppState.user?.role === 'beruvchi';
  const titleEl = document.getElementById('home-jobs-title');
  const moreBtn = document.querySelector('#screen-home .section-more');
  if (titleEl) titleEl.textContent = isEmployerView ? "Mening e'lonlarim" : "So'nggi e'lonlar";
  const employerTabs = document.getElementById('home-employer-tabs');
  if (employerTabs) {
    employerTabs.innerHTML = isEmployerView ? ['all','active','assigned','in_progress','closed','expired'].map(st => `<button class="quick-filter-btn ${AppState.homeFilter.employerStatus === st ? 'active' : ''}" onclick="setEmployerHomeStatus('${st}')">${st === 'all' ? 'Hammasi' : statusLabel(st)}</button>`).join('') : '';
  }
  if (moreBtn) moreBtn.textContent = isEmployerView ? 'Arxiv bilan' : 'Barchasi';
  if (!jobs.length) {
    AppState.homeVisibleJobIds = [];
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"></div>
        <div class="empty-title">${isEmployerView ? "Sizda hali e'lon yo'q" : "Mos ochiq e'lon topilmadi"}</div>
        <div class="empty-desc">${isEmployerView ? "Faqat o'zingiz joylagan faol va arxiv e'lonlar shu yerda ko'rinadi" : "Eski, yopilgan yoki ishlatilgan e'lonlar feed'da ko‘rsatilmaydi"}</div>
      </div>`;
    return;
  }

  AppState.homeVisibleJobIds = jobs.map(j => String(j.id));
  feed.innerHTML = jobs.map((j, i) => {
    const applicantCount = Store.getApplicationsForJob(j.id).filter(app => app.status === 'pending').length;
    const mine = AppState.user?.role === 'ishchi' ? Store.getMyApplicationForJob(j.id, AppState.user.id) : null;
    const saved = AppState.user?.role === 'ishchi' ? Store.isJobSaved(j.id, AppState.user.id) : false;
    const fresh = Date.now() - j.createdAt < 2 * 60 * 60 * 1000;
    const coords = parseJobCoords(j);
    const settings = getAppSettings();
    const distance = AppState.user?.role === 'ishchi' && coords && settings.workerLocation ? haversineKm(settings.workerLocation, coords).toFixed(1) : null;
    return `
      <div class="job-card" style="animation-delay:${i * 0.05}s" onclick="openDetail(${j.id})">
        <div class="job-card-top">
          <span class="job-cat-tag">${getCatName(j.cat)}</span>
          <span class="job-time-tag">${formatRelative(j.createdAt)} oldin</span>
        </div>
        <div class="job-card-title">${escapeHtml(j.title)}</div>
        <div class="job-card-desc">${escapeHtml(j.desc)}</div>
        <div class="job-card-footer">
          <div>
            <div class="job-price">${formatMoney(j.price)} so'm</div>
            <div class="job-location">${escapeHtml(j.location)}</div>
            <div class="job-card-phone">+998 ${escapeHtml(j.phone || '')}</div>
            ${distance ? `<div class="job-card-phone">${distance} km</div>` : ''}
          </div>
          <div class="job-card-btns">
            <button class="btn-call-sm" onclick="event.stopPropagation(); callNumber('${escapeJsString(j.phone || '')}', '${escapeJsString(j.poster)}')">Qo'ng'iroq</button>
            <button class="btn-call-sm" onclick="event.stopPropagation(); openWhatsApp('${escapeJsString(j.phone || '')}', '${escapeJsString(j.poster)}')">WhatsApp</button>
            ${j.mapLink ? `<button class="btn-call-sm" onclick="event.stopPropagation(); window.open('${escapeJsString(j.mapLink)}','_blank','noopener')">Xarita</button>` : ''}
          </div>
        </div>
        <div class="job-card-meta">
          <span class="meta-tag">${j.views || 0} ko'rildi</span>
          <span class="meta-tag">${formatHoursLeft(j.expiresAt)}</span>
          ${fresh ? `<span class="meta-tag">Yangi</span>` : ''}
          ${AppState.user?.role === 'beruvchi' && AppState.user?.id === j.ownerId
            ? `<span class="meta-tag">${applicantCount} nomzod</span>`
            : mine ? `<span class="meta-tag">${statusLabel(mine.status)}</span>` : `<span class="meta-tag">${Number(j.posterRating || 0) ? Number(j.posterRating).toFixed(1) : '—'}</span>`}
          ${saved ? `<span class="meta-tag">Saqlangan</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

function updateHomeStats() {
  const activeJobs = Store.getPublicFeedJobs();
  const users = typeof Store?.getAllUsers === 'function' ? Store.getAllUsers() : [];
  const reviews = AppState.user && typeof Store?.getReviewsForUser === 'function' ? Store.getReviewsForUser(AppState.user.id) : [];
  const allRated = users.filter(u => Number(u.rating || 0) > 0);
  const avg = allRated.length ? (allRated.reduce((s, u) => s + Number(u.rating || 0), 0) / allRated.length) : 0;
  document.getElementById('home-active-jobs').textContent = activeJobs.length;
  document.getElementById('home-workers-count').textContent = users.filter(u => u.role === 'ishchi').length;
  document.getElementById('home-average-rating').textContent = avg ? `${avg.toFixed(1)}★` : '—';
}

function updateProfileStats() {
  const user = AppState.user;
  if (!user) return;
  const myJobs = Store.getMyJobs(user.id);
  const myApplications = Store.getMyApplications(user.id);
  const completedCount = user.role === 'beruvchi'
    ? myJobs.filter(j => j.status === 'closed').length
    : myApplications.filter(a => a.status === 'completed').length;

  document.getElementById('profile-rating-num').textContent = Number(user.rating || 0) ? Number(user.rating).toFixed(1) : '—';
  document.getElementById('profile-completed-num').textContent = completedCount;
  document.getElementById('profile-jobs-num').textContent = user.role === 'beruvchi' ? myJobs.length : myApplications.length;
  document.getElementById('profile-primary-action-badge').textContent = user.role === 'beruvchi'
    ? myJobs.filter(j => ['active', 'assigned', 'in_progress'].includes(j.status)).length
    : myApplications.filter(a => ['pending', 'accepted', 'in_progress'].includes(a.status)).length;
  const savedCount = user.role === 'ishchi' ? Store.getSavedJobs(user.id).length : 0;
  const reportsCount = Store.getReports().filter(r => r.status === 'open').length;
  document.getElementById('saved-count-badge').textContent = savedCount;
  document.getElementById('report-count-badge').textContent = reportsCount;
}

function ensureAdminAccess() {
  if (!AppState.user || !Store.isAdminUser(AppState.user)) {
    Toast.show('Bu bo‘lim faqat admin uchun ochiq.');
    Router.go('home', true);
    return false;
  }
  return true;
}

function updateNotificationBadge() {
  const badge = document.querySelector('.notif-badge');
  const sidebarBadge = document.querySelector('.si-badge');
  let count = 0;

  if (AppState.user?.role === 'beruvchi') {
    count = Store.getApplicationsForEmployer(AppState.user.id).filter(a => a.status === 'pending').length;
  } else if (AppState.user?.role === 'ishchi') {
    const statusCount = Store.getMyApplications(AppState.user.id).filter(a => ['accepted', 'in_progress', 'completed'].includes(a.status)).length;
    const dutyCount = AppState.user.availability?.onDuty ? Store.getNewJobsSince(AppState.user.availability?.lastSeenJobAt || 0).length : 0;
    count = statusCount + dutyCount;
  }

  if (badge) {
    badge.textContent = count;
    badge.style.display = count ? 'flex' : 'none';
  }
  if (sidebarBadge) {
    sidebarBadge.textContent = count;
    sidebarBadge.style.display = count ? 'inline-flex' : 'none';
  }
  document.getElementById('activity-subtitle').textContent = count
    ? `${count} ta yangi holat mavjud`
    : (AppState.user?.role === 'beruvchi' ? "Sizning e'lon va nomzodlaringiz shu yerda" : "Sizning murojaatlaringiz va holatlaringiz shu yerda");
}

function callNumber(phone, name) {
  const digits = normalizeUzPhoneDigits(phone);
  if (!digits) return Toast.show('Telefon raqami topilmadi.');
  window.location.href = `tel:+998${digits}`;
  Toast.show(`Qo'ng'iroq: ${name}`);
}

function openDetail(jobId) {
  try {
  const found = Store.getJob(jobId);
  if (!found) {
    Toast.show('Bu e’lon endi mavjud emas yoki yashirilgan.');
    initHome();
    return;
  }
  const isAdminViewer = typeof Store?.isAdminUser === 'function' ? Store.isAdminUser(AppState.user) : false;
  if (AppState.user?.role === 'beruvchi' && !isAdminViewer && String(AppState.user.id) !== String(found.ownerId)) {
    Toast.show("Ish beruvchi faqat o'z e'lonlarini ko'ra oladi.");
    return;
  }
  Store.incrementView(jobId);
  const j = Store.getJob(jobId);
  AppState.currentJobId = jobId;
  const isOwner = AppState.user?.id === j.ownerId;
  const myApplication = AppState.user?.role === 'ishchi' ? Store.getMyApplicationForJob(jobId, AppState.user.id) : null;
  const applicantCount = Store.getApplicationsForJob(jobId).filter(a => a.status === 'pending').length;
  const selectedApp = j.selectedApplicationId ? Store.getApplicationsForJob(jobId).find(a => String(a.id) === String(j.selectedApplicationId)) : null;
  const isSaved = AppState.user?.role === 'ishchi' ? Store.isJobSaved(jobId, AppState.user.id) : false;

  document.getElementById('detail-topbar-title').textContent = j.title;
  document.getElementById('detail-body').innerHTML = `
    <div class="detail-main-title">${escapeHtml(j.title)}</div>
    <div class="tags-row">
      <span class="tag tag-cat">${getCatIcon(j.cat)} ${getCatName(j.cat)}</span>
      <span class="tag tag-time">⏱ ${formatRelative(j.createdAt)} oldin</span>
      <span class="tag tag-views">${j.views || 0}</span>
      <span class="tag tag-active">✅ ${statusLabel(j.status)}</span>
    </div>

    <div class="price-hero">
      <div class="price-hero-left">
        <div class="ph-label">To'lov miqdori</div>
        <div class="ph-amount">${formatMoney(j.price)}</div>
        <div class="ph-type">so'm / ${j.priceType}</div>
      </div>
      <div class="price-hero-right">So'm</div>
    </div>

    <div class="detail-action-row">
      ${AppState.user?.role === 'ishchi' ? `<button class="mini-btn" onclick="toggleSaveCurrentJob()">${isSaved ? 'Saqlandi' : 'Saqlash'}</button>` : ''}
      ${!isOwner && j.status === 'active' ? `<button class="mini-btn reject" onclick="reportCurrentJob()">Xabar berish</button>` : ''}
      ${isOwner && j.status === 'active' ? `<button class="mini-btn" onclick="editCurrentJob()">✏️ Tahrirlash</button>` : ''}
      ${isOwner && j.status === 'active' ? `<button class="mini-btn" onclick="duplicateCurrentJob()">Nusxa</button>` : ''}
      <button class="mini-btn" onclick="copyJobLink()">Ulashish</button>
    </div>

    <div class="section-label">Ish tavsifi</div>
    <div class="detail-desc">${escapeHtml(j.desc)}</div>

    <div class="section-label">Ma'lumotlar</div>
    <div class="info-grid">
      <div class="info-cell"><div class="info-cell-label">Manzil</div><div class="info-cell-value">${escapeHtml(j.location)}</div></div>
      <div class="info-cell"><div class="info-cell-label">Telefon</div><div class="info-cell-value">+998 ${escapeHtml(j.phone || '')}</div></div>
      <div class="info-cell"><div class="info-cell-label">Telegram</div><div class="info-cell-value">${escapeHtml(j.telegram || 'Kiritilmagan')}</div></div>
      <div class="info-cell"><div class="info-cell-label">⏰ Muddat</div><div class="info-cell-value">${formatHoursLeft(j.expiresAt)}</div></div>
      <div class="info-cell"><div class="info-cell-label">Ko'rishlar</div><div class="info-cell-value">${j.views || 0} marta</div></div>
      <div class="info-cell"><div class="info-cell-label">Murojaatlar</div><div class="info-cell-value">${applicantCount} ta</div></div>
      <div class="info-cell"><div class="info-cell-label">Ish vaqti</div><div class="info-cell-value">${escapeHtml(j.schedule || 'Kelishiladi')}</div></div>
    </div>
    <div class="detail-contact-row">
      <button class="mini-btn" onclick="copyPhone('${escapeJsString(j.phone || '')}')">Telefonni nusxalash</button>
      <button class="mini-btn" onclick="openWhatsApp('${escapeJsString(j.phone || '')}', '${escapeJsString(j.poster)}')">WhatsApp</button>
      ${j.telegram ? `<button class="mini-btn" onclick="openTelegramContact('${escapeJsString(j.telegram)}')">Telegram</button>` : ''}
      ${j.mapLink ? `<button class="mini-btn" onclick="openMapForCurrentJob()">Xarita</button>` : ''}
    </div>
    <div class="detail-inline-note">Aloqa uchun qo‘ng‘iroq, WhatsApp, Telegram yoki xarita tugmalaridan foydalanishingiz mumkin.</div>

    ${myApplication ? `
    <div class="section-label">Mening holatim</div>
    <div class="activity-inline-card">
      <div class="activity-inline-title">${statusLabel(myApplication.status)}</div>
      <div class="activity-inline-desc">Siz ${formatRelative(myApplication.createdAt)} oldin murojaat yuborgansiz.</div>
    </div>` : ''}

    ${selectedApp ? `
    <div class="section-label">Tanlangan nomzod</div>
    <div class="activity-inline-card">
      <div class="activity-inline-title">${escapeHtml(selectedApp.workerName)}</div>
      <div class="activity-inline-desc">Holat: ${statusLabel(selectedApp.status)} · Aloqa: +998 ${escapeHtml(selectedApp.workerPhone)}</div>
    </div>` : ''}

    ${renderContractChat(j)}

    <div class="section-label">E'lon beruvchi</div>
    <div class="poster-block">
      <div class="poster-avatar">${escapeHtml((j.poster || '?')[0] || '?')}</div>
      <div>
        <div class="poster-name">${escapeHtml(j.poster)}</div>
        <div class="poster-stars">⭐ ${Number(j.posterRating || 0) ? Number(j.posterRating).toFixed(1) : '—'} <span>(${j.posterDeals || 0} bajarilgan ish)</span></div>
        <div class="poster-deals">${SETTINGS.district}</div>
      </div>
    </div>`;

  document.getElementById('detail-cta').innerHTML = isOwner ? renderEmployerDetailActions(j, applicantCount) : renderViewerDetailActions(j, myApplication);

  updateHomeStats();
  renderUserPresenceBadges();
  Router.go('detail');
  } catch (err) {
    console.error('openDetail error:', err);
    Toast.show('E’lonni ochishda xato.');
  }
}

function renderEmployerDetailActions(job, applicantCount) {
  if (job.status === 'active') {
    return `
      <button class="btn-outline" onclick="Router.go('chats')">${applicantCount} nomzod</button>
      <button class="btn-call-lg" onclick="closeCurrentJob()">✅ E'lonni yopish</button>`;
  }
  if (['assigned', 'in_progress'].includes(job.status)) {
    return `
      <button class="btn-outline" onclick="Router.go('chats')">Jarayon</button>
      <button class="btn-call-lg" onclick="completeCurrentJob()">Bajarildi</button>`;
  }
  return `
    <button class="btn-outline" onclick="Router.go('chats')">Faollik</button>
    <button class="btn-call-lg" onclick="Toast.show('Bu e’lon yakunlangan.')">✅ Yakunlangan</button>`;
}

function setEmployerHomeStatus(status) {
  AppState.homeFilter.employerStatus = status;
  renderJobs(getFilteredJobs());
}


function renderViewerDetailActions(job, myApplication) {
  const isAdminViewer = typeof Store?.isAdminUser === 'function' ? Store.isAdminUser(AppState.user) : false;
  if (AppState.user?.role === 'ishchi') {
    let primaryAction = `<button class="btn-outline" onclick="expressInterest()" ${job.status !== 'active' ? 'disabled' : ''}>Qiziqdim</button>`;
    if (myApplication?.status === 'pending') {
      primaryAction = `<button class="btn-outline" onclick="cancelMyApplication('${myApplication.id}')">↩ Murojaatni bekor qilish</button>`;
    } else if (myApplication?.status === 'accepted') {
      primaryAction = `<button class="btn-outline" onclick="startAcceptedWork('${myApplication.id}')">▶ Ishni boshlash</button>`;
    } else if (myApplication?.status === 'in_progress') {
      primaryAction = `<button class="btn-outline" disabled>Siz hozir bu ishda ishlayapsiz</button>`;
    } else if (myApplication?.status === 'completed') {
      primaryAction = `<button class="btn-outline" disabled>✅ Bu ish yakunlangan</button>`;
    } else if (myApplication && ['rejected', 'withdrawn', 'job_closed', 'expired'].includes(myApplication.status)) {
      primaryAction = `<button class="btn-outline" ${job.status !== 'active' ? 'disabled' : ''} onclick="expressInterest()">Qayta murojaat</button>`;
    }
    return `
      ${primaryAction}
      <button class="btn-call-lg" onclick="callNumber('${escapeJsString(job.phone || '')}', '${escapeJsString(job.poster)}')">Qo'ng'iroq qilish</button>`;
  }
  if (isAdminViewer) {
    return `
      <button class="btn-outline" onclick="Toast.show('Moderator ko'rish rejimi.')">Moderator</button>
      <button class="btn-call-lg" onclick="callNumber('${escapeJsString(job.phone || '')}', '${escapeJsString(job.poster)}')">Aloqa</button>`;
  }
  return `
    <button class="btn-outline" onclick="Toast.show('Ish beruvchi boshqa ish beruvchining e'loniga kira olmaydi.')">Yopiq</button>
    <button class="btn-call-lg" disabled>Faqat ishchilar uchun</button>`;
}

function copyJobLink() {
  navigator.clipboard?.writeText(`TezkorIsh e'loni #${AppState.currentJobId}`).then(() => {
    Toast.show('E’lon havolasi nusxalandi.');
  }).catch(() => Toast.show('Ulashish tayyor.'));
}

function toggleSaveCurrentJob() {
  if (!AppState.currentJobId || AppState.user?.role !== 'ishchi') return;
  const saved = Store.toggleSavedJob(AppState.currentJobId, AppState.user.id);
  initHome();
  openDetail(AppState.currentJobId);
  Toast.show(saved ? 'E’lon saqlandi.' : 'Saqlanganlardan olib tashlandi.');
}

function reportCurrentJob() {
  if (!AppState.currentJobId) return;
  const preset = prompt('Sababni tanlang: spam / aldov / noto‘g‘ri narx / haqorat', 'noto‘g‘ri narx');
  if (!preset) return;
  const note = prompt('Qisqa izoh (ixtiyoriy)', '');
  const reason = `${preset}${note ? ' — ' + note.trim() : ''}`;
  try {
    Store.createReport(AppState.currentJobId, reason.trim());
    initHome();
    Toast.show('Xabar yuborildi. Lokal moderatsiya panelida ko‘rinadi.');
  } catch (err) {
    Toast.show(err.message || 'Xabar yuborib bo‘lmadi.');
  }
}

function expressInterest() {
  if (!AppState.currentJobId) return;
  try {
    Store.createApplication(AppState.currentJobId);
    initHome();
    openDetail(AppState.currentJobId);
    Toast.show('Murojaat yuborildi. Ish beruvchi endi sizni ko‘radi.');
  } catch (err) {
    Toast.show(err.message || 'Murojaat yuborishda xato.');
  }
}


function startAcceptedWork(applicationId) {
  if (!AppState.user) return;
  try {
    Store.markWorkerJobStarted(applicationId, AppState.user.id);
    initHome();
    if (AppState.currentJobId) openDetail(AppState.currentJobId);
    Toast.show('Ish boshlandi. Bu e’lon feed’dan yashirildi.');
  } catch (err) {
    Toast.show(err.message || 'Ishni boshlashda xato.');
  }
}

function cancelMyApplication(applicationId) {
  if (!AppState.user) return;
  try {
    Store.cancelApplication(applicationId, AppState.user.id);
    initHome();
    if (AppState.currentJobId) openDetail(AppState.currentJobId);
    Toast.show('Murojaat bekor qilindi.');
  } catch (err) {
    Toast.show(err.message || 'Murojaatni bekor qilib bo‘lmadi.');
  }
}

function closeCurrentJob() {
  if (!AppState.currentJobId || !AppState.user) return;
  try {
    Store.closeJob(AppState.currentJobId, AppState.user.id);
    Toast.show("E'lon yopildi.");
    initHome();
    Router.go('chats', true);
  } catch (err) {
    Toast.show(err.message || "E'lonni yopishda xato.");
  }
}

function completeCurrentJob() {
  if (!AppState.currentJobId || !AppState.user) return;
  try {
    Store.completeJob(AppState.currentJobId, AppState.user.id);
    AppState.user = Store.loadUser();
    hydrateUserUI();
    initHome();
    Router.go('chats', true);
    Toast.show('Ish bajarildi deb belgilandi.');
  } catch (err) {
    Toast.show(err.message || 'Yakunlashda xato.');
  }
}

function initPost() {
  const grid = document.getElementById('post-cats-grid');
  grid.innerHTML = POST_CATEGORIES.map(c => `
    <button class="cat-pick" data-cat="${c.id}" onclick="selectPostCat('${c.id}', this)">
      <span class="cat-pick-icon">${c.icon}</span>
      <span class="cat-pick-name">${c.name}</span>
    </button>
  `).join('');
}

function selectPostCat(id, el) {
  AppState.postCat = id;
  document.querySelectorAll('.cat-pick').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function selectDuration(el, hours) {
  AppState.postDuration = hours;
  document.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function prefillPostForm(job) {
  document.getElementById('post-title').value = job.title;
  document.getElementById('post-desc').value = job.desc;
  document.getElementById('post-price').value = job.price;
  document.getElementById('post-location').value = job.location;
  document.getElementById('post-phone').value = job.phone || AppState.user?.phoneDigits || '';
  document.getElementById('post-schedule').value = job.schedule || '';
  document.getElementById('post-map-link').value = job.mapLink || '';
  document.getElementById('post-telegram').value = job.telegram || '';
  document.getElementById('post-lat').value = job.lat || '';
  document.getElementById('post-lng').value = job.lng || '';
  AppState.postCat = job.cat;
  AppState.postDuration = job.duration;
  document.querySelectorAll('.cat-pick').forEach(c => c.classList.toggle('active', c.dataset.cat === job.cat));
  document.querySelectorAll('.dur-btn').forEach(b => b.classList.toggle('active', b.dataset.h === String(job.duration)));
}

function resetPostForm() {
  document.getElementById('post-title').value = '';
  document.getElementById('post-desc').value = '';
  document.getElementById('post-price').value = '';
  document.getElementById('post-location').value = '';
  document.getElementById('post-phone').value = AppState.user?.phoneDigits || '';
  document.getElementById('post-schedule').value = '';
  document.getElementById('post-map-link').value = '';
  document.getElementById('post-telegram').value = '';
  document.getElementById('post-lat').value = '';
  document.getElementById('post-lng').value = '';
  AppState.postCat = null;
  AppState.postDuration = SETTINGS.defaultExpiryHours;
  AppState.editingJobId = null;
  document.querySelectorAll('.cat-pick').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.dur-btn').forEach(b => b.classList.toggle('active', b.dataset.h === String(SETTINGS.defaultExpiryHours)));
  document.querySelector('#screen-post .post-topbar-title').textContent = "E'lon berish ➕";
  document.querySelector('#screen-post .post-topbar-sub').textContent = "~90 soniyada e'lon bering, 100% bepul";
}

function editCurrentJob() {
  const job = Store.getJob(AppState.currentJobId);
  if (!job) return;
  AppState.editingJobId = job.id;
  prefillPostForm(job);
  document.querySelector('#screen-post .post-topbar-title').textContent = "E'lonni tahrirlash ✏️";
  document.querySelector('#screen-post .post-topbar-sub').textContent = "Mavjud e'lonni yangilang";
  Router.go('post');
}

function editJobFromList(jobId) {
  const job = Store.getJob(jobId);
  if (!job) return;
  AppState.editingJobId = job.id;
  prefillPostForm(job);
  document.querySelector('#screen-post .post-topbar-title').textContent = "E'lonni tahrirlash ✏️";
  document.querySelector('#screen-post .post-topbar-sub').textContent = "Mavjud e'lonni yangilang";
  Router.go('post');
}


function capturePostLocation() {
  if (!navigator.geolocation) return Toast.show('Geolokatsiya qo‘llab-quvvatlanmaydi.');
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = Number(pos.coords.latitude.toFixed(6));
    const lng = Number(pos.coords.longitude.toFixed(6));
    const mapLinkInput = document.getElementById('post-map-link');
    const latInput = document.getElementById('post-lat');
    const lngInput = document.getElementById('post-lng');
    const locationInput = document.getElementById('post-location');
    if (mapLinkInput) mapLinkInput.value = buildMapsLink(lat, lng);
    if (latInput) latInput.value = lat;
    if (lngInput) lngInput.value = lng;
    if (locationInput && !locationInput.value.trim()) {
      locationInput.value = await reverseGeocode(lat, lng);
    }
    Toast.show('Joriy location va manzil biriktirildi.');
  }, () => Toast.show('Locationni olib bo‘lmadi.'));
}

function submitPost() {
  if (!AppState.user && typeof Store?.loadUser === 'function') {
    AppState.user = Store.loadUser();
  }
  if (AppState.user && typeof Store?.saveUser === 'function') {
    AppState.user = Store.saveUser(AppState.user);
  }
  if (AppState.user?.role !== 'beruvchi') {
    Toast.show('Faqat ish beruvchi e’lon joylay oladi.');
    return;
  }

  const title = document.getElementById('post-title').value.trim();
  const desc = document.getElementById('post-desc').value.trim();
  const price = digitsOnly(document.getElementById('post-price').value);
  const location = document.getElementById('post-location').value.trim();
  const phone = digitsOnly(document.getElementById('post-phone').value);
  const schedule = document.getElementById('post-schedule').value.trim();
  const mapLink = document.getElementById('post-map-link')?.value.trim() || '';
  const telegram = document.getElementById('post-telegram')?.value.trim() || '';
  const lat = document.getElementById('post-lat')?.value || null;
  const lng = document.getElementById('post-lng')?.value || null;

  if (!AppState.postCat) return Toast.show('Kategoriya tanlang.');
  if (title.length < 5) return Toast.show('Sarlavha kamida 5 ta belgidan iborat bo‘lsin.');
  if (desc.length < 12) return Toast.show('Tavsifni biroz to‘liqroq kiriting.');
  if (!price) return Toast.show('Narxni kiriting.');
  if (location.length < 3) return Toast.show('Manzilni kiriting.');
  if (phone.length < 9) return Toast.show('Aloqa telefonini kiriting.');
  if (!mapLink) return Toast.show('Xarita locationini ham biriktiring.');

  try {
    let job;
    if (AppState.editingJobId) {
      job = Store.updateJob(AppState.editingJobId, {
        cat: AppState.postCat,
        title,
        desc,
        price,
        location,
        phone,
        schedule,
        mapLink,
        telegram,
        lat,
        lng,
        duration: AppState.postDuration,
      }, AppState.user.id);
      document.getElementById('success-modal-desc').innerHTML = `E'loningiz yangilandi. Faollik muddati <strong>${job.duration} soat</strong>.`;
    } else {
      job = Store.createJob({
        cat: AppState.postCat,
        title,
        desc,
        price,
        location,
        phone,
        schedule,
        mapLink,
        telegram,
        lat,
        lng,
        duration: AppState.postDuration,
      });
      document.getElementById('success-modal-desc').innerHTML = `E'loningiz <strong>${job.duration} soat</strong> davomida faol bo'ladi.`;
    }
    document.getElementById('success-modal').classList.add('open');
    initHome();
    updateProfileStats();
  } catch (err) {
    Toast.show(err.message || 'E’lon yaratishda xato.');
  }
}

function closeSuccessModal() {
  document.getElementById('success-modal').classList.remove('open');
  resetPostForm();
  initHome();
  Router.go('home', true);
}

function renderActivity() {
  const list = document.getElementById('chats-list');
  if (!AppState.user) {
    list.innerHTML = '';
    return;
  }

  if (AppState.user.role === 'beruvchi') {
    const myJobs = Store.getMyJobs(AppState.user.id);
    const incoming = Store.getApplicationsForEmployer(AppState.user.id);
    const pending = incoming.filter(a => a.status === 'pending');
    const accepted = incoming.filter(a => ['accepted', 'in_progress'].includes(a.status));
    const contracts = typeof Store?.getContractsForUser === 'function' ? Store.getContractsForUser(AppState.user.id) : [];
    const tabs = [
      ['all', 'Hammasi'],
      ['active', 'Faol'],
      ['assigned', 'Biriktirilgan'],
      ['in_progress', 'Jarayonda'],
      ['closed', 'Yopilgan'],
      ['expired', 'Muddati tugagan'],
    ];
    const filteredJobs = AppState.employerActivityFilter === 'all' ? myJobs : myJobs.filter(j => j.status === AppState.employerActivityFilter);

    list.innerHTML = `
      <div class="activity-wrap">
        <div class="activity-summary-grid">
          <div class="activity-summary-card"><div class="activity-summary-num">${myJobs.filter(j => j.status === 'active').length}</div><div class="activity-summary-label">Faol e'lon</div></div>
          <div class="activity-summary-card"><div class="activity-summary-num">${pending.length}</div><div class="activity-summary-label">Yangi nomzod</div></div>
        </div>
        <div class="quick-filter-row employer-tabs">${tabs.map(([key,label]) => `<button class="quick-filter-btn ${AppState.employerActivityFilter === key ? 'active' : ''}" onclick="setEmployerActivityFilter('${key}')">${label}</button>`).join('')}</div>

        <div class="activity-section-title">Yangi nomzodlar</div>
        ${pending.length ? pending.map(app => `
          <div class="activity-card">
            <div class="activity-card-head">
              <div>
                <div class="activity-card-title">${escapeHtml(app.workerName)}</div>
                <div class="activity-card-sub">${escapeHtml(app.jobTitle)}</div>
              </div>
              <span class="activity-status pending">${statusLabel(app.status)}</span>
            </div>
            <div class="activity-meta">${formatRelative(app.createdAt)} oldin · ${escapeHtml(app.jobLocation)}</div>
            <div class="activity-actions">
              <button class="mini-btn" onclick="callNumber('${escapeJsString(app.workerPhone || '')}', '${escapeJsString(app.workerName)}')">Qo'ng'iroq</button>
              <button class="mini-btn" onclick="openWhatsApp('${escapeJsString(app.workerPhone || '')}', '${escapeJsString(app.workerName)}')">WhatsApp</button>
              <button class="mini-btn accept" onclick="setApplicationStatus('${app.id}', 'accepted')">✅ Qabul qilish</button>
              <button class="mini-btn reject" onclick="setApplicationStatus('${app.id}', 'rejected')">✖ Rad etish</button>
            </div>
          </div>`).join('') : `<div class="empty-state compact"><div class="empty-title">Hali yangi nomzod yo'q</div><div class="empty-desc">Ishchilar murojaat qilganda shu yerda ko'rinadi</div></div>`}

        <div class="activity-section-title">Biriktirilgan / jarayondagi ishlar</div>
        ${accepted.length ? accepted.map(app => `
          <div class="activity-card">
            <div class="activity-card-head">
              <div>
                <div class="activity-card-title">${escapeHtml(app.workerName)}</div>
                <div class="activity-card-sub">${escapeHtml(app.jobTitle)}</div>
              </div>
              <span class="activity-status ${app.status}">${statusLabel(app.status)}</span>
            </div>
            <div class="activity-meta">Holat: ${statusLabel(app.status)} · ${escapeHtml(app.jobLocation)}</div>
            <div class="activity-actions">
              <button class="mini-btn" onclick="openDetail(${app.jobId})">E'lon</button>
              <button class="mini-btn" onclick="callNumber('${escapeJsString(app.workerPhone || '')}', '${escapeJsString(app.workerName)}')">Aloqa</button>
              <button class="mini-btn" onclick="openWhatsApp('${escapeJsString(app.workerPhone || '')}', '${escapeJsString(app.workerName)}')">WhatsApp</button>
              <button class="mini-btn accept" onclick="completeJobFromActivity(${app.jobId})">Bajarildi</button>
            </div>
          </div>`).join('') : `<div class="empty-state compact"><div class="empty-title">Jarayon yo'q</div><div class="empty-desc">Nomzod qabul qilingandan keyin shu yerda ko'rinadi</div></div>`}

        <div class="activity-section-title">Mening e'lonlarim</div>
        ${filteredJobs.length ? filteredJobs.map(job => {
          const pendingCount = Store.getApplicationsForJob(job.id).filter(a => a.status === 'pending').length;
          const contract = contracts.find(c => String(c.jobId) === String(job.id) && ['completed','closed'].includes(c.status));
          return `
          <div class="activity-card">
            <div class="activity-card-head">
              <div>
                <div class="activity-card-title">${escapeHtml(job.title)}</div>
                <div class="activity-card-sub">${getCatIcon(job.cat)} ${getCatName(job.cat)}</div>
              </div>
              <span class="activity-status ${job.status}">${statusLabel(job.status)}</span>
            </div>
            <div class="activity-meta">${formatMoney(job.price)} so'm · ${escapeHtml(job.location)} · ${formatHoursLeft(job.expiresAt)}</div>
            <div class="activity-actions">
              <button class="mini-btn" onclick="openDetail(${job.id})">Ochish</button>
              ${job.status === 'active' ? `<button class="mini-btn" onclick="editJobFromList(${job.id})">✏️ Tahrir</button>` : ''}
              ${job.status === 'active' ? `<button class="mini-btn" onclick="duplicateJobFromList(${job.id})">Nusxa</button>` : ''}
              ${job.status === 'active' ? `<button class="mini-btn reject" onclick="closeJobFromList(${job.id})">Yopish</button>` : `<button class="mini-pill">${pendingCount} nomzod</button>`}
              ${contract ? `<button class="mini-btn accept" onclick="openReviewPrompt('${contract.id}', '${contract.workerId}')">⭐ Ishchini baholash</button>` : ''}
            </div>
          </div>`;
        }).join('') : `<div class="empty-state compact"><div class="empty-title">Bu holatda e'lon yo'q</div><div class="empty-desc">Filter bo‘yicha boshqa e’lon topilmadi</div></div>`}
      </div>`;
  } else {
    const myApplications = Store.getMyApplications(AppState.user.id);
    list.innerHTML = `
      <div class="activity-wrap">
        <div class="activity-summary-grid">
          <div class="activity-summary-card"><div class="activity-summary-num">${myApplications.filter(a => a.status === 'pending').length}</div><div class="activity-summary-label">Kutilmoqda</div></div>
          <div class="activity-summary-card"><div class="activity-summary-num">${myApplications.filter(a => ['accepted', 'in_progress', 'completed'].includes(a.status)).length}</div><div class="activity-summary-label">Qabul/Jarayon</div></div>
        </div>

        <div class="activity-section-title">Mening murojaatlarim</div>
        ${myApplications.length ? myApplications.map(app => `
          <div class="activity-card">
            <div class="activity-card-head">
              <div>
                <div class="activity-card-title">${escapeHtml(app.jobTitle)}</div>
                <div class="activity-card-sub">${escapeHtml(app.employerName)}</div>
              </div>
              <span class="activity-status ${app.status}">${statusLabel(app.status)}</span>
            </div>
            <div class="activity-meta">${formatRelative(app.createdAt)} oldin · ${escapeHtml(app.jobLocation)}</div>
            <div class="activity-actions">
              <button class="mini-btn" onclick="openDetail(${app.jobId})">E'lonni ochish</button>
              <button class="mini-btn" onclick="callNumber('${escapeJsString(app.employerPhone || '')}', '${escapeJsString(app.employerName)}')">Qo'ng'iroq</button>
              ${app.status === 'pending' ? `<button class="mini-btn reject" onclick="cancelMyApplication('${app.id}')">↩ Bekor qilish</button>` : ''}
              ${app.status === 'accepted' ? `<button class="mini-btn accept" onclick="startAcceptedWork('${app.id}')">▶ Start</button>` : ''}
              ${app.status === 'completed' ? `<button class="mini-btn accept" onclick="rateEmployerForApplication('${app.id}')">⭐ Baholash</button>` : ''}
            </div>
          </div>`).join('') : `<div class="empty-state compact"><div class="empty-title">Hali murojaat yo'q</div><div class="empty-desc">Yoqqan e'loningizga “Qiziqdim” tugmasini bosing</div></div>`}
      </div>`;
  }
}

function setApplicationStatus(applicationId, status) {
  if (!AppState.user) return;
  try {
    Store.setApplicationStatus(applicationId, AppState.user.id, status);
    initHome();
    Toast.show(status === 'accepted' ? 'Nomzod qabul qilindi. E’lon endi ommaviy feed’dan yashirildi.' : 'Nomzod rad etildi.');
  } catch (err) {
    Toast.show(err.message || 'Holatni yangilashda xato.');
  }
}

function closeJobFromList(jobId) {
  if (!AppState.user) return;
  try {
    Store.closeJob(jobId, AppState.user.id);
    initHome();
    Toast.show("E'lon yopildi.");
  } catch (err) {
    Toast.show(err.message || "E'lonni yopishda xato.");
  }
}

function setEmployerActivityFilter(status) {
  AppState.employerActivityFilter = status;
  renderActivity();
}

function duplicateJobFromList(jobId) {
  if (!AppState.user || typeof Store?.duplicateJob !== 'function') return;
  try {
    Store.duplicateJob(jobId, AppState.user.id);
    initHome();
    Toast.show('E’lon nusxalandi.');
  } catch (err) {
    Toast.show(err.message || 'Nusxalashda xato.');
  }
}

function completeJobFromActivity(jobId) {
  if (!AppState.user) return;
  try {
    Store.completeJob(jobId, AppState.user.id);
    AppState.user = Store.loadUser();
    hydrateUserUI();
    initHome();
    Toast.show('Ish bajarildi deb belgilandi.');
  } catch (err) {
    Toast.show(err.message || 'Yakunlashda xato.');
  }
}

function renderSavedJobs() {
  const list = document.getElementById('saved-list');
  if (!list || !AppState.user || AppState.user.role !== 'ishchi') {
    if (list) list.innerHTML = '';
    return;
  }
  const savedJobs = Store.getSavedJobs(AppState.user.id);
  document.getElementById('saved-subtitle').textContent = `${savedJobs.length} ta saqlangan e'lon`;
  list.innerHTML = savedJobs.length ? `
    <div class="activity-wrap">
      ${savedJobs.map(job => `
      <div class="activity-card">
        <div class="activity-card-head">
          <div>
            <div class="activity-card-title">${escapeHtml(job.title)}</div>
            <div class="activity-card-sub">${getCatIcon(job.cat)} ${getCatName(job.cat)}</div>
          </div>
          <span class="activity-status ${job.status}">${statusLabel(job.status)}</span>
        </div>
        <div class="activity-meta">${formatMoney(job.price)} so'm · ${escapeHtml(job.location)}</div>
        <div class="activity-actions">
          <button class="mini-btn" onclick="openDetail(${job.id})">Ochish</button>
          <button class="mini-btn reject" onclick="removeSavedJob(${job.id})">Olib tashlash</button>
        </div>
      </div>`).join('')}
    </div>` : `<div class="empty-state"><div class="empty-icon"></div><div class="empty-title">Saqlangan e'lonlar yo'q</div><div class="empty-desc">Yoqqan e'loningizni saqlab keyinroq qaytib ko'rishingiz mumkin</div></div>`;
}

function removeSavedJob(jobId) {
  if (AppState.user?.role !== 'ishchi') return;
  Store.toggleSavedJob(jobId, AppState.user.id);
  initHome();
  Toast.show('Saqlanganlardan olib tashlandi.');
}

function openSavedScreen() {
  if (AppState.user?.role !== 'ishchi') {
    Toast.show('Saqlanganlar faqat ishchilar uchun.');
    return;
  }
  renderSavedJobs();
  Router.go('saved');
}

function renderAdmin() {
  const list = document.getElementById('admin-list');
  if (!list) return;
  if (!Store.isAdminUser(AppState.user)) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon"></div><div class="empty-title">Admin ruxsati kerak</div><div class="empty-desc">Bu bo‘lim lokal moderatsiya uchun ajratilgan. Productionda backend admin qoidalari kerak bo‘ladi.</div></div>`;
    return;
  }
  const jobs = Store.getAllJobs();
  const reports = Store.getReports();
  const openReports = reports.filter(r => r.status === 'open');
  const activeJobs = jobs.filter(j => ['active', 'in_progress'].includes(j.status));

  list.innerHTML = `
    <div class="activity-wrap">
      <div class="activity-summary-grid">
        <div class="activity-summary-card"><div class="activity-summary-num">${jobs.length}</div><div class="activity-summary-label">Jami e'lon</div></div>
        <div class="activity-summary-card"><div class="activity-summary-num">${activeJobs.length}</div><div class="activity-summary-label">Faol/Jarayonda</div></div>
      </div>
      <div class="activity-summary-grid">
        <div class="activity-summary-card"><div class="activity-summary-num">${Store.getAllApplications().length}</div><div class="activity-summary-label">Murojaat</div></div>
        <div class="activity-summary-card"><div class="activity-summary-num">${openReports.length}</div><div class="activity-summary-label">Ochiq hisobot</div></div>
      </div>

      <div class="activity-section-title">Hisobotlar</div>
      ${reports.length ? reports.map(report => `
        <div class="activity-card">
          <div class="activity-card-head">
            <div>
              <div class="activity-card-title">${escapeHtml(report.jobTitle)}</div>
              <div class="activity-card-sub">${escapeHtml(report.reporterName)} → ${escapeHtml(report.reason)}</div>
            </div>
            <span class="activity-status ${report.status}">${statusLabel(report.status)}</span>
          </div>
          <div class="activity-meta">${formatRelative(report.createdAt)} oldin · ${escapeHtml(report.employerName)}</div>
          <div class="activity-actions">
            <button class="mini-btn" onclick="openDetail(${report.jobId})">E'lon</button>
            ${report.status === 'open' ? `<button class="mini-btn accept" onclick="resolveReport('${report.id}')">✅ Yopish</button>` : `<button class="mini-pill">✔ Ko‘rib chiqilgan</button>`}
          </div>
        </div>`).join('') : `<div class="empty-state compact"><div class="empty-title">Hisobotlar yo'q</div><div class="empty-desc">Foydalanuvchi xabar berganda shu yerda ko'rinadi</div></div>`}

      <div class="activity-section-title">So'nggi e'lonlar</div>
      ${jobs.slice(0, 6).map(job => `
        <div class="activity-card">
          <div class="activity-card-head">
            <div>
              <div class="activity-card-title">${escapeHtml(job.title)}</div>
              <div class="activity-card-sub">${escapeHtml(job.poster)}</div>
            </div>
            <span class="activity-status ${job.status}">${statusLabel(job.status)}</span>
          </div>
          <div class="activity-meta">${formatMoney(job.price)} so'm · ${escapeHtml(job.location)}</div>
          <div class="activity-actions">
            <button class="mini-btn" onclick="openDetail(${job.id})">Ochish</button>
          </div>
        </div>`).join('')}
    </div>`;
}

function resolveReport(reportId) {
  if (!ensureAdminAccess()) return;
  try {
    Store.resolveReport(reportId);
    initHome();
    Toast.show('Hisobot ko‘rib chiqildi.');
  } catch (err) {
    Toast.show(err.message || 'Hisobotni yopishda xato.');
  }
}

function openAdminScreen() {
  if (!ensureAdminAccess()) return;
  renderAdmin();
  Router.go('admin');
}

function openPrimaryProfileAction() {
  Router.go('chats');
}

function openAboutScreen() {
  syncHelpCenterUI();
  Router.go('about');
}

function rateEmployerForApplication(applicationId) {
  const app = Store.getAllApplications().find(item => String(item.id) === String(applicationId));
  if (!app || !AppState.user) return;
  const contracts = typeof Store?.getContractsForUser === 'function' ? Store.getContractsForUser(AppState.user.id) : [];
  const contract = contracts.find(c => String(c.applicationId) === String(applicationId));
  if (!contract) return Toast.show('Shartnoma topilmadi.');
  openReviewPrompt(contract.id, app.employerId);
}

function openProfileEditor() {
  if (!AppState.user) return;
  document.getElementById('profile-edit-name').value = AppState.user.name || '';
  document.getElementById('profile-edit-phone').value = AppState.user.phone || '';
  document.getElementById('profile-edit-modal').classList.add('open');
}

function closeProfileEditor() {
  document.getElementById('profile-edit-modal').classList.remove('open');
  document.getElementById('profile-edit-avatar').value = '';
}

function handleProfileAvatarChange(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return Toast.show('Avatar uchun rasm tanlang.');
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('profile-edit-preview').src = reader.result;
    document.getElementById('profile-edit-preview').classList.add('show');
  };
  reader.readAsDataURL(file);
}

async function saveProfileEditor() {
  if (!AppState.user) return;
  const nextName = normalizeDisplayName(document.getElementById('profile-edit-name').value.trim());
  const nextPhoneDigits = digitsOnly(document.getElementById('profile-edit-phone').value || AppState.user.phoneDigits || '');
  if (nextName.length < 2) return Toast.show('Ism juda qisqa.');
  if (nextPhoneDigits.length < 9) return Toast.show('Telefon raqam noto‘g‘ri.');
  AppState.user.name = nextName;
  AppState.user.phoneDigits = nextPhoneDigits;
  AppState.user.phone = '+998 ' + nextPhoneDigits;
  const preview = document.getElementById('profile-edit-preview');
  if (preview?.src && preview.classList.contains('show')) AppState.user.avatar = preview.src;
  if (isServerPilotMode()) {
    try {
      await AuthAPI.saveProfile({
        name: AppState.user.name,
        phoneDigits: AppState.user.phoneDigits,
        role: AppState.user.role,
        avatar: AppState.user.avatar || ''
      });
      if (typeof Store?.syncRemoteMirror === 'function') {
        try { await Store.syncRemoteMirror(); } catch (err) { console.warn('syncRemoteMirror profile editor failed:', err); }
      }
    } catch (err) {
      Toast.show(err.message || 'Profilni serverda saqlab bo‘lmadi.');
      return;
    }
  }
  AppState.user = Store.saveUser(AppState.user);
  hydrateUserUI();
  initHome();
  closeProfileEditor();
  Toast.show('Profil yangilandi.');
}

function editProfilePrompt() { openProfileEditor(); }



function renderContractChat(job) {
  if (!AppState.user || !job || typeof Store?.getContractByJobAndUser !== 'function') return '';
  const contract = Store.getContractByJobAndUser(job.id, AppState.user.id);
  if (!contract || !['accepted','in_progress','completed','closed'].includes(contract.status)) return '';
  try {
    const thread = Store.getChatThreadForContract(contract.id, AppState.user.id);
    return `
      <div class="section-label">Kelishuv chati</div>
      <div class="chat-thread-box">
        <div class="chat-thread-head">Faqat ishchi va ish beruvchi ko‘radi</div>
        <div class="chat-thread-messages">${thread.messages.length ? thread.messages.map(m => `
          <div class="chat-msg ${String(m.fromUserId) === String(AppState.user.id) ? 'mine' : 'theirs'}">
            <div class="chat-msg-bubble">${escapeHtml(m.text)}</div>
            <div class="chat-msg-time">${new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
          </div>`).join('') : '<div class="empty-desc">Hali xabar yo‘q. Shu yerda kelishuv yozishmalari saqlanadi.</div>'}</div>
        ${contract.status === 'completed' ? '<div class="detail-inline-note">Ish yakunlangan. Chat faqat o‘qish rejimida.</div>' : `
        <div class="chat-compose">
          <input id="detail-chat-input" class="text-field" type="text" maxlength="500" placeholder="Xabar yozing...">
          <button class="mini-btn accept" onclick="sendCurrentJobChatMessage('${contract.id}')">Yuborish</button>
        </div>`}
      </div>`;
  } catch {
    return '';
  }
}

function sendCurrentJobChatMessage(contractId) {
  try {
    const input = document.getElementById('detail-chat-input');
    const text = input?.value?.trim();
    if (!text) return Toast.show('Xabar yozing.');
    Store.sendChatMessage(contractId, AppState.user.id, text);
    openDetail(AppState.currentJobId);
  } catch (err) {
    Toast.show(err.message || 'Chatga yuborishda xato.');
  }
}

function exportLocalBackup() {
  try {
    const snapshot = Store.exportBackup();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tezkorish-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    Toast.show('Zaxira fayli yuklandi.');
  } catch (err) {
    Toast.show(err.message || 'Zaxira eksportida xato.');
  }
}

function triggerImportBackup() {
  document.getElementById('backup-file-input')?.click();
}

function importLocalBackup(event) {
  if (isServerPilotMode()) {
    Toast.show('Server pilot rejimida backup import o‘chirilgan.');
    if (event?.target) event.target.value = '';
    return;
  }
  const file = event?.target?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const snapshot = JSON.parse(String(reader.result || '{}'));
      AppState.user = Store.importBackup(snapshot);
      syncHelpCenterUI();
      if (AppState.user) {
        hydrateUserUI();
        initHome();
        Router.go('home', true);
      } else {
        clearUserUI();
        Router.go('onboarding', true);
      }
      Toast.show('Zaxira muvaffaqiyatli tiklandi.');
    } catch (err) {
      Toast.show(err.message || 'Zaxira faylini o‘qib bo‘lmadi.');
    } finally {
      if (event?.target) event.target.value = '';
    }
  };
  reader.onerror = () => {
    Toast.show('Faylni o‘qishda xato.');
    if (event?.target) event.target.value = '';
  };
  reader.readAsText(file);
}

function resetDemoConfirm() {
  if (isServerPilotMode()) { Toast.show('Real pilot buildda global reset o‘chirilgan.'); return; }
  const ok = confirm("Barcha lokal e'lonlar, murojaatlar va arxivlarni tozalashni xohlaysizmi?");
  if (!ok) return;
  Store.resetDemoData();
  AppState.user = Store.loadUser();
  if (AppState.user) { hydrateUserUI(); initHome(); } else { clearUserUI(); } 
  Toast.show("Lokal ma'lumotlar tozalandi.");
}

async function logout() {
  document.getElementById('success-modal').classList.remove('open');
  if (isServerPilotMode()) { try { await AuthAPI.logout(); } catch (err) { console.warn('logout api failed', err); } }
  try { sessionStorage.removeItem('tezkorish.authenticated'); } catch {}
  Store.clearUser();
  if (dutyPulseTimer) clearInterval(dutyPulseTimer);
  dutyPulseTimer = null;
  AppState.user = null;
  AppState.authDraft = { role: null, phoneDigits: '', otpVerified: false, otpCode: '', name: '', authMode: 'telegram', telegramVerified: false, telegramUserId: '', telegramUsername: '', telegramPhotoUrl: '' };
  AppState.selectedCat = 'hammasi';
  AppState.searchQuery = '';
  AppState.postCat = null;
  AppState.postDuration = SETTINGS.defaultExpiryHours;
  AppState.currentJobId = null;
  AppState.editingJobId = null;
  const searchInput = document.getElementById('home-search-input');
  if (searchInput) searchInput.value = '';
  document.getElementById('home-role-note')?.remove();
  clearAuthDraft();
  clearUserUI();
  resetPostForm();
  Router.go('onboarding', true);
}

if ('serviceWorker' in navigator && !isFileProtocol() && isSecureAppContext()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW register skipped:', err));
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(getAppSettings().theme);
  renderUserPresenceBadges();
  syncHelpCenterUI();
  updateRuntimeNotes();
  initPost();
  clearUserUI();

  if (!isServerPilotMode()) {
    try { Store.ensureSeeded(); } catch (err) { console.warn('ensureSeeded bootstrap failed:', err); }
  }

  const bootstrapped = await bootstrapServerAuthSession();
  if (bootstrapped) return;
  if (isServerPilotMode()) { try { Store.clearUser(); } catch {} AppState.user = null; clearUserUI(); }
  const handledTelegram = handleTelegramCallbackFromUrl();
  if (handledTelegram) return;
  await renderTelegramLoginOptions();
  if (isServerPilotMode()) {
    Router.go('auth-telegram', true);
  } else {
    initSplash();
  }
});
