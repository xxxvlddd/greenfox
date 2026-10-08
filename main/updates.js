'use strict';
/* ============================================================
   ОБНОВЛЕНИЯ
   ============================================================
   Раз в сутки приложение спрашивает у GitHub, какая версия последняя. В
   запросе нет ничего о человеке и его учёте — только «покажи последний
   релиз». Есть новее установленной — окно показывает плашку.

   Обновлению верим, только если его описание (update.json: версия, имя
   файла, размер, SHA-256, что нового) подписано ключом автора — Ed25519,
   как у Sparkle. Открытая половина ключа — здесь, закрытая есть только у
   автора (tools/release-key.js). Поэтому даже со взломанным аккаунтом
   GitHub чужую программу не подсунуть: подписи у неё не будет.
   Скачанный установщик сверяется с подписанными размером и суммой,
   приложение из него — по идентификатору, версии и подписи кода. Только
   потом оно встаёт на место старого.

   Замена — после выхода: маленький сценарий ждёт, пока приложение
   закроется, переставляет папки и запускает новую версию. Учёт лежит
   отдельно и не трогается; перед заменой делается копия базы.

   В проверках сеть, ключ и системные шаги подменяются: useFetch, useKey,
   useSys.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const DB = require('./db');
const prefs = require('./prefs');

const REPO = 'xxxvlddd/greenfox';
const FEED = 'https://api.github.com/repos/' + REPO + '/releases/latest';
const PAGE = 'https://github.com/' + REPO + '/releases/latest';
const COMMAND = 'curl -fsSL https://raw.githubusercontent.com/' + REPO + '/main/scripts/install.sh | bash';
const ASSET = 'GREENFOX-arm64.dmg';
const MANIFEST = 'update.json';
const SIG = 'update.json.sig';
const APP_NAME = 'GREENFOX.app';
const BUNDLE_ID = 'ru.local.finances';
const DAY = 24 * 3600 * 1000;
/* Открытая половина ключа подписи релизов. */
const PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\n' +
  'MCowBQYDK2VwAyEAulY7s20/w5uad7bfiFFpRoXDM7Bv4o4uWXIWXwXph/E=\n' +
  '-----END PUBLIC KEY-----\n';

let fetchImpl = (...a) => fetch(...a);
let keyPem = PUBLIC_KEY;
function useFetch(f) { fetchImpl = f; }
function useKey(pem) { keyPem = pem || PUBLIC_KEY; }

function fail(msg) { const e = new Error(msg); e.user = true; throw e; }

/* ---------- версии ---------- */
/* «v0.7.0» → [0, 7, 0]. Предварительные версии («0.7.0-beta») — не для всех. */
function parseVersion(s) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(s || '').trim());
  return m ? m.slice(1).map(Number) : null;
}
function newer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/* ---------- подписанное описание релиза ---------- */
/* Подпись проверяется до разбора: неподписанному тексту не верим ни в чём. */
function verifyManifest(text, sig, pem) {
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(String(text), 'utf8'), crypto.createPublicKey(pem || keyPem),
                       Buffer.from(String(sig || '').trim(), 'base64'));
  } catch (e) { ok = false; }
  if (!ok) fail('подпись обновления не сошлась — его не ставим');
  let m;
  try { m = JSON.parse(text); } catch (e) { fail('описание обновления не читается'); }
  if (!m || m.app !== 'GREENFOX' || !parseVersion(m.version) || m.file !== ASSET ||
      !/^[0-9a-f]{64}$/.test(String(m.sha256 || '')) || !(Number.isInteger(m.size) && m.size > 0 && m.size < 2 ** 31)) {
    fail('описание обновления неполное — его не ставим');
  }
  const notes = (Array.isArray(m.notes) ? m.notes : []).slice(0, 4).map(n => String(n).slice(0, 300));
  return { version: String(m.version), sha256: m.sha256, size: m.size, notes, date: String(m.date || '').slice(0, 10) };
}

