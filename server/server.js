const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = path.resolve(__dirname, '..');
const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');
const APP_BASE_URL = String(process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  console.error('SESSION_SECRET .env da topilmadi!');
  process.exit(1);
}
const ADMIN_TELEGRAM_IDS = new Set(String(process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(v => v.trim()).filter(Boolean));

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

function nowIso() { return new Date().toISOString(); }
function randomId(prefix = 'id') { return `${prefix}_${crypto.randomBytes(12).toString('hex')}`; }

function defaultDb() {
  return {
    createdAt: nowIso(),
    updatedAt: nowIso(),
    storage: {
      global: {
        'tezkorish.meta': { appVersion: 'real-pilot-v31', firstInstalledAt: Date.now(), seedInitialized: true },
        'tezkorish.jobs': [],
        'tezkorish.applications': [],
        'tezkorish.savedJobs': [],
        'tezkorish.reports': [],
        'tezkorish.users': [],
        'tezkorish.contracts': [],
        'tezkorish.reviews': [],
        'tezkorish.chats': []
      },
      users: {}
    },
    sessions: {}
  };
}

function readDb() {
  let db;
  if (!fs.existsSync(DB_FILE)) {
    db = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return db;
  }
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    db = defaultDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return db;
  }
  const init = defaultDb();
  db.storage = db.storage || { global: {}, users: {} };
  db.storage.global = { ...init.storage.global, ...(db.storage.global || {}) };
  db.storage.users = db.storage.users || {};
  db.sessions = db.sessions || {};
  pruneSessions(db);
  return db;
}

function pruneSessions(db) {
  const cutoff = Date.now() - (14 * 24 * 60 * 60 * 1000);
  Object.keys(db.sessions || {}).forEach((sid) => {
    const session = db.sessions[sid];
    const updatedAt = session?.updatedAt ? new Date(session.updatedAt).getTime() : 0;
    if (!updatedAt || updatedAt < cutoff) delete db.sessions[sid];
  });
}

