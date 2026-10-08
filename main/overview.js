'use strict';
/* ============================================================
   ДАННЫЕ ДЛЯ ЭКРАНА «ОБЗОР»
   ============================================================
   Собирает всё, что показывает первый экран. Ни одно число сюда не
   вписано руками: всё выводится из операций и справочников.

   Деньги уходят в интерфейс СТРОКАМИ КОПЕЕК, без исключений: BigInt
   через мост между процессами не проходит, а переводить в дробное
   число нельзя. Смешивать в одном ответе копейки и рубли тем более
   нельзя — на этом уже один раз показали лимит карты в сто раз меньше
   настоящего.
   ============================================================ */
const L = require('../core/ledger');
const R = require('../core/report');
const { fmt, say } = require('../core/money');

/* Категории, которые тратой не считаются. */
function techCategories(db) {
  const rows = db.prepare("SELECT name FROM categories WHERE type IN ('техническая')").all();
  return new Set(rows.map(r => r.name));
}

const book = require('./book');
const grace = require('./grace');
const prefs = require('./prefs');
const allTransactions = book.allTransactions;

function build(db, todayIso) {
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY sort_order').all();
  const liabilities = db.prepare('SELECT * FROM liabilities').all();
  const tech = techCategories(db);

  const B = book.load(db);
  const rows = B.rows;
  const hist = B.hist;
  /* Пусто — пока нет ни одного счёта; без операций, но со счетами —
     уже есть что показать. */
  if (!hist.length) return { empty: true };
  /* Пополнение кредитки в расписании — тем, что осталось внести до грейса,
     а не лимитом карты. */
  const G = grace.state(accounts, book.recurring(db, 'WHERE active = 1'), B, todayIso || R.iso(new Date()));
  const recurring = grace.applyTo(book.recurring(db, 'WHERE active = 1'), G);

  /* Последний день, о котором учёт что-то знает: операция или отметка
     «день без трат» из календаря. */
  const quietLast = db.prepare('SELECT MAX(date) d FROM quiet_days WHERE date <= ?').get(todayIso || R.iso(new Date())).d;
  const lastDay = quietLast && quietLast > hist[hist.length - 1].d ? quietLast : hist[hist.length - 1].d;
  /* Сегодня — это сегодня, а не последний день, когда что-то вносили.
     Иначе приложение, в которое два дня не заглядывали, показывало бы
     позавчерашний дневной лимит и уверяло, что всё в порядке.
     Балансы переносятся вперёд сами: с последней операции они не
     менялись. */
  const today = todayIso || R.iso(new Date());
  const snap = R.balanceOn(hist, today);
  const yesterday = R.addDays(today, -1);

  const avail = R.available(snap.bal, accounts);
  const up = R.upcoming(recurring, R.addDays(today, 1), 30);
  /* Резерв и горизонт лимита — из настроек: резерв в лимит не входит,
     горизонт — до ближайшего поступления или фиксированное число дней. */
  const reserve = prefs.reserve(db);
  const horizon = prefs.get(db, 'calc.horizon');
  /* Лимит на сегодня — от остатка на начало дня: трата, внесённая
     сегодня, уменьшает «осталось», а не сам лимит, иначе она считалась
     бы дважды. Сегодняшние траты возвращаются на свои счета, и только
     потом считается доступное. */
  const startBal = Object.assign({}, snap.bal);
  for (const r of rows) {
    if (r.d === today && R.isSpending(r, tech) && r.from) startBal[r.from] = (startBal[r.from] || 0n) + r.a;
  }
  const startAvail = R.available(startBal, accounts);
  const dl = R.dayLimit(startAvail, up, reserve);
  const toIncome = dl.nextIncome ? R.daysBetween(today, dl.nextIncome) : null;
  /* Фиксированный горизонт: свободные — за вычетом обязательных платежей
     в пределах этих дней; поступления не учитываются, как и до них. */
  let days = toIncome, free = dl.free, due = dl.due;
  if (horizon !== 'income') {
    days = Number(horizon);
    const end = R.addDays(today, days);
    due = 0n;
    for (const u of up) {
      if (u.day > end || u.dir === 'доход' || !u.obligatory || u.category === 'Переводы между своими') continue;
      due += u.amount;
    }
    free = startAvail - due - reserve;
  }
  const limit = days && days > 0 ? free / BigInt(days) : null;

  const spentY = R.spentOn(rows, yesterday, tech);
  const opsYRows = rows.filter(r => r.d === yesterday && R.isSpending(r, tech));
  const opsY = opsYRows.length;
  /* Что именно тратили вчера — две-три категории, без списка операций. */
  const yCats = [];
  for (const r of opsYRows) if (yCats.indexOf(r.c) < 0) yCats.push(r.c);

  const spentToday = R.spentOn(rows, today, tech);
  const opsToday = rows.filter(r => r.d === today && R.isSpending(r, tech)).length;

  /* Темп последней недели: если он заметно выше лимита, экран обязан
     сказать об этом, а не показывать ободряющее число. */
  let week = 0n;
  for (let i = 1; i <= 7; i++) week += R.spentOn(rows, R.addDays(today, -i), tech);
  const rate7 = week / 7n;

  /* ── Ряды для графиков ──────────────────────────────────────
     Всё, что в макете было вписано руками, здесь считается.     */
  const catType = {};
  for (const c of db.prepare('SELECT name, type FROM categories').all()) catType[c.name] = c.type;
  const isSpend = r => R.isSpending(r, tech);
  const colors = R.categoryColors(rows, isSpend);
  const firstDay = hist[0].d;
  const daily = R.dailySpend(rows, isSpend, firstDay, today, colors, String);
  /* Категории, уже описанные расписанием: их суммы приходят в прогноз
     отдельными событиями, поэтому в дневной темп попадать не должны. */
  const recurringCats = new Set(
    recurring.filter(r => r.direction !== 'доход' && r.category).map(r => r.category));
  const rates = R.spendRates(daily, rows, isSpend,
    new Set(['базовые']), catType, recurringCats);

  /* События прогноза — в днях от сегодня, как их ждёт график. */
  const HORIZON = 90;
  const evList = R.upcoming(recurring, R.addDays(today, 1), HORIZON);
  const events = {};
  for (const e of evList) {
    const off = R.daysBetween(today, e.day);
    if (!off || off < 1 || off > HORIZON) continue;
    const slot = (events[off] = events[off] || { sum: 0n, names: [] });
    slot.sum += e.dir === 'доход' ? e.amount : -e.amount;
    slot.names.push(e.name);
  }
  const eventsOut = {};
  for (const k of Object.keys(events)) {
    eventsOut[k] = { sum: String(events[k].sum), names: events[k].names };
  }

  /* Таблица ближайших событий: к каждому — остаток после него при
     обычном темпе трат. Та же модель, что на графике, иначе экран
     противоречил бы сам себе. */
  const TABLE_DAYS = 14;
  const usualRate = BigInt(rates.usual);
  const accById = {};
  for (const a of accounts) accById[a.id] = a.name;
  let running = 0n;
  const table = [];
  for (const e of evList) {
    const off = R.daysBetween(today, e.day);
    if (!off || off < 1 || off > TABLE_DAYS) continue;
    const signed = e.dir === 'доход' ? e.amount : -e.amount;
    running += signed;
    const bal = avail - usualRate * BigInt(off) + running;
    const [yy, mm, dd] = e.day.split('-').map(Number);
    table.push({
      day: off,
      date: String(dd).padStart(2, '0') + '.' + String(mm).padStart(2, '0'),
      dow: R.DOW[new Date(yy, mm - 1, dd).getDay()],
      name: e.name,
      kind: e.dir === 'доход' ? 'income' : (e.obligatory ? 'must' : 'sub'),
      tag: e.dir === 'доход' ? 'доход' : (e.obligatory ? 'обязательный' : 'по желанию'),
      acc: accById[e.accountId] || '—',
      amount: String(signed),
      balance: String(bal),
    });
  }

  /* Проверка сходимости — то же, что делает аудит: если расчёт разошёлся
     со справочником, экран обязан сказать об этом, а не показать число. */
  /* Сверка сравнивается на дату сверки: после неё учёт продолжается. */
  const accCsvLike = accounts.filter(a => a.reconciled_balance !== null).map(a => ({
    id: a.id, balance: fmt(BigInt(a.reconciled_balance)), at: a.reconciled_at }));
  const liabLike = liabilities.filter(l => l.reconciled_debt !== null).map(l => ({
    id: l.id, type: l.type, account_id: l.account_id, at: l.reconciled_at,
    current_debt: fmt(BigInt(l.reconciled_debt)) }));
  const allAcc = db.prepare('SELECT id, type, credit_limit FROM accounts').all();
  const verdict = L.check(rows, hist, accCsvLike, liabLike, {
    known: new Set(allAcc.map(a => a.id)),
    cards: allAcc.filter(a => a.type === 'кредитная карта')
      .map(a => ({ id: a.id, limit: a.credit_limit === null ? null : BigInt(a.credit_limit) })),
  });

  /* ── Предупреждения ─────────────────────────────────────────
     Три проверки, которые видно на «Обзоре». Каждая либо срабатывает
     на данных, либо не показывается вовсе — выдуманных тревог нет. */
  const alerts = [];

  /* 1. Деньги кончатся раньше, чем придут. Считаем по обычному темпу
        и тем же событиям, что на графике. */
  if (limit !== null) {
    const usual = BigInt(rates.usual);
    let bal = avail;
    let zeroDay = null, shortfall = 0n;
    for (let off = 1; off <= (days || 30); off++) {
      bal -= usual;
      if (events[off]) bal += events[off].sum;
      if (bal < 0n && zeroDay === null) { zeroDay = off; shortfall = -bal; }
    }
    if (zeroDay !== null && dl.nextIncome) {
      const when = R.addDays(today, zeroDay);
      alerts.push({ tone: 'danger', lead: 'Риск исчерпания.',
        text: 'При обычном темпе ' + R.human(when) + ' не хватит ' + say(shortfall) +
              ' — деньги придут только ' + R.human(dl.nextIncome) });
    }
  }

  /* 2. Обязательный платёж не пройдёт: на счёте списания не хватает.
        Считаем по остатку счёта без учёта будущих трат — если не
        хватает уже сейчас, ждать нечего. */
  const accById2 = {};
  for (const a of accounts) accById2[a.id] = a;
  for (const e of evList) {
    const off = R.daysBetween(today, e.day);
    if (!off || off < 1 || off > 14) continue;
    if (e.dir === 'доход' || !e.obligatory || !e.accountId) continue;
    const acc = accById2[e.accountId];
    if (!acc) continue;
    const onAcc = snap.bal[e.accountId];
    if (onAcc === undefined) continue;
    /* Кредитной картой платят в долг: считать надо не остаток, а
       незанятый лимит. Сравнивать её отрицательный баланс с суммой
       платежа бессмысленно — так любая покупка выглядела бы срывом. */
    const room = acc.type === 'кредитная карта'
      ? (acc.credit_limit === null ? null : BigInt(acc.credit_limit) + onAcc)
      : onAcc;
    if (room === null || room >= e.amount) continue;
    alerts.push({ tone: 'warning', lead: 'Не хватит на платёж.',
      text: R.human(e.day) + ' спишется ' + say(e.amount) + ' (' + e.name + ') с «' +
            acc.name + '» — ' + (acc.type === 'кредитная карта'
              ? 'свободного лимита ' + say(room)
              : 'на ней ' + say(room)) });
  }

  /* 3. Грейс кредитки: сколько ещё внести до дня грейса, чтобы не было
        процентов (main/grace.js). Всё внесено — молчим. */
  if (G && G.left > 0n) {
    alerts.push({ tone: 'warning', lead: 'Грейс кредитки.',
      text: 'До ' + R.human(G.due) + ' нужно внести ещё ' + say(G.left) + ' — ' +
            (G.daysLeft === 0 ? 'сегодня последний день' : 'осталось ' + R.nDays(G.daysLeft)) +
            (G.paid > 0n ? '. Уже внесено ' + say(G.paid) : '') });
  }

  return {
    empty: false,
    today, lastDay,
    /* Шапка показывает дату словами, как в макете. */
    todayLabel: R.humanFull(today),
    alerts,
    navCounts: {
      overview: alerts.length + (R.daysBetween(lastDay, today) >= 2 ? 1 : 0) + verdict.problems.length,
      capital: verdict.problems.length + R.staleRecon(accounts, today).length },
    /* Счета, сверка которых старше двух недель: в подвале меню это
       «Требуется сверка», как в макете. */
    staleRecon: R.staleRecon(accounts, today).length,
    /* Сколько дней назад вносили последнюю операцию — экран скажет об
       этом сам, если пауза затянулась. */
    staleDays: R.daysBetween(lastDay, today),
    available: String(avail),
    dayLimit: limit === null ? null : String(limit),
    free: String(free),
    dueBefore: String(due),
    nextIncome: dl.nextIncome,
    daysToIncome: toIncome,
    limitDays: days,
    limitHorizon: horizon,
    reserve: String(reserve),
    spentYesterday: String(spentY),
    opsYesterday: opsY,
    catsYesterday: yCats.slice(0, 3),
    spentToday: String(spentToday),
    opsToday,
    rate7: String(rate7),
    /* Завтрашний лимит: свободное за вычетом сегодняшних трат, делённое
       на оставшиеся дни. Он выше сегодняшнего, если сегодня не тратили,
       и ниже, если тратили больше нормы — это и есть смысл показателя. */
    tomorrowLimit: (limit !== null && days > 1)
      ? String((free - spentToday) / BigInt(days - 1))
      : null,
    accounts: accounts.map(a => ({
      /* «—» — банк не указан: в подписи счёта прочерк не нужен. */
      id: a.id, name: a.name, bank: a.bank && a.bank !== '—' ? a.bank : '', type: a.type,
      isPayment: !!a.is_payment,
      balance: String(snap.bal[a.id] === undefined ? 0n : snap.bal[a.id]),
      /* Остаток в валюте счёта; balance — он же в рублях по курсу на сегодня. */
      native: String((snap.nat || snap.bal)[a.id] === undefined ? 0n : (snap.nat || snap.bal)[a.id]),
      cur: a.currency || 'RUB',
      creditLimit: a.credit_limit === null ? null : String(a.credit_limit),
      reconciledAt: a.reconciled_at,
    })),
    /* Дата последней сверки — самая свежая среди платёжных счетов. */
    reconciledAt: accounts.filter(a => a.is_payment && a.reconciled_at)
      .map(a => a.reconciled_at).sort().pop() || null,
    upcoming: up.slice(0, 40).map(u => ({
      day: u.day, name: u.name, amount: String(u.amount),
      dir: u.dir, category: u.category, obligatory: u.obligatory,
    })),
    startBalance: String(avail),
    rates,
    /* Экран обязан сказать, что именно вошло в темп, иначе число
       «средний день» ничего не значит. */
    ratesNote: 'без аренды, кредита, подписок и взносов — они учтены расписанием',
    recurringCats: Array.from(recurringCats),
    daily,
    events: eventsOut,
    table,
    tableDays: TABLE_DAYS,
    horizon: HORIZON,
    loan: String(hist[hist.length - 1].loan),
    problems: verdict.problems,
    warnings: verdict.warnings,
    counts: {
      transactions: rows.length,
      firstDay: hist[0].d,
    },
  };
}

module.exports = { build, allTransactions, techCategories };
