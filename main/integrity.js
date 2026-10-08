'use strict';
/* ============================================================
   ПРОВЕРКА ЦЕЛОСТНОСТИ
   ============================================================
   Пересчитывает балансы с нуля и сверяет с тем, что человек
   подтвердил при сверке; ищет операции, которые ссылаются на чужие
   счета и категории или нарушают правила учёта; находит дни, когда
   некредитный счёт уходил в минус, — так обычно выглядит пропущенное
   поступление.

   Ошибка — то, что ломает расчёт; предупреждение — то, на что стоит
   посмотреть. Текст — для человека, суммы — с разрядами.
   ============================================================ */
const R = require('../core/report');
const M = require('../core/money');
const book = require('./book');
const fx = require('./fx');

const SELF = 'Переводы между своими';

function ddmm(iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4); }
/* Сумма в валюте счёта: «500,00 $». */
function sayIn(c, cur) { return M.say(c).replace(/\s₽$/, '\u00A0' + ((fx.CUR[cur] || fx.CUR.RUB).sym)); }
function some(list, n) {
  const shown = list.slice(0, n || 3).join(', ');
  return list.length > (n || 3) ? shown + ' и ещё ' + (list.length - (n || 3)) : shown;
}

function check(db, todayIso) {
  const today = todayIso || R.iso(new Date());
  const items = [];
  const err = text => items.push({ level: 'error', text });
  const warn = text => items.push({ level: 'warn', text });

  const accounts = db.prepare('SELECT * FROM accounts ORDER BY sort_order').all();
  const accById = {};
  for (const a of accounts) accById[a.id] = a;
  const cats = {};
  for (const c of db.prepare('SELECT * FROM categories').all()) cats[c.name] = c;
  const ops = db.prepare('SELECT * FROM transactions ORDER BY date, seq').all();
  const where = t => ddmm(t.date) + ' «' + (t.description || t.category) + '»';

  /* ── Ссылки ── */
  const lostAcc = ops.filter(t => (t.account_from && !accById[t.account_from]) || (t.account_to && !accById[t.account_to]));
  if (lostAcc.length) err('Операции ссылаются на счёт, которого нет в справочнике: ' + some(lostAcc.map(where)));
  const lostCat = ops.filter(t => !cats[t.category]);
  if (lostCat.length) err('Операции с категорией вне списка: ' + some(lostCat.map(where)));

  /* ── Правила учёта ── */
  const wrong = ops.filter(t => {
    const c = cats[t.category];
    if (!c) return false;
    if (t.direction === 'перевод') return t.category !== SELF || t.account_from === t.account_to;
    if (t.direction === 'расход') return c.type === 'доход' || c.type === 'техническая';
    return c.type !== 'доход' && c.name !== 'Прочее';
  });
  if (wrong.length) err('Направление не сходится с категорией или счетами: ' + some(wrong.map(where)));
  const future = ops.filter(t => t.date > today);
  if (future.length) warn('Операции с датой в будущем: ' + some(future.map(where)));

  /* ── Валютные счета: у каждой их стороны — своя сумма, и есть курс ── */
  const curOf = id => (id && accById[id] && accById[id].currency) || 'RUB';
  const noNative = ops.filter(t => (curOf(t.account_from) !== 'RUB' && t.amount_from === null) ||
                                   (curOf(t.account_to) !== 'RUB' && t.amount_to === null));
  if (noNative.length) err('Операции по валютному счёту без суммы в его валюте — остаток посчитан по курсу ЦБ: ' +
                           some(noNative.map(where)));
  const rate = fx.rateFn(db);
  const noRate = fx.inUse(db).filter(c => !rate(c, today));
  if (noRate.length) warn('Нет курса ' + noRate.join(' и ') + ' — валютные счета не входят в рублёвые суммы. ' +
                          'Обновите курсы или впишите вручную в «Настройках» → «Расчёты»');

  /* ── Пересчёт с нуля и сверка ── */
  const B = book.load(db);
  if (B.hist.length) {
    for (const a of accounts) {
      if (a.reconciled_balance === null || !a.reconciled_at) continue;
      /* Сверка — в валюте счёта. */
      const at = R.balanceOn(B.hist, a.reconciled_at);
      const got = (at.nat || at.bal)[a.id] || 0n;
      const want = BigInt(a.reconciled_balance);
      if (got !== want) {
        err('«' + a.name + '»: на ' + ddmm(a.reconciled_at) + ' расчёт даёт ' + sayIn(got, a.currency) + ', а при сверке было ' +
            sayIn(want, a.currency) + ' — разница ' + sayIn(got - want, a.currency));
      }
    }
    for (const l of db.prepare('SELECT * FROM liabilities WHERE reconciled_debt IS NOT NULL AND account_id IS NULL').all()) {
      if (!l.reconciled_at) continue;
      const got = R.balanceOn(B.hist, l.reconciled_at).loan;
      const want = BigInt(l.reconciled_debt);
      if (got !== want) {
        err('Кредит «' + l.creditor + '»: на ' + ddmm(l.reconciled_at) + ' расчёт даёт долг ' + M.say(got) +
            ', а при сверке было ' + M.say(want));
      }
    }
    /* Некредитный счёт в минусе — почти всегда пропущенное поступление
       или перевод, внесённый не тем счётом. */
    for (const a of accounts) {
      if (a.type === 'кредитная карта') continue;
      const neg = B.hist.filter(h => ((h.nat || h.bal)[a.id] || 0n) < 0n).map(h => h.d);
      if (neg.length) {
        warn('«' + a.name + '» уходил в минус ' + neg.length + ' ' + (neg.length === 1 ? 'раз' : neg.length < 5 ? 'раза' : 'раз') +
             ', впервые ' + ddmm(neg[0]) + ' — вероятно, не внесено поступление');
      }
    }
  }

  /* ── Справочники ── */
  const recBad = db.prepare('SELECT * FROM recurring WHERE active = 1').all().filter(r =>
    (r.account_id && (!accById[r.account_id] || accById[r.account_id].archived)) ||
    (r.category && (!cats[r.category] || !cats[r.category].active)));
  if (recBad.length) warn('Регулярные платежи ссылаются на счёт или категорию в архиве: ' +
                          some(recBad.map(r => '«' + r.name + '»')));
  const goalBad = db.prepare('SELECT * FROM savings_goals').all().filter(g =>
    g.account_id && (!accById[g.account_id] || accById[g.account_id].archived));
  if (goalBad.length) warn('Цели копятся на счёте в архиве: ' + some(goalBad.map(g => '«' + g.name + '»')));

  return {
    ok: !items.some(i => i.level === 'error'),
    checked: { ops: ops.length, accounts: accounts.length, cats: Object.keys(cats).length },
    items,
  };
}

module.exports = { check };
