'use strict';
/* ============================================================
   ДАННЫЕ ДЛЯ ЭКРАНА «ПЛАНЫ»
   ============================================================
   Очередь покупок, купленное из неё и то, во что очередь обходится
   запасу прочности. Запас — тот же, что у «Капитала»; дни до нуля —
   тем же расчётом, что обычный темп на «Прогнозах»: экраны не должны
   называть разные числа для одного и того же.

   Метки нужности и срочности человек меняет прямо на карточке — это
   единственная запись, которую экран делает сам.
   ============================================================ */
const R = require('../core/report');
const L = require('../core/ledger');
const overview = require('./overview');
const book = require('./book');
const capital = require('./capital');
const prefs = require('./prefs');

const HORIZON = 30;
/* Тип категории — словом при названии категории: «дискреционная». */
const TYPE_ONE = { 'базовые': 'базовая', 'обязательные': 'обязательная', 'дискреционные': 'дискреционная',
                   'сбережения': 'сбережения', 'прочее': 'прочее' };

function build(db, todayIso) {
  const ov = overview.build(db, todayIso);
  if (ov.empty) return { empty: true };
  const today = ov.today;
  const accounts = db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY sort_order').all();
  const catType = {};
  for (const c of db.prepare('SELECT name, type FROM categories').all()) catType[c.name] = c.type;

  const B = book.load(db);
  const recurring = book.schedule(db, accounts, B, today).recurring;
  const rows = B.rows;
  const snap = R.balanceOn(B.hist, today);
  const base = capital.reserveBase(db, today, accounts, snap.bal);

  const items = db.prepare("SELECT * FROM planned WHERE status IN ('queue','bought') ORDER BY id").all()
    .map(p => ({
      id: p.id, name: p.name, min: String(p.price_min), max: String(p.price_max),
      need: p.need, urg: p.urgency, unsure: !!p.unsure, repl: !!p.replaceable,
      cat: p.category || '', type: TYPE_ONE[catType[p.category]] || '',
      saved: String(p.saved || 0), added: p.added, deadline: p.deadline, note: p.note || '',
      status: p.status, boughtAt: p.bought_at,
      boughtSum: p.bought_sum === null ? null : String(p.bought_sum),
      waited: p.added && p.bought_at ? R.daysBetween(p.added, p.bought_at) : null,
    }));

  const events = {};
  for (const k of Object.keys(ov.events)) if (Number(k) <= HORIZON) events[k] = ov.events[k].sum;
  const income = R.upcoming(recurring, R.addDays(today, 1), HORIZON).filter(u => u.dir === 'доход')[0] || null;

  return {
    empty: false, today,
    queue: items.filter(p => p.status === 'queue'),
    bought: items.filter(p => p.status === 'bought')
      .sort((a, b) => (a.boughtAt < b.boughtAt ? 1 : -1)),
    reserve: {
      liquid: String(base.liquid), monthly: String(base.avgDay * 30n), zones: prefs.zones(db),
      avail: ov.available, rate: ov.rates.usual, events, horizon: HORIZON,
      income: income ? { name: income.name, date: income.day, day: R.daysBetween(today, income.day) } : null,
    },
    firstDay: rows.length ? rows[0].d : today,
  };
}

/* Сменить метку позиции. Выбор нужности снимает пометку «не определено»:
   человек решил — решение и записываем. */
function setTag(db, id, axis, value) {
  const ok = axis === 'need' ? ['need', 'want'].includes(value)
           : axis === 'urg' ? ['hot', 'cold'].includes(value) : false;
  if (!ok) throw new Error('неизвестная метка: ' + axis + ' = ' + value);
  const res = axis === 'need'
    ? db.prepare("UPDATE planned SET need = ?, unsure = 0 WHERE id = ? AND status = 'queue'").run(value, id)
    : db.prepare("UPDATE planned SET urgency = ? WHERE id = ? AND status = 'queue'").run(value, id);
  if (res.changes !== 1) throw new Error('позиция не найдена в очереди: ' + id);
  return { ok: true };
}

module.exports = { build, setTag };