let writeChain = Promise.resolve();
function writeDb(db) {
  pruneSessions(db);
  db.updatedAt = nowIso();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function writeDbSafe(db) {
  writeChain = writeChain.then(() => { writeDb(db); });
  return writeChain;
}

function parseCookies(header = '') {
  const result = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    result[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return result;
}

function signValue(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(value)).digest('hex');
}

function verifySignedSessionId(raw = '') {
  const [sid, sig] = String(raw || '').split('.');
  if (!sid || !sig) return null;
  const expected = signValue(sid);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return sid;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve(null);
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function sendRedirect(res, location, headers = {}) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

function setSessionCookieHeader() {
  const secure = APP_BASE_URL.startsWith('https://');
  return `tezkorish_session=%SID%; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}${secure ? '; Secure' : ''}`;
}

function clearSessionCookieHeader() {
  return 'tezkorish_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function getSession(req, db) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sid = verifySignedSessionId(cookies.tezkorish_session || '');
  if (!sid) return { sid: null, session: null };
  return { sid, session: db.sessions[sid] || null };
}

function ensureSession(req, res, db) {
  const found = getSession(req, db);
  if (found.sid && found.session) return found;
  const sid = randomId('sess');
  db.sessions[sid] = { createdAt: nowIso(), updatedAt: nowIso(), userId: null, pendingTelegram: null };
  writeDb(db);
  const cookie = setSessionCookieHeader().replace('%SID%', encodeURIComponent(`${sid}.${signValue(sid)}`));
  res.setHeader('Set-Cookie', cookie);
  return { sid, session: db.sessions[sid] };
}

function isCompleteUser(user) {
  return !!(user && user.id && user.name && user.phone && user.phoneDigits && user.role);
}

function getUsers(db) {
  return Array.isArray(db.storage.global['tezkorish.users']) ? db.storage.global['tezkorish.users'] : [];
}

function saveUsers(db, users) {
  db.storage.global['tezkorish.users'] = Array.isArray(users) ? users : [];
}

function getUserById(db, userId) {
  return getUsers(db).find(u => String(u.id) === String(userId)) || null;
}

function getUsersByTelegramId(db, telegramUserId) {
  return getUsers(db).filter(u => String(u.telegramUserId || '') === String(telegramUserId || ''));
}

function getUserByTelegramId(db, telegramUserId) {
  return getUsersByTelegramId(db, telegramUserId)[0] || null;
}

function getUserByTelegramIdRole(db, telegramUserId, role) {
  return getUsers(db).find(u => String(u.telegramUserId || '') === String(telegramUserId || '') && String(u.role || '') === String(role || '')) || null;
}

function upsertUser(db, user) {
  const users = getUsers(db);
  const idx = users.findIndex(u => String(u.id) === String(user.id));
  const next = { ...user, updatedAt: nowIso() };
  if (idx >= 0) users[idx] = { ...users[idx], ...next };
  else users.unshift(next);
  saveUsers(db, users);
  return next;
}

function ensureUserScoped(db, userId) {
  if (!db.storage.users[userId]) db.storage.users[userId] = {};
  return db.storage.users[userId];
}

function isAdminUser(user) {
  return Boolean(user && (user.isAdmin || ADMIN_TELEGRAM_IDS.has(String(user.telegramUserId || ''))));
}

function normalizePhoneDigits(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('998')) digits = digits.slice(3);
  if (digits.length > 9) digits = digits.slice(-9);
  return digits;
}

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function keyScope(key) {
  if (key === 'tezkorish.user' || key === 'tezkorish.settings' || key === 'tezkorish.backup') return 'user';
  return 'global';
}

function getGlobalArray(db, key) {
  return Array.isArray(db.storage.global[key]) ? db.storage.global[key] : [];
}

function setGlobalArray(db, key, value) {
  db.storage.global[key] = Array.isArray(value) ? value : [];
  return db.storage.global[key];
}

function sortByCreatedDesc(list) {
  return list.slice().sort((a, b) => Number(b?.createdAt || b?.updatedAt || 0) - Number(a?.createdAt || a?.updatedAt || 0));
}

function ensureAuthUser(db, session) {
  if (!session?.userId) throw new Error('Session kerak.');
  const authUser = getUserById(db, session.userId);
  if (!authUser) throw new Error('User topilmadi.');
  return authUser;
}

function mergeSelfUser(current, incoming) {
  const next = { ...(current || {}) };
  const name = String(incoming?.name || '').trim().replace(/\s+/g, ' ');
  const role = String(incoming?.role || current?.role || '').trim();
  const phoneDigits = normalizePhoneDigits(incoming?.phoneDigits || incoming?.phone || current?.phoneDigits || current?.phone || '');
  if (name) next.name = name;
  if (['ishchi', 'beruvchi'].includes(role)) next.role = role;
  if (phoneDigits) {
    next.phoneDigits = phoneDigits;
    next.phone = '+998 ' + phoneDigits;
  }
  if (typeof incoming?.avatar === 'string') next.avatar = incoming.avatar.trim();
  if (incoming?.availability && typeof incoming.availability === 'object') {
    next.availability = {
      onDuty: false,
      lastShiftStartedAt: null,
      lastSeenJobAt: 0,
      ...(current?.availability || {}),
      ...incoming.availability,
    };
  }
  if (incoming?.district) next.district = String(incoming.district);
  next.lastActiveAt = Number(incoming?.lastActiveAt || Date.now());
  next.isAdmin = Boolean(current?.isAdmin || ADMIN_TELEGRAM_IDS.has(String(current?.telegramUserId || incoming?.telegramUserId || '')));
  next.updatedAt = nowIso();
  return next;
}

function mergeItemsById(existingList, incomingList, { canCreate, canUpdate, mergeItem, sort = true }) {
  const map = new Map((Array.isArray(existingList) ? existingList : []).map(item => [String(item?.id || ''), item]).filter(([id]) => id));
  for (const raw of Array.isArray(incomingList) ? incomingList : []) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id || '');
    if (!id) continue;
    if (map.has(id)) {
      const existing = map.get(id);
      if (canUpdate(existing, raw)) map.set(id, mergeItem(existing, raw, false));
      continue;
    }
    if (canCreate(raw)) map.set(id, mergeItem(null, raw, true));
  }
  const items = Array.from(map.values());
  return sort ? sortByCreatedDesc(items) : items;
}

