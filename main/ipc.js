'use strict';
/* ============================================================
   ВЫЗОВЫ ИЗ ОКНА
   ============================================================
   Всё, что окно может попросить у главного процесса, перечислено
   здесь. Приложение и живые проверки подключают один и тот же список:
   проверка видит ровно те вызовы, что работают у человека.

   env — то, чем приложение отличается от проверки: база, сегодняшняя
   дата, папка данных, системные окна выбора файла, перенос базы.

   Ошибка проверки ввода уходит в окно текстом — человек видит, что
   поправить; сбой базы называется сбоем, а не выдаётся за ошибку ввода.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const overview = require('./overview');
const expenses = require('./expenses');
const capital = require('./capital');
const forecast = require('./forecast');
const plans = require('./plans');
const calendar = require('./calendar');
const payments = require('./payments');
const entry = require('./entry');
const prefs = require('./prefs');
const settings = require('./settings');
const secrets = require('./secrets');
const openrouter = require('./openrouter');
const backup = require('./backup');
const csvio = require('./csvio');
const integrity = require('./integrity');
const assistant = require('./assistant');
const comments = require('./comments');
const onboard = require('./onboard');
const fx = require('./fx');
const updates = require('./updates');

/* Вызов пришёл от нашей страницы — главного кадра окна с index.html
   приложения, — а не от чего-то, что в окно попало. */
function fromPage(indexUrl) {
  return e => {
    const f = e && e.senderFrame;
    return !!f && !!e.sender && f === e.sender.mainFrame && String(f.url).split('#')[0] === indexUrl;
  };
}

