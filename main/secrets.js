'use strict';
/* ============================================================
   КЛЮЧ АССИСТЕНТА
   ============================================================
   Ключ OpenRouter открытым текстом нигде не лежит. Он шифруется
   средствами системы: Electron safeStorage держит ключ шифрования в
   связке ключей macOS, а в базе остаётся только шифр. Окно приложения
   полного ключа не получает никогда — только маску.

   Проверки запускаются без Electron, и шифрования там нет: им
   подставляется своё хранилище через use().
   ============================================================ */
const DB = require('./db');

const SLOT = 'ai.key.enc';
let backend = null;

function fail(msg) { const e = new Error(msg); e.user = true; throw e; }

function electronBackend() {
  const { safeStorage } = require('electron');
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: s => safeStorage.encryptString(s),
    decrypt: b => safeStorage.decryptString(b),
  };
}
function use(b) { backend = b; }
function be() { return backend || (backend = electronBackend()); }

function set(db, raw) {
  const key = String(raw || '').trim();
  if (!key) fail('Ключ пустой');
  if (!/^sk-or-[A-Za-z0-9_-]{16,}$/.test(key)) fail('Это не похоже на ключ OpenRouter: он начинается с «sk-or-»');
  if (!be().available()) fail('Шифрование системы недоступно — ключ не сохранён');
  DB.setSetting(db, SLOT, be().encrypt(key).toString('base64'));
  return { ok: true, masked: mask(key) };
}
/* null — ключа нет; false — ключ есть, но система его не отдала
   (например, доступ к связке ключей запрещён). */
function get(db) {
  const v = DB.getSetting(db, SLOT, '');
  if (!v) return null;
  try { return be().decrypt(Buffer.from(v, 'base64')); } catch (e) { return false; }
}
function clear(db) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(SLOT);
  return { ok: true };
}
function mask(key) { return key ? key.slice(0, 9) + '••••••••' + key.slice(-4) : ''; }
function status(db) {
  const k = get(db);
  return { hasKey: !!k, unreadable: k === false, masked: k ? mask(k) : '' };
}

module.exports = { use, set, get, clear, mask, status };
