'use strict';
/* ============================================================
   ГЛАВНЫЙ ПРОЦЕСС
   ============================================================ */
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, session, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const Database = require('better-sqlite3');
const DB = require('./db');
const R = require('../core/report');
const ipc = require('./ipc');
const updates = require('./updates');
const backup = require('./backup');
const prefs = require('./prefs');

let win = null;
let db = null;

/* Имя — GREENFOX. До 0.6.1 приложение называлось «Финансы», и под этим
   именем в связке ключей macOS лежит ключ, которым зашифрован ключ
   ассистента: Electron берёт запись связки по имени приложения при
   запуске. Поэтому на время запуска имя прежнее, а когда приложение
   готово — GREENFOX: меню и «О программе». Сменить имя сразу — и
   сохранённый ключ ассистента не расшифровать. */
const NAME = 'GREENFOX';
const LEGACY = 'Финансы';
app.setName(LEGACY);

/* Папка данных — Application Support/GREENFOX; прежняя, «Финансы»,
   переезжает при первом запуске (main/rename.js). */
app.setPath('userData', require('./rename').userDataDir(app.getPath('appData'), NAME, LEGACY));

/* Песочница — то же приложение со своей папкой и своей базой: посмотреть
   пустые экраны и состояния, не трогая настоящий учёт. Запуск с
   --sandbox (пустая база) или --sandbox=copy (свежая копия настоящей
   базы); --simulate=error|slow — пример ошибки и медленного расчёта.
   Папка приложения меняется до запуска: иначе две копии делили бы
   одни настройки окна и связку ключей. */
const arg = name => {
  const a = process.argv.filter(x => x === '--' + name || x.indexOf('--' + name + '=') === 0)[0];
  return a ? (a.split('=')[1] || 'empty') : '';
};
const SANDBOX = arg('sandbox');
const SIMULATE = SANDBOX ? arg('simulate') : '';
const REAL_USER_DATA = app.getPath('userData');
if (SANDBOX) app.setPath('userData', path.join(app.getPath('appData'), NAME + ' — песочница'));

/* Папка базы. По умолчанию — внутри данных приложения; человек может
   перенести её, например, в синхронизируемую папку. Куда — записано в
   location.json рядом с данными приложения: в самой базе это хранить
   нельзя, её ещё надо найти. */
function defaultDir() { return path.join(app.getPath('userData'), 'data'); }
function locationFile() { return path.join(app.getPath('userData'), 'location.json'); }
function chosenDir() {
  try { return JSON.parse(fs.readFileSync(locationFile(), 'utf8')).dir || null; } catch (e) { return null; }
}
let currentDir = null;
function dataDir() { return currentDir || defaultDir(); }
function dbFile() { return path.join(dataDir(), 'finances.db'); }

/* Выбранная папка пропала — например, отключён диск. Молча открыть
   базу по умолчанию нельзя: человек вносил бы операции не туда. */
function resolveDir() {
  if (SANDBOX) return defaultDir();
  const dir = chosenDir();
  if (!dir || fs.existsSync(path.join(dir, 'finances.db'))) return dir || defaultDir();
  const pick = dialog.showMessageBoxSync({
    type: 'warning', buttons: ['Выйти', 'Открыть прежнюю базу'], defaultId: 0, cancelId: 0,
    message: 'Папка с базой не найдена',
    detail: 'База была перенесена в папку «' + dir + '», но сейчас её там нет. Если папка на внешнем диске ' +
            'или в облаке, подключите её и запустите приложение снова. «Открыть прежнюю базу» откроет базу ' +
            'из папки по умолчанию — в ней нет того, что вносилось после переноса.',
  });
  if (pick === 0) { app.exit(0); return null; }
  try { fs.unlinkSync(locationFile()); } catch (e) { /* уже нет */ }
  return defaultDir();
}

/* Перенос базы: согласованная копия в новую папку, проверка, что в
   копии те же операции, и только потом переключение. Старый файл
   остаётся на месте — как ещё одна копия. */