function mergeMessages(existingMessages, incomingMessages) {
  const map = new Map();
  for (const msg of Array.isArray(existingMessages) ? existingMessages : []) {
    const id = String(msg?.id || '');
    if (id) map.set(id, msg);
  }
  for (const msg of Array.isArray(incomingMessages) ? incomingMessages : []) {
    const id = String(msg?.id || '');
    if (!id) continue;
    map.set(id, { ...(map.get(id) || {}), ...cloneValue(msg) });
  }
  return Array.from(map.values()).sort((a, b) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0));
}

function recomputeDerivedData(db) {
  const users = getUsers(db).map(user => ({ ...user }));
  const contracts = getGlobalArray(db, 'tezkorish.contracts');
  const reviews = getGlobalArray(db, 'tezkorish.reviews');
  for (const user of users) {
    const userId = String(user.id || '');
    user.completedJobs = contracts.filter(contract => String(contract?.workerId || '') === userId && String(contract?.status || '') === 'completed').length;
    const related = reviews.filter(review => String(review?.toUserId || '') === userId);
    const avg = related.length ? related.reduce((sum, review) => sum + Number(review?.score || 0), 0) / related.length : 0;
    user.rating = Math.round(avg * 10) / 10;
    user.phoneDigits = normalizePhoneDigits(user.phoneDigits || user.phone || '');
    if (user.phoneDigits) user.phone = '+998 ' + user.phoneDigits;
    user.isAdmin = Boolean(user.isAdmin || ADMIN_TELEGRAM_IDS.has(String(user.telegramUserId || '')));
    user.updatedAt = nowIso();
  }
  saveUsers(db, users);
}

function mergeUsersValue(db, value, authUser) {
  const users = new Map(getUsers(db).map(user => [String(user.id), user]));
  if (Array.isArray(value)) {
    const incomingSelf = value.find(item => String(item?.id || '') === String(authUser.id));
    if (incomingSelf) users.set(String(authUser.id), mergeSelfUser(users.get(String(authUser.id)) || authUser, incomingSelf));
    if (isAdminUser(authUser)) {
      for (const item of value) {
        const id = String(item?.id || '');
        if (!id || id === String(authUser.id)) continue;
        const existing = users.get(id);
        if (!existing) continue;
        users.set(id, {
          ...existing,
          ...cloneValue(item),
          id: existing.id,
          isAdmin: Boolean(existing.isAdmin || ADMIN_TELEGRAM_IDS.has(String(existing.telegramUserId || ''))),
          updatedAt: nowIso(),
        });
      }
    }
  }
  saveUsers(db, Array.from(users.values()));
  recomputeDerivedData(db);
  return getUsers(db);
}

