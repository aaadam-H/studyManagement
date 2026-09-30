// SQLite via Node's built-in node:sqlite (free, zero setup, single file at data/studyhub.db)
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'studyhub.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,          -- matric / student ID (admin: "admin")
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT, phone TEXT, program TEXT, faculty TEXT,
  year INTEGER, semester TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS courses (
  code TEXT PRIMARY KEY, name TEXT, credit INTEGER
);
CREATE TABLE IF NOT EXISTS enrollments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_code TEXT NOT NULL REFERENCES courses(code),
  status TEXT, grp TEXT,
  section TEXT,                           -- chosen timetable section (optional)
  PRIMARY KEY (user_id, course_code)
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT NOT NULL,
  section TEXT,                           -- timetable table / subgroup label
  day INTEGER NOT NULL,                   -- 1=Mon .. 7=Sun
  start TEXT NOT NULL, end TEXT NOT NULL, -- HH:MM
  kind TEXT, venue TEXT, lecturer TEXT, details TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_classes_course ON classes(course_code);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code TEXT,                       -- NULL = general
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'info',      -- info | assignment | exam | urgent
  title TEXT NOT NULL, body TEXT, due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_code TEXT, title TEXT NOT NULL, description TEXT, due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_code TEXT, item TEXT NOT NULL, score REAL, max_score REAL, weight REAL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_code TEXT, title TEXT NOT NULL, body TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const DEFAULT_TIMETABLE_URL =
  'https://timetables2.unimap.edu.my/IjazahSarjanaMuda/SarjanaMudaSem220252026/DEGREE_SEM2_20252026_OFFICIAL_subgroups_days_vertical.html#table_1103';

function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}
if (getSetting('timetable_url') === null) setSetting('timetable_url', DEFAULT_TIMETABLE_URL);

module.exports = { db, getSetting, setSetting };