async function moveData(dir) {
  const target = path.join(String(dir || ''), 'finances.db');
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'Папка не найдена' };
  if (path.resolve(dir) === path.resolve(dataDir())) return { ok: false, error: 'База уже лежит в этой папке' };
  if (fs.existsSync(target)) return { ok: false, error: 'В этой папке уже лежит база финансов — выберите пустую папку' };
  await backup.make(db, dataDir(), 'move');
  await db.backup(target);
  const n = db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
  const check = new Database(target, { readonly: true });
  const m = check.prepare('SELECT COUNT(*) n FROM transactions').get().n;
  check.close();
  if (m !== n) { try { fs.unlinkSync(target); } catch (e) { /* нечего удалять */ } return { ok: false, error: 'Копия не совпала с базой — база осталась на месте' }; }
  const was = dataDir();
  db.close();
  currentDir = dir;
  db = DB.open(Database, target);
  fs.writeFileSync(locationFile(), JSON.stringify({ dir, movedAt: new Date().toISOString(), from: was }, null, 2));
  return { ok: true, dir, from: was };
}

/* Где стоит приложение и можно ли заменить его новой версией. Нельзя —
   из исходников, из образа диска, из «карантинной» копии macOS (App
   Translocation: приложение запущено прямо из «Загрузок») и без прав на
   папку: тогда плашка предложит обновиться командой. */
function bundlePath() {
  if (!app.isPackaged) return { error: 'приложение запущено из исходников' };
  const p = path.resolve(process.execPath, '..', '..', '..');
  if (!/\.app$/.test(p)) return { error: 'не нашлось, где стоит приложение' };
  if (/\/AppTranslocation\//.test(p) || p.indexOf('/Volumes/') === 0) {
    return { error: 'GREENFOX запущен прямо из образа диска или из «Загрузок» — перенесите его в «Программы»' };
  }
  try {
    fs.accessSync(path.dirname(p), fs.constants.W_OK);
    fs.accessSync(p, fs.constants.W_OK);
  } catch (e) { return { error: 'нет прав менять папку «' + path.dirname(p) + '»' }; }
  return { path: p };
}
/* Проверочный адрес обновлений — только для сквозной проверки: подпись
   обновления он не отменяет. */
const UPDATE_FEED = process.env.GREENFOX_UPDATE_FEED || '';

/* Копия по расписанию — при запуске и после записей. «При каждом
   изменении» — не на каждую строку: подряд идущие записи дают одну
   копию через полминуты после последней. */
let backupTimer = null;
function autoBackup(trigger) {
  try {
    if (!backup.due(db, dataDir(), trigger)) return;
    const wait = trigger === 'write' && prefs.get(db, 'data.backupEvery') === 'change' ? 30000 : 0;
    clearTimeout(backupTimer);
    backupTimer = setTimeout(() => {
      backup.make(db, dataDir(), 'auto').catch(e => console.error('копия не сделана:', e.message));
    }, wait);
  } catch (e) { console.error('копия не сделана:', e.message); }
}

/* Окно приложения — одна страница из папки приложения. Всё, что не она,
   в окно не попадает: ни переход по ссылке, ни новое окно, ни встроенная
   страница. Иначе чужая страница оказалась бы в окне, у которого есть
   мост к базе и файлам. */
const INDEX = path.join(__dirname, '..', 'renderer', 'index.html');
const fromApp = ipc.fromPage(pathToFileURL(INDEX).href);

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  /* Окно показано — сообщаем странице: приветствие мастера начинается,
     когда его уже видно, а не в скрытом окне. */
  const shown = () => { if (win && !win.isDestroyed()) win.webContents.send('win-shown'); };
  win.once('show', () => setTimeout(shown, 30));
  win.once('ready-to-show', () => win.show());
  /* Если окно не показалось за две секунды — показываем как есть.
     Иначе любая ошибка в разметке оставляет человека перед пустым
     доком без единого признака, что приложение вообще запустилось. */
  setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); }, 2000);

  /* Ошибки внутри окна обязаны доходить до журнала: иначе их не видно
     совсем — окно просто не появляется. */
  win.webContents.on('did-fail-load', (e, code, desc, url) => {
    console.error('страница не загрузилась:', code, desc, url);
  });
  win.webContents.on('preload-error', (e, file, err) => {
    console.error('мост не загрузился:', file, err && err.message);
  });
  win.webContents.on('render-process-gone', (e, d) => {
    console.error('окно упало:', d.reason);
  });
  /* Подробности — в самом событии: уровень словом, строка и файл. */
  win.webContents.on('console-message', e => {
    if (e.level === 'error' || e.level === 'warning') console.error('в окне:', e.message, '(' + e.sourceId + ':' + e.lineNumber + ')');
  });

  /* Уйти со своей страницы окно не может, открыть новое — тоже. Ссылок
     наружу в приложении нет. */
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('will-redirect', e => e.preventDefault());
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.loadFile(INDEX);
}

