'use strict';
/* ============================================================
   ВВОД: ДАННЫЕ ДЛЯ ФОРМ И ЗАПИСЬ
   ============================================================
   Всё, что формы пишут в базу, проходит здесь и только здесь. Каждая
   запись проверяется до того, как попасть в базу, и идёт одной
   транзакцией: либо записано всё, либо ничего.

   Золотые правила учёта соблюдаются здесь, а не на совести окна:
   категория — только из закрытого списка (новая заводится отдельно и
   обязательно с типом), у расхода есть счёт списания, у дохода — счёт
   зачисления, у перевода — оба и фиксированная категория, деньги —
   целые копейки больше нуля, дата — ГГГГ-ММ-ДД.

   После сохранения окно предлагает «Отменить». Отмена — настоящая:
   запись удаляется или прежние значения возвращаются, но только в
   течение минуты и только для того, что записано из окна.
   ============================================================ */
const crypto = require('crypto');
const R = require('../core/report');
const L = require('../core/ledger');
const book = require('./book');
const overview = require('./overview');
const capital = require('./capital');
const fx = require('./fx');

const SELF = 'Переводы между своими';
const LOAN_CAT = 'Платежи по кредитам';
const TAGS = ['спонтанная', 'по плану', 'регулярный', 'поздняя запись', 'требует уточнения'];
const CAT_TYPES = ['базовые', 'обязательные', 'дискреционные', 'сбережения', 'прочее', 'доход'];
const ACC_TYPE = { debit: 'дебетовая карта', credit: 'кредитная карта', current: 'текущий',
                   cash: 'наличные', broker: 'брокерский', crypto: 'крипто' };
const PERIOD = { m: 'month', w: 'week', q: 'quarter', y: 'year' };
const UNDO_MS = 60000;

/* ---------- проверки ---------- */
function fail(msg) { const e = new Error(msg); e.user = true; throw e; }
function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function cents(v, what, allowZero, allowNeg) {
  let b;
  try { b = BigInt(String(v)); } catch (e) { fail(what + ': не число'); }
  if (!allowNeg && b < 0n) fail(what + ': не может быть отрицательной');
  if (!allowZero && b === 0n) fail(what + ': нужна сумма больше нуля');
  if (b > 100000000000n || b < -100000000000n) fail(what + ': слишком большая сумма');
  return b;
}
function text(v, max) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max || 200); }
function now() { return new Date().toISOString(); }
const ruDay = iso => iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4);
/* Курс валюты на день; нет — внятная ошибка, а не тихий ноль. */
function needRate(rate, cur, day) {
  const k = rate(cur, day);
  if (!k) fail('Нет курса ' + cur + ' на ' + ruDay(day) + ' — обновите курсы в «Настройках» → «Расчёты» или впишите курс вручную');
  return k;
}
function convOrFail(rate, cents, from, to, day) {
  if (from === to) return cents;
  if (from !== 'RUB') needRate(rate, from, day);
  if (to !== 'RUB') needRate(rate, to, day);
  return fx.convert(cents, from, to, rate, day);
}
/* «500,00 $» — сумма в валюте счёта для сообщений. */
function sayCur(c, cur) { return M.say(c).replace(/\s₽$/, '\u00A0' + ((fx.CUR[cur] || fx.CUR.RUB).sym)); }

/* ---------- отмена ---------- */
const UNDO = new Map();
function remember(fn) {
  for (const [k, u] of UNDO) if (Date.now() > u.until) UNDO.delete(k);
  const token = crypto.randomUUID();
  UNDO.set(token, { fn, until: Date.now() + UNDO_MS });
  return token;
}
function undo(db, token) {
  const u = UNDO.get(token);
  if (!u || Date.now() > u.until) return { ok: false, error: 'отменить уже нельзя — прошло больше минуты' };
  UNDO.delete(token);
  db.transaction(u.fn)();
  return { ok: true };
}

/* ============================================================
   ДАННЫЕ ДЛЯ ФОРМ
   ============================================================ */