function mergeGlobalStorageValue(db, key, value, authUser) {
  const isAdmin = isAdminUser(authUser);
  if (key === 'tezkorish.meta') {
    const current = db.storage.global[key] && typeof db.storage.global[key] === 'object' ? db.storage.global[key] : {};
    const incoming = value && typeof value === 'object' ? value : {};
    db.storage.global[key] = {
      ...current,
      appVersion: 'real-pilot-v31',
      firstInstalledAt: Number(incoming.firstInstalledAt || current.firstInstalledAt || Date.now()),
      lastOpenedAt: Number(incoming.lastOpenedAt || current.lastOpenedAt || Date.now()),
      seedInitialized: true,
      lastImportedAt: Number(incoming.lastImportedAt || current.lastImportedAt || 0) || undefined,
    };
    return db.storage.global[key];
  }

  if (key === 'tezkorish.users') return mergeUsersValue(db, value, authUser);

  const existing = getGlobalArray(db, key);

  if (key === 'tezkorish.jobs') {
    const merged = mergeItemsById(existing, value, {
      canCreate: item => (isAdmin || authUser.role === 'beruvchi') && String(item?.ownerId || '') === String(authUser.id),
      canUpdate: current => isAdmin || String(current?.ownerId || '') === String(authUser.id),
      mergeItem: (current, incoming, isNew) => ({
        ...(current || {}),
        ...cloneValue(incoming),
        id: current?.id || incoming.id,
        ownerId: current?.ownerId || authUser.id,
        poster: current?.poster || incoming.poster || authUser.name,
        createdAt: Number(current?.createdAt || incoming.createdAt || Date.now()),
      })
    });
    setGlobalArray(db, key, merged);
    return merged;
  }

  if (key === 'tezkorish.applications') {
    const merged = mergeItemsById(existing, value, {
      canCreate: item => isAdmin || String(item?.workerId || '') === String(authUser.id),
      canUpdate: current => isAdmin || String(current?.workerId || '') === String(authUser.id) || String(current?.employerId || '') === String(authUser.id),
      mergeItem: (current, incoming) => ({
        ...(current || {}),
        ...cloneValue(incoming),
        id: current?.id || incoming.id,
        jobId: current?.jobId || incoming.jobId,
        workerId: current?.workerId || incoming.workerId,
        employerId: current?.employerId || incoming.employerId,
        createdAt: Number(current?.createdAt || incoming.createdAt || Date.now()),
      })
    });
    setGlobalArray(db, key, merged);
    return merged;
  }

  if (key === 'tezkorish.savedJobs') {
    const incoming = Array.isArray(value) ? value : [];
    if (isAdmin) {
      const merged = mergeItemsById(existing, incoming, {
        canCreate: () => true,
        canUpdate: () => true,
        mergeItem: (current, incomingItem) => ({
          ...(current || {}),
          ...cloneValue(incomingItem),
          id: current?.id || incomingItem.id,
          workerId: current?.workerId || incomingItem.workerId,
          jobId: current?.jobId || incomingItem.jobId,
          createdAt: Number(current?.createdAt || incomingItem.createdAt || Date.now()),
        })
      });
      setGlobalArray(db, key, merged);
      return merged;
    }
    const mine = incoming
      .filter(item => item && typeof item === 'object' && String(item.workerId || '') === String(authUser.id))
      .map(item => ({
        ...cloneValue(item),
        workerId: authUser.id,
        createdAt: Number(item.createdAt || Date.now()),
      }));
    const others = existing.filter(item => String(item?.workerId || '') !== String(authUser.id));
    const merged = sortByCreatedDesc([...others, ...mine]);
    setGlobalArray(db, key, merged);
    return merged;
  }

  if (key === 'tezkorish.reports') {
    const merged = mergeItemsById(existing, value, {
      canCreate: item => isAdmin || String(item?.reporterId || '') === String(authUser.id),
      canUpdate: current => isAdmin || String(current?.reporterId || '') === String(authUser.id),
      mergeItem: (current, incoming) => ({
        ...(current || {}),
        ...cloneValue(incoming),
        id: current?.id || incoming.id,
        reporterId: current?.reporterId || incoming.reporterId,
        jobId: current?.jobId || incoming.jobId,
        createdAt: Number(current?.createdAt || incoming.createdAt || Date.now()),
      })
    });
    setGlobalArray(db, key, merged);
    return merged;
  }

  if (key === 'tezkorish.contracts') {
    const merged = mergeItemsById(existing, value, {
      canCreate: item => isAdmin || String(item?.employerId || '') === String(authUser.id) || String(item?.workerId || '') === String(authUser.id),
      canUpdate: current => isAdmin || String(current?.employerId || '') === String(authUser.id) || String(current?.workerId || '') === String(authUser.id),
      mergeItem: (current, incoming) => ({
        ...(current || {}),
        ...cloneValue(incoming),
        id: current?.id || incoming.id,
        jobId: current?.jobId || incoming.jobId,
        applicationId: current?.applicationId || incoming.applicationId,
        employerId: current?.employerId || incoming.employerId,
        workerId: current?.workerId || incoming.workerId,
        threadId: current?.threadId || incoming.threadId,
        createdAt: Number(current?.createdAt || incoming.createdAt || Date.now()),
      })
    });
    setGlobalArray(db, key, merged);
    recomputeDerivedData(db);
    return merged;
  }

  if (key === 'tezkorish.reviews') {
    const merged = mergeItemsById(existing, value, {
      canCreate: item => isAdmin || String(item?.fromUserId || '') === String(authUser.id),
      canUpdate: current => isAdmin || String(current?.fromUserId || '') === String(authUser.id),
      mergeItem: (current, incoming) => ({
        ...(current || {}),
        ...cloneValue(incoming),
        id: current?.id || incoming.id,
        contractId: current?.contractId || incoming.contractId,
        fromUserId: current?.fromUserId || incoming.fromUserId,
        toUserId: current?.toUserId || incoming.toUserId,
        createdAt: Number(current?.createdAt || incoming.createdAt || Date.now()),
      })
    });
    setGlobalArray(db, key, merged);
    recomputeDerivedData(db);
    return merged;
  }

  if (key === 'tezkorish.chats') {
    const merged = mergeItemsById(existing, value, {
      canCreate: item => isAdmin || (Array.isArray(item?.participants) && item.participants.map(v => String(v)).includes(String(authUser.id))),
      canUpdate: current => isAdmin || (Array.isArray(current?.participants) && current.participants.map(v => String(v)).includes(String(authUser.id))),
      sort: true,
      mergeItem: (current, incoming) => {
        const participants = Array.isArray(current?.participants) ? current.participants : (Array.isArray(incoming?.participants) ? incoming.participants : []);
        return {
          ...(current || {}),
          ...cloneValue(incoming),
          id: current?.id || incoming.id,
          contractId: current?.contractId || incoming.contractId,
          jobId: current?.jobId || incoming.jobId,
          participants,
          messages: mergeMessages(current?.messages, incoming?.messages),
          updatedAt: Number(incoming?.updatedAt || current?.updatedAt || Date.now()),
        };
      }
    });
    setGlobalArray(db, key, merged);
    return merged;
  }

  throw new Error('Bu storage kaliti yozish uchun ruxsat etilmagan.');
}

