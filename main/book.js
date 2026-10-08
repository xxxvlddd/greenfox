'use strict';
/* ============================================================
   УЧЁТ ИЗ БАЗЫ
   ============================================================
   Один вход для всех экранов: операции, стартовое состояние из
   справочников и прогон. Раньше стартовый снимок жил в коде, и счёт,
   заведённый формой, расчёт бы просто не увидел. Теперь остатки счетов
   на дату их снимка и долг по кредиту со ставкой берутся из базы — для
   перенесённого учёта это ровно те же числа, что были в коде.
   ============================================================ */
const L = require('../core/ledger');
const { fmt } = require('../core/money');
const fx = require('./fx');

function allTransactions(db) {
  return db.prepare(
    'SELECT date, amount, amount_from, amount_to, direction, account_from, account_to, category, description, flag ' +
    'FROM transactions ORDER BY date, seq').all().map(r => ({
      date: r.date, amount: fmt(BigInt(r.amount)), direction: r.direction,
      amount_from: r.amount_from === null ? '' : fmt(BigInt(r.amount_from)),
      amount_to: r.amount_to === null ? '' : fmt(BigInt(r.amount_to)),
      account_from: r.account_from || '', account_to: r.account_to || '',
      category: r.category, description: r.description, flag: r.flag,
    }));
}

/* Валюты счетов и курсы для прогона. Без валютных счетов — null:
   прогон идёт по-старому, в рублях. */
function fxOf(db, accounts) {
  const cur = {};
  for (const a of accounts) if (a.currency && a.currency !== 'RUB') cur[a.id] = a.currency;
  return Object.keys(cur).length ? { cur, rate: fx.rateFn(db) } : null;
}

function load(db) {
  /* Архивные счета в прогоне остаются: старые операции на них ссылаются. */
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY sort_order').all();
  const liabilities = db.prepare('SELECT * FROM liabilities').all();
  const rows = L.loadTransactions(allTransactions(db));
  const start = L.startFrom(accounts, liabilities);
  const fxs = fxOf(db, accounts);
  /* Прогон идёт и без операций: остатки счетов на дату их открытия —
     уже учёт. После мастера первого запуска экраны показывают введённые
     остатки, а не «пусто». */
  const hist = L.replay(rows, start, fxs);
  return {
    rows, hist, start, fx: fxs,
    loanRate: start.loan ? start.loan.rate : null,
    /* Точка «старт» для графика капитала: до первой операции. Остатки
       валютных счетов — в рублях по курсу того дня. */
    startPoint: () => {
      const first = hist.length ? hist[0].d : null;
      const p = L.startState(Object.assign({}, start, { first }));
      return fxs ? { bal: L.rubAt(fxs, p.bal, first), nat: p.bal, loan: p.loan } : Object.assign(p, { nat: p.bal });
    },
  };
}

/* Регулярные платежи для расчётов. Сумма платежа — в валюте его счёта:
   подписка 20 $ с долларовой карты. Экранам, которые складывают
   платежи с остатками, нужна рублёвая — по курсу на сегодня; своя
   остаётся в amount_native / amount_max_native, валюта — в currency.
   tail — условие и порядок: 'WHERE active = 1 ORDER BY id'. */
function recurring(db, tail) {
  const rows = db.prepare('SELECT r.*, a.currency acc_cur FROM recurring r LEFT JOIN accounts a ON a.id = r.account_id ' +
    String(tail || '').replace(/\b(active|id|direction|day_of_month|name)\b/g, 'r.$1')).all();
  const rate = rows.some(r => r.acc_cur && r.acc_cur !== 'RUB') ? fx.rateFn(db) : null;
  return rows.map(r => {
    const cur = r.acc_cur && r.acc_cur !== 'RUB' ? r.acc_cur : 'RUB';
    delete r.acc_cur;
    r.currency = cur;
    r.amount_native = r.amount;
    r.amount_max_native = r.amount_max;
    if (cur === 'RUB') return r;
    const k = rate(cur, null);
    r.amount = k ? Number(fx.toRub(r.amount, k)) : 0;
    if (r.amount_max !== null) r.amount_max = k ? Number(fx.toRub(r.amount_max, k)) : 0;
    return r;
  });
}

module.exports = { load, allTransactions, recurring };