function formData(db, todayIso) {
  const ov = overview.build(db, todayIso);
  const today = ov.today || todayIso || R.iso(new Date());
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY sort_order').all();
  const B = book.load(db);
  const snap = B.hist.length ? R.balanceOn(B.hist, today) : { bal: {}, loan: 0n };
  const cats = db.prepare('SELECT name, type, note FROM categories WHERE active = 1 ORDER BY sort_order').all();
  /* Операций по счёту — валюту меняют, пока их нет. */
  const opsOf = {};
  for (const r of db.prepare('SELECT account_from a, account_to b FROM transactions').all()) {
    if (r.a) opsOf[r.a] = (opsOf[r.a] || 0) + 1;
    if (r.b && r.b !== r.a) opsOf[r.b] = (opsOf[r.b] || 0) + 1;
  }

  /* По прошлым операциям: частые категории, обычная сумма, описания. */
  const ops = db.prepare("SELECT date, amount, direction, account_from, account_to, category, description " +
                         "FROM transactions ORDER BY date DESC, seq DESC").all();
  const since = R.addDays(today, -60);
  const freq = {}, byCat = {}, descs = {};
  for (const o of ops) {
    if (o.direction !== 'расход') continue;
    if (o.date >= since) freq[o.category] = (freq[o.category] || 0) + 1;
    (byCat[o.category] = byCat[o.category] || []).push(BigInt(o.amount));
    const d = L.short(o.description);
    if (d) {
      const m = (descs[o.category] = descs[o.category] || {});
      m[d] = (m[d] || 0) + 1;
    }
  }
  const median = {};
  for (const c of Object.keys(byCat)) if (byCat[c].length >= 3) median[c] = String(R.medianCents(byCat[c]));
  const descOut = {};
  for (const c of Object.keys(descs)) {
    descOut[c] = Object.keys(descs[c]).sort((a, b) => descs[c][b] - descs[c][a]).slice(0, 6);
  }
  const accName = {};
  for (const a of accounts) accName[a.id] = a.name;
  const dayOps = {};
  for (const o of ops) {
    if (o.date < R.addDays(today, -14)) break;
    (dayOps[o.date] = dayOps[o.date] || []).push({ desc: L.short(o.description), cat: o.category,
      sum: String(o.amount), dir: o.direction, acc: accName[o.account_from] || accName[o.account_to] || '' });
  }

  /* Грейс кредитки: внесённое за цикл — то же, что на «Капитале». */
  const card = accounts.filter(a => a.type === 'кредитная карта')[0] || null;
  const graceRule = db.prepare("SELECT * FROM recurring WHERE active = 1 AND category = ? AND obligatory = 1 " +
                               'AND day_of_month IS NOT NULL').get(SELF);
  let grace = null;
  if (card && graceRule && B.hist.length) {
    const cyc = R.graceCycle(today, graceRule.day_of_month);
    let paid = 0n;
    for (const r of B.rows) if (r.to === card.id && r.d >= cyc.start && r.d <= today) paid += r.a;
    const before = R.balanceOn(B.hist, R.addDays(cyc.start, -1)).bal[card.id] || 0n;
    grace = { cardId: card.id, start: cyc.start, due: cyc.due, paid: String(paid),
              need: String(before < 0n ? -before : 0n) };
  }

  const loanRow = db.prepare("SELECT * FROM liabilities WHERE account_id IS NULL AND type != 'кредитная карта'").get();
  const base = B.hist.length ? capital.reserveBase(db, today, accounts, snap.bal) : null;
  const stale = {};
  for (const s of R.staleRecon(accounts, today)) stale[s.id] = s.days;

  return {
    today,
    accounts: accounts.map(a => ({
      id: a.id, name: a.name, type: a.type, bank: a.bank,
      isPayment: !!a.is_payment, isCredit: a.type === 'кредитная карта',
      limit: a.credit_limit === null ? null : String(a.credit_limit),
      /* balance — в рублях (для сравнений и итогов), native — в валюте счёта. */
      balance: String(snap.bal[a.id] || 0n),
      native: String((snap.nat || snap.bal)[a.id] || 0n), cur: a.currency || 'RUB', ops: opsOf[a.id] || 0,
      reconciledAt: a.reconciled_at,
      graceNote: a.grace_note || '',
      graceDay: a.type === 'кредитная карта' ? ((graceRuleFor(db, a) || {}).day_of_month || null) : null,
    })),
    cats: {
      exp: cats.filter(c => c.type !== 'доход' && c.type !== 'техническая').map(c => ({ name: c.name, type: c.type })),
      inc: cats.filter(c => c.type === 'доход').map(c => ({ name: c.name, type: c.type })),
    },
    catTypes: CAT_TYPES,
    recentExp: Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 5),
    median, descs: descOut, dayOps,
    dayLimit: ov.dayLimit || null,
    spentToday: ov.spentToday || '0',
    available: ov.available || '0',
    monthly: base ? String(base.avgDay * 30n) : '0',
    goals: db.prepare('SELECT * FROM savings_goals ORDER BY id').all()
      .map(g => ({ id: g.id, name: String(g.name).split(' (')[0], accountId: g.account_id,
                   target: g.target === null ? null : String(g.target), deadline: g.deadline,
                   monthly: g.monthly === null ? null : String(g.monthly) })),
    plans: db.prepare("SELECT * FROM planned WHERE status = 'queue' ORDER BY id").all().map(x => ({
      id: x.id, name: x.name, cat: x.category, min: String(x.price_min), max: String(x.price_max),
      need: x.need, urg: x.urgency, repl: !!x.replaceable, own: String(x.recurring_cost || 0),
      deadline: x.deadline, note: x.note })),
    recurring: book.recurring(db, 'WHERE active = 1 ORDER BY id').map(x => ({
      id: x.id, name: x.name, cat: x.category, amount: String(x.amount_native), cur: x.currency,
      rub: String(x.amount),
      amountTo: x.amount_max_native === null ? null : String(x.amount_max_native), period: x.period,
      day: x.day_of_month, wday: x.day_of_week, month: x.month_of_year, accId: x.account_id, dir: x.direction,
      obligatory: !!x.obligatory, note: x.note, until: x.end_date })),
    tags: TAGS,
    grace,
    stale,
    /* Курсы ЦБ по дням — окна пересчитывают валютные суммы сами. */
    fx: fx.forForms(db),
    currencies: fx.LIST.map(c => ({ code: c, sym: fx.CUR[c].sym, name: fx.CUR[c].name })),
    banks: Array.from(new Set(accounts.map(a => a.bank).filter(b => b && b !== '—')
      .concat(['МТС Банк', 'Сбербанк', 'ТБанк', 'Альфа-Банк', 'ВТБ', 'Райффайзен']))).concat(['—']),
    loan: loanRow ? {
      id: loanRow.id, creditor: loanRow.creditor, type: loanRow.type,
      rest: String(snap.loan || 0n), rateBp: loanRow.rate_bp, rateMonth: loanRow.rate_month,
      pay: loanRow.monthly_payment === null ? null : String(loanRow.monthly_payment),
      day: loanRow.payment_day, close: loanRow.close_date, inOblig: !!loanRow.in_regular,
      initial: loanRow.initial_amount === null ? null : String(loanRow.initial_amount),
    } : null,
  };
}

/* Расчётные остатки на конец выбранного дня — для окна сверки. */
function reconCalc(db, date) {
  if (!isDate(date)) fail('дата сверки не датой');
  const B = book.load(db);
  const snap = B.hist.length ? R.balanceOn(B.hist, date) : { bal: {}, nat: {} };
  const out = {};
  /* В валюте счёта: с банком сверяют то, что видно в банке. */
  for (const a of db.prepare('SELECT id FROM accounts WHERE archived = 0').all()) out[a.id] = String((snap.nat || snap.bal)[a.id] || 0n);
  return out;
}

/* ============================================================
   ОПЕРАЦИИ
   ============================================================ */
/* Проверка операции по правилам учёта — общая для окон ввода и для
   карточек ассистента. Возвращает готовую к записи строку или бросает
   ошибку словами для человека. */
function checkOp(db, op, today) {
  const kind = op && op.kind;
  if (!['expense', 'income', 'transfer'].includes(kind)) fail('неизвестный вид операции');
  const amount = cents(op.amount, 'Сумма');
  if (!isDate(op.date)) fail('Дата: нужна в виде ДД.ММ.ГГГГ');
  if (op.date > today) fail('Дата в будущем: будущие платежи заводятся в регулярных');
  const acc = id => db.prepare('SELECT * FROM accounts WHERE id = ? AND archived = 0').get(id);
  const cat = db.prepare('SELECT * FROM categories WHERE name = ? AND active = 1').get(
    kind === 'transfer' ? SELF : op.category);
  if (!cat) fail('Категория: выберите из списка');

  let dir, from = null, to = null;
  if (kind === 'expense') {
    dir = 'расход'; from = op.from;
    if (!acc(from)) fail('Счёт списания: выберите счёт');
    if (cat.type === 'доход' || cat.type === 'техническая') fail('Категория: для расхода нужна расходная');
  } else if (kind === 'income') {
    dir = 'доход'; to = op.to;
    if (!acc(to)) fail('Счёт зачисления: выберите счёт');
    if (cat.type !== 'доход' && cat.name !== 'Прочее') fail('Категория: для дохода нужна доходная');
  } else {
    dir = 'перевод'; from = op.from; to = op.to;
    if (!acc(from) || !acc(to)) fail('Счета: выберите оба счёта');
    if (from === to) fail('Счета: перевод на тот же счёт ничего не меняет');
  }
  /* Метки — одной строкой, как в учёте: «спонтанная, поздняя запись». */
  const tags = (Array.isArray(op.tags) ? op.tags : []).filter(t => TAGS.includes(t));
  if (op.once && kind === 'income') tags.push('разовое');
  if (op.goal && kind === 'transfer') tags.push('под цель «' + text(op.goal, 60) + '»');
  /* «Купил» из очереди планов: покупка и закрытие позиции — одно действие. */
  const plan = op.planId ? db.prepare("SELECT * FROM planned WHERE id = ? AND status = 'queue'").get(op.planId) : null;
  if (op.planId && !plan) fail('Позиция плана уже не в очереди');
  /* Суммы. amount в базе — всегда рубли: по ним считаются траты. У
     валютного счёта — ещё и своя сумма в его валюте, по ней идёт
     остаток. Сумма в окне — в валюте счёта; «Другая валюта» у расхода
     и дохода — пересчёт по курсу ЦБ на дату операции. У перевода между
     счетами в разных валютах — две суммы: сколько ушло и сколько пришло
     (обмен идёт по курсу банка, а не ЦБ); вторая не задана — по ЦБ. */
  const rate = fx.rateFn(db);
  const curOf = id => (id && (acc(id) || {}).currency) || 'RUB';
  const typed = op.cur && fx.isCur(op.cur) ? op.cur : null;
  let rub, fa = null, ta = null;
  if (kind === 'transfer') {
    const cf = curOf(from), ct = curOf(to);
    const natFrom = amount;
    let natTo = natFrom;
    if (cf !== ct) {
      natTo = op.amountTo !== undefined && op.amountTo !== null && op.amountTo !== ''
        ? cents(op.amountTo, 'Сумма зачисления') : convOrFail(rate, natFrom, cf, ct, op.date);
    }
    if (cf !== 'RUB') fa = natFrom;
    if (ct !== 'RUB') ta = natTo;
    rub = cf === 'RUB' ? natFrom : ct === 'RUB' ? natTo : fx.toRub(natFrom, needRate(rate, cf, op.date));
  } else {
    const id = kind === 'expense' ? from : to, c = curOf(id);
    const nat = typed && typed !== c ? convOrFail(rate, amount, typed, c, op.date) : amount;
    if (nat <= 0n) fail('Сумма: в валюте счёта получается меньше цента');
    if (c !== 'RUB') { if (kind === 'expense') fa = nat; else ta = nat; }
    rub = c === 'RUB' ? nat : fx.toRub(nat, needRate(rate, c, op.date));
  }
  if (rub <= 0n) fail('Сумма: в рублях получается меньше копейки');
  return { date: op.date, amount: rub, fa, ta, dir, from, to, cat: cat.name, desc: text(op.desc, 200), tags, plan };
}

