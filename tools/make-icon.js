'use strict';
/* ============================================================
   ИКОНКА ПРИЛОЖЕНИЯ
   ============================================================
   build/icon.svg → build/icon.icns (все размеры, которые просит macOS)
   и build/icon.png 1024 — для дока при запуске без сборки.

   SVG рисуется в canvas окна Electron: так получаются PNG с честной
   прозрачностью по краям плитки, без сторонних программ. Набор
   размеров склеивает в .icns системная iconutil.

   Запуск: npm run icon
   ============================================================ */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BUILD = path.join(__dirname, '..', 'build');
const SRC = path.join(BUILD, 'icon.svg');
/* Имена файлов набора — как их ждёт iconutil. */
const SET = [[16, 'icon_16x16'], [32, 'icon_16x16@2x'], [32, 'icon_32x32'], [64, 'icon_32x32@2x'],
  [128, 'icon_128x128'], [256, 'icon_128x128@2x'], [256, 'icon_256x256'], [512, 'icon_256x256@2x'],
  [512, 'icon_512x512'], [1024, 'icon_512x512@2x']];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const svg = Buffer.from(fs.readFileSync(SRC, 'utf8')).toString('base64');
  const png = size => win.webContents.executeJavaScript(`new Promise(function(res, rej){
    var img = new Image();
    img.onload = function(){
      var c = document.createElement('canvas'); c.width = ${size}; c.height = ${size};
      var g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, ${size}, ${size});
      res(c.toDataURL('image/png'));
    };
    img.onerror = function(){ rej('icon.svg не нарисовался'); };
    img.src = 'data:image/svg+xml;base64,${svg}';
  })`).then(url => Buffer.from(url.split(',')[1], 'base64'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-')) + '/icon.iconset';
  fs.mkdirSync(dir);
  for (const [size, name] of SET) fs.writeFileSync(path.join(dir, name + '.png'), await png(size));
  fs.writeFileSync(path.join(BUILD, 'icon.png'), await png(1024));
  execFileSync('iconutil', ['-c', 'icns', dir, '-o', path.join(BUILD, 'icon.icns')]);
  console.log('готово: build/icon.icns, build/icon.png');
  app.exit(0);
}).catch(e => { console.error('не получилось: ' + e.message); app.exit(1); });
