'use strict';
/* ============================================================
   ПЕРЕЕЗД ПАПКИ ДАННЫХ ПОСЛЕ ПЕРЕИМЕНОВАНИЯ
   ============================================================
   До 0.6.1 приложение называлось «Финансы», и данные лежали в
   Application Support/Финансы. Теперь — Application Support/GREENFOX.
   При первом запуске новой версии прежняя папка переезжает целиком:
   база, копии, настройки окна. Переименование на том же диске — одно
   действие: либо переехала вся, либо осталась на месте, и тогда
   приложение работает в прежней. Новая папка уже есть — ничего не
   трогаем: её не перезаписать старой.
   ============================================================ */
const fs = require('fs');
const path = require('path');

function userDataDir(appData, name, legacy) {
  const fresh = path.join(appData, name), old = path.join(appData, legacy);
  if (fs.existsSync(fresh) || !fs.existsSync(old)) return fresh;
  try { fs.renameSync(old, fresh); } catch (e) { return old; }
  /* Папка базы, выбранная внутри прежней, — по новому пути. */
  try {
    const loc = path.join(fresh, 'location.json');
    const j = JSON.parse(fs.readFileSync(loc, 'utf8'));
    if (j.dir && (j.dir === old || j.dir.indexOf(old + path.sep) === 0)) {
      j.dir = fresh + j.dir.slice(old.length);
      fs.writeFileSync(loc, JSON.stringify(j, null, 2));
    }
  } catch (e) { /* папку базы не переносили */ }
  return fresh;
}

module.exports = { userDataDir };
