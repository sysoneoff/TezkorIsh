
// ═══════════════════════════════
// TezkorIsh — Data Layer v5.0
// 60% local-first MVP with cleaner feed logic
// ═══════════════════════════════
'use strict';

const SETTINGS = {
  district: "Uchko'prik tumani",
  activeJobLimit: 3,
  defaultExpiryHours: 24,
  closedRetentionHours: 72,
  appVersion: 'real-pilot-v28',
  demoAdminPhoneDigits: [],
};

const STORAGE_KEYS = {
  meta: 'tezkorish.meta',
  user: 'tezkorish.user',
  jobs: 'tezkorish.jobs',
  applications: 'tezkorish.applications',
  savedJobs: 'tezkorish.savedJobs',
  reports: 'tezkorish.reports',
  users: 'tezkorish.users',
  backup: 'tezkorish.backup',
  settings: 'tezkorish.settings',
  contracts: 'tezkorish.contracts',
  reviews: 'tezkorish.reviews',
  chats: 'tezkorish.chats',
};

function getPilotConfigSafe() {
  try {
    return window.TEZKOR_PILOT_CONFIG || {};
  } catch {
    return {};
  }
}

function getApiBaseUrl() {
  const cfg = getPilotConfigSafe();
  return String(cfg.apiBaseUrl || '').trim().replace(/\/$/, '');
}


function normalizeRemoteAuthUser(user) {
  if (!user) return null;
  const roleValue = String(user.role || '').trim().toLowerCase();
  const normalizedRole = ['ishchi', 'worker'].includes(roleValue)
    ? 'ishchi'
    : (['beruvchi', 'ish beruvchi', 'ish_beruvchi', 'employer', 'admin'].includes(roleValue) ? 'beruvchi' : (roleValue || null));
  const phoneDigits = String(user.phoneDigits || user.phone || '').replace(/\D/g, '');
  return {
    ...user,
    role: normalizedRole,
    phoneDigits,
    phone: user.phone || (phoneDigits ? ('+998 ' + phoneDigits) : ''),
    telegramUserId: String(user.telegramUserId || user.telegram_user_id || ''),
    telegramUsername: String(user.telegramUsername || user.telegram_username || user.username || ''),
    telegramPhotoUrl: String(user.telegramPhotoUrl || user.photo_url || ''),
    authProvider: user.authProvider || (user.telegramUserId || user.telegram_user_id ? 'telegram' : 'local'),
    rating: Number(user.rating || 0),
    completedJobs: Number(user.completedJobs || 0),
    availability: {
      onDuty: false,
      lastShiftStartedAt: null,
      lastSeenJobAt: 0,
      ...(user.availability || {}),
    },
    isAdmin: Boolean(user.isAdmin),
  };
}

function getSessionUserSnapshot() {
  try {
    const inMemory = normalizeRemoteAuthUser(typeof AppState !== 'undefined' ? AppState.user : null);
    if (inMemory && inMemory.id) return inMemory;
  } catch {}
  try {
    const cfg = getPilotConfigSafe();
    const serverMode = String(cfg.pilotMode || '').toLowerCase() === 'server';
    const bootOk = sessionStorage.getItem('tezkorish.authenticated') === '1';
    if (serverMode && !bootOk) return null;
    const raw = localStorage.getItem(STORAGE_KEYS.user);
    if (!raw) return null;
    return normalizeRemoteAuthUser(JSON.parse(raw));
  } catch {
    return null;
  }
}


