'use strict';
/* ============================================================
   ДАННЫЕ ДЛЯ ЭКРАНА «ПРОГНОЗЫ»
   ============================================================
   Три темпа трат, текущий месяц, кредит, грейс и цели накоплений.
   Остаток, темпы и расписание берутся из того же расчёта, что у
   «Обзора»: иначе два экрана называли бы разные даты, когда кончатся
   деньги. Кредит и цикл грейса — те же, что у «Капитала».

   Деньги уходят в окно строками копеек.
   ============================================================ */
const L = require('../core/ledger');
const R = require('../core/report');
const overview = require('./overview');
const book = require('./book');
const expenses = require('./expenses');
const capital = require('./capital');

const HORIZON = 30;            /* горизонт сценариев, дней */
const GOAL_WINDOW = 30;        /* окно динамики у целей без срока */
const SELF = 'Переводы между своими';

function ddmm(iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7); }
function sum(list, f) { return list.reduce((s, x) => s + f(x), 0n); }
function shortGoal(name) { return String(name).split(' (')[0]; }

/* График кредита — в строки для окна. */
function serSchedule(s) {
  if (!s) return null;
  return { pts: s.pts.map(String), dates: s.dates, n: s.n, full: s.full,
           last: String(s.last), interest: String(s.interest), total: String(s.total),
           firstInt: String(s.firstInt), firstPrin: String(s.firstPrin) };
}

function loadAll(db, todayIso) {
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY sort_order').all();
  const liabilities = db.prepare('SELECT * FROM liabilities').all();
  const B = book.load(db);
  const rows = B.rows, hist = B.hist;
  const today = todayIso || R.iso(new Date());
  const S = book.schedule(db, accounts, B, today);
  const recurring = S.recurring;
  return { accounts, recurring, grace: S.grace, liabilities, rows, hist, today, loanRate: B.loanRate,
           snap: hist.length ? R.balanceOn(hist, today) : null };
}

function loanOf(ctx) {
  const row = ctx.liabilities.filter(l => !l.account_id && l.type !== 'кредитная карта')[0];
  if (!row || !row.monthly_payment || !row.payment_day || !ctx.snap || ctx.snap.loan <= 0n) return null;
  return { row, pay: BigInt(row.monthly_payment), next: R.nextDayOfMonth(ctx.today, row.payment_day) };
}

/* Расчёт «а если платить больше» — по запросу окна, на каждое изменение
   суммы. Тот же график, что у «Капитала», только с другим платежом. */
function loanPlan(db, todayIso, extraRub) {
  const ctx = loadAll(db, todayIso);
  const l = loanOf(ctx);
  if (!l) return null;
  const extra = BigInt(Math.max(0, Math.round(Number(extraRub) || 0))) * 100n;
  return serSchedule(R.loanSchedule(ctx.snap.loan, l.pay + extra, l.next, l.row.payment_day, ctx.loanRate));
}

