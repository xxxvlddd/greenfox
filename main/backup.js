'use strict';
/* ============================================================
   РЕЗЕРВНЫЕ КОПИИ
   ============================================================
   Копия базы — целый файл SQLite в папке backups рядом с базой. Её
   делает сам SQLite (db.backup), поэтому копия согласована, даже если
   в эту секунду идёт запись. Хранится столько последних копий, сколько
   задано в настройках; старые удаляются.

   Когда делать копию, решает расписание: раз в день, раз в неделю или
   после изменений. Перед действиями, которые трудно откатить, — перенос
   базы, загрузка таблицы, объединение категорий — копия делается
   всегда.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const prefs = require('./prefs');

/* Копии называются greenfox-…; до переименования — finances-…: их тоже
   видно в списке и чистит ротация. */
const NAME = /^(?:greenfox|finances)-(\d{4}-\d{2}-\d{2})-(\d{6})(?:-([a-z]+))?\.db$/;

function dir(dataDir) { return path.join(dataDir, 'backups'); }
function pad(n) { return String(n).padStart(2, '0'); }
function stamp(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' +
         pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

/* Копии, новые первыми. Время — из имени файла: оно не меняется при
   копировании папки, в отличие от даты изменения. */
function list(dataDir) {
  const d = dir(dataDir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => NAME.test(f)).map(f => {
    const m = NAME.exec(f);
    const t = m[2];
    return { name: f, file: path.join(d, f), reason: m[3] || '',
             at: m[1] + 'T' + t.slice(0, 2) + ':' + t.slice(2, 4) + ':' + t.slice(4, 6),
             size: fs.statSync(path.join(d, f)).size };
  }).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (a.name < b.name ? 1 : -1)));
}
function last(dataDir) {
  const l = list(dataDir);
  return l.length ? l[0].at : null;
}

function prune(db, dataDir) {
  const keep = Number(prefs.get(db, 'data.backupKeep')) || 30;
  for (const b of list(dataDir).slice(keep)) {
    try { fs.unlinkSync(b.file); } catch (e) { /* уже удалена */ }
  }
}

/* reason — латиницей в имени файла: auto, manual, move, import, merge. */
async function make(db, dataDir, reason, now) {
  const d = dir(dataDir);
  fs.mkdirSync(d, { recursive: true });
  let at = now || new Date();
  let name = 'greenfox-' + stamp(at) + (reason ? '-' + reason : '') + '.db';
  /* Две копии в одну секунду не должны затирать друг друга. */
  while (fs.existsSync(path.join(d, name))) {
    at = new Date(at.getTime() + 1000);
    name = 'greenfox-' + stamp(at) + (reason ? '-' + reason : '') + '.db';
  }
  await db.backup(path.join(d, name));
  prune(db, dataDir);
  return { ok: true, name, file: path.join(d, name), at: list(dataDir).filter(b => b.name === name).map(b => b.at)[0] };
}

/* Пора ли делать копию по расписанию. trigger: start — запуск
   приложения, write — после записи. */
function due(db, dataDir, trigger, now) {
  const every = prefs.get(db, 'data.backupEvery');
  const t = now || new Date();
  const lastAt = last(dataDir);
  if (every === 'change') return trigger === 'write' || !lastAt;
  if (!lastAt) return true;
  const prev = new Date(lastAt);
  if (every === 'daily') return prev.toDateString() !== t.toDateString();
  return t - prev >= 7 * 86400000;
}

module.exports = { dir, list, last, make, due, prune };