function insertOps(db, list, source) {
  const at = now();
  const ids = [];
  const seqOf = db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 n FROM transactions WHERE date = ?');
  const ins = db.prepare(
    'INSERT INTO transactions(date,amount,amount_from,amount_to,currency,direction,account_from,account_to,category,description,' +
    "source,flag,seq,created_at,updated_at) VALUES(?,?,?,?,'RUB',?,?,?,?,?,?,?,?,?,?)");
  db.transaction(() => {
    for (const v of list) {
      ids.push(Number(ins.run(v.date, String(v.amount), v.fa === null || v.fa === undefined ? null : String(v.fa),
        v.ta === null || v.ta === undefined ? null : String(v.ta), v.dir, v.from, v.to, v.cat, v.desc, source,
        v.tags.join(', '), seqOf.get(v.date).n, at, at).lastInsertRowid));
      if (v.plan) db.prepare("UPDATE planned SET status = 'bought', bought_at = ?, bought_sum = ? WHERE id = ?")
        .run(v.date, String(v.amount), v.plan.id);
    }
  })();
  return { ids, undo: remember(() => {
    const del = db.prepare('DELETE FROM transactions WHERE id = ? AND created_at = ?');
    for (const id of ids) del.run(id, at);
    for (const v of list) {
      if (v.plan) db.prepare("UPDATE planned SET status = 'queue', bought_at = NULL, bought_sum = NULL WHERE id = ?")
        .run(v.plan.id);
    }
  }) };
}

function addOperation(db, op, todayIso) {
  const today = todayIso || R.iso(new Date());
  const r = insertOps(db, [checkOp(db, op, today)], 'приложение');
  return { ok: true, id: r.ids[0], undo: r.undo };
}

/* Несколько операций разом — карточки ассистента. Сначала проверяются
   все: если хоть одна неверна, не пишется ни одна, и ошибка называет
   её номер. Отмена — одна на всю пачку. */
function addOperations(db, ops, todayIso, source) {
  const today = todayIso || R.iso(new Date());
  if (!Array.isArray(ops) || !ops.length) fail('Сохранять нечего');
  const list = ops.map((op, i) => {
    try { return checkOp(db, op, today); }
    catch (e) { if (e.user) fail('Операция ' + (i + 1) + ': ' + e.message); throw e; }
  });
  const r = insertOps(db, list, source || 'ассистент');
  return { ok: true, added: r.ids.length, ids: r.ids, undo: r.undo };
}

/* Новая категория — только с типом и только явно: закрытый список
   пополняется отдельным подтверждением, а не опечаткой в поле. */
function addCategory(db, c) {
  const name = text(c && c.name, 60);
  if (name.length < 2) fail('Название категории: хотя бы два знака');
  if (!CAT_TYPES.includes(c.type)) fail('Тип категории: выберите из списка');
  const same = db.prepare('SELECT name FROM categories').all()
    .filter(x => x.name.toLowerCase() === name.toLowerCase())[0];
  if (same) fail('Такая категория уже есть: ' + same.name);
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 n FROM categories').get().n;
  db.prepare('INSERT INTO categories(name,type,note,active,sort_order) VALUES(?,?,?,1,?)')
    .run(name, c.type, text(c.note, 200), order);
  return { ok: true, name, undo: remember(() => {
    const used = db.prepare('SELECT COUNT(*) n FROM transactions WHERE category = ?').get(name).n;
    if (!used) db.prepare('DELETE FROM categories WHERE name = ?').run(name);
  }) };
}

/* ============================================================
   СПРАВОЧНИКИ
   ============================================================ */
function insertUndo(db, table, id) {
  return remember(() => db.prepare('DELETE FROM ' + table + ' WHERE id = ?').run(id));
}
/* Правка записи: прежнюю строку запоминаем целиком, отмена её возвращает. */
function updateRow(db, table, id, fields) {
  const prev = db.prepare('SELECT * FROM ' + table + ' WHERE id = ?').get(id);
  if (!prev) fail('Запись не найдена — возможно, её уже убрали');
  const keys = Object.keys(fields);
  db.prepare('UPDATE ' + table + ' SET ' + keys.map(k => k + ' = ?').join(', ') + ' WHERE id = ?')
    .run(...keys.map(k => fields[k]), id);
  return { ok: true, id, undo: remember(() => {
    db.prepare('UPDATE ' + table + ' SET ' + keys.map(k => k + ' = ?').join(', ') + ' WHERE id = ?')
      .run(...keys.map(k => prev[k]), id);
  }) };
}

