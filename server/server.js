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
const SESSION_SECRET = process.env.SESSION_SECRET || 'tezkorish-real-pilot-secret';
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
<<<<<<< HEAD
        'tezkorish.meta': { appVersion: 'real-pilot-v24', firstInstalledAt: Date.now(), seedInitialized: true },
=======
        'tezkorish.meta': { appVersion: 'real-pilot-v23', firstInstalledAt: Date.now(), seedInitialized: true },
>>>>>>> d79c5678bf98cbe155520f8fda70a4f4bce8accc
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
  return db;
}

function writeDb(db) {
  db.updatedAt = nowIso();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
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

function getUserByTelegramId(db, telegramUserId) {
  return getUsers(db).find(u => String(u.telegramUserId || '') === String(telegramUserId || '')) || null;
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

function keyScope(key) {
  if (key === 'tezkorish.user' || key === 'tezkorish.settings' || key === 'tezkorish.backup') return 'user';
  return 'global';
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
      if (!session?.userId) throw new Error('Session kerak.');
      const current = getUserById(db, session.userId);
      if (!current) throw new Error('User topilmadi.');
      upsertUser(db, { ...current, ...(value || {}) });
      return getUserById(db, session.userId);
    }
    const scoped = ensureUserScoped(db, session.userId);
    scoped[key] = value;
    return value;
  }
  db.storage.global[key] = value;
  return value;
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
    return sendJson(res, 200, { ok: true, botUsername: TELEGRAM_BOT_USERNAME, callbackUrl: `${APP_BASE_URL}/api/auth/telegram/callback`, appBaseUrl: APP_BASE_URL, loginEnabled: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_USERNAME) });
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
      writeDb(db);
      return sendRedirect(res, `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}tg_error=1`);
    }
    const payload = buildTelegramPayload(params);
    if (!payload.telegramUserId) {
      db.sessions[sid].pendingTelegram = { error: 'Telegram ID topilmadi.' };
      db.sessions[sid].updatedAt = nowIso();
      writeDb(db);
      return sendRedirect(res, `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}tg_error=1`);
    }
    const existing = getUserByTelegramId(db, payload.telegramUserId);
    if (existing && isCompleteUser(existing)) {
      const nextUser = upsertUser(db, {
        ...existing,
        telegramUsername: payload.username || existing.telegramUsername || '',
        telegramPhotoUrl: payload.photoUrl || existing.telegramPhotoUrl || '',
        avatar: existing.avatar || payload.photoUrl || existing.telegramPhotoUrl || '',
        isAdmin: existing.isAdmin || ADMIN_TELEGRAM_IDS.has(String(payload.telegramUserId))
      });
      db.sessions[sid] = { createdAt: session?.createdAt || nowIso(), updatedAt: nowIso(), userId: nextUser.id, pendingTelegram: null };
      writeDb(db);
      return sendRedirect(res, `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}tg_ok=1`);
    }
    db.sessions[sid] = { createdAt: session?.createdAt || nowIso(), updatedAt: nowIso(), userId: null, pendingTelegram: payload };
    writeDb(db);
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
    if (!user && pending?.telegramUserId) user = getUserByTelegramId(db, pending.telegramUserId);
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
    writeDb(db);
    return sendJson(res, 200, { ok: true, user });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const db = readDb();
    const { sid } = getSession(req, db);
    if (sid) delete db.sessions[sid];
    writeDb(db);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookieHeader() });
  }

  if (pathname === '/api/storage/read' && req.method === 'GET') {
    const key = String(url.searchParams.get('key') || '');
    if (!key) return sendJson(res, 400, { ok: false, error: 'key kerak.' });
    const db = readDb();
    const { session } = getSession(req, db);
    return sendJson(res, 200, { ok: true, value: readStorageValue(db, key, session) });
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
      writeDb(db);
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
      delete db.storage.global[key];
    }
    writeDb(db);
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
