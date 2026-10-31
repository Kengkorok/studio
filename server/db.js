// Draf disimpan dalam SQLite (node:sqlite, tiada pakej tambahan).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
mkdirSync(join(DATA_DIR, 'uploads'), { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, 'studio.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS drafts (
    id           TEXT PRIMARY KEY,
    path         TEXT,              -- fail dalam repo kalau dah pernah terbit
    title        TEXT NOT NULL DEFAULT '',
    slug         TEXT NOT NULL DEFAULT '',
    slug_locked  INTEGER NOT NULL DEFAULT 0,
    date         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    tags         TEXT NOT NULL DEFAULT '[]',
    image        TEXT NOT NULL DEFAULT '',
    image_alt    TEXT NOT NULL DEFAULT '',
    cover        INTEGER NOT NULL DEFAULT 1,
    komen        INTEGER NOT NULL DEFAULT 1,
    og_auto      INTEGER NOT NULL DEFAULT 0,
    body         TEXT NOT NULL DEFAULT '',
    dirty        INTEGER NOT NULL DEFAULT 1,  -- ada perubahan belum terbit
    updated_at   TEXT NOT NULL,
    published_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS drafts_path ON drafts(path) WHERE path IS NOT NULL;
`);

// Lajur yang ditambah selepas versi pertama
const cols = new Set(db.prepare('PRAGMA table_info(drafts)').all().map((c) => c.name));
for (const [name, def] of [
  ['author', "TEXT NOT NULL DEFAULT 'safwan'"], // safwan, claudrok atau korokgpt
  ['sumber_url', "TEXT NOT NULL DEFAULT ''"],
  ['sumber_title', "TEXT NOT NULL DEFAULT ''"],
  ['image_credit', "TEXT NOT NULL DEFAULT ''"],
]) if (!cols.has(name)) db.exec(`ALTER TABLE drafts ADD COLUMN ${name} ${def}`);

const FIELDS = ['path', 'title', 'slug', 'slug_locked', 'date', 'description', 'tags', 'image', 'image_alt', 'cover', 'komen', 'og_auto', 'body', 'dirty', 'published_at', 'author', 'sumber_url', 'sumber_title', 'image_credit'];
const now = () => new Date().toISOString();

function decode(row) {
  if (!row) return null;
  return {
    ...row,
    tags: JSON.parse(row.tags),
    slug_locked: !!row.slug_locked,
    cover: !!row.cover,
    komen: !!row.komen,
    og_auto: !!row.og_auto,
    dirty: !!row.dirty,
  };
}

function encode(d) {
  const out = {};
  for (const k of FIELDS) {
    if (!(k in d)) continue;
    const v = d[k];
    out[k] = k === 'tags' ? JSON.stringify(v || []) : typeof v === 'boolean' ? Number(v) : v;
  }
  return out;
}

export function listDrafts() {
  return db.prepare('SELECT id, path, title, slug, date, tags, dirty, author, updated_at, published_at FROM drafts ORDER BY updated_at DESC')
    .all().map(decode);
}

export function getDraft(id) {
  return decode(db.prepare('SELECT * FROM drafts WHERE id = ?').get(id));
}

export function getDraftByPath(path) {
  return decode(db.prepare('SELECT * FROM drafts WHERE path = ?').get(path));
}

export function createDraft(fields) {
  const id = randomUUID();
  const row = { id, ...encode(fields), updated_at: now() };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO drafts (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
  return getDraft(id);
}

export function updateDraft(id, fields) {
  const row = { ...encode(fields), updated_at: now() };
  const keys = Object.keys(row);
  db.prepare(`UPDATE drafts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => row[k]), id);
  return getDraft(id);
}

export function deleteDraft(id) {
  db.prepare('DELETE FROM drafts WHERE id = ?').run(id);
}