function savePlan(db, p, todayIso) {
  const today = todayIso || R.iso(new Date());
  const name = text(p.name, 80);
  if (!name) fail('Название: как называется покупка');
  const cat = db.prepare('SELECT * FROM categories WHERE name = ? AND active = 1').get(p.cat);
  if (!cat || cat.type === 'доход' || cat.type === 'техническая') fail('Категория: выберите расходную');
  const lo = cents(p.min, 'Цена от');
  const hi = p.max === '' || p.max === null || p.max === undefined ? lo : cents(p.max, 'Цена до');
  if (hi < lo) fail('Цена до меньше, чем цена от');
  if (!['need', 'want'].includes(p.need) || !['hot', 'cold'].includes(p.urg)) fail('Нужность и срочность: выберите');
  if (p.deadline && !isDate(p.deadline)) fail('Дедлайн: нужна дата');
  const own = p.own ? cents(p.own, 'Стоимость владения', true) : 0n;
  if (p.id) return updateRow(db, 'planned', Number(p.id), {
    name, price_min: String(lo), price_max: String(hi), need: p.need, urgency: p.urg, unsure: 0,
    deadline: p.deadline || null, note: text(p.note, 300), category: cat.name, replaceable: p.repl ? 1 : 0,
    recurring_cost: String(own) });
  const res = db.prepare('INSERT INTO planned(name,price_min,price_max,need,urgency,unsure,deadline,saved,status,' +
    "note,category,replaceable,added,recurring_cost) VALUES(?,?,?,?,?,0,?,0,'queue',?,?,?,?,?)")
    .run(name, String(lo), String(hi), p.need, p.urg, p.deadline || null, text(p.note, 300), cat.name,
         p.repl ? 1 : 0, today, String(own));
  const id = Number(res.lastInsertRowid);
  return { ok: true, id, undo: insertUndo(db, 'planned', id) };
}

/* Месяц первого списания для годовых и квартальных: ближайшее
   наступление этого числа, начиная с сегодня. */
function firstMonth(today, day) {
  const [, m, d] = today.split('-').map(Number);
  return d <= day ? m : (m % 12) + 1;
}

function saveRecurring(db, r, todayIso) {
  const today = todayIso || R.iso(new Date());
  const name = text(r.name, 80);
  if (!name) fail('Название: как называется платёж');
  const type = r.type;
  if (!['обязательный', 'добровольный', 'доход'].includes(type)) fail('Тип: выберите');
  const cat = db.prepare('SELECT * FROM categories WHERE name = ? AND active = 1').get(r.cat);
  if (!cat) fail('Категория: выберите из списка');
  if (type === 'доход' ? cat.type !== 'доход' : cat.type === 'доход') fail('Категория не подходит к типу платежа');
  const lo = cents(r.amount, 'Сумма');
  const hi = r.fixed ? null : cents(r.amountTo, 'Сумма до');
  if (hi !== null && hi < lo) fail('Сумма до меньше, чем от');
  const period = PERIOD[r.every];
  if (!period) fail('Периодичность: выберите');
  let dom = null, dow = null, moy = null;
  if (period === 'week') {
    dow = Number(r.wday);
    if (!(dow >= 1 && dow <= 7)) fail('День недели: выберите');
  } else {
    dom = Number(r.day);
    if (!(Number.isInteger(dom) && dom >= 1 && dom <= 31)) fail('Число месяца: от 1 до 31');
    /* Месяц годового платежа (у квартального — месяц первого) выбирает
       человек: страховка в марте, а заводят её в октябре. Не выбран —
       ближайший месяц с этим числом. */
    if (period === 'year' || period === 'quarter') {
      const mo = Number(r.month);
      if (r.month !== undefined && r.month !== null && r.month !== '' && !(Number.isInteger(mo) && mo >= 1 && mo <= 12)) {
        fail('Месяц: выберите');
      }
      moy = mo >= 1 && mo <= 12 ? mo : firstMonth(today, dom);
    }
  }
  if (!db.prepare('SELECT 1 FROM accounts WHERE id = ? AND archived = 0').get(r.accId)) fail('Счёт: выберите');
  if (r.until && !isDate(r.until)) fail('Дата окончания: нужна дата');
  if (r.id) return updateRow(db, 'recurring', Number(r.id), {
    name, amount: String(lo), amount_max: hi === null ? null : String(hi),
    direction: type === 'доход' ? 'доход' : 'расход', period, day_of_month: dom, day_of_week: dow,
    month_of_year: moy, category: cat.name, account_id: r.accId, obligatory: type === 'обязательный' ? 1 : 0,
    note: text(r.note, 300), end_date: r.until || null });
  const res = db.prepare('INSERT INTO recurring(name,amount,amount_max,direction,period,day_of_month,day_of_week,' +
    'month_of_year,category,account_id,obligatory,active,note,end_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?)')
    .run(name, String(lo), hi === null ? null : String(hi), type === 'доход' ? 'доход' : 'расход', period,
         dom, dow, moy, cat.name, r.accId, type === 'обязательный' ? 1 : 0, text(r.note, 300), r.until || null);
  const id = Number(res.lastInsertRowid);
  return { ok: true, id, undo: insertUndo(db, 'recurring', id) };
}

function saveGoal(db, g) {
  const name = text(g.name, 80);
  if (!name) fail('Название: как называется цель');
  if (!db.prepare('SELECT 1 FROM accounts WHERE id = ? AND archived = 0').get(g.accId)) fail('Счёт хранения: выберите');
  const target = g.target ? cents(g.target, 'Целевая сумма') : null;
  if (g.deadline && !isDate(g.deadline)) fail('Срок: нужна дата');
  const monthly = g.monthly ? cents(g.monthly, 'Плановый взнос') : null;
  if (g.id) return updateRow(db, 'savings_goals', Number(g.id), {
    name, kind: target ? 'target' : 'track', target: target === null ? null : String(target),
    account_id: g.accId, deadline: g.deadline || null, monthly: monthly === null ? null : String(monthly) });
  const res = db.prepare('INSERT INTO savings_goals(name,kind,target,account_id,deadline,note,monthly) VALUES(?,?,?,?,?,?,?)')
    .run(name, target ? 'target' : 'track', target === null ? null : String(target), g.accId,
         g.deadline || null, text(g.note, 300), monthly === null ? null : String(monthly));
  const id = Number(res.lastInsertRowid);
  return { ok: true, id, undo: insertUndo(db, 'savings_goals', id) };
}

/* Код счёта — из названия латиницей: в базе на него ссылаются операции. */
const TR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',
  о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
function slug(name) {
  return String(name).toLowerCase().split('').map(ch => TR[ch] !== undefined ? TR[ch] : ch).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'acc';
}