function readStorageValue(db, key, session) {
  if (keyScope(key) === 'user') {
    if (key === 'tezkorish.user') {
      if (!session?.userId) return null;
      return getUserById(db, session.userId) || null;
    }
    if (!session?.userId) return null;
    const scoped = ensureUserScoped(db, session.userId);
    return scoped[key] ?? null;
  }
  return db.storage.global[key] ?? null;
}

function writeStorageValue(db, key, value, session) {
  if (keyScope(key) === 'user') {
    if (!session?.userId && key !== 'tezkorish.user') throw new Error('Session kerak.');
    if (key === 'tezkorish.user') {
      const authUser = ensureAuthUser(db, session);
      const nextUser = mergeSelfUser(authUser, value || {});
      upsertUser(db, nextUser);
      recomputeDerivedData(db);
      return getUserById(db, session.userId);
    }
    const scoped = ensureUserScoped(db, session.userId);
    scoped[key] = cloneValue(value);
    return scoped[key];
  }
  const authUser = ensureAuthUser(db, session);
  return mergeGlobalStorageValue(db, key, value, authUser);
}

function verifyTelegramLegacyAuth(params) {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false, reason: 'TELEGRAM_BOT_TOKEN o‘rnatilmagan.' };
  const hash = params.hash;
  if (!hash) return { ok: false, reason: 'hash topilmadi.' };
  const authDate = Number(params.auth_date || 0);
  if (!authDate) return { ok: false, reason: 'auth_date topilmadi.' };
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > 60 * 15) return { ok: false, reason: 'Telegram auth muddati tugagan.' };
  const dataCheckString = Object.keys(params)
    .filter(key => key !== 'hash' && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('\n');
  const secretKey = crypto.createHash('sha256').update(TELEGRAM_BOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return { ok: false, reason: 'Telegram hash tekshiruvi yiqildi.' };
  } catch {
    return { ok: false, reason: 'Telegram hash format xato.' };
  }
  return { ok: true };
}

