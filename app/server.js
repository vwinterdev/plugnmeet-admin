'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const PNM_URL = (process.env.PLUGNMEET_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.PLUGNMEET_API_KEY || '';
const API_SECRET = process.env.PLUGNMEET_API_SECRET || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const TEACHER_NAME = process.env.TEACHER_NAME || 'Преподаватель';
const DATA_FILE = process.env.DATA_FILE || '/data/lessons.json';

if (!PNM_URL || !API_KEY || !API_SECRET) {
  console.error('Нужны PLUGNMEET_URL, PLUGNMEET_API_KEY и PLUGNMEET_API_SECRET');
  process.exit(1);
}

// ---------- хранилище ----------

let lessons = [];
try {
  lessons = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {
  lessons = [];
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(lessons, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const rid = (bytes) => crypto.randomBytes(bytes).toString('hex');

// ---------- plugNmeet API ----------

async function pnm(endpoint, payload) {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', API_SECRET).update(body).digest('hex');
  const res = await fetch(`${PNM_URL}/auth${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'API-KEY': API_KEY,
      'HASH-SIGNATURE': signature,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    throw new Error(data.msg || `plugNmeet ${endpoint}: HTTP ${res.status}`);
  }
  return data;
}

const roomLocks = new Map();

// Комната в plugNmeet живёт, пока в ней кто-то есть, поэтому создаём её по требованию
function ensureRoom(lesson) {
  if (roomLocks.has(lesson.roomId)) return roomLocks.get(lesson.roomId);
  const p = (async () => {
    const active = await pnm('/room/isRoomActive', { room_id: lesson.roomId });
    if (active.is_active) return;
    try {
      await pnm('/room/create', {
        room_id: lesson.roomId,
        empty_timeout: 300,
        metadata: {
          room_title: lesson.title,
          room_features: {
            allow_webcams: true,
            mute_on_start: false,
            allow_screen_share: true,
            admin_only_webcams: false,
            allow_view_other_webcams: true,
            allow_view_other_users_list: true,
            allow_raise_hand: true,
            recording_features: { is_allow: false, is_allow_cloud: false, is_allow_local: true },
            chat_features: { is_allow: true, is_allow_file_upload: true },
            shared_note_pad_features: { is_allow: true },
            whiteboard_features: { is_allow: true },
            external_media_player_features: { is_allow: true },
            waiting_room_features: { is_active: false },
            breakout_room_features: { is_allow: true },
            display_external_link_features: { is_allow: true },
            polls_features: { is_allow: true },
          },
        },
      });
    } catch (err) {
      // параллельный запрос мог создать комнату раньше
      const again = await pnm('/room/isRoomActive', { room_id: lesson.roomId });
      if (!again.is_active) throw err;
    }
  })().finally(() => roomLocks.delete(lesson.roomId));
  roomLocks.set(lesson.roomId, p);
  return p;
}

async function joinUrl(lesson, user) {
  await ensureRoom(lesson);
  const { token } = await pnm('/room/getJoinToken', {
    room_id: lesson.roomId,
    user_info: {
      name: user.name,
      user_id: user.id,
      is_admin: user.isAdmin,
      user_metadata: {},
    },
  });
  return `${PNM_URL}/?access_token=${encodeURIComponent(token)}`;
}

// ---------- HTTP ----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && body !== null;
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 10_000) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const cleanName = (v, max) => String(v ?? '').trim().slice(0, max);

function publicLesson(l) {
  return {
    id: l.id,
    title: l.title,
    students: l.students.map((s) => ({
      id: s.id,
      name: s.name,
      link: `${PUBLIC_URL}/j/${s.token}`,
    })),
  };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method;

  // ссылка ученика (публичная, без пароля)
  if (method === 'GET' && parts[0] === 'j' && parts[1]) {
    for (const lesson of lessons) {
      const student = lesson.students.find((s) => s.token === parts[1]);
      if (student) {
        const target = await joinUrl(lesson, { id: `s-${student.id}`, name: student.name, isAdmin: false });
        return send(res, 302, '', { Location: target });
      }
    }
    return send(res, 404, 'Ссылка недействительна');
  }

  // вход преподавателя
  if (method === 'GET' && parts[0] === 'enter' && parts[1]) {
    const lesson = lessons.find((l) => l.id === parts[1]);
    if (!lesson) return send(res, 404, 'Урок не найден');
    const target = await joinUrl(lesson, { id: 'teacher', name: TEACHER_NAME, isAdmin: true });
    return send(res, 302, '', { Location: target });
  }

  if (parts[0] === 'api' && parts[1] === 'lessons') {
    if (method === 'GET' && parts.length === 2) {
      return send(res, 200, lessons.map(publicLesson));
    }
    if (method === 'POST' && parts.length === 2) {
      const { title } = await readJson(req);
      const t = cleanName(title, 100);
      if (!t) return send(res, 400, { error: 'Нужно название' });
      const id = rid(4);
      lessons.push({ id, roomId: `lesson-${id}`, title: t, students: [] });
      save();
      return send(res, 201, publicLesson(lessons[lessons.length - 1]));
    }
    const lesson = lessons.find((l) => l.id === parts[2]);
    if (!lesson) return send(res, 404, { error: 'Урок не найден' });

    if (method === 'DELETE' && parts.length === 3) {
      lessons = lessons.filter((l) => l !== lesson);
      save();
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && parts[3] === 'students') {
      const { name } = await readJson(req);
      const n = cleanName(name, 60);
      if (!n) return send(res, 400, { error: 'Нужно имя' });
      lesson.students.push({ id: rid(4), name: n, token: rid(16) });
      save();
      return send(res, 201, publicLesson(lesson));
    }
    if (method === 'DELETE' && parts[3] === 'students' && parts[4]) {
      lesson.students = lesson.students.filter((s) => s.id !== parts[4]);
      save();
      return send(res, 200, publicLesson(lesson));
    }
  }

  // статика админки
  if (method === 'GET') {
    const file = parts.length ? parts.join('/') : 'index.html';
    const full = path.join(__dirname, 'public', path.normalize(file));
    if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      return send(res, 200, fs.readFileSync(full), { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    }
  }
  return send(res, 404, 'Not found');
}

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 502, 'Ошибка связи с plugNmeet: ' + err.message);
    });
  })
  .listen(PORT, () => console.log(`lessons app on :${PORT}`));