function saveAccount(db, a, todayIso) {
  const today = todayIso || R.iso(new Date());
  const name = text(a.name, 60);
  if (!name) fail('Название: как называется счёт');
  if (db.prepare('SELECT 1 FROM accounts WHERE lower(name) = lower(?)').get(name)) fail('Счёт с таким названием уже есть');
  const type = ACC_TYPE[a.type];
  if (!type) fail('Тип: выберите');
  const cur = a.cur || 'RUB';
  if (!fx.isCur(cur)) fail('Валюта: рубли, доллары или евро');
  if (type === 'кредитная карта' && cur !== 'RUB') fail('Кредитная карта — только в рублях: долг и грейс считаются в рублях');
  const bal = a.bal === '' || a.bal === null || a.bal === undefined ? 0n : cents(a.bal, 'Начальный баланс', true, true);
  if (type === 'кредитная карта' && bal > 0n) fail('Остаток кредитки — это долг: задайте его со знаком минус');
  if (type !== 'кредитная карта' && bal < 0n) fail('Остаток этого счёта не может быть отрицательным');
  if (!isDate(a.balDate) || a.balDate > today) fail('Дата баланса: не позже сегодняшней');
  let limit = null, graceDay = null;
  if (type === 'кредитная карта') {
    limit = cents(a.limit, 'Кредитный лимит');
    graceDay = Number(a.graceDay);
    if (!(Number.isInteger(graceDay) && graceDay >= 1 && graceDay <= 28)) fail('День грейса: от 1 до 28');
  }
  let id = slug(name), n = 2;
  while (db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(id)) id = slug(name) + '_' + n++;
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 n FROM accounts').get().n;
  /* Пополнение кредитки — в рублях: с рублёвого платёжного счёта. */
  const payer = db.prepare("SELECT id FROM accounts WHERE is_payment = 1 AND archived = 0 AND currency = 'RUB' ORDER BY sort_order").get();
  let recId = null;
  db.transaction(() => {
    /* Начальный остаток человек подтвердил сам — это и есть первая сверка. */
    db.prepare('INSERT INTO accounts(id,name,bank,type,currency,start_balance,start_date,credit_limit,grace_note,' +
      'is_payment,reconciled_balance,reconciled_at,sort_order,archived) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)')
      .run(id, name, text(a.bank, 40) || '—', type, cur, String(bal), a.balDate, limit === null ? null : String(limit),
           text(a.graceRule, 300), a.isPay && type !== 'кредитная карта' ? 1 : 0, String(bal), a.balDate, order);
    /* Правило грейса живёт в расписании — как у перенесённой кредитки. */
    if (type === 'кредитная карта' && payer) {
      recId = Number(db.prepare('INSERT INTO recurring(name,amount,amount_max,direction,period,day_of_month,category,' +
        "account_id,obligatory,active,note) VALUES(?,?,NULL,'расход','month',?,?,?,1,1,?)")
        .run('Пополнение «' + name + '» до грейса', String(limit), graceDay, SELF, payer.id, text(a.graceRule, 300))
        .lastInsertRowid);
    }
  })();
  return { ok: true, id, cur, undo: remember(() => {
    if (db.prepare('SELECT COUNT(*) n FROM transactions WHERE account_from = ? OR account_to = ?').get(id, id).n) return;
    if (recId) db.prepare('DELETE FROM recurring WHERE id = ?').run(recId);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  }) };
}

/* «Убрать» позицию из очереди и «На паузу» для регулярного платежа —
   без окна, сразу, с отменой в тосте. */
function dropPlan(db, id) {
  const p = db.prepare("SELECT * FROM planned WHERE id = ? AND status = 'queue'").get(Number(id));
  if (!p) fail('Позиция уже не в очереди');
  return updateRow(db, 'planned', p.id, { status: 'dropped' });
}
function pauseRecurring(db, id) {
  const r = db.prepare('SELECT * FROM recurring WHERE id = ? AND active = 1').get(Number(id));
  if (!r) fail('Платёж уже на паузе');
  return updateRow(db, 'recurring', r.id, { active: 0 });
}

/* Ставка годовых процентов → месячная десятичной строкой. */
function monthRate(pct) { return (Number(pct) / 1200).toFixed(10); }

function saveLoan(db, l, todayIso) {
  const today = todayIso || R.iso(new Date());
  const creditor = text(l.creditor, 60);
  if (!creditor) fail('Кредитор: кому платите');
  const type = text(l.type, 40);
  if (type === 'кредитная карта') fail('Кредитная карта заводится как счёт — через «Счёт»');
  /* Пустое поле — не ноль процентов: беспроцентный долг вводится нулём явно. */
  if (String(l.rate === undefined || l.rate === null ? '' : l.rate).trim() === '') {
    fail('Ставка: укажите процент годовых, для беспроцентного долга — 0');
  }
  const rate = Number(String(l.rate).replace(',', '.'));
  if (!(rate >= 0 && rate < 100)) fail('Ставка: число процентов годовых');
  const pay = cents(l.pay, 'Ежемесячный платёж');
  const day = Number(l.day);
  if (!(Number.isInteger(day) && day >= 1 && day <= 31)) fail('День платежа: от 1 до 31');
  if (l.close && !isDate(l.close)) fail('Дата закрытия: нужна дата');
  const initial = l.initial ? cents(l.initial, 'Изначальная сумма') : null;
  const prev = db.prepare("SELECT * FROM liabilities WHERE account_id IS NULL AND type != 'кредитная карта'").get();
  const bp = Math.round(rate * 100);
  let restore;
  if (prev) {
    /* Остаток долга не правится: он получается прогоном платежей. Ставка
       меняет расчёт процентов, только если её действительно поменяли. */
    const rm = prev.rate_bp === bp && prev.rate_month ? prev.rate_month : monthRate(rate);
    const recPrev = db.prepare('SELECT * FROM recurring WHERE category = ? AND active = 1').all(LOAN_CAT);
    db.transaction(() => {
      db.prepare('UPDATE liabilities SET creditor=?, type=?, rate_bp=?, rate_month=?, monthly_payment=?, payment_day=?, ' +
        'close_date=?, in_regular=?, initial_amount=? WHERE id=?')
        .run(creditor, type, bp, rm, String(pay), day, l.close || null, l.inOblig ? 1 : 0,
             initial === null ? null : String(initial), prev.id);
      /* Платёж по кредиту в расписании — тот же платёж: держим их согласными. */
      if (recPrev.length === 1) {
        db.prepare('UPDATE recurring SET amount=?, day_of_month=?, end_date=?, obligatory=? WHERE id=?')
          .run(String(pay), day, l.close || null, l.inOblig ? 1 : 0, recPrev[0].id);
      }
    })();
    restore = () => {
      db.prepare('UPDATE liabilities SET creditor=?, type=?, rate_bp=?, rate_month=?, monthly_payment=?, payment_day=?, ' +
        'close_date=?, in_regular=?, initial_amount=? WHERE id=?')
        .run(prev.creditor, prev.type, prev.rate_bp, prev.rate_month, prev.monthly_payment, prev.payment_day,
             prev.close_date, prev.in_regular, prev.initial_amount, prev.id);
      if (recPrev.length === 1) {
        db.prepare('UPDATE recurring SET amount=?, day_of_month=?, end_date=?, obligatory=? WHERE id=?')
          .run(recPrev[0].amount, recPrev[0].day_of_month, recPrev[0].end_date, recPrev[0].obligatory, recPrev[0].id);
      }
    };
    return { ok: true, id: prev.id, undo: remember(restore) };
  }
  const rest = cents(l.rest, 'Текущий остаток');
  /* Платёж по кредиту — в рублях: с рублёвого платёжного счёта. */
  const payer = db.prepare("SELECT id FROM accounts WHERE is_payment = 1 AND archived = 0 AND currency = 'RUB' ORDER BY sort_order").get();
  let recId = null;
  const id = 'loan_' + Date.now().toString(36);
  db.transaction(() => {
    db.prepare('INSERT INTO liabilities(id,creditor,type,start_debt,start_date,rate_bp,rate_month,monthly_payment,' +
      'payment_day,close_date,account_id,in_regular,reconciled_debt,reconciled_at,initial_amount) ' +
      'VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)')
      .run(id, creditor, type, String(rest), today, bp, monthRate(rate), String(pay), day, l.close || null,
           l.inOblig ? 1 : 0, String(rest), today, initial === null ? null : String(initial));
    if (payer) {
      recId = Number(db.prepare('INSERT INTO recurring(name,amount,direction,period,day_of_month,category,account_id,' +
        "obligatory,active,note,end_date) VALUES(?,?,'расход','month',?,?,?,?,1,'',?)")
        .run('Платёж по кредиту: ' + creditor, String(pay), day, LOAN_CAT, payer.id, l.inOblig ? 1 : 0, l.close || null)
        .lastInsertRowid);
    }
  })();
  return { ok: true, id, undo: remember(() => {
    if (recId) db.prepare('DELETE FROM recurring WHERE id = ?').run(recId);
    db.prepare('DELETE FROM liabilities WHERE id = ?').run(id);
  }) };
}

