'use strict';
/* ============================================================
   ДАННЫЕ ДЛЯ ЭКРАНА «КАЛЕНДАРЬ»
   ============================================================
   Месяц по дням. До сегодняшнего дня включительно — факт: траты и
   доходы по внесённым операциям, остаток платёжных счетов из прогона.
   Дальше — ожидание тем же расчётом, что обычный темп на «Прогнозах»:
   дневной темп плюс поступления и платежи по расписанию. Поэтому
   остаток в календаре сходится с прогнозом день в день.

   Деньги уходят в окно строками копеек; у операций — со знаком.
   ============================================================ */
const L = require('../core/ledger');
const R = require('../core/report');
const overview = require('./overview');
const book = require('./book');
const expenses = require('./expenses');
const prefs = require('./prefs');

const SELF = 'Переводы между своими';
const AHEAD = 2;                /* на сколько месяцев вперёд можно листать */

function pad(n) { return String(n).padStart(2, '0'); }
function isoOf(y, m, d) {
  const dt = new Date(y, m, d);
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
}
function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function build(db, todayIso, q) {
  const ov = overview.build(db, todayIso);
  if (ov.empty) return { empty: true };
  const today = ov.today;
  const [ty, tm] = today.split('-').map(Number);
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY sort_order').all();
  const accName = {};
  for (const a of accounts) accName[a.id] = a.name;
  const tech = overview.techCategories(db);
  const BB = book.load(db);
  const hist = BB.hist;
  /* Пополнение кредитки — тем, что осталось внести до грейса. */
  const recurring = book.schedule(db, accounts, BB, today).recurring;
  const firstDay = hist[0].d;
  const [fy, fm] = firstDay.split('-').map(Number);

  /* ── Какой месяц: от первого месяца учёта до двух месяцев вперёд ── */
  const at = (yy, mm) => yy * 12 + mm;
  const minIdx = at(fy, fm - 1), maxIdx = at(ty, tm - 1) + AHEAD;
  const want = q && Number.isInteger(q.year) && Number.isInteger(q.month) ? at(q.year, q.month) : at(ty, tm - 1);
  const cur = Math.min(Math.max(want, minIdx), maxIdx);
  const y = Math.floor(cur / 12), m = cur % 12;

  /* ── Сетка: недели целиком, с понедельника или с воскресенья — как
       задано в настройках ── */
  const weekStart = prefs.get(db, 'ui.weekStart');
  const shift = weekStart === 'sun' ? 0 : 6;
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const gridFrom = isoOf(y, m, 1 - (first.getDay() + shift) % 7);
  const gridTo = isoOf(y, m, last.getDate() + 6 - (last.getDay() + shift) % 7);
  const cells = [];
  for (let d = gridFrom; d <= gridTo; d = R.addDays(d, 1)) cells.push(d);

  /* ── Как пометить операцию в ячейке ── */
  const dueCats = new Set(recurring.filter(r => r.direction !== 'доход' && r.obligatory && r.category &&
                                                r.category !== SELF).map(r => r.category));
  const planned = db.prepare('SELECT * FROM planned').all();
  const boughtKey = new Set(planned.filter(p => p.status === 'bought' && p.bought_at)
    .map(p => p.bought_at + '|' + p.category));
  const kindOf = r => r.direction === 'доход' ? 'inc'
    : r.direction === 'перевод' ? 'mov'
    : boughtKey.has(r.date + '|' + r.category) ? 'plan'
    : dueCats.has(r.category) ? 'due' : 'exp';

  const days = {};
  for (const d of cells) {
    days[d] = { past: d <= today, tracked: d >= firstDay, exp: 0n, inc: 0n, mov: 0n, bal: null,
                marks: [], ops: [], plans: [], note: '', quiet: false };
  }

  /* ── Прошедшие дни: операции ── */
  const curOf = {};
  for (const a of db.prepare('SELECT id, currency FROM accounts').all()) curOf[a.id] = a.currency || 'RUB';
  const ops = db.prepare('SELECT date, amount, amount_from, amount_to, direction, account_from, account_to, category, description ' +
                         'FROM transactions WHERE date BETWEEN ? AND ? ORDER BY date, seq').all(gridFrom, gridTo);
  for (const r of ops) {
    const day = days[r.date];
    if (!day || !day.past) continue;
    const a = BigInt(r.amount), kind = kindOf(r);
    if (R.isSpending({ dir: r.direction, c: r.category }, tech)) day.exp += a;
    if (r.direction === 'доход') day.inc += a;
    if (kind !== 'exp' && day.marks.indexOf(kind) < 0) day.marks.push(kind);
    day.ops.push({
      desc: r.description, cat: r.category, kind,
      acc: r.direction === 'перевод'
        ? (accName[r.account_from] || '—') + ' → ' + (accName[r.account_to] || '—')
        : (accName[r.account_from] || accName[r.account_to] || '—'),
      sum: String(r.direction === 'доход' ? a : r.direction === 'перевод' ? a : -a),
      /* Сумма в валюте валютного счёта — рядом со счётом. */
      fx: curOf[r.account_from] && curOf[r.account_from] !== 'RUB' && r.amount_from !== null
        ? { sum: String(r.amount_from), cur: curOf[r.account_from] }
        : curOf[r.account_to] && curOf[r.account_to] !== 'RUB' && r.amount_to !== null
          ? { sum: String(r.amount_to), cur: curOf[r.account_to] } : null,
    });
  }
  for (const d of cells) {
    if (days[d].past && days[d].tracked) days[d].bal = R.available(R.balanceOn(hist, d).bal, accounts);
  }

  /* ── Будущие дни: тот же расчёт, что обычный темп на «Прогнозах» ──
       Перевод на кредитку остаток платёжных счетов уменьшает, но тратой
       не считается — в ячейке его видно маркером, а не суммой расхода. */
  const rate = BigInt(ov.rates.usual);
  if (gridTo > today) {
    const horizon = R.daysBetween(today, gridTo);
    const events = R.upcoming(recurring, R.addDays(today, 1), horizon - 1);
    const byDay = {};
    for (const e of events) (byDay[e.day] = byDay[e.day] || []).push(e);
    const deadlines = {};
    for (const p of planned) {
      if (p.status === 'queue' && p.deadline) (deadlines[p.deadline] = deadlines[p.deadline] || []).push(p);
    }
    let bal = BigInt(ov.available);
    for (let d = R.addDays(today, 1); d <= gridTo; d = R.addDays(d, 1)) {
      let inc = 0n, exp = rate, mov = 0n;
      const plans = [], marks = [];
      for (const e of byDay[d] || []) {
        const kind = e.dir === 'доход' ? 'inc' : e.category === SELF ? 'mov' : e.obligatory ? 'due' : 'vol';
        if (kind === 'inc') inc += e.amount;
        else if (kind === 'mov') mov += e.amount;
        else exp += e.amount;
        if (kind !== 'vol' && marks.indexOf(kind) < 0) marks.push(kind);
        plans.push({ name: e.name, kind, sum: String(kind === 'inc' ? e.amount : -e.amount),
                     meta: kind === 'mov' ? 'перевод между своими' : kind === 'vol' ? 'регулярный, по желанию'
                         : kind === 'inc' ? 'регулярное поступление' : 'регулярный платёж',
                     cat: e.category, acc: e.accountId });
      }
      for (const p of deadlines[d] || []) {
        if (marks.indexOf('plan') < 0) marks.push('plan');
        plans.push({ name: p.name, kind: 'plan', sum: String(-BigInt(p.price_max)), meta: 'срок покупки из планов',
                     id: p.id });
      }
      bal = bal + inc - exp - mov;
      if (days[d]) Object.assign(days[d], { exp, inc, mov, bal, marks, plans });
    }
  }

  for (const n of db.prepare('SELECT date, text FROM day_notes WHERE date BETWEEN ? AND ?').all(gridFrom, gridTo)) {
    if (days[n.date]) days[n.date].note = n.text;
  }
  /* Отмеченные «без трат». */
  for (const q of db.prepare('SELECT date FROM quiet_days').all()) {
    if (days[q.date]) days[q.date].quiet = true;
  }

  const out = {};
  for (const d of cells) {
    const x = days[d];
    out[d] = { past: x.past, tracked: x.tracked, exp: String(x.exp), inc: String(x.inc), mov: String(x.mov),
               bal: x.bal === null ? null : String(x.bal), marks: x.marks, ops: x.ops, plans: x.plans, note: x.note,
               quiet: x.quiet };
  }
  const income = R.upcoming(recurring, R.addDays(today, 1), 62).filter(u => u.dir === 'доход')[0] || null;
  return {
    empty: false, today, firstDay,
    headLabel: 'Сегодня ' + R.human(today) + ' ' + ty +
               (income ? ' · до поступления ' + R.nDays(R.daysBetween(today, income.day)) : ''),
    year: y, month: m,
    monthName: capFirst(expenses.MON_NOM[m]) + ' ' + y,
    canPrev: cur > minIdx, canNext: cur < maxIdx,
    rate: String(rate),
    cells, days: out,
    weekStart, levels: prefs.levels(db),
  };
}

