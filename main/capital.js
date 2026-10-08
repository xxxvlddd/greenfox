'use strict';
/* ============================================================
   ДАННЫЕ ДЛЯ ЭКРАНА «КАПИТАЛ И ДОЛГИ»
   ============================================================
   Всё выводится из прогона операций от стартового снимка: балансы
   счетов на каждый день, остаток кредита, сверка. В макете ряды были
   вписаны руками под 10 сентября — здесь каждый считается из базы.

   Деньги уходят в окно СТРОКАМИ КОПЕЕК, как и на других экранах.
   Фразы с числами собирает окно: только там знают, какой пробел
   неразрывный.
   ============================================================ */
const L = require('../core/ledger');
const R = require('../core/report');
const overview = require('./overview');
const book = require('./book');
const prefs = require('./prefs');
const expenses = require('./expenses');

const EVENT_FROM = 2000000n;   /* подпись над графиком — операция от 20 000 ₽ */
const EVENT_MAX  = 5;

/* Цвет счёта. Копилка, брокерский и крипта держат цвета макета,
   карты и текущие счета получают по порядку следующие из палитры. */
const TYPE_COLOR = {
  'наличные': 'var(--cat-8)', 'копилка': 'var(--cat-8)', 'брокерский': 'var(--cat-6)', 'крипто': 'var(--cat-3)',
  'кредитная карта': 'var(--cat-2)',
};
const SPARE_COLORS = ['var(--cat-1)', 'var(--cat-11)', 'var(--cat-7)', 'var(--cat-9)',
                      'var(--cat-5)', 'var(--cat-10)'];
const LOAN_COLOR = 'var(--cat-4)';
const TYPE_LABEL = {
  'дебетовая карта': 'дебетовая', 'текущий': 'текущий счёт', 'наличные': 'наличные', 'копилка': 'копилка',
  'брокерский': 'брокерский счёт', 'крипто': 'криптокошелёк', 'кредитная карта': 'кредитная',
};

function cmp(a, b) { return a > b ? 1 : a < b ? -1 : 0; }
/* Цвет каждого счёта — один на всех экранах. */
function accountColors(accounts) {
  const color = {};
  let spare = 0;
  for (const a of accounts) color[a.id] = TYPE_COLOR[a.type] || SPARE_COLORS[spare++ % SPARE_COLORS.length];
  return color;
}
function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/* Активы — счета в плюсе. Долги — кредит и счета в минусе: так
   переплаченная кредитка честно становится активом, а не долгом. */
function splitOf(bal, loan, ids) {
  let assets = 0n, debts = loan;
  for (const id of ids) {
    const v = bal[id] || 0n;
    if (v >= 0n) assets += v; else debts -= v;
  }
  return { assets, debts, nw: assets - debts };
}

/* Подпись события: описание до скобки и до тире, не длиннее 24 знаков. */
function eventName(t) {
  let s = String(t).split(' — ')[0];
  if (s.length > 24) {
    let cut = s.slice(0, 24);
    if (s.charAt(24) !== ' ') cut = cut.replace(/\s+\S*$/, '');   /* недорезанное слово — долой */
    s = cut.trim() + '…';
  }
  return s;
}

/* Основа запаса прочности: ликвидное (платёжные счета и копилка) и
   средний день прошлого полного месяца — того же, что на «Расходах».
   Нужна «Капиталу» и «Планам»: экраны обязаны называть один запас. */
function reserveBase(db, today, accounts, bal) {
  let ref = expenses.build(db, today, { unit: 'month', offset: -1 });
  if (ref.empty || ref.noData) ref = expenses.build(db, today, { unit: 'month', offset: 0 });
  const avgDay = ref.noData || ref.empty ? 0n : BigInt(ref.avgDay);
  let liquid = 0n;
  for (const a of accounts) {
    /* Ликвидное — платёжные счета, наличные и копилка: взять можно сразу. */
    if (!a.is_payment && a.type !== 'наличные' && a.type !== 'копилка') continue;
    const v = bal[a.id] || 0n;
    if (v > 0n) liquid += v;
  }
  return { ref, avgDay, liquid, avail: R.available(bal, accounts) };
}