/* ---------- сеть ---------- */
async function get(url, max, accept) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, redirect: 'follow',
      headers: Object.assign({ 'User-Agent': 'GREENFOX-updater' }, accept ? { Accept: accept } : {}) });
    if (!res.ok) { const e = new Error('GitHub ответил ошибкой ' + res.status); e.status = res.status; throw e; }
    const text = await res.text();
    if (text.length > max) throw Object.assign(new Error('ответ GitHub слишком большой'), { status: -1 });
    return text;
  } catch (e) {
    if (e.status) throw e;
    if (e.name === 'AbortError') throw new Error('GitHub не ответил за 20 секунд');
    throw new Error('нет связи с GitHub');
  } finally { clearTimeout(timer); }
}

/* ---------- что известно ---------- */
function json(db, key) {
  try { return JSON.parse(DB.getSetting(db, key, '') || 'null'); } catch (e) { return null; }
}
let run = null;                  /* идёт установка: { phase, got, total, error, reason } */
/* mode: on — проверяет; off — выключено в настройках; dev — песочница или
   запуск из исходников, где ставить некуда. */
function state(db, current, mode, now) {
  const t = now || Date.now();
  const a = json(db, 'update.available');
  const available = a && newer(a.version, current) ? a : null;
  const later = json(db, 'update.later');
  const off = prefs.get(db, 'upd.check') !== 'on';
  return {
    mode: mode === 'dev' ? 'dev' : off ? 'off' : 'on', current,
    checkedAt: DB.getSetting(db, 'update.checkedAt', '') || null,
    available, snoozed: !!(available && later && later.version === available.version && t < later.until),
    error: DB.getSetting(db, 'update.error', '') || '',
    run, page: PAGE, command: COMMAND,
  };
}

/* ---------- проверка ---------- */
let checking = null;
/* opts: force — не ждать суток; feed — другой адрес (проверки);
   mode — см. state(). */
function check(db, current, opts) {
  const o = opts || {};
  if (o.mode === 'dev') return Promise.resolve(state(db, current, 'dev'));
  if (!o.force && prefs.get(db, 'upd.check') !== 'on') return Promise.resolve(state(db, current));
  const last = Date.parse(DB.getSetting(db, 'update.checkedAt', '')) || 0;
  if (!o.force && Date.now() - last < DAY) return Promise.resolve(state(db, current));
  if (checking) return checking;
  checking = (async () => {
    try {
      const rel = JSON.parse(await get(o.feed || FEED, 2e6, 'application/vnd.github+json'));
      const ver = String((rel && rel.tag_name) || '').replace(/^v/, '');
      let found = null;
      if (rel && !rel.draft && !rel.prerelease && newer(ver, current)) {
        const asset = n => (Array.isArray(rel.assets) ? rel.assets : []).filter(x => x && x.name === n)[0];
        const dmg = asset(ASSET), man = asset(MANIFEST), sig = asset(SIG);
        if (!dmg || !man || !sig) fail('в релизе ' + ver + ' нет подписанного описания — его не ставим');
        const m = verifyManifest(await get(man.browser_download_url, 65536), await get(sig.browser_download_url, 4096));
        if (m.version !== ver) fail('версия в подписанном описании не совпадает с релизом — его не ставим');
        if (dmg.size && dmg.size !== m.size) fail('размер установщика не совпадает с подписанным — его не ставим');
        found = Object.assign(m, { url: String(dmg.browser_download_url) });
      }
      DB.setSetting(db, 'update.available', found ? JSON.stringify(found) : '');
      DB.setSetting(db, 'update.checkedAt', new Date().toISOString());
      DB.setSetting(db, 'update.error', '');
    } catch (e) {
      /* Релизов ещё нет — не ошибка. Подпись не сошлась — прежнее
         предложение снимаем: верить ему больше нельзя. Сети нет —
         прежнее оставляем, попробуем через час. */
      if (e.status === 404) {
        DB.setSetting(db, 'update.available', '');
        DB.setSetting(db, 'update.checkedAt', new Date().toISOString());
        DB.setSetting(db, 'update.error', '');
      } else {
        if (e.user) DB.setSetting(db, 'update.available', '');
        if (e.user || e.status) DB.setSetting(db, 'update.checkedAt', new Date().toISOString());
        DB.setSetting(db, 'update.error', e.message);
      }
    } finally { checking = null; }
    return state(db, current);
  })();
  return checking;
}