/* Приложение целиком русское, и встроенные части браузера — меню по
   правой кнопке, подсказки полей — должны быть на том же языке, а не
   на языке системы. Поля дат мы рисуем сами: у них формат не зависит
   ни от системы, ни от этой настройки. */
app.commandLine.appendSwitch('lang', 'ru-RU');

/* Песочница начинается заново при каждом запуске: пустая — без единой
   операции, копия — со свежими данными из настоящей базы (она открыта
   только на чтение). */
async function prepareSandbox() {
  fs.mkdirSync(dataDir(), { recursive: true });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbFile() + s); } catch (e) { /* не было */ } }
  if (SANDBOX !== 'copy') return;
  let realDir = path.join(REAL_USER_DATA, 'data');
  try { realDir = JSON.parse(fs.readFileSync(path.join(REAL_USER_DATA, 'location.json'), 'utf8')).dir || realDir; } catch (e) { /* по умолчанию */ }
  const real = path.join(realDir, 'finances.db');
  if (!fs.existsSync(real)) return;
  const src = new Database(real, { readonly: true, fileMustExist: true });
  try { await src.backup(dbFile()); } finally { src.close(); }
}

app.whenReady().then(async () => {
  /* Камера, микрофон, геопозиция, уведомления, устройства — приложению
     не нужно ничего: любой запрос отклоняется без вопроса человеку. */
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  if (session.defaultSession.setDevicePermissionHandler) session.defaultSession.setDevicePermissionHandler(() => false);
  /* Связка ключей уже открыта под прежним именем — дальше GREENFOX.
     Меню собирается заново: стандартное запомнило имя на старте. */
  app.setName(NAME);
  app.setAboutPanelOptions({ applicationName: NAME, applicationVersion: app.getVersion(), version: '',
                             copyright: '© 2026 Valeriy Babenko · GNU GPL 3.0',
                             credits: 'Домашняя бухгалтерия · github.com/xxxvlddd/greenfox' });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' },
                                                  { role: 'viewMenu' }, { role: 'windowMenu' }]));
  /* Без сборки в доке — значок Electron; показываем свой. */
  if (!app.isPackaged && app.dock) {
    try { app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png')); } catch (e) { /* нет иконки — не страшно */ }
  }
  currentDir = resolveDir();
  if (!currentDir) return;
  if (SANDBOX) await prepareSandbox();
  db = DB.open(Database, dbFile());
  autoBackup('start');
  /* Остатки прерванного обновления рядом с приложением. */
  if (app.isPackaged) updates.tidy(bundlePath().path);

  ipc.register(ipcMain, {
    db: () => db,
    today: () => process.env.FINANCES_TODAY || R.iso(new Date()),
    version: app.getVersion(),
    sandbox: SANDBOX ? (SANDBOX === 'copy' ? 'копия ваших данных' : 'пустая база') : '',
    trust: fromApp,
    /* Обновления: в установленном приложении; в песочнице и из исходников —
       только со сквозным проверочным адресом. */
    updater: {
      enabled: (app.isPackaged && !SANDBOX) || !!UPDATE_FEED,
      feed: UPDATE_FEED || undefined,
      target: bundlePath,
      args: process.argv.slice(1).filter(a => /^--(sandbox|simulate)(=|$)/.test(a)),
      quit: () => app.quit(),
      copy: text => clipboard.writeText(text),
      open: url => shell.openExternal(url),
    },
    updateDelay: UPDATE_FEED ? 3000 : undefined,
    simulate: SIMULATE,
    dataDir, defaultDir, moveData,
    afterWrite: () => autoBackup('write'),
    /* Комментарии и отчёты ассистента приходят в окно сами, без запроса. */
    broadcast: (channel, value) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, value); },
    pickFolder: async () => {
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
      return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
    },
    pickFile: async () => {
      const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Таблица CSV', extensions: ['csv'] }] });
      return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
    },
    /* Только папки: файл, открытый «в Finder», запустился бы. */
    reveal: p => (p && fs.existsSync(p) && fs.statSync(p).isDirectory()
      ? shell.openPath(p).then(err => ({ ok: !err, error: err || undefined }))
      : { ok: false, error: 'Папки ещё нет' }),
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* На Mac закрытое окно не значит выход: из дока его открывают снова, и
   база ему нужна. Закрываем её только при выходе. */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => {
  clearTimeout(backupTimer);
  if (db) { try { db.close(); } catch (e) { /* уже закрыта */ } }
});