/* ============================================================
   СВЕРКА
   ============================================================
   Расхождение не стирается правкой остатка: на его сумму добавляется
   корректирующая операция, и история остаётся как была. Подтверждённый
   остаток и дата сверки записываются в справочник счетов и в снимки. */
function saveRecon(db, r, todayIso) {
  const today = todayIso || R.iso(new Date());
  if (!isDate(r.date) || r.date > today) fail('Дата сверки: не позже сегодняшней');
  const calc = reconCalc(db, r.date);
  const rate = fx.rateFn(db);
  const rows = (r.rows || []).filter(x => !x.skip);
  if (!rows.length) fail('Сверять нечего: все счета отмечены «не сверял»');
  const accs = {};
  for (const a of db.prepare('SELECT * FROM accounts WHERE archived = 0').all()) accs[a.id] = a;
  const plan = rows.map(x => {
    const a = accs[x.accId];
    if (!a) fail('неизвестный счёт: ' + x.accId);
    const fact = cents(x.fact, 'Фактический баланс «' + a.name + '»', true, true);
    const diff = fact - BigInt(calc[a.id] || '0');
    /* Расхождение валютного счёта — в его валюте; в рублях корректировка
       стоит по курсу дня сверки. */
    const cur = a.currency || 'RUB';
    const abs = diff < 0n ? -diff : diff;
    let rub = abs;
    if (cur !== 'RUB' && abs > 0n) { rub = fx.toRub(abs, needRate(rate, cur, r.date)); if (rub <= 0n) rub = 1n; }
    return { a, fact, diff, rub, native: cur !== 'RUB' ? abs : null };
  });
  const dd = r.date.slice(8, 10) + '.' + r.date.slice(5, 7);
  const made = [], prevAcc = [], prevSnap = [];
  db.transaction(() => {
    for (const p of plan) {
      prevAcc.push({ id: p.a.id, bal: p.a.reconciled_balance, at: p.a.reconciled_at });
      prevSnap.push({ id: p.a.id, row: db.prepare('SELECT * FROM balance_snapshots WHERE date = ? AND account_id = ?')
        .get(r.date, p.a.id) || null });
      if (p.diff !== 0n) {
        const seq = db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 n FROM transactions WHERE date = ?').get(r.date).n;
        const at = now();
        const income = p.diff > 0n;
        made.push(Number(db.prepare('INSERT INTO transactions(date,amount,amount_from,amount_to,currency,direction,' +
          "account_from,account_to,category,description,source,flag,seq,created_at,updated_at) VALUES(?,?,?,?,'RUB',?,?,?," +
          "'Прочее',?,'сверка','корректировка',?,?,?)")
          .run(r.date, String(p.rub), !income && p.native !== null ? String(p.native) : null,
               income && p.native !== null ? String(p.native) : null, income ? 'доход' : 'расход', income ? null : p.a.id,
               income ? p.a.id : null, 'Корректировка по сверке ' + dd + ' — ' +
               (income ? 'неучтённое поступление' : 'неучтённый расход'), seq, at, at).lastInsertRowid));
      }
      db.prepare('UPDATE accounts SET reconciled_balance = ?, reconciled_at = ? WHERE id = ?')
        .run(String(p.fact), r.date, p.a.id);
      db.prepare("INSERT OR REPLACE INTO balance_snapshots(date, account_id, balance, source) VALUES(?,?,?,'сверка')")
        .run(r.date, p.a.id, String(p.fact));
    }
  })();
  return { ok: true, corrections: made.length, undo: remember(() => {
    for (const id of made) db.prepare("DELETE FROM transactions WHERE id = ? AND source = 'сверка'").run(id);
    for (const p of prevAcc) db.prepare('UPDATE accounts SET reconciled_balance = ?, reconciled_at = ? WHERE id = ?')
      .run(p.bal, p.at, p.id);
    for (const s of prevSnap) {
      if (s.row) db.prepare('INSERT OR REPLACE INTO balance_snapshots(date, account_id, balance, source) VALUES(?,?,?,?)')
        .run(s.row.date, s.row.account_id, s.row.balance, s.row.source);
      else db.prepare('DELETE FROM balance_snapshots WHERE date = ? AND account_id = ?').run(r.date, s.id);
    }
  }) };
}

/* Предпросмотр кредита: график от остатка с указанной ставкой — тем же
   расчётом, что на «Капитале» и «Прогнозах». */
function loanPreview(db, q, todayIso) {
  const today = todayIso || R.iso(new Date());
  const prev = db.prepare("SELECT * FROM liabilities WHERE account_id IS NULL AND type != 'кредитная карта'").get();
  let rest;
  if (prev) { const H = book.load(db).hist; rest = H.length ? R.balanceOn(H, today).loan : 0n; }
  else { try { rest = BigInt(q.rest); } catch (e) { return null; } }
  let pay, day = Number(q.day);
  try { pay = BigInt(q.pay); } catch (e) { return null; }
  if (String(q.rate === undefined || q.rate === null ? '' : q.rate).trim() === '') return null;
  const rate = Number(String(q.rate).replace(',', '.'));
  if (!(rest > 0n) || !(pay > 0n) || !(day >= 1 && day <= 31) || !(rate >= 0)) return null;
  const bp = Math.round(rate * 100);
  const rm = prev && prev.rate_bp === bp && prev.rate_month ? prev.rate_month : monthRate(rate);
  const sch = R.loanSchedule(rest, pay, R.nextDayOfMonth(today, day), day, L.parseRate(rm));
  if (!sch) return { never: true };
  return { n: sch.n, interest: String(sch.interest), total: String(sch.total), last: sch.dates[sch.n - 1],
           rest: String(rest) };
}

/* ============================================================
   СПРАВОЧНИКИ ИЗ НАСТРОЕК
   ============================================================
   Правка счетов, категорий и расписания. То, на что ссылаются операции,
   меняется вместе со ссылками, одной транзакцией и с отменой. */
const M = require('../core/money');

/* Категории, на имена которых опирается расчёт: переводы не считаются
   тратой, платежи по кредиту уменьшают долг, корректировки сверки идут
   в «Прочее», инвестиции — и трата, и перемещение, жильё и подписки —
   свои группы обязательных платежей. Их не переименовывают, не
   объединяют и не убирают — меняется только пояснение. */
const SYSTEM_CATS = new Set([SELF, LOAN_CAT, 'Прочее', 'Инвестиции', 'Жильё и коммуналка', 'Подписки и связь']);