/* «Позже» и крестик — до завтра, и только для этой версии. Подсказка с
   командой или ошибка при этом тоже убираются. */
function later(db, current) {
  if (run && !/download|verify|restart/.test(run.phase)) run = null;
  const a = state(db, current).available;
  if (a) DB.setSetting(db, 'update.later', JSON.stringify({ version: a.version, until: Date.now() + DAY }));
  return state(db, current);
}

/* ---------- скачать и проверить ---------- */
async function download(av, dir, onProgress) {
  const res = await fetchImpl(av.url, { redirect: 'follow', headers: { 'User-Agent': 'GREENFOX-updater' } })
    .catch(() => fail('нет связи с GitHub — установщик не скачался'));
  if (!res.ok || !res.body) fail('установщик не скачался: GitHub ответил ' + res.status);
  const file = path.join(dir, ASSET);
  const out = fs.createWriteStream(file, { mode: 0o600 });
  const hash = crypto.createHash('sha256');
  const reader = res.body.getReader();
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got > av.size) fail('установщик больше подписанного размера — его не ставим');
      hash.update(value);
      if (!out.write(value)) await new Promise(r => out.once('drain', r));
      if (onProgress) onProgress(got, av.size);
    }
  } finally {
    await new Promise(r => out.end(r));
  }
  if (got !== av.size) fail('установщик скачался не целиком — попробуйте ещё раз');
  if (hash.digest('hex') !== av.sha256) fail('контрольная сумма установщика не совпала с подписанной — его не ставим');
  return file;
}

/* ---------- системные шаги macOS ---------- */
const sh = (cmd, args) => new Promise((res, rej) => {
  execFile(cmd, args, { timeout: 300000, maxBuffer: 1 << 20 }, (e, out, err) =>
    e ? rej(Object.assign(e, { stderr: String(err || '') })) : res(String(out)));
});
/* Приложение из образа — во временную скрытую папку рядом со старым, на
   том же диске: тогда замена — мгновенное переименование. */