async function remoteRequest(method, url, body, options = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: body ? JSON.stringify(body) : undefined,
    keepalive: Boolean(options.keepalive),
  });
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || payload?.ok === false) {
    const err = new Error(payload?.error || `Remote storage request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return payload;
}

let remoteWriteTimer = null;
let remoteFlushPromise = null;
const remoteWriteQueue = new Map();
const REMOTE_IMMEDIATE_KEYS = new Set([
  STORAGE_KEYS.jobs,
  STORAGE_KEYS.applications,
  STORAGE_KEYS.users,
  STORAGE_KEYS.contracts,
  STORAGE_KEYS.reviews,
  STORAGE_KEYS.chats,
  STORAGE_KEYS.reports,
  STORAGE_KEYS.meta,
]);

function isImmediateRemoteKey(key) {
  return REMOTE_IMMEDIATE_KEYS.has(String(key || ''));
}

async function flushRemoteWriteQueue(options = {}) {
  if (!shouldUseRemoteStorage()) return;
  if (remoteFlushPromise) return remoteFlushPromise;
  if (!remoteWriteQueue.size) return;
  const apiBase = getApiBaseUrl();
  const items = Array.from(remoteWriteQueue.entries()).map(([key, value]) => ({ key, value }));
  remoteWriteQueue.clear();
  if (remoteWriteTimer) { clearTimeout(remoteWriteTimer); remoteWriteTimer = null; }

  const sendWithBeacon = Boolean(options.useBeacon && navigator.sendBeacon);
  if (sendWithBeacon) {
    try {
      const payload = JSON.stringify({ items });
      const blob = new Blob([payload], { type: 'application/json' });
      const ok = navigator.sendBeacon(`${apiBase}/storage/write-batch`, blob);
      if (ok) return;
    } catch {}
  }

  remoteFlushPromise = (async () => {
    try {
      await remoteRequest('POST', `${apiBase}/storage/write-batch`, { items }, { keepalive: !!options.keepalive });
    } catch (err) {
      console.warn('Remote write batch failed:', err?.message || err);
      for (const item of items) remoteWriteQueue.set(item.key, item.value);
      throw err;
    } finally {
      remoteFlushPromise = null;
    }
  })();
  return remoteFlushPromise;
}

function queueRemoteWrite(key, value, options = {}) {
  if (!shouldUseRemoteStorage()) return;
  const user = getSessionUserSnapshot();
  if (!user && key !== STORAGE_KEYS.meta && key !== STORAGE_KEYS.settings) return;
  remoteWriteQueue.set(key, value);
  const immediate = options.immediate || isImmediateRemoteKey(key);
  if (immediate) {
    flushRemoteWriteQueue({ keepalive: true }).catch(() => {});
    return;
  }
  if (remoteWriteTimer) return;
  remoteWriteTimer = setTimeout(() => {
    flushRemoteWriteQueue({ keepalive: true }).catch(() => {});
  }, 150);
}

async function syncRemoteMirror() {
  if (!shouldUseRemoteStorage()) return { ok: false, reason: 'remote-off' };
  const apiBase = getApiBaseUrl();
  try {
    const snapshot = await remoteRequest('GET', `${apiBase}/storage/snapshot`);
    const global = snapshot?.global || {};
    Object.entries(global).forEach(([key, value]) => {
      localStorage.setItem(key, JSON.stringify(value));
    });
    const userScoped = snapshot?.userScoped || {};
    Object.entries(userScoped).forEach(([key, value]) => {
      localStorage.setItem(key, JSON.stringify(value));
    });
    if (snapshot?.authUser) {
      localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(normalizeRemoteAuthUser(snapshot.authUser)));
      sessionStorage.setItem('tezkorish.authenticated', '1');
    } else {
      localStorage.removeItem(STORAGE_KEYS.user);
      sessionStorage.removeItem('tezkorish.authenticated');
    }
    return snapshot;
  } catch (err) {
    if (err?.status === 401) {
      localStorage.removeItem(STORAGE_KEYS.user);
      sessionStorage.removeItem('tezkorish.authenticated');
      return { ok: false, reason: 'unauthorized' };
    }
    throw err;
  }
}

function shouldUseRemoteStorage() {
  try {
    const cfg = getPilotConfigSafe();
    const apiBase = getApiBaseUrl();
    const serverMode = String(cfg.pilotMode || '').toLowerCase() === 'server';
    return Boolean(apiBase && !window.location.protocol.startsWith('file') && serverMode);
  } catch {
    return false;
  }
}

window.addEventListener('pagehide', () => {
  flushRemoteWriteQueue({ useBeacon: true, keepalive: true }).catch(() => {});
});


const CATEGORIES = [
  { id: 'hammasi', icon: '🔥', name: 'Hammasi' },
  { id: 'yukchi', icon: '🚚', name: 'Yukchi' },
  { id: 'qurilish', icon: '🏗️', name: 'Qurilish' },
  { id: 'tozalovchi', icon: '🧹', name: 'Tozalovchi' },
  { id: 'qorovul', icon: '👮', name: "Qo'riqchi" },
  { id: 'haydovchi', icon: '🚗', name: 'Haydovchi' },
  { id: 'bogbon', icon: '🌿', name: "Bog'bon" },
  { id: 'oshpaz', icon: '🍳', name: 'Oshpaz' },
  { id: 'boshqa', icon: '⚙️', name: 'Boshqa' },
];

const POST_CATEGORIES = CATEGORIES.filter(c => c.id !== 'hammasi');

function hoursAgo(hours) {
  return Date.now() - hours * 60 * 60 * 1000;
}

function buildSeedJob(id, data, createdHoursAgo = 1, durationHours = 24) {
  const createdAt = hoursAgo(createdHoursAgo);
  return {
    id,
    cat: data.cat,
    title: data.title,
    desc: data.desc,
    price: String(data.price),
    priceType: data.priceType || 'kun',
    location: data.location,
    phone: data.phone,
    poster: data.poster,
    posterRating: data.posterRating || 4.8,
    posterDeals: data.posterDeals || 0,
    duration: durationHours,
    createdAt,
    expiresAt: createdAt + durationHours * 60 * 60 * 1000,
    views: data.views || 0,
    status: 'active',
    ownerId: data.ownerId || 'seed-employer',
    selectedApplicationId: null,
  };
}

const SEED_JOBS = [];

const AppState = {
  user: null,
  authDraft: {
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
  },
  selectedCat: 'hammasi',
  searchQuery: '',
  postCat: null,
  postDuration: SETTINGS.defaultExpiryHours,
  currentJobId: null,
  editingJobId: null,
  homeVisibleJobIds: [],
  homeLastRefreshAt: 0,
  homeFilter: {
    matchedOnly: false,
    priceOrder: 'none',
    nearbyOnly: false,
  },
  employerActivityFilter: 'all',
};

const Store = (() => {
  function safeRead(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback;
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function normalizeRole(role) {
    const value = String(role || '').trim().toLowerCase();
    if (['ishchi', 'worker'].includes(value)) return 'ishchi';
    if (['beruvchi', 'ish beruvchi', 'ish_beruvchi', 'employer', 'admin'].includes(value)) return 'beruvchi';
    return value || null;
  }

  function normalizeUser(user) {
    if (!user) return null;
    const normalizedRole = normalizeRole(user.role);
    const phoneDigits = String(user.phoneDigits || user.phone || '').replace(/\D/g, '');
    return {
      ...user,
      role: normalizedRole,
      phoneDigits,
      phone: user.phone || (phoneDigits ? ('+998 ' + phoneDigits) : ''),
      telegramUserId: String(user.telegramUserId || user.telegram_user_id || ''),
      telegramUsername: String(user.telegramUsername || user.telegram_username || user.username || ''),
      telegramPhotoUrl: String(user.telegramPhotoUrl || user.photo_url || ''),
      authProvider: user.authProvider || (user.telegramUserId || user.telegram_user_id ? 'telegram' : 'local'),
      rating: Number(user.rating || 0),
      completedJobs: Number(user.completedJobs || 0),
      availability: {
        onDuty: false,
        lastShiftStartedAt: null,
        lastSeenJobAt: 0,
        ...user.availability,
      },
      isAdmin: Boolean(user.isAdmin),
    };
  }

  function getSessionUser() {
    const inMemory = normalizeUser(typeof AppState !== 'undefined' ? AppState.user : null);
    if (isValidUser(inMemory)) {
      const persisted = normalizeUser(safeRead(STORAGE_KEYS.user, null));
      if (!persisted || String(persisted.id) !== String(inMemory.id) || persisted.role !== inMemory.role || String(persisted.phoneDigits) !== String(inMemory.phoneDigits)) {
        save(STORAGE_KEYS.user, inMemory);
      }
      return inMemory;
    }
    return loadUser();
  }


  function loadSettingsRaw() {
    return safeRead(STORAGE_KEYS.settings, {
      theme: 'sysone',
      preferredCats: [],
      nearbyRadiusKm: 10,
      workerLocation: null,
      workerAddress: '',
    });
  }

  function saveSettings(settings) {
    const current = loadSettingsRaw();
    const next = {
      ...current,
      ...(settings || {}),
      preferredCats: Array.isArray(settings?.preferredCats ?? current.preferredCats)
        ? Array.from(new Set((settings?.preferredCats ?? current.preferredCats).filter(Boolean)))
        : [],
      nearbyRadiusKm: Number(settings?.nearbyRadiusKm ?? current.nearbyRadiusKm ?? 10) || 10,
    };
    return save(STORAGE_KEYS.settings, next);
  }

  function loadContractsRaw() {
    return safeRead(STORAGE_KEYS.contracts, []);
  }

  function saveContracts(contracts) {
    return save(STORAGE_KEYS.contracts, Array.isArray(contracts) ? contracts : []);
  }

  function loadReviewsRaw() {
    return safeRead(STORAGE_KEYS.reviews, []);
  }

  function saveReviews(reviews) {
    return save(STORAGE_KEYS.reviews, Array.isArray(reviews) ? reviews : []);
  }

  function loadChatsRaw() {
    return safeRead(STORAGE_KEYS.chats, []);
  }

  function saveChats(chats) {
    return save(STORAGE_KEYS.chats, Array.isArray(chats) ? chats : []);
  }

  function touchUserPresence(userId) {
    const user = getUserById(userId);
    if (!user) return null;
    user.lastActiveAt = Date.now();
    upsertUser(user);
    const currentUser = getSessionUser();
    if (currentUser && String(currentUser.id) === String(user.id)) save(STORAGE_KEYS.user, normalizeUser(user));
    return user;
  }

  function getPresenceSummary() {
    const users = loadUsersRaw();
    const now = Date.now();
    return {
      total: users.length,
      online: users.filter(u => (now - Number(u.lastActiveAt || 0)) <= 5 * 60 * 1000).length,
    };
  }

  function recalcUserRating(userId) {
    const reviews = loadReviewsRaw().filter(r => String(r.toUserId) === String(userId));
    const user = getUserById(userId);
    if (!user) return null;
    const avg = reviews.length ? reviews.reduce((s, r) => s + Number(r.score || 0), 0) / reviews.length : 0;
    user.rating = Math.round(avg * 10) / 10;
    upsertUser(user);
    const currentUser = getSessionUser();
    if (currentUser && String(currentUser.id) === String(user.id)) save(STORAGE_KEYS.user, normalizeUser(user));
    return user;
  }

  function isAdminUser(user) {
    const normalized = normalizeUser(user);
    return !!normalized?.isAdmin;
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    if (shouldUseRemoteStorage()) {
      const user = getSessionUser();
      if (user) queueRemoteWrite(key, value, { immediate: isImmediateRemoteKey(key) });
    }
    return value;
  }

  function loadMeta() {
    return safeRead(STORAGE_KEYS.meta, {});
  }

  function saveMeta(meta) {
    return save(STORAGE_KEYS.meta, meta);
  }

  function loadUsersRaw() {
    return safeRead(STORAGE_KEYS.users, []);
  }

  function saveUsers(users) {
    return save(STORAGE_KEYS.users, users.map(normalizeUser));
  }

  function upsertUser(user) {
    const normalized = normalizeUser(user);
    if (!normalized || !normalized.id) return normalized;
    const users = loadUsersRaw();
    const idx = users.findIndex(item => String(item.id) === String(normalized.id));
    if (idx >= 0) users[idx] = { ...users[idx], ...normalized };
    else users.unshift(normalized);
    saveUsers(users);
    return normalized;
  }

  function findUserByPhoneRole(phoneDigits, role) {
    return loadUsersRaw().find(item => String(item.phoneDigits) === String(phoneDigits) && (!role || item.role === role)) || null;
  }

  function findUserByTelegramId(telegramUserId) {
    return loadUsersRaw().find(item => String(item.telegramUserId || '') === String(telegramUserId || '')) || null;
  }

  function getUserById(userId) {
    return loadUsersRaw().find(item => String(item.id) === String(userId)) || null;
  }

  function isValidUser(user) {
    return !!(user && typeof user === 'object' && user.id && user.name && user.phone && user.phoneDigits && ['ishchi', 'beruvchi'].includes(user.role));
  }

  function loadUser() {
    const user = normalizeUser(safeRead(STORAGE_KEYS.user, null));
    if (isValidUser(user)) return user;
    // Noto‘g‘ri yoki eski user saqlangan bo‘lsa, uni tozalaymiz
    localStorage.removeItem(STORAGE_KEYS.user);
    localStorage.removeItem('tezkorish_user');
    localStorage.removeItem('user');
    return null;
  }

  function saveUser(user) {
    const normalized = upsertUser({ ...(user || {}), lastActiveAt: Date.now() });
    return save(STORAGE_KEYS.user, normalized);
  }

  function clearUser() {
    localStorage.removeItem(STORAGE_KEYS.user);
    localStorage.removeItem('tezkorish_user');
    localStorage.removeItem('user');
  }

  function loadJobsRaw() {
    return safeRead(STORAGE_KEYS.jobs, []);
  }

  function saveJobs(jobs) {
    return save(STORAGE_KEYS.jobs, jobs);
  }

  function loadApplicationsRaw() {
    return safeRead(STORAGE_KEYS.applications, []);
  }

  function saveApplications(applications) {
    return save(STORAGE_KEYS.applications, applications);
  }

  function loadSavedRaw() {
    return safeRead(STORAGE_KEYS.savedJobs, []);
  }

  function saveSaved(saved) {
    return save(STORAGE_KEYS.savedJobs, saved);
  }

  function loadReportsRaw() {
    return safeRead(STORAGE_KEYS.reports, []);
  }

  function saveReports(reports) {
    return save(STORAGE_KEYS.reports, reports);
  }

  function ensureSeeded() {
    const meta = loadMeta();
    const user = getSessionUser();
    const isRemote = shouldUseRemoteStorage();
    let jobs = loadJobsRaw();

    if (!jobs.length && !meta.seedInitialized && !isRemote) {
      saveJobs(SEED_JOBS);
      jobs = loadJobsRaw();
    }

    if (!isRemote) {
      if (!loadApplicationsRaw().length) saveApplications([]);
      if (!loadSavedRaw().length) saveSaved([]);
      if (!loadReportsRaw().length) saveReports([]);
      if (!loadUsersRaw().length) saveUsers([]);
      if (!loadContractsRaw().length) saveContracts([]);
      if (!loadReviewsRaw().length) saveReviews([]);
      if (!loadChatsRaw().length) saveChats([]);
    }

    const settingsExisting = safeRead(STORAGE_KEYS.settings, null);
    if (user && !settingsExisting) saveSettings(loadSettingsRaw());

    if (user) saveUser(user);
    else if (!isRemote) clearUser();

    if (!isRemote || user) {
      saveMeta({
        ...meta,
        appVersion: SETTINGS.appVersion,
        lastOpenedAt: Date.now(),
        firstInstalledAt: meta.firstInstalledAt || Date.now(),
        seedInitialized: true,
      });
    }

    cleanupExpiredJobs();
  }

  function cleanupExpiredJobs() {
    const now = Date.now();
    const isRemote = shouldUseRemoteStorage();
    const user = getSessionUser();
    let jobs = loadJobsRaw().map(job => {
      if (job.status === 'active' && job.expiresAt <= now) {
        return { ...job, status: 'expired', hiddenAt: now };
      }
      if (['closed', 'expired'].includes(job.status) && !job.hiddenAt) {
        return { ...job, hiddenAt: job.closedAt || now };
      }
      return job;
    });

    const jobsMap = new Map(jobs.map(job => [String(job.id), job]));
    let applications = loadApplicationsRaw().map(app => {
      const job = jobsMap.get(String(app.jobId));
      if (!job) return app;
      if (job.status === 'expired' && ['pending', 'accepted', 'in_progress'].includes(app.status)) {
        return { ...app, status: 'expired' };
      }
      if (job.status === 'closed' && app.status === 'pending') {
        return { ...app, status: 'job_closed' };
      }
      return app;
    });

    // lightweight archive cleanup so old hidden data does not keep polluting local demo
    const cutoff = now - SETTINGS.closedRetentionHours * 60 * 60 * 1000;
    const keepJobIds = new Set(jobs.filter(job => !job.hiddenAt || job.hiddenAt >= cutoff).map(job => String(job.id)));
    jobs = jobs.filter(job => keepJobIds.has(String(job.id)) || ['active', 'assigned', 'in_progress'].includes(job.status));
    applications = applications.filter(app => keepJobIds.has(String(app.jobId)));
    const saved = loadSavedRaw().filter(item => keepJobIds.has(String(item.jobId)));

    // Guest foydalanuvchi login sahifasida turganda remote write qilinmasin.
    if (!isRemote || user) {
      saveJobs(jobs);
      saveApplications(applications);
      saveSaved(saved);
    }
    return jobs;
  }

  function getAllJobs() {
    return cleanupExpiredJobs().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function getPublicFeedJobs() {
    return getAllJobs().filter(job => job.status === 'active' && job.expiresAt > Date.now());
  }

  function getActiveJobs() {
    return getPublicFeedJobs();
  }

  function getMyJobs(userId) {
    return getAllJobs().filter(job => String(job.ownerId) === String(userId));
  }

  function getEmployerHomeJobs(userId) {
    return getMyJobs(userId).sort((a, b) => {
      const rank = status => ['active', 'assigned', 'in_progress', 'closed', 'expired'].indexOf(status);
      const diff = rank(a.status) - rank(b.status);
      if (diff !== 0) return diff;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function getJob(jobId) {
    return getAllJobs().find(job => String(job.id) === String(jobId)) || null;
  }

  function getActiveJobCountForOwner(userId) {
    return getMyJobs(userId).filter(job => ['active', 'assigned', 'in_progress'].includes(job.status)).length;
  }

  function createJob(payload) {
    const user = getSessionUser();
    if (!user || user.role !== 'beruvchi') throw new Error('Faqat ish beruvchi e’lon yarata oladi.');
    if (getActiveJobCountForOwner(user.id) >= SETTINGS.activeJobLimit) {
      throw new Error(`Bir vaqtda ${SETTINGS.activeJobLimit} ta faol e’londan oshirib bo‘lmaydi.`);
    }

    const now = Date.now();
    const job = {
      id: now,
      cat: payload.cat,
      title: payload.title,
      desc: payload.desc,
      price: String(payload.price),
      priceType: 'kun',
      location: payload.location,
      phone: String(payload.phone || user.phoneDigits || '').replace(/\D/g, ''),
      schedule: payload.schedule || '',
      mapLink: payload.mapLink || '',
      telegram: payload.telegram || '',
      lat: payload.lat || null,
      lng: payload.lng || null,
      poster: user.name,
      posterRating: user.rating || 0,
      posterDeals: user.completedJobs || 0,
      duration: payload.duration,
      createdAt: now,
      expiresAt: now + payload.duration * 60 * 60 * 1000,
      views: 0,
      status: 'active',
      ownerId: user.id,
      selectedApplicationId: null,
      hiddenAt: null,
    };

    saveJobs([job, ...getAllJobs()]);
    return job;
  }

  function updateJob(jobId, payload, userId) {
    const existing = getJob(jobId);
    if (!existing) throw new Error('E’lon topilmadi.');
    if (String(existing.ownerId) !== String(userId)) throw new Error('Bu e’lon sizga tegishli emas.');
    if (existing.status !== 'active') throw new Error('Faqat aktiv e’lon tahrirlanadi.');

    const jobs = getAllJobs().map(job => {
      if (String(job.id) !== String(jobId)) return job;
      return {
        ...job,
        cat: payload.cat,
        title: payload.title,
        desc: payload.desc,
        price: String(payload.price),
        location: payload.location,
        phone: String(payload.phone || job.phone || '').replace(/\D/g, ''),
        schedule: payload.schedule || '',
      mapLink: payload.mapLink || '',
      telegram: payload.telegram || '',
      lat: payload.lat || null,
      lng: payload.lng || null,
        duration: payload.duration,
        expiresAt: job.createdAt + payload.duration * 60 * 60 * 1000,
      };
    });

    saveJobs(jobs);
    return getJob(jobId);
  }

  function incrementView(jobId) {
    const jobs = getAllJobs().map(job => {
      if (String(job.id) !== String(jobId)) return job;
      return { ...job, views: (job.views || 0) + 1 };
    });
    saveJobs(jobs);
  }

  function closeJob(jobId, userId) {
    const target = getJob(jobId);
    if (!target) throw new Error('E’lon topilmadi.');
    if (String(target.ownerId) !== String(userId)) throw new Error('Bu e’lon sizga tegishli emas.');
    if (!['active', 'assigned', 'in_progress'].includes(target.status)) throw new Error('Bu e’lonni hozir yopib bo‘lmaydi.');

    const now = Date.now();
    const jobs = getAllJobs().map(job => {
      if (String(job.id) !== String(jobId)) return job;
      return { ...job, status: 'closed', closedAt: now, hiddenAt: now };
    });
    saveJobs(jobs);

    const applications = loadApplicationsRaw().map(app => {
      if (String(app.jobId) !== String(jobId)) return app;
      if (['completed', 'rejected', 'withdrawn', 'job_closed'].includes(app.status)) return app;
      return { ...app, status: 'job_closed' };
    });
    saveApplications(applications);
    const contracts = loadContractsRaw().map(contract => {
      if (String(contract.jobId) !== String(jobId)) return contract;
      if (['completed', 'closed'].includes(contract.status)) return contract;
      return { ...contract, status: 'closed', closedAt: now };
    });
    saveContracts(contracts);
  }

  function completeJob(jobId, userId) {
    const job = getJob(jobId);
    if (!job) throw new Error('E’lon topilmadi.');
    if (String(job.ownerId) !== String(userId)) throw new Error('Bu e’lon sizga tegishli emas.');
    if (!['assigned', 'in_progress'].includes(job.status)) throw new Error('Ish hali tanlanmagan yoki jarayonga kirmagan.');

    const now = Date.now();
    const jobs = getAllJobs().map(item => {
      if (String(item.id) !== String(jobId)) return item;
      return { ...item, status: 'closed', closedAt: now, hiddenAt: now };
    });
    saveJobs(jobs);

    const applications = loadApplicationsRaw().map(app => {
      if (String(app.jobId) !== String(jobId)) return app;
      if (String(app.id) === String(job.selectedApplicationId)) return { ...app, status: 'completed', completedAt: now };
      if (['pending', 'accepted', 'in_progress'].includes(app.status)) return { ...app, status: 'job_closed' };
      return app;
    });
    saveApplications(applications);

    const winningApp = applications.find(app => String(app.id) === String(job.selectedApplicationId));
    const contracts = loadContractsRaw().map(contract => {
      if (String(contract.jobId) !== String(jobId)) return contract;
      return { ...contract, status: 'completed', completedAt: now, closedAt: now };
    });
    saveContracts(contracts);

    if (winningApp) {
      const worker = getUserById(winningApp.workerId);
      if (worker) {
        worker.completedJobs = (worker.completedJobs || 0) + 1;
        upsertUser(worker);
        const currentUser = getSessionUser();
        if (currentUser && String(currentUser.id) === String(worker.id)) save(STORAGE_KEYS.user, normalizeUser(worker));
      }
    }
  }

  function getAllApplications() {
    cleanupExpiredJobs();
    return loadApplicationsRaw().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function getMyApplications(workerId) {
    return getAllApplications().filter(app => String(app.workerId) === String(workerId));
  }

  function getApplicationsForEmployer(employerId) {
    return getAllApplications().filter(app => String(app.employerId) === String(employerId));
  }

  function getApplicationsForJob(jobId) {
    return getAllApplications().filter(app => String(app.jobId) === String(jobId));
  }

  function getMyApplicationForJob(jobId, workerId) {
    return getAllApplications().find(app => String(app.jobId) === String(jobId) && String(app.workerId) === String(workerId)) || null;
  }

  function createApplication(jobId) {
    const user = getSessionUser();
    if (!user || user.role !== 'ishchi') throw new Error('Faqat ishchi murojaat yubora oladi.');

    const job = getJob(jobId);
    if (!job) throw new Error('E’lon topilmadi.');
    if (job.status !== 'active') throw new Error('Bu e’lon endi faol emas.');
    if (String(job.ownerId) === String(user.id)) throw new Error('O‘zingizning e’loningizga murojaat qilib bo‘lmaydi.');

    const existing = getMyApplicationForJob(jobId, user.id);
    if (existing && !['withdrawn', 'rejected', 'expired', 'job_closed'].includes(existing.status)) {
      throw new Error('Siz bu e’longa allaqachon murojaat yuborgansiz.');
    }

    const application = {
      id: 'a-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      jobId: job.id,
      jobTitle: job.title,
      jobCat: job.cat,
      jobLocation: job.location,
      employerId: job.ownerId,
      employerName: job.poster,
      employerPhone: job.phone,
      workerId: user.id,
      workerName: user.name,
      workerPhone: user.phoneDigits,
      status: 'pending',
      createdAt: Date.now(),
    };

    saveApplications([application, ...getAllApplications()]);
    return application;
  }

  function cancelApplication(applicationId, userId) {
    const target = getAllApplications().find(app => String(app.id) === String(applicationId));
    if (!target) throw new Error('Murojaat topilmadi.');
    if (String(target.workerId) !== String(userId)) throw new Error('Bu murojaat sizga tegishli emas.');
    if (target.status !== 'pending') {
      throw new Error(target.status === 'accepted' ? 'Bu ish allaqachon qabul qilingan. Ish beruvchi bilan bog‘laning.' : 'Faqat kutilayotgan murojaat bekor qilinadi.');
    }
    const applications = getAllApplications().map(app => {
      if (String(app.id) !== String(applicationId)) return app;
      return { ...app, status: 'withdrawn', withdrawnAt: Date.now() };
    });
    saveApplications(applications);
  }

  function setApplicationStatus(applicationId, employerId, status) {
    const allowed = ['accepted', 'rejected'];
    if (!allowed.includes(status)) throw new Error('Noto‘g‘ri status.');
    const target = getAllApplications().find(app => String(app.id) === String(applicationId));
    if (!target) throw new Error('Murojaat topilmadi.');
    if (String(target.employerId) !== String(employerId)) throw new Error('Ruxsat yo‘q.');
    if (target.status !== 'pending') throw new Error('Faqat yangi murojaatni tasdiqlash yoki rad etish mumkin.');

    let applications = getAllApplications().map(app => {
      if (String(app.id) !== String(applicationId)) return app;
      return { ...app, status, updatedAt: Date.now() };
    });

    let jobs = getAllJobs();
    if (status === 'accepted') {
      applications = applications.map(app => {
        if (String(app.jobId) !== String(target.jobId) || String(app.id) === String(applicationId)) return app;
        return app.status === 'pending' ? { ...app, status: 'rejected' } : app;
      });

      jobs = jobs.map(job => {
        if (String(job.id) !== String(target.jobId)) return job;
        return { ...job, status: 'assigned', selectedApplicationId: applicationId, assignedAt: Date.now() };
      });
    }

    saveApplications(applications);
    saveJobs(jobs);

    if (status === 'accepted') {
      const worker = getUserById(target.workerId);
      const employer = getUserById(target.employerId);
      const job = getJob(target.jobId);
      if (job) {
        const contracts = loadContractsRaw().filter(c => String(c.applicationId) !== String(applicationId));
        contracts.unshift({
          id: 'c-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          jobId: job.id,
          applicationId,
          employerId: target.employerId,
          workerId: target.workerId,
          employerName: employer?.name || target.employerName,
          workerName: worker?.name || target.workerName,
          employerPhone: job.phone || target.employerPhone || '',
          workerPhone: target.workerPhone || '',
          title: job.title,
          cat: job.cat,
          location: job.location,
          mapLink: job.mapLink || '',
          schedule: job.schedule || '',
          status: 'accepted',
          createdAt: Date.now(),
          completedAt: null,
          closedAt: null,
          threadId: 't-' + applicationId,
        });
        saveContracts(contracts);
      }
    }
  }

  function markWorkerJobStarted(applicationId, workerId) {
    const target = getAllApplications().find(app => String(app.id) === String(applicationId));
    if (!target) throw new Error('Murojaat topilmadi.');
    if (String(target.workerId) !== String(workerId)) throw new Error('Bu ish sizga tegishli emas.');
    if (target.status !== 'accepted') throw new Error('Faqat qabul qilingan ishni boshlash mumkin.');

    const applications = getAllApplications().map(app => {
      if (String(app.id) !== String(applicationId)) return app;
      return { ...app, status: 'in_progress', startedAt: Date.now() };
    });
    const jobs = getAllJobs().map(job => {
      if (String(job.id) !== String(target.jobId)) return job;
      return { ...job, status: 'in_progress', startedAt: Date.now() };
    });
    saveApplications(applications);
    saveJobs(jobs);
    const contracts = loadContractsRaw().map(contract => {
      if (String(contract.applicationId) !== String(applicationId)) return contract;
      return { ...contract, status: 'in_progress', startedAt: Date.now() };
    });
    saveContracts(contracts);
  }

  function getSavedJobIds(workerId) {
    return loadSavedRaw()
      .filter(item => String(item.workerId) === String(workerId))
      .map(item => String(item.jobId));
  }

  function isJobSaved(jobId, workerId) {
    return getSavedJobIds(workerId).includes(String(jobId));
  }

  function toggleSavedJob(jobId, workerId) {
    const saved = loadSavedRaw();
    const exists = saved.find(item => String(item.jobId) === String(jobId) && String(item.workerId) === String(workerId));
    if (exists) {
      saveSaved(saved.filter(item => !(String(item.jobId) === String(jobId) && String(item.workerId) === String(workerId))));
      return false;
    }
    saveSaved([{ id: 's-' + Date.now(), workerId, jobId, createdAt: Date.now() }, ...saved]);
    return true;
  }

  function getSavedJobs(workerId) {
    const ids = new Set(getSavedJobIds(workerId));
    return getAllJobs().filter(job => ids.has(String(job.id)) && job.status === 'active');
  }

  function createReport(jobId, reason) {
    const user = getSessionUser();
    const job = getJob(jobId);
    if (!user || !job) throw new Error('Hisobot yuborib bo‘lmadi.');
    const reports = loadReportsRaw();
    const duplicate = reports.find(r => String(r.jobId) === String(jobId) && String(r.reporterId) === String(user.id) && r.status === 'open');
    if (duplicate) throw new Error('Siz bu e’lon haqida allaqachon xabar bergansiz.');

    const report = {
      id: 'r-' + Date.now() + '-' + Math.floor(Math.random() * 100),
      jobId: job.id,
      jobTitle: job.title,
      employerName: job.poster,
      reporterId: user.id,
      reporterName: user.name,
      reason,
      status: 'open',
      createdAt: Date.now(),
    };

    saveReports([report, ...reports]);
    return report;
  }

  function getReports() {
    return loadReportsRaw().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function resolveReport(reportId) {
    const user = getSessionUser();
    if (!isAdminUser(user)) throw new Error('Admin ruxsati kerak.');
    const reports = getReports().map(report => {
      if (String(report.id) !== String(reportId)) return report;
      return { ...report, status: 'resolved', resolvedAt: Date.now() };
    });
    saveReports(reports);
  }

  function getNewJobsSince(ts) {
    const safeTs = Number(ts || 0);
    return getPublicFeedJobs().filter(job => (job.createdAt || 0) > safeTs);
  }



  function getContractsForUser(userId) {
    return loadContractsRaw()
      .filter(contract => String(contract.workerId) == String(userId) || String(contract.employerId) == String(userId))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function submitReview(payload) {
    const user = getSessionUser();
    if (!user) throw new Error('Avval tizimga kiring.');
    const contract = loadContractsRaw().find(c => String(c.id) === String(payload.contractId));
    if (!contract) throw new Error('Shartnoma topilmadi.');
    if (!['completed', 'closed'].includes(contract.status)) throw new Error('Faqat yakunlangan ish uchun baho beriladi.');
    const fromUserId = String(user.id);
    const toUserId = String(payload.toUserId);
    if (fromUserId === toUserId) throw new Error('O‘zingizga baho bera olmaysiz.');
    const exists = loadReviewsRaw().find(r => String(r.contractId) === String(contract.id) && String(r.fromUserId) === fromUserId && String(r.toUserId) === toUserId);
    if (exists) throw new Error('Siz bu shartnoma bo‘yicha allaqachon baho qoldirgansiz.');
    const score = Math.max(1, Math.min(5, Number(payload.score || 0)));
    if (!score) throw new Error('Bahoni tanlang.');
    const reviews = loadReviewsRaw();
    reviews.unshift({
      id: 'rv-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      contractId: contract.id,
      jobId: contract.jobId,
      fromUserId,
      toUserId,
      fromRole: user.role,
      score,
      text: String(payload.text || '').trim(),
      createdAt: Date.now(),
    });
    saveReviews(reviews);
    recalcUserRating(toUserId);
    return true;
  }

  function getReviewsForUser(userId) {
    return loadReviewsRaw().filter(r => String(r.toUserId) === String(userId));
  }

  function duplicateJob(jobId, userId) {
    const source = getJob(jobId);
    if (!source) throw new Error('E’lon topilmadi.');
    if (String(source.ownerId) !== String(userId)) throw new Error('Bu e’lon sizga tegishli emas.');
    return createJob({
      cat: source.cat,
      title: source.title,
      desc: source.desc,
      price: source.price,
      location: source.location,
      phone: source.phone,
      schedule: source.schedule || '',
      mapLink: source.mapLink || '',
      telegram: source.telegram || '',
      lat: source.lat || null,
      lng: source.lng || null,
      duration: source.duration || SETTINGS.defaultExpiryHours,
    });
  }


  function getContractByJobAndUser(jobId, userId) {
    return loadContractsRaw().find(contract => String(contract.jobId) === String(jobId) && (String(contract.workerId) === String(userId) || String(contract.employerId) === String(userId))) || null;
  }

  function getChatThread(threadId, userId) {
    const chats = loadChatsRaw();
    const thread = chats.find(t => String(t.id) === String(threadId));
    if (!thread) return { id: threadId, participants: [], messages: [] };
    if (userId && !thread.participants.map(String).includes(String(userId))) throw new Error('Chatga ruxsat yo‘q.');
    return thread;
  }

  function getOrCreateThreadForContract(contractId, userId) {
    const contract = loadContractsRaw().find(c => String(c.id) === String(contractId));
    if (!contract) throw new Error('Shartnoma topilmadi.');
    if (![String(contract.workerId), String(contract.employerId)].includes(String(userId))) throw new Error('Chatga ruxsat yo‘q.');
    const threadId = contract.threadId || ('t-' + contract.applicationId);
    let chats = loadChatsRaw();
    let thread = chats.find(t => String(t.id) == String(threadId));
    if (!thread) {
      thread = {
        id: threadId,
        contractId: contract.id,
        jobId: contract.jobId,
        title: contract.title,
        participants: [contract.employerId, contract.workerId],
        messages: [],
        updatedAt: Date.now(),
      };
      chats.unshift(thread);
      saveChats(chats);
    }
    return thread;
  }

  function sendChatMessage(contractId, userId, text) {
    const body = String(text || '').trim();
    if (body.length < 1) throw new Error('Xabar bo‘sh bo‘lmasin.');
    const thread = getOrCreateThreadForContract(contractId, userId);
    const chats = loadChatsRaw();
    const idx = chats.findIndex(t => String(t.id) === String(thread.id));
    const msg = {
      id: 'm-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      fromUserId: userId,
      text: body.slice(0, 1200),
      createdAt: Date.now(),
    };
    chats[idx].messages.push(msg);
    chats[idx].updatedAt = msg.createdAt;
    saveChats(chats);
    touchUserPresence(userId);
    return msg;
  }

  function getChatThreadForContract(contractId, userId) {
    const thread = getOrCreateThreadForContract(contractId, userId);
    return getChatThread(thread.id, userId);
  }
  function exportBackup() {
    cleanupExpiredJobs();
    return {
      type: 'tezkorish-local-backup',
      version: SETTINGS.appVersion,
      exportedAt: Date.now(),
      data: {
        meta: loadMeta(),
        user: loadUser(),
        users: loadUsersRaw(),
        jobs: loadJobsRaw(),
        applications: loadApplicationsRaw(),
        savedJobs: loadSavedRaw(),
        reports: loadReportsRaw(),
        settings: loadSettingsRaw(),
        contracts: loadContractsRaw(),
        reviews: loadReviewsRaw(),
        chats: loadChatsRaw(),
      },
    };
  }

  function importBackup(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.data || typeof snapshot.data !== 'object') {
      throw new Error('Zaxira fayli noto‘g‘ri.');
    }
    const payload = snapshot.data;
    saveUsers(Array.isArray(payload.users) ? payload.users : []);
    saveJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
    saveApplications(Array.isArray(payload.applications) ? payload.applications : []);
    saveSaved(Array.isArray(payload.savedJobs) ? payload.savedJobs : []);
    saveReports(Array.isArray(payload.reports) ? payload.reports : []);
    saveSettings(payload.settings && typeof payload.settings === 'object' ? payload.settings : loadSettingsRaw());
    saveContracts(Array.isArray(payload.contracts) ? payload.contracts : []);
    saveReviews(Array.isArray(payload.reviews) ? payload.reviews : []);
    saveChats(Array.isArray(payload.chats) ? payload.chats : []);

    const importedUser = normalizeUser(payload.user || null);
    if (isValidUser(importedUser)) save(STORAGE_KEYS.user, importedUser);
    else clearUser();

    const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
    saveMeta({
      ...meta,
      appVersion: SETTINGS.appVersion,
      lastImportedAt: Date.now(),
      seedInitialized: true,
      firstInstalledAt: meta.firstInstalledAt || Date.now(),
    });
    save(STORAGE_KEYS.backup, { importedAt: Date.now(), sourceVersion: snapshot.version || 'unknown' });
    cleanupExpiredJobs();
    return loadUser();
  }

  function resetDemoData() {
    saveJobs([]);
    saveApplications([]);
    saveSaved([]);
    saveReports([]);
    saveContracts([]);
    saveReviews([]);
    saveChats([]);
    const meta = loadMeta();
    saveMeta({ ...meta, seedInitialized: true, appVersion: SETTINGS.appVersion, lastOpenedAt: Date.now(), firstInstalledAt: meta.firstInstalledAt || Date.now() });
    cleanupExpiredJobs();
  }

  function resetAllData() {
    Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
    ensureSeeded();
  }

  return {
    loadUser,
    saveUser,
    clearUser,
    findUserByPhoneRole,
    findUserByTelegramId,
    getUserById,
    ensureSeeded,
    loadJobs: getAllJobs,
    getAllJobs,
    getPublicFeedJobs,
    getActiveJobs,
    getMyJobs,
    getEmployerHomeJobs,
    getJob,
    createJob,
    updateJob,
    closeJob,
    completeJob,
    incrementView,
    getActiveJobCountForOwner,
    getAllApplications,
    getMyApplications,
    getApplicationsForEmployer,
    getApplicationsForJob,
    getMyApplicationForJob,
    createApplication,
    cancelApplication,
    setApplicationStatus,
    markWorkerJobStarted,
    getSavedJobIds,
    isJobSaved,
    toggleSavedJob,
    getSavedJobs,
    createReport,
    getReports,
    resolveReport,
    getNewJobsSince,
    resetDemoData,
    resetAllData,
    isValidUser,
    isAdminUser,
    normalizeRole,
    exportBackup,
    importBackup,
    getContractsForUser,
    submitReview,
    getReviewsForUser,
    getSettings: loadSettingsRaw,
    saveSettings,
    getAllUsers: loadUsersRaw,
    duplicateJob,
    touchUserPresence,
    syncRemoteMirror,
    getPresenceSummary,
    getContractByJobAndUser,
    getChatThreadForContract,
    sendChatMessage,
  };
})();