/* Записать поля и вернуть, как вернуть прежние. */
function patch(db, table, keyCol, key, fields) {
  const prev = db.prepare('SELECT * FROM ' + table + ' WHERE ' + keyCol + ' = ?').get(key);
  if (!prev) fail('Запись не найдена — возможно, её уже убрали');
  const keys = Object.keys(fields);
  const sql = 'UPDATE ' + table + ' SET ' + keys.map(k => k + ' = ?').join(', ') + ' WHERE ' + keyCol + ' = ?';
  db.prepare(sql).run(...keys.map(k => fields[k]), key);
  return () => db.prepare(sql).run(...keys.map(k => prev[k]), key);
}
function accountById(db, id) {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!a) fail('Счёт не найден — возможно, его уже убрали');
  return a;
}
/* Остаток в валюте счёта. */
function balanceNow(db, id, today) {
  const B = book.load(db);
  if (!B.hist.length) return 0n;
  const snap = R.balanceOn(B.hist, today);
  return (snap.nat || snap.bal)[id] || 0n;
}
/* Правило грейса живёт в расписании переводом «на кредитку до N числа».
   У карты, заведённой в приложении, в названии правила — её имя. */
function graceRuleFor(db, card) {
  const rules = db.prepare('SELECT * FROM recurring WHERE category = ? AND obligatory = 1 ' +
                           'AND day_of_month IS NOT NULL ORDER BY id').all(SELF);
  return rules.filter(r => r.name.indexOf('«' + card.name + '»') >= 0)[0] || rules[0] || null;
}

function editAccount(db, a) {
  const prev = accountById(db, a.id);
  const name = text(a.name, 60);
  if (!name) fail('Название: как называется счёт');
  if (db.prepare('SELECT 1 FROM accounts WHERE lower(name) = lower(?) AND id != ?').get(name, prev.id)) {
    fail('Счёт с таким названием уже есть');
  }
  const isCard = prev.type === 'кредитная карта';
  const fields = { name, bank: text(a.bank, 40) || '—' };
  let rule = null, ruleFields = null;
  if (isCard) {
    fields.credit_limit = String(cents(a.limit, 'Кредитный лимит'));
    fields.grace_note = text(a.graceRule === undefined ? prev.grace_note : a.graceRule, 300);
    const day = Number(a.graceDay);
    if (!(Number.isInteger(day) && day >= 1 && day <= 28)) fail('День грейса: от 1 до 28');
    rule = graceRuleFor(db, prev);
    if (rule) {
      ruleFields = { day_of_month: day };
      /* Сумма правила, заведённого вместе с картой, — её лимит: меняется лимит — меняется и она. */
      if (prev.credit_limit !== null && String(rule.amount) === String(prev.credit_limit)) ruleFields.amount = fields.credit_limit;
    }
  } else {
    fields.is_payment = a.isPay ? 1 : 0;
    /* Валюту меняют, пока на счёте нет ни операций, ни платежей: их
       суммы записаны в прежней валюте и стали бы другими деньгами. */
    const cur = a.cur || prev.currency || 'RUB';
    if (cur !== (prev.currency || 'RUB')) {
      if (!fx.isCur(cur)) fail('Валюта: рубли, доллары или евро');
      if (db.prepare('SELECT COUNT(*) n FROM transactions WHERE account_from = ? OR account_to = ?').get(prev.id, prev.id).n) {
        fail('По счёту уже есть операции — валюту не поменять. Заведите новый счёт в нужной валюте');
      }
      if (db.prepare('SELECT COUNT(*) n FROM recurring WHERE account_id = ?').get(prev.id).n) {
        fail('С этого счёта идут регулярные платежи — их суммы записаны в прежней валюте. Перенесите их на другой счёт');
      }
      fields.currency = cur;
    }
  }
  const back = [];
  db.transaction(() => {
    back.push(patch(db, 'accounts', 'id', prev.id, fields));
    if (rule) back.push(patch(db, 'recurring', 'id', rule.id, ruleFields));
  })();
  return { ok: true, id: prev.id, undo: remember(() => back.reverse().forEach(f => f())) };
}

/* Лимит и день грейса из «Расчётов» — та же правка карты. */
function setCardTerms(db, t) {
  const card = db.prepare("SELECT * FROM accounts WHERE type = 'кредитная карта' AND archived = 0 ORDER BY sort_order").get();
  if (!card) fail('Кредитной карты в учёте нет');
  return editAccount(db, { id: card.id, name: card.name, bank: card.bank, limit: t.limit, graceDay: t.graceDay });
}

function reorderAccounts(db, ids) {
  const cur = db.prepare('SELECT id, sort_order FROM accounts WHERE archived = 0 ORDER BY sort_order').all();
  const list = Array.isArray(ids) ? ids.map(String) : [];
  if (list.length !== cur.length || !cur.every(c => list.includes(c.id))) fail('Список счетов изменился — обновите экран');
  const set = db.prepare('UPDATE accounts SET sort_order = ? WHERE id = ?');
  db.transaction(() => list.forEach((id, i) => set.run(i, id)))();
  return { ok: true, undo: remember(() => cur.forEach(c => set.run(c.sort_order, c.id))) };
}

/* В архив — только пустой счёт и только если на нём не держится
   расписание или цель: иначе деньги и платежи пропали бы с экранов. */
function archiveAccount(db, id, todayIso) {
  const today = todayIso || R.iso(new Date());
  const a = accountById(db, id);
  if (a.archived) fail('Счёт уже в архиве');
  const bal = balanceNow(db, a.id, today);
  if (bal !== 0n) fail('На счёте ' + sayCur(bal, a.currency) + ' — сначала переведите остаток или обнулите его сверкой');
  const rec = db.prepare('SELECT name FROM recurring WHERE active = 1 AND account_id = ?').all(a.id);
  if (rec.length) fail('С этого счёта идут регулярные платежи: ' + rec.map(r => '«' + r.name + '»').join(', ') +
                       ' — перенесите их на другой счёт');
  const goals = db.prepare('SELECT name FROM savings_goals WHERE account_id = ?').all(a.id);
  if (goals.length) fail('На этом счёте копится цель ' + goals.map(g => '«' + g.name + '»').join(', ') +
                         ' — выберите для неё другой счёт');
  const back = patch(db, 'accounts', 'id', a.id, { archived: 1 });
  return { ok: true, undo: remember(back) };
}
function restoreAccount(db, id) {
  const a = accountById(db, id);
  if (!a.archived) fail('Счёт не в архиве');
  const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 n FROM accounts WHERE archived = 0').get().n;
  const back = patch(db, 'accounts', 'id', a.id, { archived: 0, sort_order: order });
  return { ok: true, undo: remember(back) };
}

function catRow(db, name) {
  const c = db.prepare('SELECT * FROM categories WHERE name = ?').get(String(name));
  if (!c) fail('Категория не найдена — возможно, её уже убрали');
  return c;
}
function catUsage(db, name) {
  const t = db.prepare("SELECT COUNT(*) n, SUM(direction = 'расход') exp, SUM(direction = 'доход') inc " +
                       'FROM transactions WHERE category = ?').get(name);
  return { ops: t.n, exp: t.exp || 0, inc: t.inc || 0,
           rec: db.prepare('SELECT COUNT(*) n FROM recurring WHERE category = ?').get(name).n,
           plans: db.prepare('SELECT COUNT(*) n FROM planned WHERE category = ?').get(name).n };
}
const isSystemCat = c => SYSTEM_CATS.has(c.name) || c.type === 'техническая';