function build(db, todayIso) {
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY sort_order').all();
  const liabilities = db.prepare('SELECT * FROM liabilities').all();
  const tech = overview.techCategories(db);

  const B = book.load(db);
  const rows = B.rows;
  const hist = B.hist;
  if (!hist.length) return { empty: true };
  const today = todayIso || R.iso(new Date());
  const S = book.schedule(db, accounts, B, today);
  const recurring = S.recurring, G = S.grace;
  const firstDay = hist[0].d;
  const ids = accounts.map(a => a.id);
  const snap = R.balanceOn(hist, today);
  const now = splitOf(snap.bal, snap.loan, ids);
  const start = B.startPoint();
  const was = splitOf(start.bal, start.loan, ids);

  const color = accountColors(accounts);

  /* ── Ряды: стартовая точка и конец каждого календарного дня ── */
  const days = [];
  for (let d = firstDay; d <= today; d = R.addDays(d, 1)) days.push(d);
  const points = [start].concat(days.map(d => R.balanceOn(hist, d)));
  const nw = [], assets = [], debts = [];
  for (const p of points) {
    const s = splitOf(p.bal, p.loan, ids);
    nw.push(s.nw); assets.push(s.assets); debts.push(s.debts);
  }
  const accSeries = accounts.filter(a => a.type !== 'кредитная карта').map(a => ({
    name: a.name.split(' (')[0], color: color[a.id],
    data: points.map(p => String(p.bal[a.id] || 0n)),
  }));

  /* ── События над графиком: самые крупные доходы и траты ── */
  const moving = r => r.dir === 'доход' || (r.dir === 'расход' && !r.to && !tech.has(r.c));
  const events = rows.filter(r => moving(r) && r.a >= EVENT_FROM && r.d <= today)
    .sort((a, b) => cmp(b.a, a.a)).slice(0, EVENT_MAX)
    .map(r => ({
      i: days.indexOf(r.d) + 1,
      date: r.d.slice(8, 10) + '.' + r.d.slice(5, 7),
      name: eventName(r.t),
      amount: String(r.dir === 'доход' ? r.a : -r.a),
    }))
    .sort((a, b) => a.i - b.i);

  /* Провал и скачок — дни с самым большим изменением капитала. */
  let drop = null, jump = null;
  for (let i = 1; i < nw.length; i++) {
    const delta = nw[i] - nw[i - 1];
    if (delta < 0n && (!drop || delta < drop.delta)) drop = { delta, day: days[i - 1] };
    if (delta > 0n && (!jump || delta > jump.delta)) jump = { delta, day: days[i - 1] };
  }
  const biggest = (day, dir) => rows.filter(r => r.d === day && r.dir === dir)
    .sort((a, b) => cmp(b.a, a.a))[0];
  const dropOp = drop && biggest(drop.day, 'расход');
  const jumpOp = jump && biggest(jump.day, 'доход');

  /* ── Активы и долги ─────────────────────────────────────── */
  const stale = R.staleRecon(accounts, today);
  const staleDays = {};
  for (const s of stale) staleDays[s.id] = s.days;

  const assetsList = accounts.filter(a => (snap.bal[a.id] || 0n) > 0n)
    .sort((x, y) => cmp(snap.bal[y.id], snap.bal[x.id]))
    .map(a => {
      const tags = [];
      if (!a.is_payment && a.type !== 'кредитная карта') tags.push({ kind: 'payment' });
      if (staleDays[a.id]) tags.push({ kind: 'stale', days: staleDays[a.id] });
      const bank = a.bank && a.bank !== '—' ? a.bank : '';
      const type = TYPE_LABEL[a.type] || a.type;
      return { name: a.name, sub: bank ? bank + ' · ' + type : capFirst(type),
               sum: String(snap.bal[a.id]), color: color[a.id], type: a.type, tags,
               /* Валютный счёт: в сумме — рубли по курсу, рядом — сколько в валюте. */
               native: String((snap.nat || snap.bal)[a.id] || 0n), cur: a.currency || 'RUB' };
    });

  /* Кредит в ядре один, и долг по нему ведёт прогон. Карточка
     справочника даёт ему имя и условия. */
  const loanRow = liabilities.filter(l => !l.account_id && l.type !== 'кредитная карта')[0] || null;
  const card = accounts.filter(a => a.type === 'кредитная карта')[0] || null;
  const graceRule = recurring.filter(r => r.category === 'Переводы между своими' &&
                                          r.obligatory && r.day_of_month)[0] || null;

  const debtsList = [];
  if (loanRow && snap.loan > 0n) {
    debtsList.push({ kind: 'loan', name: capFirst(loanRow.type), creditor: loanRow.creditor,
      rateBp: loanRow.rate_bp, close: loanRow.close_date,
      sum: String(snap.loan), color: LOAN_COLOR, tags: [] });
  }
  for (const a of accounts) {
    const v = snap.bal[a.id] || 0n;
    if (v >= 0n) continue;
    const tags = [];
    if (a.type === 'кредитная карта' && G && G.cardId === a.id && G.left > 0n) {
      tags.push({ kind: 'grace', days: G.daysLeft });
    }
    debtsList.push({ kind: 'card', name: a.name, limit: a.credit_limit === null ? null : String(a.credit_limit),
      graceDay: graceRule ? graceRule.day_of_month : null,
      sum: String(-v), color: color[a.id], tags });
  }
  debtsList.sort((x, y) => cmp(BigInt(y.sum), BigInt(x.sum)));

  /* ── Кредит: график платежей от сегодняшнего остатка ── */
  let loan = null;
  if (loanRow) {
    const pay = loanRow.monthly_payment === null ? null : BigInt(loanRow.monthly_payment);
    const next = loanRow.payment_day ? R.nextDayOfMonth(today, loanRow.payment_day) : null;
    const sch = pay && next ? R.loanSchedule(snap.loan, pay, next, loanRow.payment_day, B.loanRate) : null;
    loan = {
      name: capFirst(loanRow.type), creditor: loanRow.creditor,
      rateBp: loanRow.rate_bp, payment: pay === null ? null : String(pay),
      day: loanRow.payment_day, balance: String(snap.loan),
      paymentsLeft: sch ? sch.n : null,
      lastDate: sch && sch.n ? sch.dates[sch.n - 1] : null,
      interest: sch ? String(sch.interest) : null,
      daysToNext: next ? R.daysBetween(today, next) : null,
      reconciledAt: loanRow.reconciled_at,
      initial: loanRow.initial_amount === null ? null : String(loanRow.initial_amount),
    };
  }

  /* ── Кредитка: цикл грейса считается так же, как на «Обзоре» ── */
  let cardOut = null;
  if (card) {
    const v = snap.bal[card.id] || 0n;
    const debt = v < 0n ? -v : 0n;
    const limit = card.credit_limit === null ? null : BigInt(card.credit_limit);
    /* Цикл грейса — один расчёт для всех экранов (main/grace.js). */
    let cycle = null;
    if (G && G.cardId === card.id) {
      const before = R.balanceOn(hist, R.addDays(G.start, -1)).bal[card.id] || 0n;
      const debtStart = before < 0n ? -before : 0n;
      cycle = { start: G.start, due: G.due, daysLeft: G.daysLeft, source: G.source, statementDay: G.statementDay,
                paid: String(G.paid), count: G.ops.length, debtStart: String(G.need), left: String(G.left),
                change: String(debt - debtStart),
                stuck: G.paid > 0n && debt > 0n && debt >= debtStart && G.left > 0n };
    }
    cardOut = {
      name: 'Кредитная карта',
      bank: card.bank && card.bank !== '—' ? card.bank : '',
      debt: String(debt), limit: limit === null ? null : String(limit),
      free: limit === null ? null : String(limit - debt),
      graceDay: graceRule ? graceRule.day_of_month : null,
      statementDay: card.statement_day || null,
      reconciledAt: card.reconciled_at,
      alert: limit !== null && limit > 0n && debt * 10n >= limit * 9n,
      cycle,
    };
  }

  /* ── Запас прочности ── */
  const { ref, avgDay, liquid, avail } = reserveBase(db, today, accounts, snap.bal);
  const daysLeft = avgDay > 0n ? Number(avail / avgDay) : null;
  const zeroDate = daysLeft === null ? null : R.addDays(today, daysLeft);
  const income = R.upcoming(recurring, R.addDays(today, 1), 62).filter(u => u.dir === 'доход')[0] || null;
  const safety = {
    liquid: String(liquid), avail: String(avail),
    avgDay: String(avgDay), monthly: String(avgDay * 30n),
    avgDayNet: ref.noData || ref.empty ? '0' : ref.avgDayNet,
    oneOffCount: ref.noData || ref.empty ? 0 : ref.oneOff.count,
    month: ref.period ? ref.period.name.split(' ')[0] : '',
    daysLeft, zeroDate, zones: prefs.zones(db),
    income: income ? { name: income.name, day: income.day,
                       lag: zeroDate ? R.daysBetween(zeroDate, income.day) : null } : null,
  };

  /* ── Сверка ─────────────────────────────────────────────────
     Расчёт сравнивается с банком на дату сверки, а не на сегодня:
     иначе любая операция после сверки выглядела бы расхождением. */
  const recon = accounts.filter(a => a.reconciled_at && a.reconciled_balance !== null).map(a => {
    /* Сверка — в валюте счёта: с банком сравнивают то, что видно в банке. */
    const at = R.balanceOn(hist, a.reconciled_at);
    const calc = (at.nat || at.bal)[a.id] || 0n;
    const fact = BigInt(a.reconciled_balance);
    const diff = calc - fact;
    return { name: a.name, calc: String(calc), fact: String(fact), diff: String(diff), cur: a.currency || 'RUB',
             off: diff > 1n || diff < -1n, date: a.reconciled_at, stale: !!staleDays[a.id],
             order: a.sort_order };
  }).sort((x, y) => (x.stale - y.stale) || (x.order - y.order));

  const snaps = db.prepare("SELECT date, account_id, balance FROM balance_snapshots " +
                           "WHERE source = 'сверка' ORDER BY date").all();
  const byDate = {};
  for (const s of snaps) (byDate[s.date] = byDate[s.date] || []).push(s);
  const history = Object.keys(byDate).sort().reverse().map(day => {
    const at = R.balanceOn(hist, day), bal = at.nat || at.bal;
    let off = 0;
    for (const s of byDate[day]) {
      const diff = (bal[s.account_id] || 0n) - BigInt(s.balance);
      if (diff > 1n || diff < -1n) off++;
    }
    return { date: day, accounts: byDate[day].length, off };
  });
  const lastRecon = accounts.map(a => a.reconciled_at).filter(Boolean).sort().pop() || null;

  const [ty, tm, td] = today.split('-').map(Number);
  return {
    empty: false,
    today, firstDay,
    headLabel: 'Состояние на ' + R.human(today) + ' ' + ty + ' · ' +
               R.WDAY[new Date(ty, tm - 1, td).getDay()].toLowerCase(),
    nw: String(now.nw), assets: String(now.assets), debts: String(now.debts),
    delta: String(now.nw - was.nw),
    assetsCount: assetsList.length,
    assetKinds: Array.from(new Set(assetsList.map(a => a.type)
      .filter(t => t === 'наличные' || t === 'копилка' || t === 'брокерский' || t === 'крипто'))),
    debtKinds: Array.from(new Set(debtsList.map(d => d.kind))),
    lastRecon,
    series: {
      labels: ['старт'].concat(days.map(d => d.slice(8, 10) + '.' + d.slice(5, 7))),
      nw: nw.map(String), assets: assets.map(String), debts: debts.map(String),
      accounts: accSeries,
    },
    events,
    /* В подписи под заголовком название целиком: обрезка многоточием
       уместна в тесной ленте над графиком, а не посреди фразы. */
    drop: dropOp ? { day: drop.day, name: String(dropOp.t).split(' — ')[0] } : null,
    jump: jumpOp ? { day: jump.day, name: String(jumpOp.t).split(' — ')[0] } : null,
    assetsList, debtsList,
    loan, card: cardOut, safety,
    recon: { rows: recon, stale, history, last: lastRecon,
             offCount: recon.filter(r => r.off).length },
  };
}

module.exports = { build, accountColors, splitOf, reserveBase };
