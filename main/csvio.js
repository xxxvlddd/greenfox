'use strict';
/* ============================================================
   ВЫГРУЗКА И ЗАГРУЗКА ТАБЛИЦ
   ============================================================
   Выгрузка пишет те же таблицы, что лежали в папке учёта до
   приложения: те же имена файлов и колонок, суммы с двумя знаками,
   даты ГГГГ-ММ-ДД. Каждая выгрузка — в свою новую папку: старые файлы
   не затираются.

   Загрузка принимает журнал операций в том же формате. Ни одна строка
   не попадает в базу, пока человек не увидел отчёт: сколько строк
   можно добавить, какие отклонены и почему, какие похожи на уже
   внесённые. Добавление — одной транзакцией и с отменой.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readCsv, toCsv } = require('../core/csv');
const M = require('../core/money');
const R = require('../core/report');
const book = require('./book');

const SELF = 'Переводы между своими';
const ACC_TYPE_OUT = { 'брокерский': 'брокерский счёт', 'крипто': 'криптокошелёк', 'текущий': 'текущий счёт', 'копилка': 'копилка' };
const FREQ_OUT = { month: 'месяц', year: 'год', week: 'неделя', quarter: 'квартал' };
const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const TABLES = ['transactions', 'accounts', 'categories', 'recurring', 'liabilities', 'planned',
                'savings_goals', 'balances_history'];
const TABLE_NAMES = { transactions: 'Журнал операций', accounts: 'Счета', categories: 'Категории',
  recurring: 'Регулярные платежи', liabilities: 'Кредиты и долги', planned: 'Планы покупок',
  savings_goals: 'Цели накоплений', balances_history: 'Снимки балансов' };

function fail(msg) { const e = new Error(msg); e.user = true; throw e; }
const rub = c => (c === null || c === undefined ? '' : M.fmt(BigInt(c)));
function pad(n) { return String(n).padStart(2, '0'); }

/* ── Выгрузка ─────────────────────────────────────────────── */
function tableRows(db, name, today) {
  if (name === 'transactions') {
    /* amount — в рублях, как всегда. Есть операции по валютным счетам —
       ещё две колонки: amount_from / amount_to в валюте счёта списания и
       зачисления. Нет — формат прежний, его читают старые таблицы. */
    const list = db.prepare('SELECT * FROM transactions ORDER BY date, seq, id').all();
    const withFx = list.some(t => t.amount_from !== null || t.amount_to !== null);
    return { head: ['date', 'amount', 'currency', 'direction', 'account_from', 'account_to', 'category',
                    'description', 'source', 'flag'].concat(withFx ? ['amount_from', 'amount_to'] : []),
      rows: list.map(t => Object.assign({
        date: t.date, amount: rub(t.amount), currency: t.currency, direction: t.direction,
        account_from: t.account_from || '', account_to: t.account_to || '', category: t.category,
        description: t.description, source: t.source, flag: t.flag },
        withFx ? { amount_from: rub(t.amount_from), amount_to: rub(t.amount_to) } : {})) };
  }
  if (name === 'accounts') {
    return { head: ['id', 'name', 'bank', 'type', 'currency', 'balance', 'credit_limit', 'grace_period', 'updated_at',
                    'start_balance', 'start_date', 'is_payment', 'archived'],
      rows: db.prepare('SELECT * FROM accounts ORDER BY sort_order').all().map(a => ({
        id: a.id, name: a.name, bank: a.bank, type: ACC_TYPE_OUT[a.type] || a.type, currency: a.currency,
        /* balance — подтверждённый сверкой остаток на updated_at, как и
           было в таблице до приложения; текущий остаток вычисляется. */
        balance: rub(a.reconciled_balance), credit_limit: rub(a.credit_limit), grace_period: a.grace_note,
        updated_at: a.reconciled_at || '', start_balance: rub(a.start_balance), start_date: a.start_date,
        is_payment: a.is_payment ? 'да' : 'нет', archived: a.archived ? 'да' : 'нет' })) };
  }
  if (name === 'categories') {
    return { head: ['category', 'type', 'note', 'active'],
      rows: db.prepare('SELECT * FROM categories ORDER BY sort_order').all().map(c => ({
        category: c.name, type: c.type, note: c.note, active: c.active ? 'да' : 'нет' })) };
  }
  if (name === 'recurring') {
    return { head: ['id', 'name', 'category', 'amount', 'frequency', 'day', 'account', 'type', 'note', 'end_date', 'active'],
      rows: db.prepare('SELECT * FROM recurring ORDER BY id').all().map(r => ({
        id: r.id, name: r.name, category: r.category || '',
        amount: rub(r.amount) + (r.amount_max === null ? '' : '-' + rub(r.amount_max)),
        frequency: FREQ_OUT[r.period] || r.period,
        day: r.period === 'week' ? WEEKDAYS[(r.day_of_week || 1) - 1] : (r.day_of_month || ''),
        account: r.account_id || '',
        type: r.direction === 'доход' ? 'доход' : r.obligatory ? 'обязательный' : 'добровольный',
        note: r.note, end_date: r.end_date || '', active: r.active ? 'да' : 'нет' })) };
  }
  if (name === 'liabilities') {
    const B = book.load(db);
    const snap = B.hist.length ? R.balanceOn(B.hist, today) : { bal: {}, loan: 0n };
    return { head: ['id', 'creditor', 'type', 'initial_amount', 'current_debt', 'rate_pct', 'monthly_payment',
                    'payment_day', 'close_date', 'in_regular_expenses'],
      rows: db.prepare('SELECT * FROM liabilities').all().map(l => {
        /* Текущий долг — из прогона: по кредиту — остаток тела, по
           кредитке — минус на карте. */
        const debt = l.account_id ? -(snap.bal[l.account_id] || 0n) : snap.loan;
        return { id: l.id, creditor: l.creditor, type: l.type, initial_amount: rub(l.initial_amount),
          current_debt: rub(debt > 0n ? debt : 0n), rate_pct: l.rate_bp === null ? '' : (l.rate_bp / 100).toFixed(2),
          monthly_payment: rub(l.monthly_payment), payment_day: l.payment_day || '', close_date: l.close_date || '',
          in_regular_expenses: l.in_regular ? 'да' : 'нет' };
      }) };
  }
  if (name === 'planned') {
    return { head: ['id', 'name', 'price_min', 'price_max', 'category', 'necessity', 'urgency', 'replaceable',
                    'recurring_cost', 'status', 'added', 'bought_date', 'note'],
      rows: db.prepare('SELECT * FROM planned ORDER BY id').all().map(p => ({
        id: p.id, name: p.name, price_min: rub(p.price_min), price_max: rub(p.price_max), category: p.category,
        necessity: p.need === 'need' ? 'необходимо' : p.unsure ? 'полезно-хочется' : 'хочется',
        urgency: p.urgency === 'hot' ? 'горит' : 'не горит', replaceable: p.replaceable ? 'да' : 'нет',
        recurring_cost: rub(p.recurring_cost),
        status: p.status === 'bought' ? 'куплено' : p.status === 'dropped' ? 'отменено' : 'планируется',
        added: p.added || '', bought_date: p.bought_at || '', note: p.note })) };
  }
  if (name === 'savings_goals') {
    const B = book.load(db);
    const snap = B.hist.length ? R.balanceOn(B.hist, today) : { bal: {} };
    return { head: ['id', 'goal_name', 'account_id', 'current_amount', 'target_amount', 'deadline', 'planned_monthly'],
      rows: db.prepare('SELECT * FROM savings_goals ORDER BY id').all().map(g => ({
        id: g.id, goal_name: g.name, account_id: g.account_id || '',
        current_amount: rub(g.account_id ? (snap.bal[g.account_id] || 0n) : 0n),
        target_amount: rub(g.target), deadline: g.deadline || '', planned_monthly: rub(g.monthly) })) };
  }
  if (name === 'balances_history') {
    /* Снимок валютного счёта — в его валюте. */
    const curOf = {};
    for (const a of db.prepare('SELECT id, currency FROM accounts').all()) curOf[a.id] = a.currency;
    return { head: ['date', 'snapshot', 'account_id', 'balance', 'currency', 'note'],
      rows: db.prepare('SELECT * FROM balance_snapshots ORDER BY date, account_id').all().map(b => ({
        date: b.date, snapshot: b.source, account_id: b.account_id, balance: rub(b.balance), currency: curOf[b.account_id] || 'RUB',
        note: '' })) };
  }
  fail('неизвестная таблица: ' + name);
}

