'use strict';
/* ============================================================
   ГРЕЙС КРЕДИТКИ — один расчёт для всех экранов
   ============================================================
   Беспроцентный период держится, если до дня грейса внесена сумма по
   выписке. Сколько это, приложение узнаёт так — по порядку:

   1. Человек сам сказал, сколько осталось внести (мастер первого запуска,
      окно счёта, «Настройки» → «Расчёты»): «на 8 октября до грейса
      осталось 37 433 ₽». Это действует для того цикла, к которому сказано.
   2. Известен день выписки: нужно внести долг на конец дня выписки.
   3. Иначе — долг на начало цикла (день после прошлого дня грейса).

   Из нужного вычитается внесённое на карту с начала цикла (для суммы,
   сказанной человеком, — с того дня, когда он её сказал).

   Пополнение кредитки по расписанию в графиках и предупреждениях берётся
   не лимитом карты, а тем, что действительно осталось внести.
   ============================================================ */
const R = require('../core/report');

const SELF = 'Переводы между своими';

/* Правило грейса живёт в расписании переводом «на кредитку до N числа». */
function ruleOf(recurring) {
  return recurring.filter(r => r.active !== 0 && r.category === SELF && r.obligatory && r.day_of_month)[0] || null;
}
function cardOf(accounts) {
  return accounts.filter(a => a.type === 'кредитная карта' && !a.archived)[0] || null;
}
/* День выписки, после которого наступает этот день грейса: тот же месяц,
   если выписка раньше дня грейса, иначе прошлый. */
function statementBefore(due, day) {
  const [y, m] = due.split('-').map(Number);
  let d = new Date(y, m - 1, day);
  if (R.iso(d) >= due) d = new Date(y, m - 2, day);
  return R.iso(d);
}

/* accounts, recurring — как у экрана; B — общий прогон (book.load). */
function state(accounts, recurring, B, today) {
  const card = cardOf(accounts), rule = ruleOf(recurring);
  if (!card || !rule || !B || !B.hist.length) return null;
  const cyc = R.graceCycle(today, rule.day_of_month);
  const due = cyc.due;
  const debtOn = day => { const v = R.balanceOn(B.hist, day).bal[card.id] || 0n; return v < 0n ? -v : 0n; };
  const debt = debtOn(today);
  let need, from, source, statement = null;
  if (card.grace_need !== null && card.grace_need !== undefined && card.grace_need_due === due && card.grace_need_at) {
    need = BigInt(card.grace_need); from = card.grace_need_at; source = 'manual';
  } else if (card.statement_day) {
    statement = statementBefore(due, card.statement_day);
    need = debtOn(statement); from = R.addDays(statement, 1); source = 'statement';
  } else {
    need = debtOn(R.addDays(cyc.start, -1)); from = cyc.start; source = 'cycle';
  }
  const ops = B.rows.filter(r => r.to === card.id && r.d >= from && r.d <= today);
  let paid = 0n;
  for (const r of ops) paid += r.a;
  const left = need > paid ? need - paid : 0n;
  return {
    card, cardId: card.id, rule, ruleId: rule.id, graceDay: rule.day_of_month, statementDay: card.statement_day || null,
    start: from, cycleStart: cyc.start, due, statement, source,
    need, paid, left, debt, ops,
    daysLeft: R.daysBetween(today, due),
    limit: card.credit_limit === null ? null : BigInt(card.credit_limit),
  };
}

/* Расписание с настоящей суммой пополнения кредитки: ближайший день
   грейса — сколько осталось внести, следующие — новый долг сверх этого
   (то, что попадёт в следующую выписку). */
function applyTo(recurring, g) {
  if (!g) return recurring;
  const later = g.debt > g.left ? g.debt - g.left : 0n;
  return recurring.map(r => {
    if (r.id !== g.ruleId) return r;
    return Object.assign({}, r, { amount: Number(g.left), amountOn: day => (day === g.due ? g.left : later) });
  });
}

/* Строкой для окна: копейки строками. */
function out(g) {
  if (!g) return null;
  return { cardId: g.cardId, start: g.start, cycleStart: g.cycleStart, due: g.due, statement: g.statement, source: g.source,
    graceDay: g.graceDay, statementDay: g.statementDay, daysLeft: g.daysLeft,
    need: String(g.need), paid: String(g.paid), left: String(g.left), debt: String(g.debt),
    limit: g.limit === null ? null : String(g.limit) };
}

module.exports = { state, applyTo, out, ruleOf, cardOf, statementBefore, SELF };
