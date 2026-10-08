'use strict';
/* ============================================================
   ПРОВЕРКА СБОРКИ: ЛИЦЕНЗИИ НА МЕСТЕ
   ============================================================
   electron-builder вызывает это после упаковки приложения, до установщика.
   Лицензии приложения (GPL), Electron и Chromium обязаны лежать внутри
   GREENFOX.app: без них распространять сборку нельзя. Сборщик сам о
   пропавшем файле только упоминает в журнале — здесь сборка останавливается.

   Лицензии Electron и Chromium берутся из node_modules/electron/dist. Его
   Electron 44 докачивает при первом обращении — это делает predist в
   package.json.
   ============================================================ */
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.app');
  const res = path.join(app, 'Contents', 'Resources');
  const need = ['LICENSE.txt', 'LICENSE.electron.txt', 'LICENSES.chromium.html'];
  const missing = need.filter(f => !fs.existsSync(path.join(res, f)));
  if (missing.length) {
    throw new Error('в сборке нет ' + missing.join(', ') + ' — запустите сборку через npm run dist: ' +
                    'он сначала докачивает Electron, из которого берутся эти лицензии');
  }
};