async function unpack(dmg, version, target, work) {
  const mnt = path.join(work, 'mnt');
  fs.mkdirSync(mnt);
  await sh('/usr/bin/hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mnt, '-quiet'])
    .catch(() => fail('установщик не открылся как образ диска'));
  const fresh = path.join(path.dirname(target), '.GREENFOX-' + version + '.app');
  try {
    const src = path.join(mnt, APP_NAME);
    const plist = path.join(src, 'Contents', 'Info.plist');
    const id = (await sh('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist]).catch(() => '')).trim();
    const ver = (await sh('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]).catch(() => '')).trim();
    if (id !== BUNDLE_ID) fail('в установщике другое приложение — его не ставим');
    if (ver !== version) fail('в установщике версия ' + (ver || '?') + ' вместо ' + version + ' — его не ставим');
    fs.rmSync(fresh, { recursive: true, force: true });
    await sh('/usr/bin/ditto', [src, fresh]).catch(() => fail('не удалось скопировать новую версию в ' + path.dirname(target)));
  } finally {
    await sh('/usr/bin/hdiutil', ['detach', mnt, '-quiet', '-force']).catch(() => {});
  }
  try { await sh('/usr/bin/codesign', ['--verify', '--deep', '--strict', fresh]); }
  catch (e) { fs.rmSync(fresh, { recursive: true, force: true }); fail('подпись кода новой версии не сошлась — её не ставим'); }
  await sh('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', fresh]).catch(() => {});
  return fresh;
}

/* Сценарий замены. Аргументы — номер процесса, где стоит приложение, где
   новая версия; дальше — ключи запуска (песочница). Пути приходят
   аргументами, не вклеиваются в текст сценария. */
const SWAP = [
  '#!/bin/sh',
  '# GREENFOX: замена новой версией после выхода приложения.',
  'pid="$1"; target="$2"; fresh="$3"; shift 3',
  'i=0',
  'while kill -0 "$pid" 2>/dev/null; do',
  '  i=$((i + 1)); [ "$i" -gt 600 ] && exit 1',
  '  sleep 0.1',
  'done',
  'old="$target.old-$$"',
  'mv "$target" "$old" || exit 1',
  'if mv "$fresh" "$target"; then rm -rf "$old"; else mv "$old" "$target"; fi',
  'open="${GREENFOX_OPEN:-/usr/bin/open}"',
  'if [ "$#" -gt 0 ]; then "$open" -n "$target" --args "$@"; else "$open" "$target"; fi',
  'rm -rf "$(dirname "$0")"',
  '',
].join('\n');
function swap(target, fresh, args, work) {
  const file = path.join(work, 'swap.sh');
  fs.writeFileSync(file, SWAP, { mode: 0o700 });
  spawn('/bin/sh', [file, String(process.pid), target, fresh].concat(args || []), { detached: true, stdio: 'ignore' }).unref();
}
let sys = { unpack, swap };
function useSys(s) { sys = Object.assign({ unpack, swap }, s || {}); }

/* Остатки прерванной замены рядом с приложением. */
function tidy(target) {
  if (!target) return;
  const dir = path.dirname(target), base = path.basename(target);
  try {
    for (const e of fs.readdirSync(dir)) {
      if (/^\.GREENFOX-\d+\.\d+\.\d+\.app$/.test(e) || e.indexOf(base + '.old-') === 0) {
        fs.rmSync(path.join(dir, e), { recursive: true, force: true });
      }
    }
  } catch (e) { /* папка недоступна — не страшно */ }
}

/* ---------- установка ---------- */
/* env: target() → { path } или { error }; beforeRestart() — копия базы;
   quit() — выход; args — ключи запуска для новой версии; push(state). */
async function install(db, current, env) {
  const a = state(db, current).available;
  if (!a) fail('Новой версии нет — устанавливать нечего');
  if (run && /download|verify|restart/.test(run.phase)) return { ok: false, error: 'Обновление уже идёт' };
  const push = () => { if (env.push) env.push(state(db, current)); };
  const where = env.target();
  if (!where || !where.path) {
    run = { phase: 'manual', reason: (where && where.error) || 'не нашлось, где стоит приложение' };
    push();
    return { ok: false, manual: true };
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'greenfox-update-'));
  let last = 0;
  try {
    run = { phase: 'download', got: 0, total: a.size };
    push();
    const file = await download(a, work, got => {
      run = { phase: 'download', got, total: a.size };
      if (Date.now() - last > 250) { last = Date.now(); push(); }
    });
    run = { phase: 'verify' };
    push();
    const fresh = await sys.unpack(file, a.version, where.path, work);
    fs.rmSync(file, { force: true });
    run = { phase: 'restart', version: a.version };
    push();
    await env.beforeRestart();
    sys.swap(where.path, fresh, env.args || [], work);
    setTimeout(() => env.quit(), 400);
    return { ok: true };
  } catch (e) {
    fs.rmSync(work, { recursive: true, force: true });
    run = { phase: 'error', error: e.user ? e.message : 'не получилось: ' + e.message };
    push();
    return { ok: false, error: run.error };
  }
}
function reset() { run = null; checking = null; }

module.exports = { REPO, FEED, PAGE, COMMAND, ASSET, MANIFEST, SIG, BUNDLE_ID, PUBLIC_KEY, SWAP,
  parseVersion, newer, verifyManifest, state, check, later, download, unpack, swap, tidy, install, reset,
  useFetch, useKey, useSys };