function buildTelegramPayload(params) {
  return {
    telegramUserId: String(params.id || params.telegram_user_id || ''),
    username: String(params.username || '').replace(/^@/, ''),
    firstName: String(params.first_name || ''),
    lastName: String(params.last_name || ''),
    photoUrl: String(params.photo_url || ''),
    authDate: Number(params.auth_date || 0),
    verified: true,
  };
}

function safeRedirect(target) {
  if (!target) return APP_BASE_URL + '/';
  if (target.startsWith('/')) return APP_BASE_URL + target;
  if (target.startsWith(APP_BASE_URL)) return target;
  return APP_BASE_URL + '/';
}

function bootstrapResponse(db, session) {
  if (session?.userId) {
    const user = getUserById(db, session.userId);
    if (user && isCompleteUser(user)) return { authenticated: true, user, pendingTelegram: null };
  }
  return { authenticated: false, user: null, pendingTelegram: session?.pendingTelegram || null };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, appBaseUrl: APP_BASE_URL, telegramConfigured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_USERNAME) });
  }

  if (pathname === '/api/state/signature' && req.method === 'GET') {
    const db = readDb();
    const { session } = getSession(req, db);
    const users = getUsers(db);
    const global = db.storage.global;
    return sendJson(res, 200, {
      ok: true,
      signature: [db.updatedAt, session?.userId || 'guest', users.length, (global['tezkorish.jobs'] || []).length, (global['tezkorish.applications'] || []).length, (global['tezkorish.chats'] || []).length, (global['tezkorish.reviews'] || []).length, (global['tezkorish.reports'] || []).length, (global['tezkorish.contracts'] || []).length].join('|')
    });
  }

  if (pathname === '/api/auth/bootstrap' && req.method === 'GET') {
    const db = readDb();
    const { session } = getSession(req, db);
    return sendJson(res, 200, { ok: true, ...bootstrapResponse(db, session) });
  }

  if (pathname === '/api/auth/telegram/config' && req.method === 'GET') {
    const botId = String(TELEGRAM_BOT_TOKEN || '').split(':')[0] || '';
    const callbackUrl = `${APP_BASE_URL}/api/auth/telegram/callback`;
    let loginUrl = '';
    try {
      const appOrigin = new URL(APP_BASE_URL).origin;
      if (botId) {
        loginUrl = `https://oauth.telegram.org/auth?bot_id=${encodeURIComponent(botId)}&origin=${encodeURIComponent(appOrigin)}&request_access=write&return_to=${encodeURIComponent(callbackUrl)}`;
      }
    } catch {}
    return sendJson(res, 200, { ok: true, botUsername: TELEGRAM_BOT_USERNAME, callbackUrl, appBaseUrl: APP_BASE_URL, loginUrl, loginEnabled: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_USERNAME) });
  }

  if (pathname === '/api/auth/telegram/callback' && req.method === 'GET') {
    const db = readDb();
    const { sid, session } = ensureSession(req, res, db);
    const params = Object.fromEntries(url.searchParams.entries());
    const redirectTo = safeRedirect(params.state || params.redirect_to || '/');
    const verification = verifyTelegramLegacyAuth(params);
    if (!verification.ok) {
      db.sessions[sid].pendingTelegram = { error: verification.reason || 'Telegram auth tasdiqlanmadi.' };
      db.sessions[sid].updatedAt = nowIso();
      await writeDbSafe(db);
      return sendRedirect(res, `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}tg_error=1`);
    }
    const payload = buildTelegramPayload(params);
    if (!payload.telegramUserId) {
      db.sessions[sid].pendingTelegram = { error: 'Telegram ID topilmadi.' };
      db.sessions[sid].updatedAt = nowIso();
      await writeDbSafe(db);
      return sendRedirect(res, `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}tg_error=1`);
    }
    const existingProfiles = getUsersByTelegramId(db, payload.telegramUserId)
      .filter(isCompleteUser)
      .map(user => ({
        id: user.id,
        role: user.role,
        name: user.name,
        phoneDigits: user.phoneDigits,
        avatar: user.avatar || user.telegramPhotoUrl || '',
      }));
    db.sessions[sid] = {
      createdAt: session?.createdAt || nowIso(),
      updatedAt: nowIso(),
      userId: null,
      pendingTelegram: { ...payload, existingProfiles }
    };
    await writeDbSafe(db);
    return sendRedirect(res, `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}tg_new=1#auth-name`);
  }

  if (pathname === '/api/auth/profile' && req.method === 'POST') {
    const body = await readRequestBody(req);
    const db = readDb();
    const { sid, session } = ensureSession(req, res, db);
    const name = String(body?.name || '').trim().replace(/\s+/g, ' ');
    const role = ['ishchi', 'beruvchi'].includes(String(body?.role || '')) ? String(body.role) : '';
    const phoneDigits = String(body?.phoneDigits || '').replace(/\D/g, '');
    const avatar = String(body?.avatar || '').trim();
    if (name.length < 2) return sendJson(res, 400, { ok: false, error: 'Ism noto‘g‘ri.' });
    if (phoneDigits.length < 9) return sendJson(res, 400, { ok: false, error: 'Telefon raqam noto‘g‘ri.' });
    if (!role) return sendJson(res, 400, { ok: false, error: 'Rol tanlanmagan.' });
    let user = session?.userId ? getUserById(db, session.userId) : null;
    const pending = session?.pendingTelegram || null;
    if (user && String(user.role || '') !== String(role)) user = null;
    if (!user && pending?.telegramUserId) user = getUserByTelegramIdRole(db, pending.telegramUserId, role);
    if (!user && !pending?.telegramUserId) {
      return sendJson(res, 401, { ok: false, error: 'Telegram auth tasdiqlanmagan.' });
    }

    if (!user) {
      user = {
        id: randomId('u'),
        name,
        phoneDigits,
        phone: '+998 ' + phoneDigits,
        role,
        district: "Uchko'prik tumani",
        rating: 0,
        completedJobs: 0,
        telegramUserId: String(pending?.telegramUserId || ''),
        telegramUsername: String(pending?.username || ''),
        telegramPhotoUrl: String(pending?.photoUrl || ''),
        avatar: avatar || String(pending?.photoUrl || ''),
        authProvider: 'telegram',
        availability: { onDuty: false, lastShiftStartedAt: null, lastSeenJobAt: 0 },
        isAdmin: ADMIN_TELEGRAM_IDS.has(String(pending?.telegramUserId || '')),
        createdAt: nowIso(),
        lastActiveAt: Date.now(),
      };
    } else {
      user = {
        ...user,
        name,
        phoneDigits,
        phone: '+998 ' + phoneDigits,
        role,
        avatar: avatar || user.avatar || pending?.photoUrl || user.telegramPhotoUrl || '',
        telegramUserId: String(user.telegramUserId || pending?.telegramUserId || ''),
        telegramUsername: String(user.telegramUsername || pending?.username || ''),
        telegramPhotoUrl: String(user.telegramPhotoUrl || pending?.photoUrl || ''),
        authProvider: 'telegram',
        lastActiveAt: Date.now(),
        isAdmin: Boolean(user.isAdmin || ADMIN_TELEGRAM_IDS.has(String(user.telegramUserId || pending?.telegramUserId || ''))),
      };
    }

    user = upsertUser(db, user);
    db.sessions[sid] = { createdAt: session?.createdAt || nowIso(), updatedAt: nowIso(), userId: user.id, pendingTelegram: null };
    ensureUserScoped(db, user.id);
    await writeDbSafe(db);
    return sendJson(res, 200, { ok: true, user });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const db = readDb();
    const { sid } = getSession(req, db);
    if (sid) delete db.sessions[sid];
    await writeDbSafe(db);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookieHeader() });
  }

  if (pathname === '/api/storage/read' && req.method === 'GET') {
    const key = String(url.searchParams.get('key') || '');
    if (!key) return sendJson(res, 400, { ok: false, error: 'key kerak.' });
    const db = readDb();
    const { session } = getSession(req, db);
    if (!session?.userId) return sendJson(res, 401, { ok: false, error: 'Avval tizimga kiring.' });
    return sendJson(res, 200, { ok: true, value: readStorageValue(db, key, session) });
  }

  if (pathname === '/api/storage/snapshot' && req.method === 'GET') {
    const db = readDb();
    const { session } = getSession(req, db);
    if (!session?.userId) return sendJson(res, 401, { ok: false, error: 'Avval tizimga kiring.' });
    const authUser = getUserById(db, session.userId) || null;
    const userScoped = session?.userId ? (db.storage.users[session.userId] || {}) : {};
    return sendJson(res, 200, {
      ok: true,
      appVersion: db.storage.global['tezkorish.meta']?.appVersion || 'real-pilot-v32',
      authenticated: Boolean(authUser),
      authUser,
      global: db.storage.global,
      userScoped,
    });
  }

  if (pathname === '/api/storage/write-batch' && req.method === 'POST') {
    const body = await readRequestBody(req);
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return sendJson(res, 400, { ok: false, error: 'items kerak.' });
    const db = readDb();
    const { session } = getSession(req, db);
    if (!session?.userId) return sendJson(res, 401, { ok: false, error: 'Avval tizimga kiring.' });
    try {
      for (const item of items) {
        const key = String(item?.key || '');
        if (!key) continue;
        writeStorageValue(db, key, item?.value, session);
      }
      if (session?.userId) {
        const user = getUserById(db, session.userId);
        if (user) {
          user.lastActiveAt = Date.now();
          upsertUser(db, user);
        }
      }
      await writeDbSafe(db);
      return sendJson(res, 200, { ok: true, count: items.length });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message || 'Storage batch xatosi.' });
    }
  }

  if (pathname === '/api/storage/write' && req.method === 'POST') {
    const body = await readRequestBody(req);
    const key = String(body?.key || '');
    if (!key) return sendJson(res, 400, { ok: false, error: 'key kerak.' });
    const db = readDb();
    const { session } = getSession(req, db);
    if (!session?.userId) return sendJson(res, 401, { ok: false, error: 'Avval tizimga kiring.' });
    try {
      const value = writeStorageValue(db, key, body?.value, session);
      if (session?.userId) {
        const user = getUserById(db, session.userId);
        if (user) {
          user.lastActiveAt = Date.now();
          upsertUser(db, user);
        }
      }
      await writeDbSafe(db);
      return sendJson(res, 200, { ok: true, value });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message || 'Saqlashda xato.' });
    }
  }

  if (pathname === '/api/storage/delete' && req.method === 'POST') {
    const body = await readRequestBody(req);
    const key = String(body?.key || '');
    if (!key) return sendJson(res, 400, { ok: false, error: 'key kerak.' });
    const db = readDb();
    const { sid, session } = getSession(req, db);
    if (!session?.userId) return sendJson(res, 401, { ok: false, error: 'Avval tizimga kiring.' });
    if (keyScope(key) === 'user') {
      if (session?.userId) {
        if (key === 'tezkorish.user' && sid && db.sessions[sid]) {
          db.sessions[sid] = { ...session, userId: null, pendingTelegram: null, updatedAt: nowIso() };
        } else {
          const scoped = ensureUserScoped(db, session.userId);
          delete scoped[key];
        }
      }
    } else {
      return sendJson(res, 403, { ok: false, error: 'Global storage o‘chirish taqiqlangan.' });
    }
    await writeDbSafe(db);
    return sendJson(res, 200, { ok: true });
  }

  return false;
}

function serveStatic(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT_DIR, safePath.replace(/^\/+/, ''));
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (filePath.endsWith('pilot-config.js')) headers['Cache-Control'] = 'no-store';
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, APP_BASE_URL);
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (handled !== false) return;
    }
    if (serveStatic(res, url.pathname)) return;
    if (serveStatic(res, '/index.html')) return;
    res.writeHead(404); res.end('Not found');
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message || 'Server xato.' });
  }
});

server.listen(PORT, () => {
  console.log(`TezkorIsh real pilot server listening on ${APP_BASE_URL}`);
});