function exportCsv(db, parentDir, tables, today, now) {
  const list = tables && tables.length ? tables : TABLES;
  for (const t of list) if (!TABLES.includes(t)) fail('неизвестная таблица: ' + t);
  if (!parentDir || !fs.existsSync(parentDir)) fail('Папка для выгрузки не найдена');
  const at = now || new Date();
  const base = 'GREENFOX — выгрузка ' + at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) +
               ' ' + pad(at.getHours()) + '-' + pad(at.getMinutes());
  let dir = path.join(parentDir, base), n = 2;
  while (fs.existsSync(dir)) dir = path.join(parentDir, base + ' (' + n++ + ')');
  fs.mkdirSync(dir);
  const files = [];
  for (const t of list) {
    const { head, rows } = tableRows(db, t, today);
    fs.writeFileSync(path.join(dir, t + '.csv'), toCsv(head, rows), 'utf8');
    files.push({ table: t, name: TABLE_NAMES[t], rows: rows.length });
  }
  return { ok: true, dir, files };
}

/* ── Загрузка ─────────────────────────────────────────────── */
const PENDING = new Map();     /* отчёт → строки, ждущие подтверждения */
const PENDING_MS = 10 * 60000;

/* «12.08.2026» и «2026-08-12» — одна дата. */
function isoDate(raw) {
  const s = String(raw || '').trim();
  let y, m, d, x;
  if ((x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) [y, m, d] = [x[1], x[2], x[3]];
  else if ((x = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) [y, m, d] = [x[3], pad(x[2]), pad(x[1])];
  else return null;
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return dt.getFullYear() === Number(y) && dt.getMonth() === Number(m) - 1 && dt.getDate() === Number(d)
    ? y + '-' + m + '-' + d : null;
}

function importPreview(db, file, today) {
  if (!file || !fs.existsSync(file)) fail('Файл не найден');
  /* Журнал за годы — сотни килобайт; десятки мегабайт — не журнал. */
  if (fs.statSync(file).size > 20 * 1024 * 1024) fail('Файл больше 20 МБ — это не похоже на журнал операций');
  let rows;
  try { rows = readCsv(fs.readFileSync(file, 'utf8')); } catch (e) { fail('Файл не читается как таблица CSV'); }
  if (!rows.length) fail('В файле нет строк');
  const need = ['date', 'amount', 'direction', 'category'];
  const missing = need.filter(c => !(c in rows[0]));
  if (missing.length) fail('В таблице нет колонок: ' + missing.join(', ') + '. Нужен формат журнала операций');

  const accs = {};
  for (const a of db.prepare('SELECT id, name, archived, currency FROM accounts').all()) accs[a.id] = a;
  const cats = {};
  for (const c of db.prepare('SELECT name, type, active FROM categories').all()) cats[c.name] = c;
  const have = new Set(db.prepare('SELECT date, amount, direction, account_from, account_to, description FROM transactions')
    .all().map(t => [t.date, t.amount, t.direction, t.account_from || '', t.account_to || '',
                     String(t.description || '').trim().toLowerCase()].join('|')));

  const ok = [], errors = [], dups = [];
  rows.forEach((r, i) => {
    const line = i + 2;               /* первая строка — заголовок */
    const why = [];
    const date = isoDate(r.date);
    if (!date) why.push('дата не датой');
    else if (date > today) why.push('дата в будущем');
    let amount = null;
    try { amount = M.parseAmount(r.amount); } catch (e) { why.push('сумма не числом'); }
    if (amount !== null && amount <= 0n) why.push('сумма должна быть больше нуля — знак задаёт направление');
    if (r.currency && r.currency.trim() && r.currency.trim().toUpperCase() !== 'RUB') why.push('валюта не рубли');
    const dir = String(r.direction || '').trim();
    if (!['расход', 'доход', 'перевод'].includes(dir)) why.push('направление: расход, доход или перевод');
    const from = String(r.account_from || '').trim(), to = String(r.account_to || '').trim();
    let cat = String(r.category || '').trim();
    if (dir === 'перевод' && !cat) cat = SELF;
    const c = cats[cat];
    if (!c || !c.active) why.push('категории «' + cat + '» нет в списке');
    for (const id of [from, to]) if (id && (!accs[id] || accs[id].archived)) why.push('счёта «' + id + '» нет');
    /* У валютного счёта нужна сумма в его валюте — в таблице её нет. Такие
       операции вносятся окном или ассистентом. */
    for (const id of [from, to]) if (id && accs[id] && accs[id].currency && accs[id].currency !== 'RUB') {
      why.push('счёт «' + id + '» в валюте ' + accs[id].currency + ' — такие операции вносятся окном');
    }
    if (dir === 'расход') {
      if (!from) why.push('у расхода нет счёта списания');
      if (c && (c.type === 'доход' || c.type === 'техническая')) why.push('у расхода доходная или служебная категория');
    }
    if (dir === 'доход') {
      if (!to) why.push('у дохода нет счёта зачисления');
      if (from) why.push('у дохода не бывает счёта списания');
      if (c && c.type !== 'доход' && c.name !== 'Прочее') why.push('у дохода расходная категория');
    }
    if (dir === 'перевод') {
      if (!from || !to) why.push('у перевода нужны оба счёта');
      else if (from === to) why.push('перевод на тот же счёт');
      if (cat !== SELF) why.push('у перевода категория «' + SELF + '»');
    }
    const row = { line, date, amount: amount === null ? null : String(amount), direction: dir, from, to, category: cat,
                  description: String(r.description || '').trim().slice(0, 200), flag: String(r.flag || '').trim().slice(0, 200),
                  source: String(r.source || '').trim().slice(0, 40) };
    if (why.length) { errors.push({ line, reason: why.join('; '), raw: [r.date, r.amount, r.direction, r.category].join(' · ') }); return; }
    const key = [date, String(amount), dir, from, to, row.description.toLowerCase()].join('|');
    if (have.has(key)) dups.push(row); else { ok.push(row); have.add(key); }
  });

  const token = crypto.randomUUID();
  for (const [k, v] of PENDING) if (Date.now() > v.until) PENDING.delete(k);
  PENDING.set(token, { ok, dups, until: Date.now() + PENDING_MS, file: path.basename(file) });
  const sum = list => {
    const s = { 'расход': 0n, 'доход': 0n, 'перевод': 0n };
    for (const r of list) s[r.direction] += BigInt(r.amount);
    return { exp: String(s['расход']), inc: String(s['доход']), mov: String(s['перевод']) };
  };
  const dates = ok.map(r => r.date).sort();
  return { ok: true, token, file: path.basename(file), total: rows.length, add: ok.length, dupCount: dups.length,
           errors: errors.slice(0, 50), errorCount: errors.length, sums: sum(ok),
           from: dates[0] || null, to: dates[dates.length - 1] || null,
           dups: dups.slice(0, 10).map(r => ({ line: r.line, date: r.date, amount: r.amount, description: r.description })) };
}

function importApply(db, token, withDups, remember) {
  const p = PENDING.get(token);
  if (!p || Date.now() > p.until) fail('Отчёт устарел — выберите файл ещё раз');
  PENDING.delete(token);
  const list = withDups ? p.ok.concat(p.dups) : p.ok;
  if (!list.length) fail('Добавлять нечего');
  const at = new Date().toISOString();
  const seqOf = db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 n FROM transactions WHERE date = ?');
  const ins = db.prepare('INSERT INTO transactions(date,amount,currency,direction,account_from,account_to,category,' +
    "description,source,flag,seq,created_at,updated_at) VALUES(?,?,'RUB',?,?,?,?,?,?,?,?,?,?)");
  const ids = [];
  db.transaction(() => {
    for (const r of list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.line - b.line))) {
      ids.push(Number(ins.run(r.date, r.amount, r.direction, r.direction === 'доход' ? null : r.from, r.to || null,
        r.category, r.description, r.source || 'импорт', r.flag, seqOf.get(r.date).n, at, at).lastInsertRowid));
    }
  })();
  return { ok: true, added: ids.length, undo: remember(() => {
    const del = db.prepare('DELETE FROM transactions WHERE id = ? AND created_at = ?');
    for (const id of ids) del.run(id, at);
  }) };
}

/* Операции за период — с экрана «Расходы»: один файл в формате журнала. */
function exportPeriod(db, parentDir, from, to, today) {
  if (!parentDir || !fs.existsSync(parentDir)) fail('Папка для выгрузки не найдена');
  if (!isoDate(from) || !isoDate(to) || from > to) fail('Период: даты не поняты');
  const all = tableRows(db, 'transactions', today);
  const rows = all.rows.filter(r => r.date >= from && r.date <= to);
  const dd = iso => iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
  let file = path.join(parentDir, 'GREENFOX — операции ' + dd(from) + (from === to ? '' : '–' + dd(to)) + '.csv'), n = 2;
  while (fs.existsSync(file)) file = file.replace(/( \(\d+\))?\.csv$/, ' (' + n++ + ').csv');
  fs.writeFileSync(file, toCsv(all.head, rows), 'utf8');
  return { ok: true, file, dir: parentDir, rows: rows.length };
}

module.exports = { TABLES, TABLE_NAMES, exportCsv, exportPeriod, tableRows, importPreview, importApply, isoDate };
