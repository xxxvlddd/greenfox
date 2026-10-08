'use strict';
/* ============================================================
   ДАННЫЕ ДЛЯ ЭКРАНА «ОБЯЗАТЕЛЬНЫЕ ПЛАТЕЖИ»
   ============================================================
   Расписание регулярных платежей и поступлений: что сколько стоит в
   месяц и в год, прошёл ли платёж в этом цикле, как нагрузка ляжет на
   двенадцать месяцев вперёд. Источник — справочник регулярных платежей
   и операции текущего месяца.

   Деньги уходят в окно строками копеек.
   ============================================================ */
const L = require('../core/ledger');
const R = require('../core/report');
const { divHalfEven } = require('../core/money');
const overview = require('./overview');
const book = require('./book');
const expenses = require('./expenses');

const SELF = 'Переводы между своими';
/* Группы — в порядке макета. Цвет — точка в таблице и слой столбца. */
const GROUPS = [
  { id: 'home',  name: 'Жильё и коммуналка',           color: 'var(--cat-1)',  load: true },
  { id: 'loan',  name: 'Кредиты',                      color: 'var(--cat-2)',  load: true },
  { id: 'subs',  name: 'Подписки и связь',             color: 'var(--cat-3)',  load: true },
  { id: 'other', name: 'Прочие обязательные',          color: 'var(--cat-6)',  load: true },
  { id: 'inv',   name: 'Инвестиции и накопления',      color: 'var(--cat-5)',  load: false },
  { id: 'move',  name: 'Переводы и обслуживание карт', color: 'var(--cat-11)', load: false },
  { id: 'inc',   name: 'Доходы',                       color: 'var(--positive)', load: false },
];
const DOW_NAME = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

function pad(n) { return String(n).padStart(2, '0'); }
function ddmm(iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7); }
function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
/* Число месяца, не выходящее за его конец: 31-е в сентябре — это 30-е. */
function dayIn(y, m, day) {
  const last = new Date(y, m + 1, 0).getDate();
  return y + '-' + pad(m + 1) + '-' + pad(Math.min(day, last));
}

function groupOf(r, catType) {
  if (r.direction === 'доход') return 'inc';
  if (r.category === SELF || catType[r.category] === 'техническая') return 'move';
  if (catType[r.category] === 'сбережения' || r.category === 'Инвестиции') return 'inv';
  if (r.category === 'Платежи по кредитам') return 'loan';
  if (r.category === 'Жильё и коммуналка') return 'home';
  if (r.category === 'Подписки и связь') return 'subs';
  return 'other';
}
/* Приведение к месяцу: годовая делится на 12, недельная умножается на
   среднее число недель в месяце. Берём верхнюю границу суммы. */
function perMonth(every, hi) {
  if (every === 'y') return divHalfEven(hi, 12n);
  if (every === 'q') return divHalfEven(hi, 3n);
  if (every === 'w') return divHalfEven(hi * 52n, 12n);
  return hi;
}
function perYear(every, hi) { return every === 'y' ? hi : every === 'q' ? hi * 4n : perMonth(every, hi) * 12n; }