/* Правка категории. Новое имя переезжает во все ссылки — операции,
   расписание, планы — одной транзакцией. */
function editCategory(db, c) {
  const prev = catRow(db, c.name);
  const system = isSystemCat(prev);
  const name = system ? prev.name : text(c.newName, 60);
  const type = system ? prev.type : String(c.type || '');
  const note = text(c.note, 200);
  if (!system) {
    if (name.length < 2) fail('Название категории: хотя бы два знака');
    if (!CAT_TYPES.includes(type)) fail('Тип категории: выберите из списка');
    if (name.toLowerCase() !== prev.name.toLowerCase()) {
      const same = db.prepare('SELECT name FROM categories').all().filter(x => x.name.toLowerCase() === name.toLowerCase())[0];
      if (same) fail('Такая категория уже есть: ' + same.name);
    }
    const u = catUsage(db, prev.name);
    if (type === 'доход' && prev.type !== 'доход' && u.exp) fail('По категории есть расходы — доходной её не сделать');
    if (type !== 'доход' && prev.type === 'доход' && u.inc) fail('По категории есть доходы — расходной её не сделать');
  }
  const refs = ['transactions', 'recurring', 'planned'];
  db.transaction(() => {
    if (name !== prev.name) {
      db.prepare('INSERT INTO categories(name,type,note,active,sort_order) VALUES(?,?,?,?,?)')
        .run(name, type, note, prev.active, prev.sort_order);
      for (const t of refs) db.prepare('UPDATE ' + t + ' SET category = ? WHERE category = ?').run(name, prev.name);
      db.prepare('DELETE FROM categories WHERE name = ?').run(prev.name);
    } else {
      db.prepare('UPDATE categories SET type = ?, note = ? WHERE name = ?').run(type, note, name);
    }
  })();
  return { ok: true, name, undo: remember(() => {
    if (name !== prev.name) {
      db.prepare('INSERT INTO categories(name,type,note,active,sort_order) VALUES(?,?,?,?,?)')
        .run(prev.name, prev.type, prev.note, prev.active, prev.sort_order);
      for (const t of refs) db.prepare('UPDATE ' + t + ' SET category = ? WHERE category = ?').run(prev.name, name);
      db.prepare('DELETE FROM categories WHERE name = ?').run(name);
    } else {
      db.prepare('UPDATE categories SET type = ?, note = ? WHERE name = ?').run(prev.type, prev.note, prev.name);
    }
  }) };
}

/* Объединение: операции, расписание и планы переезжают в другую
   категорию, сумма сохраняется; прежняя уходит в архив. */
function mergeCategory(db, fromName, toName) {
  const a = catRow(db, fromName), b = catRow(db, toName);
  if (a.name === b.name) fail('Категорию не объединяют саму с собой');
  if (isSystemCat(a)) fail('Служебную категорию не объединяют — на неё опирается расчёт');
  if (b.type === 'техническая') fail('В служебную категорию не переносят');
  if (!b.active) fail('Категория «' + b.name + '» в архиве');
  if ((a.type === 'доход') !== (b.type === 'доход')) {
    fail('Доходную категорию объединяют только с доходной, расходную — с расходной');
  }
  const ids = {};
  for (const t of ['transactions', 'recurring', 'planned']) {
    ids[t] = db.prepare('SELECT id FROM ' + t + ' WHERE category = ?').all(a.name).map(r => r.id);
  }
  db.transaction(() => {
    for (const t of Object.keys(ids)) db.prepare('UPDATE ' + t + ' SET category = ? WHERE category = ?').run(b.name, a.name);
    db.prepare('UPDATE categories SET active = 0 WHERE name = ?').run(a.name);
  })();
  return { ok: true, moved: ids.transactions.length, undo: remember(() => {
    for (const t of Object.keys(ids)) {
      const st = db.prepare('UPDATE ' + t + ' SET category = ? WHERE id = ?');
      for (const id of ids[t]) st.run(a.name, id);
    }
    db.prepare('UPDATE categories SET active = ? WHERE name = ?').run(a.active, a.name);
  }) };
}

/* Архив прячет категорию из выбора, история остаётся. Удалить можно
   только ни разу не использованную. */
function archiveCategory(db, name) {
  const c = catRow(db, name);
  if (isSystemCat(c)) fail('Служебную категорию не убирают — на неё опирается расчёт');
  if (!c.active) fail('Категория уже в архиве');
  return { ok: true, undo: remember(patch(db, 'categories', 'name', c.name, { active: 0 })) };
}
function restoreCategory(db, name) {
  const c = catRow(db, name);
  if (c.active) fail('Категория не в архиве');
  return { ok: true, undo: remember(patch(db, 'categories', 'name', c.name, { active: 1 })) };
}
function deleteCategory(db, name) {
  const c = catRow(db, name);
  if (isSystemCat(c)) fail('Служебную категорию не удаляют — на неё опирается расчёт');
  const u = catUsage(db, c.name);
  if (u.ops || u.rec || u.plans) fail('По категории есть операции, платежи или планы — её можно объединить или отправить в архив');
  db.prepare('DELETE FROM categories WHERE name = ?').run(c.name);
  return { ok: true, undo: remember(() => db.prepare('INSERT INTO categories(name,type,note,active,sort_order) ' +
    'VALUES(?,?,?,?,?)').run(c.name, c.type, c.note, c.active, c.sort_order)) };
}

function resumeRecurring(db, id) {
  const r = db.prepare('SELECT * FROM recurring WHERE id = ? AND active = 0').get(Number(id));
  if (!r) fail('Платёж уже активен');
  return updateRow(db, 'recurring', r.id, { active: 1 });
}

/* Ставка кредита из «Расчётов». Точная месячная ставка сохраняется,
   пока годовую не поменяли. */
function setLoanRate(db, raw) {
  const loan = db.prepare("SELECT * FROM liabilities WHERE account_id IS NULL AND type != 'кредитная карта'").get();
  if (!loan) fail('Кредита в учёте нет');
  const s = String(raw === undefined || raw === null ? '' : raw).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(s)) fail('Ставка: число процентов годовых, например 14,5');
  const rate = Number(s);
  if (!(rate < 100)) fail('Ставка: меньше 100 % годовых');
  const bp = Math.round(rate * 100);
  if (bp === loan.rate_bp) return { ok: true, same: true };
  return updateRow(db, 'liabilities', loan.id, { rate_bp: bp, rate_month: monthRate(rate) });
}

module.exports = { formData, reconCalc, addOperation, addOperations, checkOp, addCategory, savePlan, saveRecurring, saveGoal,
                   saveAccount, saveLoan, saveRecon, loanPreview, dropPlan, pauseRecurring, undo, TAGS,
                   editAccount, setCardTerms, reorderAccounts, archiveAccount, restoreAccount,
                   editCategory, mergeCategory, archiveCategory, restoreCategory, deleteCategory, catUsage,
                   resumeRecurring, setLoanRate, remember, graceRuleFor, SYSTEM_CATS, CAT_TYPES };
