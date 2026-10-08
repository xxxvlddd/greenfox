'use strict';
/* ============================================================
   КОММЕНТАРИИ АССИСТЕНТА НА ЭКРАНАХ И АВТО-ОТЧЁТ
   ============================================================
   Комментарий — короткая оценка над числами «Обзора», «Расходов»,
   «Прогнозов» и «Планов». Подсказки и предупреждения приложения
   остаются как были и пересчитываются сразу; комментарий — второй слой,
   его пишет модель по тем же данным, что видит человек.

   Обновление — одним запросом на все экраны, где данные изменились:
   после записей — когда человек закончил вносить (через минуту после
   последней), при открытии экрана — если с прошлого раза что-то
   поменялось, например наступил новый день. Рядом с комментарием
   хранится отпечаток данных экрана: данные те же — модель не вызывается.

   Авто-отчёт — сводка за прошедшую неделю или месяц в панели
   ассистента. Делается один раз за период, пока приложение открыто.
   ============================================================ */
const crypto = require('crypto');
const R = require('../core/report');
const prefs = require('./prefs');
const secrets = require('./secrets');
const assistant = require('./assistant');
const expenses = require('./expenses');

const SCREENS = ['overview', 'expenses', 'forecast', 'plans'];
const NAMES = { overview: 'Обзор', expenses: 'Расходы', forecast: 'Прогнозы', plans: 'Планы' };

let busy = null;               /* обновление, которое идёт сейчас */
let lastError = '';

function fpOf(data) {
  return crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}
/* Данные экранов — те же, что уходят с вопросом из панели. «Расходы» —
   за текущий месяц: так экран открывается. */
function dataOf(db, today) {
  const out = {};
  for (const s of SCREENS) {
    const d = assistant.screenData(db, today, { screen: s });
    out[s] = d && !d.empty ? d : null;
  }
  return out;
}

/* Можно ли сейчас обращаться к модели. */
function gate(db, today) {
  if (!secrets.status(db).hasKey) return 'nokey';
  if (!prefs.get(db, 'ai.model')) return 'nomodel';
  const limit = Number(prefs.get(db, 'ai.monthLimit'));
  if (limit > 0 && assistant.monthSpent(db, today).usd >= limit) return 'limit';
  return '';
}

/* Что показать на экранах: комментарии, свежие ли они, идёт ли
   обновление и почему оно невозможно. */
function state(db, today, data) {
  const d = data || dataOf(db, today);
  const rows = {};
  for (const r of db.prepare('SELECT * FROM ai_comments').all()) rows[r.screen] = r;
  const items = {}, stale = [];
  for (const s of SCREENS) {
    const r = rows[s];
    items[s] = r ? { text: r.text, judgment: !!r.judgment, at: r.at, fresh: !!d[s] && r.fp === fpOf(d[s]) } : null;
    if (d[s] && !(items[s] && items[s].fresh)) stale.push(s);
  }
  return { mode: prefs.get(db, 'ai.comments'), gate: gate(db, today), busy: !!busy, error: lastError, items, stale };
}

function instruction(today) {
  return [
    'Ты — ассистент в GREENFOX, приложении домашней бухгалтерии. Сегодня ' + R.human(today) + ' ' + today.slice(0, 4) + '. ' +
      'Человек увидит твои комментарии над числами экранов приложения.',
    'Комментарий — оценка, а не пересказ экрана: что сейчас важно заметить и что с этим сделать. 1–2 предложения, ' +
      'до 200 знаков. Числа — только из данных экрана; одно главное число можно выделить **жирным**. Не повторяй ' +
      'предупреждения экрана слово в слово — дополняй их. Только по-русски, без английских слов, названий полей и JSON. ' +
      'judgment=false — только если в комментарии нет ни оценки, ни совета.',
    assistant.GLOSSARY,
  ].join('\n');
}
function commentTool(want) {
  const props = {};
  for (const s of want) {
    props[s] = { type: 'object', description: 'Комментарий к экрану «' + NAMES[s] + '»',
      properties: { text: { type: 'string' }, judgment: { type: 'boolean' } }, required: ['text'] };
  }
  return { type: 'function', function: { name: 'comments', description: 'Комментарии к экранам приложения',
    parameters: { type: 'object', properties: props, required: want } } };
}
/* Ответ модели: вызов функции, а у части моделей — тот же JSON текстом.
   Формы бывают разные: экран → текст, экран → {text, judgment},
   обёртка {comments: …}, список [{screen, text}], русские названия
   экранов вместо служебных — приводим к одному виду. */
