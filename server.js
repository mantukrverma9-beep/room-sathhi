const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'listings.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DATABASE_FILE = path.join(DATA_DIR, 'roomsaathi.sqlite');
const STATES_FILE = path.join(DATA_DIR, 'india-states.json');
const CHHATTISGARH_LOCATIONS_FILE = path.join(DATA_DIR, 'chhattisgarh-locations.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const APP_ORIGIN = process.env.APP_ORIGIN || `http://127.0.0.1:${PORT}`;
const REQUIRE_MODERATION = process.env.REQUIRE_MODERATION === 'true';
const ADMIN_EMAILS = new Set((process.env.ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
const SHOW_LOCAL_EMAIL_LINKS = process.env.NODE_ENV !== 'production' && process.env.SHOW_LOCAL_EMAIL_LINKS !== 'false';
const scrypt = require('node:util').promisify(crypto.scrypt);
const sessions = new Map();
const SESSION_TTL = 12 * 60 * 60 * 1000;
let database;
const HOME_TYPES = ['Private room', 'Shared room', 'PG', 'Flat', 'House'];
const DEFAULT_ROOM_IMAGE = 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1000&q=85';

// These example rooms make the homepage useful before the first owner adds a listing.
const starterListings = [
  {
    id: 'r101',
    title: 'Sunny private room near the city',
    state: 'Chhattisgarh',
    district: 'Raipur',
    city: 'Raipur',
    area: 'Shankar Nagar',
    pincode: '',
    type: 'Private room',
    rent: 9500,
    deposit: 15000,
    gender: 'Any',
    furnished: true,
    available: true,
    amenities: ['Wi-Fi', 'Furnished', 'Kitchen'],
    rules: ['Visitors allowed until 9 PM', 'No smoking indoors', '1 month notice'],
    image: 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1000&q=85',
    owner: 'Aarav',
    phone: '',
    createdAt: new Date().toISOString()
  },
  {
    id: 'r102',
    title: 'Affordable girls PG with meals',
    state: 'Chhattisgarh',
    district: 'Bilaspur',
    city: 'Bilaspur',
    area: 'Sarkanda',
    pincode: '',
    type: 'PG',
    rent: 1500,
    deposit: 5000,
    gender: 'Women',
    furnished: true,
    available: true,
    amenities: ['Meals', 'Laundry', 'Wi-Fi'],
    rules: ['Entry by 10 PM', 'Meals included', 'No smoking or alcohol'],
    image: 'https://images.unsplash.com/photo-1615874694520-474822394e73?auto=format&fit=crop&w=1000&q=85',
    owner: 'Meera',
    phone: '',
    createdAt: new Date().toISOString()
  },
  {
    id: 'r103',
    title: 'Shared flat near Bhilai market',
    state: 'Chhattisgarh',
    district: 'Durg',
    city: 'Bhilai',
    area: 'Supela',
    pincode: '',
    type: 'Flat',
    rent: 5000,
    deposit: 10000,
    gender: 'Any',
    furnished: true,
    available: true,
    amenities: ['Balcony', 'Market nearby', 'Kitchen'],
    rules: ['Keep shared areas clean', 'No pets', 'Utilities shared'],
    image: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1000&q=85',
    owner: 'Kabir',
    phone: '',
    createdAt: new Date().toISOString()
  }
];

// Create the small data folder/files on a first run.
function ensureData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!database) {
    database = new DatabaseSync(DATABASE_FILE);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS listings (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS one_time_tokens (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, purpose TEXT NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    `);

    // Import the old JSON files once so existing demo accounts and rooms survive the upgrade.
    const listingCount = database.prepare('SELECT COUNT(*) AS count FROM listings').get().count;
    if (listingCount === 0) {
      const oldListings = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : starterListings;
      saveListings(oldListings);
    }
    const userCount = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (userCount === 0 && fs.existsSync(USERS_FILE)) {
      const savedUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      const oldUsers = (Array.isArray(savedUsers) ? savedUsers : [savedUsers])
        .filter(Boolean)
        .map(user => ({ ...user, verified: user.verified ?? true }));
      saveUsers(oldUsers);
    }
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(readListings(), null, 2));
    if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify(readUsers(), null, 2));
  }
}
function readListings() {
  ensureData();
  return database.prepare('SELECT data FROM listings ORDER BY rowid').all().map(row => JSON.parse(row.data));
}

function readUsers() {
  ensureData();
  return database.prepare('SELECT data FROM users ORDER BY rowid').all().map(row => JSON.parse(row.data));
}

function saveListings(listings) {
  ensureData();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM listings').run();
    const insert = database.prepare('INSERT INTO listings (id, data) VALUES (?, ?)');
    for (const listing of listings) insert.run(listing.id, JSON.stringify(listing));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function saveUsers(users) {
  ensureData();
  database.exec('BEGIN IMMEDIATE');
  try {
    const insert = database.prepare(`
      INSERT INTO users (id, email, data) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET email = excluded.email, data = excluded.data
    `);
    for (const user of users) insert.run(user.id, user.email, JSON.stringify(user));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function publicListing(item) {
  const { ownerId, ...visibleDetails } = item;
  return visibleDetails;
}

function readCookies(req) {
  const cookieParts = (req.headers.cookie || '').split(';');
  const cookies = {};

  for (const part of cookieParts) {
    const [name, value] = part.trim().split('=');
    if (name && value) cookies[decodeURIComponent(name)] = decodeURIComponent(value);
  }

  return cookies;
}

function minimumRentFor(type) {
  if (type === 'PG') return 1500;
  if (type === 'Flat') return 5000;
  return 1;
}

function validateListing(body) {
  if (!HOME_TYPES.includes(body.type)) return 'Choose a valid home type.';

  const requiredFields = ['title', 'state', 'district', 'city', 'area', 'type', 'rent', 'deposit'];
  const hasMissingField = requiredFields.some(field => !clean(body[field], 150));
  const rent = Number(body.rent);
  const deposit = Number(body.deposit);

  if (hasMissingField || !Number.isFinite(rent) || !Number.isFinite(deposit) || deposit < 0) {
    return 'Add all required details and enter a valid rent and deposit.';
  }

  const minimumRent = minimumRentFor(body.type);
  if (rent < minimumRent) {
    return `${body.type} rent must start at ₹${minimumRent.toLocaleString('en-IN')} per month.`;
  }

  if (body.pincode && !/^\d{6}$/.test(String(body.pincode).trim())) {
    return 'PIN code must have exactly 6 digits.';
  }

  const phone = clean(body.phone, 30).replace(/[^+\d]/g, '');
  if (phone && !/^\+?\d{7,15}$/.test(phone)) {
    return 'Enter a valid contact phone number, or leave it blank.';
  }

  return null;
}

function buildListing(body, user, previousListing = null) {
  const oldPhotos = previousListing?.photos || [];
  const photos = Array.isArray(body.photos)
    ? body.photos.filter(photo => typeof photo === 'string' && photo.startsWith('/media/')).slice(0, 5)
    : oldPhotos;
  const video = typeof body.video === 'string'
    ? body.video
    : previousListing?.video || '';
  const phone = clean(body.phone, 30).replace(/[^+\d]/g, '');

  return {
    ...previousListing,
    id: previousListing?.id || crypto.randomUUID(),
    title: clean(body.title, 100),
    state: clean(body.state, 80),
    district: clean(body.district, 80),
    city: clean(body.city, 80),
    area: clean(body.area, 100),
    pincode: clean(body.pincode, 6),
    type: clean(body.type, 40),
    rent: Number(body.rent),
    deposit: Number(body.deposit),
    gender: clean(body.gender, 30) || 'Any',
    furnished: Boolean(body.furnished),
    available: previousListing?.available ?? true,
    status: REQUIRE_MODERATION
      ? (previousListing?.status === 'approved' ? 'pending' : previousListing?.status || 'pending')
      : previousListing?.status || 'approved',
    amenities: clean(body.amenities, 300).split(',').map(item => item.trim()).filter(Boolean).slice(0, 12),
    rules: clean(body.rules, 800).split('\n').map(rule => rule.trim()).filter(Boolean).slice(0, 12),
    image: photos[0] || previousListing?.image || DEFAULT_ROOM_IMAGE,
    photos,
    video,
    owner: previousListing?.owner || user.name,
    ownerId: previousListing?.ownerId || user.id,
    phone,
    createdAt: previousListing?.createdAt || new Date().toISOString()
  };
}
function currentUser(req) {
  const token = readCookies(req).roomsaathi_session;
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) { if (token) sessions.delete(token); return null; }
  const user = readUsers().find(x => x.id === session.userId);
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}
function isAdmin(user) { return Boolean(user && ADMIN_EMAILS.has(user.email.toLowerCase())); }
function createOneTimeToken(userId, purpose) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const ttl = purpose === 'verify' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  database.prepare('DELETE FROM one_time_tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
  database.prepare('DELETE FROM one_time_tokens WHERE expires_at <= ?').run(Date.now());
  database.prepare('INSERT INTO one_time_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, purpose, Date.now() + ttl);
  return token;
}
function consumeOneTimeToken(token, purpose) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const row = database.prepare('SELECT user_id FROM one_time_tokens WHERE token_hash = ? AND purpose = ? AND expires_at > ?').get(hash, purpose, Date.now());
  if (!row) return null;
  database.prepare('DELETE FROM one_time_tokens WHERE token_hash = ?').run(hash);
  return row.user_id;
}
function saveLocalEmailLink(purpose, token) {
  const url = new URL('/', APP_ORIGIN);
  url.searchParams.set(purpose === 'verify' ? 'verify' : 'reset', token);
  console.log(`[Local email preview] ${purpose}: ${url.toString()}`);
  return SHOW_LOCAL_EMAIL_LINKS ? url.toString() : undefined;
}
function requestIsSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Command-line clients and health checks do not send Origin.
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
const requestCounts = new Map();
function rateLimit(req, key, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const id = `${req.socket.remoteAddress || 'unknown'}:${key}`;
  const saved = requestCounts.get(id);
  if (!saved || saved.expiresAt <= now) {
    requestCounts.set(id, { count: 1, expiresAt: now + windowMs });
    return true;
  }
  saved.count += 1;
  return saved.count <= limit;
}
function setSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_TTL });
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `roomsaathi_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${secureFlag}`);
}
function clearSession(req, res) {
  const token = readCookies(req).roomsaathi_session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'roomsaathi_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > maxBytes) { reject(new Error('Upload is too large.')); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function clean(value, max = 250) { return String(value ?? '').trim().slice(0, max); }
function matchesFileSignature(mime, bytes) {
  if (mime === 'image/jpeg') return bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (mime === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (['video/mp4', 'video/quicktime'].includes(mime)) return bytes.length > 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
  if (mime === 'video/webm') return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://images.unsplash.com blob: data:; media-src 'self' blob:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https://api.postalpincode.in; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.method !== 'GET' && req.method !== 'HEAD' && !requestIsSameOrigin(req)) return send(res, 403, { error: 'Request origin is not allowed.' });
  if (url.pathname.startsWith('/api/')) {
    if (['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/resend-verification'].includes(url.pathname) && !rateLimit(req, url.pathname, 8)) return send(res, 429, { error: 'Too many attempts. Please wait a minute and try again.' });
    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const user = currentUser(req);
      return send(res, 200, { user: user && { ...user, isAdmin: isAdmin(user) } });
    }
    if (req.method === 'GET' && url.pathname === '/api/auth/verify') {
      const userId = consumeOneTimeToken(url.searchParams.get('token'), 'verify');
      if (!userId) return send(res, 400, { error: 'This verification link is invalid or expired. Please create a new account or request another link.' });
      const users = readUsers();
      const user = users.find(item => item.id === userId);
      if (!user) return send(res, 400, { error: 'Account not found.' });
      user.verified = true;
      saveUsers(users);
      return send(res, 200, { ok: true, message: 'Email verified. You can log in now.' });
    }
    if (req.method === 'POST' && ['/api/auth/register', '/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/resend-verification'].includes(url.pathname)) {
      try {
        const b = await readBody(req);
        const email = clean(b.email, 254).toLowerCase();
        const password = String(b.password || '');
        const users = readUsers();
        if (url.pathname.endsWith('/resend-verification')) {
          const user = users.find(item => item.email === email && !item.verified);
          const previewUrl = user && SHOW_LOCAL_EMAIL_LINKS
            ? saveLocalEmailLink('verify', createOneTimeToken(user.id, 'verify'))
            : undefined;
          return send(res, 200, { message: 'If the account needs verification, a new link has been prepared.', ...(previewUrl ? { previewUrl } : {}) });
        }
        if (url.pathname.endsWith('/forgot-password')) {
          const user = users.find(item => item.email === email);
          let previewUrl;
          if (user && SHOW_LOCAL_EMAIL_LINKS) previewUrl = saveLocalEmailLink('reset', createOneTimeToken(user.id, 'reset'));
          return send(res, 200, { message: 'If the account exists, a password reset link has been prepared.', ...(previewUrl ? { previewUrl } : {}) });
        }
        if (url.pathname.endsWith('/reset-password')) {
          if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'Password must be at least 8 characters.' });
          const userId = consumeOneTimeToken(b.token, 'reset');
          if (!userId) return send(res, 400, { error: 'This reset link is invalid or expired. Request a new one.' });
          const user = users.find(item => item.id === userId);
          if (!user) return send(res, 400, { error: 'Account not found.' });
          const salt = crypto.randomBytes(16).toString('hex');
          user.salt = salt;
          user.hash = (await scrypt(password, salt, 64)).toString('hex');
          saveUsers(users);
          for (const [sessionId, session] of sessions) if (session.userId === userId) sessions.delete(sessionId);
          return send(res, 200, { message: 'Password changed. Please log in with your new password.' });
        }
        if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
        if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'Password must be at least 8 characters.' });
        if (url.pathname.endsWith('/register')) {
          if (!SHOW_LOCAL_EMAIL_LINKS) return send(res, 503, { error: 'Email delivery is not configured. Set up a mail provider before enabling production sign-up.' });
          const name = clean(b.name, 80);
          if (!name) return send(res, 400, { error: 'Enter your name.' });
          if (users.some(x => x.email === email)) return send(res, 409, { error: 'An account with this email already exists. Please log in.' });
          const salt = crypto.randomBytes(16).toString('hex');
          const hash = (await scrypt(password, salt, 64)).toString('hex');
          const user = { id: crypto.randomUUID(), name, email, salt, hash, verified: false, createdAt: new Date().toISOString() };
          users.push(user); saveUsers(users);
          const previewUrl = saveLocalEmailLink('verify', createOneTimeToken(user.id, 'verify'));
          return send(res, 201, { message: 'Account created. Open the local verification link from the response, then log in.', previewUrl });
        }
        const user = users.find(x => x.email === email);
        if (!user) return send(res, 401, { error: 'Email or password is incorrect.' });
        const candidate = await scrypt(password, user.salt, 64);
        if (!crypto.timingSafeEqual(candidate, Buffer.from(user.hash, 'hex'))) return send(res, 401, { error: 'Email or password is incorrect.' });
        if (!user.verified) return send(res, 403, { error: 'Please verify your email before logging in.' });
        setSession(res, user);
        return send(res, 200, { user: { id: user.id, name: user.name, email: user.email, isAdmin: isAdmin(user) } });
      } catch (err) { return send(res, 400, { error: err.message || 'Could not process account request.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') { clearSession(req, res); return send(res, 200, { ok: true }); }
    if (req.method === 'GET' && url.pathname === '/api/locations') {
      const states = JSON.parse(fs.readFileSync(STATES_FILE, 'utf8'));
      const districts = JSON.parse(fs.readFileSync(CHHATTISGARH_LOCATIONS_FILE, 'utf8'));
      return send(res, 200, { states, chhattisgarh: districts });
    }
    if (req.method === 'POST' && url.pathname === '/api/media') {
      try {
        if (!currentUser(req)) return send(res, 401, { error: 'Please log in to upload listing photos or video.' });
        const b = await readBody(req, 36 * 1024 * 1024);
        const mime = clean(b.mimeType, 80).toLowerCase();
        const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : '';
        const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };
        const maxBytes = kind === 'video' ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
        if (!kind || !extensions[mime]) return send(res, 400, { error: 'Use JPG, PNG, WebP or GIF photos, or MP4/WebM/MOV video.' });
        const encoded = String(b.dataBase64 || '').replace(/^data:[^,]+;base64,/, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return send(res, 400, { error: 'This file could not be read.' });
        const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length || bytes.length > maxBytes) return send(res, 400, { error: kind === 'video' ? 'Video must be smaller than 25 MB.' : 'Each photo must be smaller than 8 MB.' });
        if (!matchesFileSignature(mime, bytes)) return send(res, 400, { error: 'The selected file does not match its image or video type.' });
        const mediaDir = path.join(DATA_DIR, 'media'); fs.mkdirSync(mediaDir, { recursive: true });
        const filename = `${crypto.randomUUID()}${extensions[mime]}`;
        fs.writeFileSync(path.join(mediaDir, filename), bytes, { flag: 'wx' });
        return send(res, 201, { url: `/media/${filename}`, kind, mimeType: mime, size: bytes.length });
      } catch (err) { return send(res, 400, { error: err.message || 'Could not upload this file.' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/my-listings') {
      const user = currentUser(req);
      if (!user) return send(res, 401, { error: 'Please log in to view your listings.' });
      return send(res, 200, readListings().filter(x => x.ownerId === user.id));
    }
    if (url.pathname === '/api/admin/listings' && req.method === 'GET') {
      const user = currentUser(req);
      if (!isAdmin(user)) return send(res, 403, { error: 'Admin access is required.' });
      return send(res, 200, readListings().filter(item => item.status === 'pending'));
    }
    const reviewAction = url.pathname.match(/^\/api\/admin\/listings\/([^/]+)$/);
    if (reviewAction && req.method === 'PATCH') {
      const user = currentUser(req);
      if (!isAdmin(user)) return send(res, 403, { error: 'Admin access is required.' });
      try {
        const body = await readBody(req);
        if (!['approved', 'rejected'].includes(body.status)) return send(res, 400, { error: 'Choose approved or rejected.' });
        const listings = readListings();
        const listing = listings.find(item => item.id === reviewAction[1]);
        if (!listing) return send(res, 404, { error: 'Listing not found.' });
        listing.status = body.status;
        saveListings(listings);
        return send(res, 200, { ok: true, status: listing.status });
      } catch (error) { return send(res, 400, { error: error.message || 'Could not review listing.' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/listings') {
      const listingId = url.searchParams.get('id');
      const q = clean(url.searchParams.get('q'), 100).toLowerCase();
      const type = clean(url.searchParams.get('type'), 40);
      const maxRent = Number(url.searchParams.get('maxRent')) || Infinity;
      const matchingListings = readListings().filter(listing => {
        if (!listing.available || (REQUIRE_MODERATION && listing.status !== 'approved') || listing.status === 'rejected') return false;
        if (listingId && listing.id !== listingId) return false;
        if (listing.rent > maxRent) return false;
        if (type && type !== 'Any' && listing.type !== type) return false;

        const searchableLocation = [
          listing.title,
          listing.city,
          listing.area,
          listing.district,
          listing.state,
          listing.pincode,
          listing.type
        ].filter(Boolean).join(' ').toLowerCase();

        return !q || searchableLocation.includes(q);
      });

      return send(res, 200, matchingListings.map(publicListing));
    }
    const listingAction = url.pathname.match(/^\/api\/listings\/([^/]+)$/);
    if (listingAction && ['PATCH', 'PUT', 'DELETE'].includes(req.method)) {
      const user = currentUser(req);
      if (!user) return send(res, 401, { error: 'Please log in to manage a listing.' });
      const listings = readListings(); const itemIndex = listings.findIndex(x => x.id === listingAction[1]);
      if (itemIndex < 0) return send(res, 404, { error: 'Listing not found.' });
      if (listings[itemIndex].ownerId !== user.id) return send(res, 403, { error: 'You can only manage your own listings.' });
      if (req.method === 'DELETE') {
        const [removed] = listings.splice(itemIndex, 1); saveListings(listings);
        const mediaDir = path.join(DATA_DIR, 'media');
        for (const mediaUrl of [...(removed.photos || []), removed.video]) {
          const filename = typeof mediaUrl === 'string' ? path.basename(mediaUrl) : '';
          if (/^[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm|mov)$/.test(filename)) { try { fs.unlinkSync(path.join(mediaDir, filename)); } catch {} }
        }
        return send(res, 200, { ok: true });
      }
      try {
        const b = await readBody(req);
        if (req.method === 'PUT') {
          const validationError = validateListing(b);
          if (validationError) return send(res, 400, { error: validationError });

          const old = listings[itemIndex];
          const updated = buildListing(b, user, old);
          listings[itemIndex] = updated;
          saveListings(listings);

          // Delete old uploads only if no other listing still uses them.
          const liveMedia = new Set(listings.flatMap(x => [...(x.photos || []), x.video]).filter(Boolean));
          for (const url of [...(old.photos || []), old.video].filter(Boolean)) {
            const filename = path.basename(url);
            const isUploadedMedia = /^[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm|mov)$/.test(filename);
            if (!liveMedia.has(url) && isUploadedMedia) {
              try {
                fs.unlinkSync(path.join(DATA_DIR, 'media', filename));
              } catch {}
            }
          }

          return send(res, 200, publicListing(updated));
        }
        if (typeof b.available !== 'boolean') return send(res, 400, { error: 'Choose whether this place is available.' });
        listings[itemIndex].available = b.available; saveListings(listings);
        return send(res, 200, listings[itemIndex]);
      } catch (err) { return send(res, 400, { error: err.message || 'Could not update listing.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/listings') {
      try {
        const user = currentUser(req);
        if (!user) return send(res, 401, { error: 'Please log in to publish a place.' });
        const b = await readBody(req);
        const validationError = validateListing(b);
        if (validationError) return send(res, 400, { error: validationError });

        const listing = buildListing(b, user);
        const listings = readListings();
        listings.unshift(listing);
        saveListings(listings);
        return send(res, 201, listing);
      } catch (err) { return send(res, 400, { error: err.message || 'Could not save listing.' }); }
    }
    return send(res, 404, { error: 'API route not found.' });
  }

  if (url.pathname.startsWith('/media/')) {
    const filename = path.basename(url.pathname.slice('/media/'.length));
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|webm|mov)$/.test(filename)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const mediaFile = path.join(DATA_DIR, 'media', filename);
    const contentTypes = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
    return fs.stat(mediaFile, (err, stats) => {
      if (err || !stats.isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      const mime = contentTypes[path.extname(filename)];
      const range = req.headers.range && mime.startsWith('video/') ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range) : null;
      if (range) {
        const start = range[1] ? Number(range[1]) : Math.max(0, stats.size - Number(range[2]));
        const end = range[2] ? Math.min(stats.size - 1, Number(range[2]) + (range[1] ? 0 : start)) : stats.size - 1;
        if (start >= stats.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` }); return res.end(); }
        res.writeHead(206, { 'Content-Type': mime, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stats.size}`, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' });
        return req.method === 'HEAD' ? res.end() : fs.createReadStream(mediaFile, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stats.size, 'Accept-Ranges': mime.startsWith('video/') ? 'bytes' : 'none', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(mediaFile).pipe(res);
    });
  }

  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(PUBLIC, requested);
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, 'index.html')) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  fs.readFile(file, (err, content) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const ext = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    send(res, 200, content, types[ext] || 'application/octet-stream');
  });
});

if (process.env.NODE_ENV === 'production' && !APP_ORIGIN.startsWith('https://')) {
  throw new Error('Set APP_ORIGIN to the HTTPS URL of the production site.');
}
server.listen(PORT, HOST, () => console.log(`RoomSaathi is running at ${APP_ORIGIN}`));