function build(db, todayIso) {
  const ov = overview.build(db, todayIso);
  if (ov.empty) return { empty: true };
  const ctx = loadAll(db, ov.today);
  const { accounts, recurring, rows, hist, snap, today } = ctx;
  const tech = overview.techCategories(db);
  const isSpend = r => R.isSpending(r, tech);
  const [ty, tm, td] = today.split('-').map(Number);

  /* ── Три сценария: один остаток, одно расписание, три темпа ── */
  const events = {};
  for (const k of Object.keys(ov.events)) if (Number(k) <= HORIZON) events[k] = ov.events[k].sum;
  const nextIncome = R.upcoming(recurring, R.addDays(today, 1), HORIZON)
    .filter(u => u.dir === 'доход')[0] || null;
  const scen = {
    avail: ov.available, horizon: HORIZON, events,
    rates: { free: ov.rates.free, usual: ov.rates.usual, lean: ov.rates.lean },
    income: nextIncome ? { day: R.daysBetween(today, nextIncome.day), date: nextIncome.day,
                           name: nextIncome.name } : null,
  };

  /* ── Текущий месяц: факт по вчера, дальше — обычный темп плюс
       обязательные платежи по расписанию ── */
  const D = new Date(ty, tm, 0).getDate();
  const monthStart = today.slice(0, 8) + '01';
  const perDay = new Array(D + 1).fill(0n);
  let incomeFact = 0n;
  for (const r of rows) {
    if (r.d < monthStart || r.d > today) continue;
    const day = Number(r.d.slice(8, 10));
    if (isSpend(r) && day < td) perDay[day] += r.a;
    if (r.dir === 'доход') incomeFact += r.a;
  }
  const fact = [0n];
  for (let k = 1; k < td; k++) fact.push(fact[k - 1] + perDay[k]);
  const plan = {};
  for (const u of R.upcoming(recurring, today, D - td)) {
    if (u.dir === 'доход' || !u.obligatory || u.category === SELF) continue;
    const day = Number(u.day.slice(8, 10));
    plan[day] = (plan[day] || 0n) + u.amount;
  }
  const expected = R.upcoming(recurring, R.addDays(today, 1), D - td - 1)
    .filter(u => u.dir === 'доход')
    .map(u => ({ name: u.name, day: u.day, sum: String(u.amount) }));
  const income = incomeFact + sum(expected, e => BigInt(e.sum));
  const regular = sum(R.upcoming(recurring, monthStart, D - 1).filter(u => u.dir === 'доход'), u => u.amount);
  const curve = rate => {
    const out = [];
    let c = fact[fact.length - 1];
    for (let k = td; k <= D; k++) { c += rate + (plan[k] || 0n); out.push(String(c)); }
    return out;
  };
  const mid = curve(BigInt(ov.rates.usual));
  const lo = curve(BigInt(ov.rates.p25));
  const hi = curve(BigInt(ov.rates.p75));

  /* Прошлый месяц — для сравнения в подписях. */
  const prev = expenses.build(db, today, { unit: 'month', offset: -1 });
  let prevOut = null;
  if (!prev.empty && !prev.noData) {
    let prevIncome = 0n;
    for (const r of rows) {
      if (r.d >= prev.period.from && r.d <= prev.period.to && r.dir === 'доход') prevIncome += r.a;
    }
    prevOut = { avgDay: prev.avgDay, cashflow: String(prevIncome - BigInt(prev.total)),
                monthPre: expenses.MON_PRE[Number(prev.period.from.slice(5, 7)) - 1] };
  }
  const month = {
    name: expenses.MON_NOM[tm - 1], namePre: expenses.MON_PRE[tm - 1], days: D, today: td,
    monthShort: ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'][tm - 1],
    fact: fact.map(String), mid, lo, hi,
    incomeFact: String(incomeFact), expected, income: String(income), regular: String(regular),
    rate: ov.rates.usual, remaining: D - td + 1,
    prev: prevOut,
  };

  /* ── Кредит ─────────────────────────────────────────────── */
  const l = loanOf(ctx);
  const loan = l ? {
    creditor: l.row.creditor, rateBp: l.row.rate_bp, payment: String(l.pay),
    day: l.row.payment_day, balance: String(snap.loan), next: l.next,
    base: serSchedule(R.loanSchedule(snap.loan, l.pay, l.next, l.row.payment_day, ctx.loanRate)),
  } : null;

  /* ── Грейс кредитки: один расчёт для всех экранов (main/grace.js) ── */
  const G = ctx.grace;
  let grace = null;
  if (G) {
    grace = {
      bank: G.card.bank && G.card.bank !== '—' ? G.card.bank : '',
      start: G.start, due: G.due, graceDay: G.graceDay, statementDay: G.statementDay, source: G.source,
      len: Math.max(1, R.daysBetween(G.start, G.due)), todayIdx: R.daysBetween(G.start, today),
      daysLeft: G.daysLeft,
      need: String(G.need), paid: String(G.paid), left: String(G.left),
      ops: G.ops.map(r => ({ date: ddmm(r.d), day: R.daysBetween(G.start, r.d), desc: r.t, sum: String(r.a) })),
      debt: String(G.debt), limit: G.limit === null ? null : String(G.limit),
      stuck: G.paid > 0n && G.debt > 0n && G.debt >= G.need && G.left > 0n,
    };
  }

  /* ── Цели накоплений ──────────────────────────────────────── */
  const accById = {};
  for (const a of accounts) accById[a.id] = a;
  const color = capital.accountColors(accounts);
  const firstDay = hist[0].d;
  const winFrom = R.addDays(today, -(GOAL_WINDOW - 1)) < firstDay ? firstDay : R.addDays(today, -(GOAL_WINDOW - 1));
  const charges = R.upcoming(recurring, R.addDays(today, 1), 62).filter(u => u.dir !== 'доход');
  const goals = db.prepare('SELECT * FROM savings_goals ORDER BY id').all().map(g => {
    const acc = accById[g.account_id] || null;
    const bal = acc ? (snap.bal[acc.id] || 0n) : 0n;
    if (g.kind === 'target' && g.target) {
      /* На платёжном счёте отложенное от текущих денег не отделить —
         отложенным считается только то, что лежит на отдельном счёте. */
      const cur = acc && !acc.is_payment && bal > 0n ? bal : 0n;
      const target = BigInt(g.target);
      const need = target > cur ? target - cur : 0n;
      const left = g.deadline ? R.daysBetween(today, g.deadline) : null;
      const months = left !== null && left > 0 ? Math.max(1, Math.ceil(left / 30)) : 1;
      return { kind: 'target', id: g.id, accountId: g.account_id, name: shortGoal(g.name), cur: String(cur),
               target: String(target),
               need: String(need), deadline: g.deadline, left, monthly: String(need / BigInt(months)),
               warn: need > 0n && left !== null && left <= 30 };
    }
    const series = [];
    for (let d = winFrom; d <= today; d = R.addDays(d, 1)) {
      series.push(String(acc ? (R.balanceOn(hist, d).bal[acc.id] || 0n) : 0n));
    }
    const charge = acc ? charges.filter(u => u.accountId === acc.id)[0] : null;
    const rest = charge ? bal - charge.amount : null;
    return {
      kind: 'track', id: g.id, accountId: g.account_id, name: shortGoal(g.name), cur: String(bal),
      color: acc ? color[acc.id] : 'var(--cat-12)',
      series, growth: String(BigInt(series[series.length - 1]) - BigInt(series[0])),
      days: series.length - 1,
      reconciledAt: acc ? acc.reconciled_at : null,
      staleDays: acc && acc.reconciled_at && R.daysBetween(acc.reconciled_at, today) > R.STALE_DAYS
        ? R.daysBetween(acc.reconciled_at, today) : 0,
      charge: charge ? { name: charge.name, day: charge.day, sum: String(charge.amount),
                         rest: String(rest), short: rest < charge.amount } : null,
      warn: !!(charge && rest < charge.amount),
    };
  }).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'target' ? -1 : 1));

  const toIncome = nextIncome ? R.daysBetween(today, nextIncome.day) : null;
  return {
    empty: false, today,
    headLabel: 'Расчёт на ' + R.human(today) + ' ' + ty + ' · горизонт ' + HORIZON + ' дней',
    scen, month, loan, grace,
    goals,
    goalsFoot: {
      saved: String(sum(goals, g => BigInt(g.cur))),
      plan: String(sum(goals.filter(g => g.kind === 'target'), g => BigInt(g.monthly))),
      avail: ov.available, usual: ov.rates.usual,
      toIncome, incomeName: nextIncome ? nextIncome.name : null,
    },
  };
}

module.exports = { build, loanPlan, HORIZON };
