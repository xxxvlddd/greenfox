'use strict';
/* ============================================================
   ПОКАЗАТЕЛИ ДЛЯ ЭКРАНОВ
   ============================================================
   Всё, что видно на экранах, считается здесь — из операций и прогона.
   В интерфейс не попадает ни одного числа, вписанного руками.
   ============================================================ */
const { fmt, mulRate } = require('./money');

function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
}
function addDays(isoStr, n) {
  const [y, m, d] = isoStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return iso(dt);
}

/* Балансы на конец указанного дня. Если в этот день операций не было,
   берём последний день с операциями до него — баланс с тех пор не
   менялся. */
/* С валютными счетами — в рублях по курсу запрошенного дня, а не дня
   последней операции: доллары в копилке дешевеют и дорожают и без
   операций. nat — те же остатки в валюте счетов. */
function balanceOn(hist, day) {
  let found = null;
  for (const h of hist) { if (h.d <= day) found = h; else break; }
  if (!found) return { d: null, bal: {}, nat: {}, loan: 0n };
  if (hist.rubAt) return { d: found.d, bal: hist.rubAt(found.nat, day), nat: found.nat, loan: found.loan };
  return found;
}

/* Доступно на счетах: только платёжные. Копилка, брокерский и крипта
   деньгами «на сегодня» не считаются — иначе дневной лимит вырастет
   за счёт того, что тратить не собирались. */
function available(bal, accounts) {
  let sum = 0n;
  for (const a of accounts) {
    if (!a.is_payment || a.archived) continue;
    const v = bal[a.id];
    if (v === undefined) continue;
    /* Отрицательный остаток по кредитке — это долг, а не доступные
       деньги: в сумму доступного он не входит. */
    if (v > 0n) sum += v;
  }
  return sum;
}

/* Расход за день: операции, которые действительно уменьшают траты.
   Переводы между своими не считаются, вложения — считаются, потому
   что человек решил учитывать их как расход. */
function isSpending(r, techCategories) {
  if (r.dir !== 'расход') return false;
  return !techCategories.has(r.c);
}

function spentOn(rows, day, tech) {
  let s = 0n;
  for (const r of rows) if (r.d === day && isSpending(r, tech)) s += r.a;
  return s;
}

/* Ближайшие обязательные платежи и поступления по расписанию. */
function upcoming(recurring, fromDay, days) {
  const out = [];
  for (let i = 0; i <= days; i++) {
    const day = addDays(fromDay, i);
    const dom = Number(day.slice(8, 10));
    const mon = Number(day.slice(5, 7));
    for (const r of recurring) {
      if (!r.active) continue;
      let hit = false;
      if (r.period === 'month') hit = r.day_of_month === dom;
      else if (r.period === 'year') hit = r.day_of_month === dom && (!r.month_of_year || r.month_of_year === mon);
      /* Квартальный — раз в три месяца от месяца первого списания. */
      else if (r.period === 'quarter') hit = r.day_of_month === dom &&
        (!r.month_of_year || ((mon - r.month_of_year) % 3 + 3) % 3 === 0);
      else if (r.period === 'week') {
        const [y, m, d] = day.split('-').map(Number);
        const wd = ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1;   /* 1 — понедельник */
        hit = r.day_of_week === wd;
      }
      /* После даты окончания платёж больше не ждём. */
      if (hit && r.end_date && day > r.end_date) hit = false;
      /* Сумма бывает своя на каждый день: пополнение кредитки к ближайшему
         грейсу — сколько осталось внести (main/grace.js). */
      const amount = hit ? (r.amountOn ? BigInt(r.amountOn(day)) : BigInt(r.amount)) : 0n;
      /* Ноль — например, к грейсу уже всё внесено: события нет. */
      if (hit && amount > 0n) out.push({ day, name: r.name, amount, dir: r.direction,
                          category: r.category || '', accountId: r.account_id || '',
                          obligatory: !!r.obligatory });
    }
  }
  return out;
}

/* Сколько можно тратить в день: свободные деньги, делённые на число
   дней до ближайшего поступления. Свободные — это доступное минус то,
   что уже обещано другим до этого поступления, минус резерв.        */
/* Перевод между своими счетами деньги не уменьшает — он их
   перекладывает. Пополнение кредитки до грейса обязательно, но
   вычитать его из доступного нельзя: оно гасит долг, который в
   доступное и не входил. */
const SELF_TRANSFER = 'Переводы между своими';