function build(db, todayIso) {
  const ov = overview.build(db, todayIso);
  if (ov.empty) return { empty: true };
  const today = ov.today;
  const [ty, tm, td] = today.split('-').map(Number);
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY sort_order').all();
  const accName = {};
  for (const a of accounts) accName[a.id] = a.name;
  const card = accounts.filter(a => a.type === 'кредитная карта')[0] || null;
  const catType = {};
  for (const c of db.prepare('SELECT name, type FROM categories').all()) catType[c.name] = c.type;
  const recurring = book.recurring(db, 'WHERE active = 1 ORDER BY id');
  const B = book.load(db);
  const rows = B.rows, hist = B.hist;
  const snap = R.balanceOn(hist, today);
  const monthStart = today.slice(0, 8) + '01';
  const monthOps = db.prepare('SELECT date, amount, amount_from, amount_to, direction, category, account_to FROM transactions ' +
                              'WHERE date BETWEEN ? AND ? ORDER BY date DESC, seq DESC').all(monthStart, today);

  /* Кредит: когда закроется — для подписи и для графика нагрузки. */
  const loanRow = db.prepare('SELECT * FROM liabilities WHERE account_id IS NULL').all()
    .filter(l => l.type !== 'кредитная карта')[0] || null;
  let loanEnd = null, loanLeft = null;
  if (loanRow && loanRow.monthly_payment && loanRow.payment_day && snap.loan > 0n) {
    const sch = R.loanSchedule(snap.loan, BigInt(loanRow.monthly_payment),
                               R.nextDayOfMonth(today, loanRow.payment_day), loanRow.payment_day, B.loanRate);
    if (sch && sch.n) { loanEnd = sch.dates[sch.n - 1]; loanLeft = sch.n; }
  }
  /* Сколько внесено на кредитку за текущий цикл грейса — у перевода
     «до грейса» это и есть его состояние. */
  let gracePaid = null, graceDue = null;
  const graceRule = recurring.filter(r => r.category === SELF && r.obligatory && r.day_of_month)[0];
  if (card && graceRule) {
    const cyc = R.graceCycle(today, graceRule.day_of_month);
    graceDue = cyc.due;
    gracePaid = 0n;
    for (const r of rows) if (r.to === card.id && r.d >= cyc.start && r.d <= today) gracePaid += r.a;
  }

  /* Какая операция месяца закрывает какой платёж. Сначала точные
     совпадения суммы, потом — с запасом в 10%: подписка в валюте
     списывается по курсу. Одна операция засчитывается одному платежу,
     иначе интернет за 510 ₽ «оплатил» бы и годовой сервис за 495 ₽. */
  const dowToday = ((new Date(ty, tm - 1, td).getDay() + 6) % 7) + 1;
  const weekFrom = R.addDays(today, -(dowToday - 1));
  const hits = {}, used = new Set();
  const cands = recurring.filter(r => {
    const g = groupOf(r, catType);
    return g !== 'move' && (r.period !== 'year' || r.month_of_year === tm) &&
      (r.period !== 'quarter' || !r.month_of_year || ((tm - r.month_of_year) % 3 + 3) % 3 === 0);
  });
  for (const exact of [true, false]) {
    for (const r of cands) {
      if (hits[r.id] !== undefined) continue;
      const dir = r.direction === 'доход' ? 'доход' : 'расход';
      let lo = BigInt(r.amount), hi = r.amount_max === null ? lo : BigInt(r.amount_max);
      /* Платёж в валюте — сравниваем в валюте: 20 $ — это 20 $ при любом
         курсе. Операция без своей суммы (с рублёвой карты) — в рублях. */
      const fxr = r.currency && r.currency !== 'RUB';
      const nlo = fxr ? BigInt(r.amount_native) : lo;
      const nhi = fxr ? BigInt(r.amount_max_native === null ? r.amount_native : r.amount_max_native) : hi;
      const from = r.period === 'week' ? weekFrom : monthStart;
      let best = -1, bestGap = null;
      monthOps.forEach((o, i) => {
        if (used.has(i) || o.direction !== dir || o.category !== r.category || o.date < from) return;
        const own = fxr ? (dir === 'доход' ? o.amount_to : o.amount_from) : null;
        const a = own !== null && own !== undefined ? BigInt(own) : BigInt(o.amount);
        if (own !== null && own !== undefined) { lo = nlo; hi = nhi; }
        else if (fxr) { lo = BigInt(r.amount); hi = r.amount_max === null ? lo : BigInt(r.amount_max); }
        const fits = exact ? (a >= lo && a <= hi) : (a * 10n >= lo * 9n && a * 10n <= hi * 11n);
        if (!fits) return;
        const gap = a > hi ? a - hi : a < lo ? lo - a : 0n;
        if (best < 0 || gap < bestGap) { best = i; bestGap = gap; }
      });
      if (best >= 0) { hits[r.id] = monthOps[best]; used.add(best); }
    }
  }

  const payments = recurring.map(r => {
    const g = groupOf(r, catType);
    const flow = r.direction === 'доход' ? 'in' : g === 'move' ? 'mov' : 'out';
    const every = r.period === 'year' ? 'y' : r.period === 'week' ? 'w' : r.period === 'quarter' ? 'q' : 'm';
    const lo = BigInt(r.amount), hi = r.amount_max === null ? lo : BigInt(r.amount_max);
    const voluntary = flow === 'out' && !r.obligatory;
    const note = String(r.note || '').trim();

    /* Когда — словами. */
    let when;
    if (every === 'w') when = 'неделя · ' + (DOW_NAME[r.day_of_week] || '—');
    else if (every === 'y') when = 'год · ' + (r.day_of_month && r.month_of_year
      ? r.day_of_month + ' ' + R.MON[r.month_of_year - 1] : '—');
    else if (every === 'q') when = 'квартал · ' + (r.day_of_month ? r.day_of_month + ' числа' : '—');
    else when = 'месяц · ' + (flow === 'mov' ? 'до ' : '') + (r.day_of_month ? r.day_of_month + ' числа' : '—');

    /* Состояние в этом цикле — по найденной выше операции. */
    const thisMonth = every === 'y' ? r.month_of_year === tm
      : every === 'q' ? !r.month_of_year || ((tm - r.month_of_year) % 3 + 3) % 3 === 0 : true;
    const hit = hits[r.id] || null;
    /* Состояние отдаём значениями, а фразу собирает окно: только там
       знают, какой пробел неразрывный. */
    let cycle, cstate;
    if (flow === 'mov') {
      cycle = gracePaid > 0n ? 'done' : 'wait';
      cstate = gracePaid > 0n ? { t: 'paid', sum: String(gracePaid) } : { t: 'until', date: graceDue || today };
    } else if (hit) {
      cycle = 'done';
      cstate = { t: flow === 'in' ? 'came' : voluntary ? 'put' : 'charged', date: hit.date };
    } else {
      const next = R.upcoming([r], today, 400)[0];
      const due = every === 'm' && r.day_of_month ? dayIn(ty, tm - 1, r.day_of_month) : (next ? next.day : null);
      if (!thisMonth) {
        cycle = 'wait'; cstate = { t: 'next', date: next ? next.day : null };
      } else if (due && due < today && !voluntary) {
        cycle = 'miss'; cstate = { t: flow === 'in' ? 'notCame' : 'notCharged', date: due };
      } else {
        cycle = 'wait'; cstate = { t: 'expected', date: due && due >= today ? due : (next ? next.day : today) };
      }
    }

    /* Подпись под названием: одно главное обстоятельство. */
    let sub = null;
    const pm = perMonth(every, hi);
    const accBal = r.account_id ? (snap.bal[r.account_id] || 0n) : null;
    const accIsCard = card && r.account_id === card.id;
    if (every === 'y') sub = { t: 'year', sum: String(pm) };
    else if (voluntary) sub = { t: 'vol' };
    else if (g === 'loan' && loanEnd) sub = { t: 'loan', end: loanEnd, left: loanLeft };
    else if (flow === 'out' && accBal !== null && !accIsCard && accBal < hi) sub = { t: 'short', sum: String(accBal) };
    else if (note && !/курс/i.test(note)) sub = { t: 'note', text: capFirst(note) };
    /* Платёж в валюте — в рублях он плавает вместе с курсом. */
    const fxr = r.currency && r.currency !== 'RUB';
    const float = r.amount_max !== null || /курс/i.test(note) || fxr;
    const floatNote = r.amount_max !== null || fxr ? null : capFirst(note);

    return {
      id: r.id, group: g, name: r.name, cat: r.category || '—', lo: String(lo), hi: String(hi), accId: r.account_id,
      every, when, flow, voluntary, float, floatNote, sub, thisMonth, cycle, cstate,
      acc: flow === 'mov' && card ? (accName[r.account_id] || '—') + ' → ' + card.name : (accName[r.account_id] || '—'),
      perMonth: String(pm), perYear: String(perYear(every, hi)),
      cur: r.currency || 'RUB',
      loNat: fxr ? String(r.amount_native) : null,
      hiNat: fxr ? String(r.amount_max_native === null ? r.amount_native : r.amount_max_native) : null,
      oblig: flow === 'out' && !voluntary,
      order: (every === 'm' ? 0 : every === 'w' ? 100 : every === 'q' ? 150 : 200) + (r.day_of_month || r.day_of_week || 0),
    };
  /* Внутри группы — по сроку, как в макете: месячные по числу, потом
     недельные, годовые в конце. */
  }).sort((a, b) => a.order - b.order);

  /* ── Показатели ── */
  const sum = (list, f) => list.reduce((s, x) => s + f(x), 0n);
  const oblig = payments.filter(p => p.oblig);
  const obligM = sum(oblig, p => BigInt(p.perMonth));
  const obligY = sum(oblig, p => BigInt(p.perYear));
  const yearlyOnce = sum(oblig.filter(p => p.every === 'y'), p => BigInt(p.hi));
  const incomeM = sum(payments.filter(p => p.flow === 'in'), p => BigInt(p.perMonth));
  const subs = payments.filter(p => p.group === 'subs');
  const nextOut = R.upcoming(recurring, R.addDays(today, 1), 62)
    .filter(u => u.dir !== 'доход' && u.obligatory && u.category !== SELF)[0] || null;

  /* ── Нагрузка на двенадцать месяцев вперёд от текущего ── */
  const load = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(ty, tm - 1 + i, 1);
    const y = d.getFullYear(), m = d.getMonth();
    const monthEnd = dayIn(y, m, 31), mStart = y + '-' + pad(m + 1) + '-01';
    const parts = GROUPS.filter(g => g.load).map(g => {
      let s = 0n;
      const names = [];
      for (const p of oblig.filter(x => x.group === g.id)) {
        if (g.id === 'loan' && loanEnd && mStart > loanEnd) continue;   /* кредит уже закрыт */
        const r = recurring.filter(x => x.id === p.id)[0];
        if (p.every === 'y') {
          if (r.month_of_year === m + 1) { s += BigInt(p.hi); names.push(p.name); }
        } else if (p.every === 'q') {
          if (!r.month_of_year || ((m + 1 - r.month_of_year) % 3 + 3) % 3 === 0) { s += BigInt(p.hi); names.push(p.name); }
        } else s += BigInt(p.perMonth);
      }
      return { group: g.id, sum: String(s), yearly: names };
    });
    load.push({ year: y, month: m, end: monthEnd, parts,
                total: String(parts.reduce((t, x) => t + BigInt(x.sum), 0n)) });
  }

  /* ── Вопросы: из заметок учёта, кроме закрытых ── */
  const resolved = new Set(db.prepare('SELECT key FROM resolved_questions').all().map(q => q.key));
  const questions = [];
  for (const p of db.prepare("SELECT * FROM planned WHERE status = 'bought'").all()) {
    const at = String(p.note || '').toLowerCase().indexOf('уточнить');
    if (at < 0) continue;
    questions.push({ key: 'plan:' + p.id, text: capFirst(String(p.note).slice(at).trim()) + '.',
      meta: 'из заметки к покупке «' + p.name + '»' + (p.bought_at ? ' · куплено ' + ddmm(p.bought_at) + '.' +
            p.bought_at.slice(0, 4) : '') });
  }
  for (const r of recurring) {
    if (!/уточн/i.test(String(r.note || ''))) continue;
    questions.push({ key: 'rec:' + r.id, text: 'Проверить на следующем цикле «' + r.name + '»: ' + String(r.note).trim() + '.',
      meta: 'из заметки к регулярному платежу' });
  }

  const nextIn = nextOut ? R.daysBetween(today, nextOut.day) : null;
  return {
    empty: false, today,
    headLabel: 'Расписание на ' + R.human(today) + ' ' + ty +
               (nextOut ? ' · ближайшее списание ' + (nextIn === 1 ? 'завтра' : 'через ' + R.nDays(nextIn)) : ''),
    groups: GROUPS,
    payments,
    metrics: {
      obligM: String(obligM), obligY: String(obligY), yearlyOnce: String(yearlyOnce), incomeM: String(incomeM),
      subsM: String(sum(subs, p => BigInt(p.perMonth))), subsCount: subs.length,
      subsFloat: subs.filter(p => p.float).length,
      next: nextOut ? { name: nextOut.name, day: nextOut.day, sum: String(nextOut.amount), inDays: nextIn,
                        acc: accName[nextOut.accountId] || '' } : null,
    },
    load, loanEnd, loanPay: loanRow && loanRow.monthly_payment ? String(loanRow.monthly_payment) : null,
    monthNames: expenses.MON_NOM,
    questions: questions.filter(q => !resolved.has(q.key)),
  };
}

/* Закрыть вопрос: запоминаем его ключ, сам вопрос больше не показывается. */
function resolveQuestion(db, key) {
  if (!/^(plan|rec):\d+$/.test(String(key))) throw new Error('неизвестный вопрос: ' + key);
  db.prepare('INSERT OR REPLACE INTO resolved_questions(key, resolved_at) VALUES(?, ?)')
    .run(key, new Date().toISOString());
  return { ok: true };
}

module.exports = { build, resolveQuestion, GROUPS };