function argsOf(msg) {
  const tc = (msg && Array.isArray(msg.tool_calls) ? msg.tool_calls : []).filter(c => c.function && c.function.name === 'comments')[0];
  let raw = tc ? tc.function.arguments : msg && msg.content;
  if (!raw || typeof raw !== 'object') {
    const t = String(raw || ''), a = t.search(/[{[]/), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    try { raw = a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : {}; } catch (e) { raw = {}; }
  }
  if (raw && raw.comments && typeof raw.comments === 'object') raw = raw.comments;
  const keyOf = k => {
    const x = String(k || '').toLowerCase().replace(/[«»"]/g, '').trim();
    return SCREENS.filter(s => s === x || NAMES[s].toLowerCase() === x)[0] || null;
  };
  const out = {};
  if (Array.isArray(raw)) {
    for (const x of raw) { const k = x && keyOf(x.screen || x.name); if (k) out[k] = x; }
  } else {
    for (const k of Object.keys(raw || {})) { const s = keyOf(k); if (s) out[s] = raw[k]; }
  }
  return out;
}

/* Обновить комментарии. opts.force — по кнопке «Обновить»: экран
   opts.screen (или все) пишется заново, даже если данные не менялись. */
function refresh(db, today, opts) {
  if (busy) return busy;
  busy = run(db, today, opts || {}).finally(() => { busy = null; });
  return busy;
}
async function run(db, today, opts) {
  const d = dataOf(db, today);
  const st = state(db, today, d);
  const want = SCREENS.filter(s => d[s] && (opts.force ? !opts.screen || opts.screen === s || st.stale.includes(s)
                                                       : st.stale.includes(s)));
  if (!want.length || st.gate) return finish(db, today, d);
  const key = secrets.get(db);
  const model = prefs.get(db, 'ai.model');
  const body = { model, max_tokens: 6000, tools: [commentTool(want)], tool_choice: 'auto', messages: [
    { role: 'system', content: instruction(today) },
    { role: 'user', content: want.map(s => 'Экран «' + NAMES[s] + '»: ' + JSON.stringify(d[s]).slice(0, 9000)).join('\n\n') +
      '\n\nНапиши комментарии к экранам ' + want.map(s => '«' + NAMES[s] + '»').join(', ') + ' — вызовом функции comments.' },
  ] };
  const r = await assistant.chat(key, body, null, true);
  if (!r.ok) { lastError = r.error || 'не получилось'; return finish(db, today, d); }
  assistant.record(db, today, model, 'comment', r.json && r.json.usage);
  const choice = r.json && r.json.choices && r.json.choices[0];
  const args = argsOf(choice && choice.message);
  const at = new Date().toISOString();
  const put = db.prepare('INSERT INTO ai_comments(screen, text, judgment, fp, at) VALUES(?,?,?,?,?) ' +
    'ON CONFLICT(screen) DO UPDATE SET text = excluded.text, judgment = excluded.judgment, fp = excluded.fp, at = excluded.at');
  let got = 0;
  for (const s of want) {
    const c = args[s];
    if (!c) continue;
    /* Тот же фильтр служебного текста, что у ответов в панели. */
    const a = assistant.normAnswer(db, { text: typeof c === 'string' ? c : c.text });
    if (a.offTopic || !a.text) continue;
    put.run(s, a.text.slice(0, 400), c.judgment === false ? 0 : 1, fpOf(d[s]), at);
    got++;
  }
  lastError = got ? '' : 'модель не прислала комментариев';
  return finish(db, today, d);
}
/* Состояние после обновления: само обновление уже не «идёт». */
function finish(db, today, d) {
  return Object.assign(state(db, today, d), { busy: false });
}

/* ---------- авто-отчёт ---------- */
const pad = n => String(n).padStart(2, '0');
/* Какой отчёт пора сделать: за прошлую неделю (с понедельника по
   воскресенье) или за прошлый месяц. null — делать нечего: выключено,
   уже сделан или учёт начат позже. */
function reportDue(db, today) {
  const kind = prefs.get(db, 'ai.report');
  if (kind !== 'weekly' && kind !== 'monthly') return null;
  const [y, m, d] = today.split('-').map(Number);
  let from, to, key, title;
  if (kind === 'weekly') {
    const monday = R.addDays(today, -((new Date(y, m - 1, d).getDay() + 6) % 7));
    from = R.addDays(monday, -7); to = R.addDays(monday, -1); key = from;
    /* «21–27 сентября» или «28 сентября — 4 октября» */
    title = 'Сводка за неделю ' + (from.slice(5, 7) === to.slice(5, 7)
      ? Number(from.slice(8)) + '–' + R.human(to) : R.human(from) + ' — ' + R.human(to));
  } else {
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    from = py + '-' + pad(pm) + '-01'; to = R.addDays(y + '-' + pad(m) + '-01', -1); key = from.slice(0, 7);
    title = 'Сводка за ' + expenses.MON_NOM[pm - 1] + ' ' + py;
  }
  const first = db.prepare('SELECT MIN(date) d FROM transactions').get().d;
  if (!first || to < first) return null;
  if (db.prepare('SELECT 1 FROM ai_reports WHERE period = ?').get(key)) return null;
  return { kind, from, to, key, title };
}
let reporting = null;
/* Сделать отчёт, если пора. Возвращает период сделанного отчёта или null. */
function makeReport(db, today) {
  if (reporting) return reporting;
  const due = reportDue(db, today);
  if (!due || gate(db, today)) return Promise.resolve(null);
  reporting = (async () => {
    const r = await assistant.ask(db, today, { mode: 'report', period: due, screen: 'overview' }, { background: true });
    if (!r.ok || r.answer.offTopic) return null;
    db.prepare('INSERT OR IGNORE INTO ai_reports(period, kind, title, answer, at, read) VALUES(?,?,?,?,?,0)')
      .run(due.key, due.kind, due.title, JSON.stringify(Object.assign({}, r.answer, { cost: r.cost })), new Date().toISOString());
    return due.key;
  })().finally(() => { reporting = null; });
  return reporting;
}
/* Непрочитанные отчёты — по порядку периодов. */
function reports(db) {
  return db.prepare('SELECT period, kind, title, answer, at FROM ai_reports WHERE read = 0 ORDER BY period').all()
    .map(r => Object.assign(r, { answer: JSON.parse(r.answer) }));
}
function unread(db) {
  return db.prepare('SELECT COUNT(*) n FROM ai_reports WHERE read = 0').get().n;
}
/* Прочитанный отчёт попадает в память разговора: можно спросить «почему». */
function markRead(db, periods) {
  const list = (Array.isArray(periods) ? periods : []).map(String);
  for (const p of list) {
    const r = db.prepare('SELECT title, answer FROM ai_reports WHERE period = ? AND read = 0').get(p);
    if (!r) continue;
    db.prepare('UPDATE ai_reports SET read = 1 WHERE period = ?').run(p);
    assistant.remember(r.title, assistant.answerText(JSON.parse(r.answer)));
  }
  return { ok: true, unread: unread(db) };
}

module.exports = { SCREENS, state, refresh, fpOf, argsOf, reportDue, makeReport, reports, unread, markRead };