function dayLimit(availCents, upcomingList, reserveCents) {
  const income = upcomingList.filter(u => u.dir === 'доход');
  const nextIncome = income.length ? income[0].day : null;
  const horizon = nextIncome
    ? upcomingList.filter(u => u.day <= nextIncome)
    : upcomingList;
  let due = 0n;
  for (const u of horizon) {
    if (u.dir === 'доход' || !u.obligatory) continue;
    if (u.category === SELF_TRANSFER) continue;
    if (nextIncome && u.day >= nextIncome) continue;   /* в день прихода денег уже не «до» */
    due += u.amount;
  }
  const free = availCents - due - (reserveCents || 0n);
  const days = nextIncome ? daysBetween(upcomingList.length ? upcomingList[0].day : null, nextIncome) : null;
  return { free, due, nextIncome, days };
}
function daysBetween(a, b) {
  if (!a || !b) return null;
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

module.exports = { iso, addDays, balanceOn, available, isSpending, spentOn,
                   upcoming, dayLimit, daysBetween, fmt };

/* ============================================================
   ТРАТЫ ПО ДНЯМ
   ============================================================
   В макете этот ряд был вписан руками. Здесь он собирается из
   операций: по дню на каждую календарную дату наблюдения, включая
   дни без трат — иначе среднее и медиана врут в большую сторону.
   ============================================================ */
var DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
var MON = ['января','февраля','марта','апреля','мая','июня',
           'июля','августа','сентября','октября','ноября','декабря'];

/* Цвет категории закрепляется по её доле в тратах: самая крупная
   получает первый цвет палитры. Так категория держит один цвет во
   всех графиках приложения. */
function categoryColors(rows, isSpend) {
  const total = {};
  for (const r of rows) {
    if (!isSpend(r)) continue;
    total[r.c] = (total[r.c] || 0n) + r.a;
  }
  const order = Object.keys(total).sort((a, b) => (total[b] > total[a] ? 1 : total[b] < total[a] ? -1 : 0));
  const map = {};
  order.forEach((name, i) => { map[name] = 'var(--cat-' + ((i % 12) + 1) + ')'; });
  return map;
}

function dailySpend(rows, isSpend, fromIso, toIso, colors, fmtMoney) {
  const byDay = {};
  for (const r of rows) {
    if (!isSpend(r) || r.d < fromIso || r.d > toIso) continue;
    const day = (byDay[r.d] = byDay[r.d] || { sum: 0n, ops: 0, cats: {} });
    day.sum += r.a;
    day.ops++;
    day.cats[r.c] = (day.cats[r.c] || 0n) + r.a;
  }
  const out = [];
  let cur = fromIso;
  while (cur <= toIso) {
    const [y, m, d] = cur.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const got = byDay[cur] || { sum: 0n, ops: 0, cats: {} };
    const bd = Object.keys(got.cats)
      .sort((a, b) => (got.cats[b] > got.cats[a] ? 1 : got.cats[b] < got.cats[a] ? -1 : 0))
      .slice(0, 4)
      .map(n => ({ n, s: fmtMoney(got.cats[n]), c: colors[n] || 'var(--cat-12)' }));
    const more = Object.keys(got.cats).length - bd.length;
    out.push({
      iso: cur,
      date: String(d).padStart(2, '0') + '.' + String(m).padStart(2, '0'),
      dow: DOW[dt.getDay()],
      full: d + ' ' + MON[m - 1] + ', ' + DOW[dt.getDay()],
      value: String(got.sum),
      ops: got.ops,
      weekend: dt.getDay() === 0 || dt.getDay() === 6,
      bd,
      more: more > 0 ? 'и ещё ' + more : '',
    });
    cur = addDays(cur, 1);
  }
  return out;
}

/* Три темпа расходования, которыми отличаются сценарии прогноза.
   Все три считаются по наблюдениям, а не назначаются.
   ============================================================
   Из темпа исключается всё, что уже описано расписанием регулярных
   платежей: аренда, кредит, подписки, взносы. Иначе прогноз вычитал
   бы квартплату дважды — один раз в составе среднего дня, второй раз
   отдельным событием 5-го числа. На этих данных двойной счёт давал
   лишние 1 200 ₽ в день.
   ============================================================ */
function spendRates(daily, rows, isSpend, leanTypes, catType, recurringCats) {
  const from = daily.length ? daily[0].iso : null;
  const to = daily.length ? daily[daily.length - 1].iso : null;
  const n = BigInt(Math.max(1, daily.length));

  /* Пересобираем дневные суммы без регулярных категорий. */
  const perDay = {};
  for (const d of daily) perDay[d.iso] = 0n;
  let leanSum = 0n;
  for (const r of rows) {
    if (!isSpend(r) || r.d < from || r.d > to) continue;
    if (recurringCats.has(r.c)) continue;
    perDay[r.d] = (perDay[r.d] || 0n) + r.a;
    if (leanTypes.has(catType[r.c])) leanSum += r.a;
  }
  const vals = Object.keys(perDay).map(k => perDay[k]);
  const sum = vals.reduce((a, v) => a + v, 0n);

  /* Свободный — средний день: редкая крупная покупка тянет его вверх,
     и это честно, потому что такие покупки случаются. */
  const free = sum / n;
  /* Обычный — медиана: один дорогой день не должен задирать прогноз. */
  const usual = medianCents(vals);
  /* Экономный — только то, без чего не прожить каждый день. */
  const lean = leanSum / n;
  /* Четверти — коридор прогноза: в какой полосе лежит половина дней. */
  const sorted = vals.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const at = q => (sorted.length ? sorted[Math.round(q * (sorted.length - 1))] : 0n);

  return { lean: String(lean), usual: String(usual), free: String(free),
           p25: String(at(0.25)), p75: String(at(0.75)) };
}

/* Медиана списка сумм в копейках. */
function medianCents(vals) {
  if (!vals.length) return 0n;
  const s = vals.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2n;
}

module.exports.categoryColors = categoryColors;
module.exports.dailySpend = dailySpend;
module.exports.spendRates = spendRates;
module.exports.medianCents = medianCents;
module.exports.DOW = DOW;
module.exports.MON = MON;

/* ---- даты словами ---- */
var WDAY = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
/* «2026-09-30» → «30 сентября» */
function human(iso){
  if (!iso) return '—';
  const p = iso.split('-');
  return Number(p[2]) + ' ' + MON[Number(p[1]) - 1];
}
/* «2026-09-30» → «Среда, 30 сентября 2026» */
function humanFull(iso){
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return WDAY[new Date(y, m - 1, d).getDay()] + ', ' + d + ' ' + MON[m - 1] + ' ' + y;
}
/* Начало расчётного цикла кредитки: последний прошедший день выписки. */
function cycleStart(todayIso, dayOfMonth){
  const [y, m, d] = todayIso.split('-').map(Number);
  const start = d > dayOfMonth ? new Date(y, m - 1, dayOfMonth) : new Date(y, m - 2, dayOfMonth);
  return iso(start);
}
module.exports.human = human;
module.exports.humanFull = humanFull;
module.exports.cycleStart = cycleStart;
module.exports.WDAY = WDAY;

/* Ближайшее наступление указанного числа месяца, начиная с завтра. */
function nextDayOfMonth(todayIso, dayOfMonth){
  const [y, m, d] = todayIso.split('-').map(Number);
  const dt = d < dayOfMonth ? new Date(y, m - 1, dayOfMonth) : new Date(y, m, dayOfMonth);
  return iso(dt);
}
module.exports.nextDayOfMonth = nextDayOfMonth;

function plural(n, one, few, many){
  var t = n % 100, o = n % 10;
  if (t >= 11 && t <= 14) return many;
  if (o === 1) return one;
  if (o >= 2 && o <= 4) return few;
  return many;
}
function nDays(n){ return n + ' ' + plural(n, 'день', 'дня', 'дней'); }
module.exports.plural = plural;
module.exports.nDays = nDays;

/* Счета, сверка которых старше двух недель. Нужны двум экранам:
   «Капиталу» — для предупреждения, меню — для счётчика. */
const STALE_DAYS = 14;
function staleRecon(accounts, todayIso){
  return accounts
    .filter(a => !a.archived && a.reconciled_at && daysBetween(a.reconciled_at, todayIso) > STALE_DAYS)
    .map(a => ({ id: a.id, name: a.name, days: daysBetween(a.reconciled_at, todayIso) }));
}
module.exports.staleRecon = staleRecon;
module.exports.STALE_DAYS = STALE_DAYS;

/* Цикл грейса кредитки: со дня после выписки по день выписки следующего
   месяца включительно — «с 22-го по 21-е», как сказано в макете.
   Пополнение в сам день выписки засчитывается закрывающемуся циклу.
   Один расчёт на все экраны: иначе «Обзор», «Капитал» и «Прогнозы»
   разошлись бы в сумме внесённого. */
function graceCycle(todayIso, day){
  const [y, m, d] = todayIso.split('-').map(Number);
  const due = d <= day ? new Date(y, m - 1, day) : new Date(y, m, day);
  const start = new Date(due.getFullYear(), due.getMonth() - 1, day + 1);
  return { start: iso(start), due: iso(due) };
}
module.exports.graceCycle = graceCycle;

/* График кредита от текущего остатка. Проценты начисляются при каждом
   платеже по той же ставке, что в прогоне; последний платёж закрывает
   остаток целиком. null — платёж не покрывает даже процентов. */
function loanSchedule(balance, pay, firstDate, payDay, rate){
  const rt = rate || { num: 0n, den: 1n };
  let b = balance, n = 0, full = 0, interest = 0n, total = 0n, last = 0n;
  let firstInt = 0n, firstPrin = 0n, d = firstDate;
  const pts = [b], dates = [];
  while (b > 0n && n < 600) {
    const i = mulRate(b, rt.num, rt.den);
    if (pay <= i) return null;
    let p = pay - i;
    if (p >= b) { p = b; last = b + i; total += last; }
    else { last = pay; total += pay; full++; }
    if (n === 0) { firstInt = i; firstPrin = p; }
    interest += i;
    b -= p;
    pts.push(b); dates.push(d); n++;
    d = nextDayOfMonth(d, payDay);
  }
  return { pts, dates, n, full, last, interest, total, firstInt, firstPrin };
}
module.exports.loanSchedule = loanSchedule;