function register(ipcMain, env) {
  const db = () => env.db();
  const today = () => env.today();
  /* Чтение: сбой — в поле error, экран покажет его, а не упадёт. */
  const read = fn => (e, ...a) => {
    try { return fn(...a); } catch (err) { return { error: err.message }; }
  };
  /* Окну — без запроса: обновились комментарии, готов отчёт. */
  const send = (channel, value) => { if (env.broadcast) env.broadcast(channel, value); };

  /* Комментарии ассистента на экранах. После записи — через минуту
     тишины: пять операций подряд дают одно обновление, а не пять. */
  const CM_AFTER_WRITE = env.commentsDelay === undefined ? 60000 : env.commentsDelay;
  const CM_ON_OPEN = env.commentsOpenDelay === undefined ? 1500 : env.commentsOpenDelay;
  let cmTimer = null;
  const cmRun = async () => {
    cmTimer = null;
    send('comments', Object.assign(comments.state(db(), today()), { busy: true }));
    send('comments', await comments.refresh(db(), today()));
  };
  const cmLater = ms => { clearTimeout(cmTimer); cmTimer = setTimeout(() => { cmRun().catch(() => {}); }, ms); };
  const cmAuto = () => { try { return prefs.get(db(), 'ai.comments') === 'auto'; } catch (e) { return false; } };

  /* Авто-отчёт: проверка вскоре после запуска, потом раз в час. */
  const repCheck = async () => {
    try {
      const done = await comments.makeReport(db(), today());
      if (done) send('report', { unread: comments.unread(db()) });
    } catch (e) { /* следующая проверка — через час */ }
  };
  const t1 = setTimeout(repCheck, env.reportDelay === undefined ? 20000 : env.reportDelay);
  const t2 = setInterval(repCheck, 3600000);
  if (t1.unref) { t1.unref(); t2.unref(); }

  /* Курсы ЦБ: вскоре после запуска, потом раз в три часа и после записи
     (завели валютный счёт — курсы нужны сразу). Ходит в сеть, только если
     в учёте есть валютный счёт; новые курсы — окно перерисует экран. */
  const fxRun = async force => {
    try {
      const r = await fx.refresh(db(), today(), { force: !!force });
      if (r.added || force) send('fx', fx.status(db(), today()));
      return r;
    } catch (e) { return { ok: false, error: e.message }; }
  };
  const fxAuto = env.fxDelay !== null;            /* null — в проверке без сети */
  if (fxAuto) {
    const f1 = setTimeout(() => fxRun(false), env.fxDelay === undefined ? 3000 : env.fxDelay);
    const f2 = setInterval(() => fxRun(false), 3 * 3600000);
    if (f1.unref) { f1.unref(); f2.unref(); }
  }

  /* Обновления: вскоре после запуска, потом каждый час — не прошли ли
     сутки с прошлой проверки. env.updater — у приложения: где оно стоит,
     как выйти и перезапуститься; без него (проверки, песочница, запуск из
     исходников) обновления не проверяются. */
  const upd = env.updater || null;
  const updMode = () => (upd && upd.enabled ? '' : 'dev');
  const updState = () => updates.state(db(), env.version, updMode());
  let updShown = '';
  const updRun = async force => {
    try {
      const st = await updates.check(db(), env.version, { force: !!force, feed: upd && upd.feed, mode: updMode() });
      const key = st.available ? st.available.version : '';
      if (force || key !== updShown) { updShown = key; send('update', st); }
      return st;
    } catch (e) { return updState(); }
  };
  if (upd && upd.enabled && env.updateDelay !== null) {
    const u1 = setTimeout(() => updRun(false), env.updateDelay === undefined ? 15000 : env.updateDelay);
    const u2 = setInterval(() => updRun(false), 3600000);
    if (u1.unref) { u1.unref(); u2.unref(); }
  }

  /* Запись: после удачной — проверка, не пора ли сделать копию, и
     комментарии на экранах — в очередь на обновление. */
  const write = fn => async (e, ...a) => {
    try {
      const r = await fn(...a);
      if (r && r.ok && env.afterWrite) env.afterWrite();
      if (r && r.ok && cmAuto()) cmLater(CM_AFTER_WRITE);
      if (r && r.ok && fxAuto) fxRun(false);
      return r;
    } catch (err) {
      return { ok: false, error: err.user ? err.message : 'сбой записи: ' + err.message };
    }
  };
  /* Отвечаем только своей странице: env.trust проверяет, что вызов пришёл
     из окна приложения с его index.html, а не от чего-то постороннего. */
  const h = (name, fn) => ipcMain.handle(name, (e, ...a) => {
    if (env.trust && !env.trust(e)) throw new Error('вызов не из окна приложения');
    return fn(e, ...a);
  });
  /* Пути к файлам и папкам окно не придумывает: годится только то, что
     человек сам выбрал в системном окне выбора. */
  const picked = new Set();
  const pick = p => { if (p) picked.add(p); return p; };
  const chosen = (p, what) => {
    if (!p || !picked.has(p)) { const err = new Error(what + ' не выбран' + (what === 'Файл' ? '' : 'а') + ' — выберите заново'); err.user = true; throw err; }
    return p;
  };
  let exported = null;           /* последняя папка выгрузки — её можно показать в Finder */

  /* Пакетный вариант модели (:batch) отвечает с задержкой — если такой был
     выбран из старого списка, берём ту же модель в обычном режиме. */
  try {
    const m = prefs.get(db(), 'ai.model');
    if (/:batch$/.test(m)) prefs.set(db(), 'ai.model', m.replace(/:batch$/, ''));
  } catch (e) { /* база ещё пустая — нечего чинить */ }

  /* ── Экраны ──
     В песочнице можно посмотреть ошибку расчёта и медленный расчёт:
     env.simulate — 'error' или 'slow'. В приложении его нет. */
  const screen = fn => {
    /* Пустой экран без единого счёта — первым делом нужен счёт, а не
       операция: экран предложит его добавить. */
    const r0 = read(fn);
    const r = (e, ...a) => {
      const d = r0(e, ...a);
      if (d && d.empty) d.noAccounts = db().prepare('SELECT COUNT(*) n FROM accounts WHERE archived = 0').get().n === 0;
      return d;
    };
    if (env.simulate === 'error') return () => ({ error: 'Сумма операций по дням не совпала с итогом периода — пример ошибки в песочнице' });
    if (env.simulate === 'slow') return (e, ...a) => new Promise(res => setTimeout(() => res(r(e, ...a)), 1500));
    return r;
  };
  h('overview', screen(() => overview.build(db(), today())));
  h('expenses', screen(q => expenses.build(db(), today(), q)));
  h('capital', screen(() => capital.build(db(), today())));
  h('forecast', screen(() => forecast.build(db(), today())));
  /* «А если платить больше» — ошибка здесь не должна ронять экран. */
  h('loan-plan', (e, extra) => { try { return forecast.loanPlan(db(), today(), extra); } catch (err) { return null; } });
  h('plans', screen(() => plans.build(db(), today())));
  h('plan-tag', write((id, axis, value) => plans.setTag(db(), Number(id), axis, value)));
  h('calendar', screen(q => calendar.build(db(), today(), q)));
  h('day-note', write((date, text) => calendar.setNote(db(), date, text)));
  h('payments', screen(() => payments.build(db(), today())));
  h('question-done', write(key => payments.resolveQuestion(db(), key)));
  h('payment-skip', write(id => payments.skipPayment(db(), id, today(), entry.remember)));
  h('question-add', write(q => payments.addQuestion(db(), q, entry.remember)));
  h('day-quiet', write((date, on) => calendar.setQuiet(db(), date, !!on, today())));

  /* ── Окна ввода ── */
  h('form-data', read(() => entry.formData(db(), today())));
  h('recon-calc', read(date => entry.reconCalc(db(), date)));
  h('loan-preview', (e, q) => { try { return entry.loanPreview(db(), q, today()); } catch (err) { return null; } });
  h('add-operation', write(op => entry.addOperation(db(), op, today())));
  h('add-category', write(c => entry.addCategory(db(), c)));
  h('save-plan', write(p => entry.savePlan(db(), p, today())));
  h('save-recurring', write(r => entry.saveRecurring(db(), r, today())));
  h('save-goal', write(g => entry.saveGoal(db(), g)));
  h('save-account', write(a => entry.saveAccount(db(), a, today())));
  h('save-loan', write(l => entry.saveLoan(db(), l, today())));
  h('save-recon', write(r => entry.saveRecon(db(), r, today())));
  h('drop-plan', write(id => entry.dropPlan(db(), id)));
  h('plan-aside', write((id, amount) => entry.setAside(db(), id, amount)));
  h('pause-recurring', write(id => entry.pauseRecurring(db(), id)));
  h('undo', write(token => entry.undo(db(), token)));

  /* ── Мастер первого запуска ── */
  h('onboard-state', read(() => onboard.state(db(), today())));
  /* Перед записью — курсы валют новых счетов: итог мастера считает
     доллары в рублях. Нет связи — итог посчитается без них. */
  h('onboard-apply', write(async p => {
    const curs = ((p && p.accounts) || []).filter(a => !a.existing && a.cur && a.cur !== 'RUB').map(a => a.cur);
    if (curs.length) { try { await fx.refresh(db(), today(), { curs }); } catch (e) { /* без курса */ } }
    return onboard.apply(db(), p, today());
  }));

  /* ── Настройки ── */
  let keyInfo = null;            /* последняя проверка ключа — до перезапуска */
  const ctx = () => {
    const dir = env.dataDir();
    const list = backup.list(dir);
    return { version: env.version, dataDir: dir, isDefaultDir: dir === env.defaultDir(),
             lastBackup: list.length ? list[0].at : null, backups: list.length,
             keyStatus: secrets.status(db()), keyInfo, update: updState() };
  };
  h('settings', read(() => settings.build(db(), today(), ctx())));
  /* Настройки окна при запуске: тема, плотность, первый экран, есть ли ключ. */
  h('prefs', read(() => Object.assign(prefs.all(db()), { hasKey: secrets.status(db()).hasKey, reportsUnread: comments.unread(db()) })));
  h('pref-set', write((key, value) => {
    const r = prefs.set(db(), key, value);
    /* Включили отчёт — проверим, не пора ли его сделать, не дожидаясь часа. */
    if (r && r.ok && key === 'ai.report') setTimeout(repCheck, 3000);
    /* Включили проверку обновлений — проверим сразу. */
    if (r && r.ok && key === 'upd.check' && r.value === 'on') setTimeout(() => updRun(true), 500);
    if (r && r.ok && key === 'upd.check') send('update', updState());
    return r;
  }));
  /* Курсы валют — в «Настройках» → «Расчёты». */
  h('fx-status', read(() => fx.status(db(), today())));
  h('fx-refresh', async () => {
    const r = await fxRun(true);
    return Object.assign(fx.status(db(), today()), { ok: r.ok, error: r.ok ? '' : r.error });
  });
  h('fx-manual', write((cur, raw) => fx.setManual(db(), cur, raw, today())));
  /* Мастер: выбрали доллары у счёта, которого ещё нет в базе. */
  h('fx-ensure', async (e, cur) => {
    try { await fx.refresh(db(), today(), { curs: [cur] }); } catch (err) { /* без курса — посчитает позже */ }
    return fx.forForms(db());
  });
  h('account-edit', write(a => entry.editAccount(db(), Object.assign({}, a, { today: today() }))));
  h('account-reorder', write(ids => entry.reorderAccounts(db(), ids)));
  h('account-archive', write(id => entry.archiveAccount(db(), id, today())));
  h('account-restore', write(id => entry.restoreAccount(db(), id)));
  h('category-edit', write(c => entry.editCategory(db(), c)));
  h('category-merge', write(async (from, to) => {
    await backup.make(db(), env.dataDir(), 'merge');
    return entry.mergeCategory(db(), from, to);
  }));
  h('category-archive', write(name => entry.archiveCategory(db(), name)));
  h('category-restore', write(name => entry.restoreCategory(db(), name)));
  h('category-delete', write(name => entry.deleteCategory(db(), name)));
  h('recurring-resume', write(id => entry.resumeRecurring(db(), id)));
  h('loan-rate', write(rate => entry.setLoanRate(db(), rate)));
  h('card-terms', write(t => entry.setCardTerms(db(), Object.assign({}, t, { today: today() }))));

  /* ── Ассистент: ключ и модели ── */
  h('ai-key-set', write(async raw => {
    const r = secrets.set(db(), raw);
    keyInfo = await openrouter.keyInfo(String(raw).trim());
    return { ok: true, masked: r.masked, info: keyInfo };
  }));
  h('ai-key-clear', write(() => { keyInfo = null; return secrets.clear(db()); }));
  h('ai-key-check', async () => {
    const key = secrets.get(db());
    if (!key) return { ok: false, error: key === false ? 'Система не отдала ключ — добавьте его заново' : 'Ключ не задан' };
    keyInfo = await openrouter.keyInfo(key);
    return keyInfo;
  });
  /* Список моделей с ценами — с OpenRouter, с запасом в базе на случай
     отсутствия сети. Если модель ещё не выбрана — предлагаем свежую
     Sonnet. */
  h('ai-models', async () => {
    const r = await openrouter.models();
    if (!r.ok) return r;
    const d = db();
    const cur = prefs.get(d, 'ai.model');
    if (cur && /:batch$/.test(cur)) prefs.set(d, 'ai.model', cur.replace(/:batch$/, ''));
    d.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('ai.models', JSON.stringify(r.list));
    d.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('ai.models.at', new Date().toISOString());
    let model = prefs.get(d, 'ai.model');
    if (!model) { model = openrouter.suggest(r.list); if (model) prefs.set(d, 'ai.model', model); }
    return { ok: true, count: r.list.length, model };
  });

  /* ── Панель ассистента ──
     Вопрос идёт долго — до минуты: модель обращается к данным по
     нескольку раз. «Остановить» обрывает запрос. */
  h('assistant-meta', read(() => assistant.meta(db(), today())));
  h('assistant-ask', async (e, q) => {
    try {
      /* Шаги работы — в окно по мере дела: панель показывает, чем занят ассистент. */
      const query = Object.assign({}, q || {}, { onStep: s => { try { e.sender.send('assistant-step', s); } catch (err) { /* окно закрыто */ } } });
      const r = await assistant.ask(db(), today(), query);
      if (r && r.saved && r.saved.ok && env.afterWrite) env.afterWrite();
      if (r && r.saved && r.saved.ok && cmAuto()) cmLater(CM_AFTER_WRITE);
      return r;
    } catch (err) { return { ok: false, state: 'error', error: 'сбой: ' + err.message }; }
  });
  h('assistant-stop', () => assistant.stop());
  h('assistant-reset', () => assistant.reset());
  h('assistant-save', write(cards => assistant.save(db(), today(), cards)));

  /* ── Комментарии и отчёты ──
     Экран открыт, а данные с прошлого комментария изменились (новый день,
     записи без комментариев) — обновляем вскоре, если очередь пуста. */
  h('comments', read(() => {
    const st = comments.state(db(), today());
    if (st.mode === 'auto' && !st.gate && st.stale.length && !st.busy && !cmTimer) cmLater(CM_ON_OPEN);
    return st;
  }));
  h('comments-refresh', async (e, screen) => {
    try {
      clearTimeout(cmTimer); cmTimer = null;
      const st = await comments.refresh(db(), today(), { force: true, screen: comments.SCREENS.includes(screen) ? screen : null });
      send('comments', st);
      return st;
    } catch (err) { return { error: 'сбой: ' + err.message }; }
  });
  h('reports', read(() => comments.reports(db())));
  h('reports-read', read(periods => comments.markRead(db(), periods)));

  /* ── Данные ── */
  h('pick-folder', async () => pick(await env.pickFolder()));
  h('pick-file', async () => pick(await env.pickFile()));
  /* Показать в Finder можно только свои папки: базы, копий и последней
     выгрузки. */
  h('reveal', (e, which) => {
    const dir = which === 'backups' ? backup.dir(env.dataDir()) : which === 'data' ? env.dataDir()
      : which === 'export' ? exported : null;
    return dir ? env.reveal(dir) : { ok: false, error: 'Неизвестная папка' };
  });
  h('data-move', write(dir => env.moveData(chosen(dir, 'Папка'))));
  h('backup-now', write(() => backup.make(db(), env.dataDir(), 'manual')));
  h('export-csv', write((dir, tables) => {
    const r = csvio.exportCsv(db(), chosen(dir, 'Папка'), tables, today() || undefined);
    if (r && r.ok) exported = r.dir;
    return r;
  }));
  /* Операции периода с «Расходов» — в выбранную папку. */
  h('export-period', write((dir, from, to) => {
    const r = csvio.exportPeriod(db(), chosen(dir, 'Папка'), from, to, today() || undefined);
    if (r && r.ok) exported = r.dir;
    return r;
  }));
  h('import-preview', read(file => csvio.importPreview(db(), chosen(file, 'Файл'), today() || new Date().toISOString().slice(0, 10))));
  h('import-apply', write(async (token, withDups) => {
    await backup.make(db(), env.dataDir(), 'import');
    return csvio.importApply(db(), token, withDups, entry.remember);
  }));
  h('integrity', read(() => integrity.check(db(), today())));
  h('changelog', () => {
    try { return fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'); } catch (e) { return ''; }
  });
  h('app-info', () => ({ version: env.version, dataDir: env.dataDir(), sandbox: env.sandbox || '' }));

  /* ── Обновления ── */
  h('update-state', read(() => updState()));
  h('update-check', () => updRun(true));
  h('update-later', read(() => { const st = updates.later(db(), env.version); send('update', st); return st; }));
  h('update-install', async () => {
    if (!upd || !upd.enabled) return { ok: false, error: 'Здесь приложение не обновляется' };
    try {
      return await updates.install(db(), env.version, {
        target: upd.target, args: upd.args, quit: upd.quit, push: st => send('update', st),
        beforeRestart: () => backup.make(db(), env.dataDir(), 'update'),
      });
    } catch (err) { return { ok: false, error: err.user ? err.message : 'сбой: ' + err.message }; }
  });
  /* Адрес и команда — свои, не из окна. */
  h('update-copy', () => (upd && upd.copy ? upd.copy(updates.COMMAND) : null, { ok: true }));
  h('update-page', () => (upd && upd.open ? upd.open(updates.PAGE) : null, { ok: true }));
}

module.exports = { register, fromPage };