/* Заметка к дню. Пустая — значит заметки нет: строку удаляем. */
function setNote(db, date, text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('дата не датой: ' + date);
  /* Заметка — пара строк; без предела окно могло бы записать мегабайты. */
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) {
    db.prepare('DELETE FROM day_notes WHERE date = ?').run(date);
  } else {
    db.prepare('INSERT INTO day_notes(date, text, updated_at) VALUES(?, ?, ?) ' +
               'ON CONFLICT(date) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at')
      .run(date, t, new Date().toISOString());
  }
  return { ok: true };
}

/* «День без трат»: записей за день нет, и это не пропуск учёта. on —
   отметить, иначе снять. Будущий день отметить нельзя. */
function setQuiet(db, date, on, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('дата не датой: ' + date);
  const fail = m => { const e = new Error(m); e.user = true; throw e; };
  if (today && date > today) fail('Отметить можно только прошедший или сегодняшний день');
  if (on) {
    const ops = db.prepare("SELECT COUNT(*) n FROM transactions WHERE date = ? AND direction = 'расход'").get(date).n;
    if (ops) fail('В этот день уже есть траты — день не «без трат»');
    db.prepare('INSERT OR REPLACE INTO quiet_days(date, at) VALUES(?, ?)').run(date, new Date().toISOString());
  } else {
    db.prepare('DELETE FROM quiet_days WHERE date = ?').run(date);
  }
  return { ok: true, date, quiet: !!on };
}

module.exports = { build, setNote, setQuiet };
