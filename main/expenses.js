'use strict';
/* ============================================================
   ДАННЫЕ ДЛЯ ЭКРАНА «РАСХОДЫ»
   ============================================================
   Экран разбирает траты одного периода: структуру по категориям,
   крупнейшие покупки, привычки, дни. В макете все ряды были вписаны
   руками под август — здесь они считаются из операций для любого
   выбранного периода.

   Деньги уходят в интерфейс СТРОКАМИ КОПЕЕК, как и на «Обзоре»:
   BigInt через мост между процессами не проходит, а дробное число
   теряет копейку. Смешивать копейки и рубли в одном ответе нельзя.
   ============================================================ */
const R = require('../core/report');
const { divHalfEven } = require('../core/money');
const prefs = require('./prefs');

/* Пороги. В макете они помечены как настраиваемые — здесь лежат
   рядом, чтобы уехать в настройки одним куском. */
const ONE_OFF_FROM   = 500000n;   /* разовая покупка: ДОРОЖЕ 5 000 ₽, строго */
const OFTEN_FROM     = 8;         /* «часто»: от 8 операций за период */
const BIG_CHECK_FROM = 250000n;   /* «крупный чек»: средний от 2 500 ₽ */
const BARS_TAIL      = 60;        /* сколько дней держим для переключателя 14/30/60 */

const MON_NOM = ['январь','февраль','март','апрель','май','июнь',
                 'июль','август','сентябрь','октябрь','ноябрь','декабрь'];
/* «больше, чем в августе» — предложный падеж. Именительный из
   заголовка периода в эту фразу не подставляется. */
const MON_PRE = ['январе','феврале','марте','апреле','мае','июне',
                 'июле','августе','сентябре','октябре','ноябре','декабре'];
const TYPE_ORDER = ['базовые', 'обязательные', 'дискреционные', 'сбережения', 'прочее'];
const TYPE_NAME = { 'базовые':'Базовые', 'обязательные':'Обязательные',
                    'дискреционные':'Дискреционные', 'сбережения':'Сбережения',
                    'прочее':'Прочее' };

/* Метка на операции. Классы взяты из макета: спонтанное — тревожным
   цветом, запоздавшее и сомнительное — предупреждающим, остальное
   нейтрально. */
function tagOf(flag) {
  const f = String(flag || '');
  if (!f) return null;
  if (f.includes('спонтан')) return { text: 'спонтанно', cls: 'spont' };
  if (f.includes('поздн') || f.includes('уточн')) return { text: f, cls: 'late' };
  return { text: f, cls: 'reg' };
}

/* Короткая подпись категории — для оси Парето и мелких плиток.
   Отрезаем хвост после «и», «по» и тире: именно он делает название
   длинным, а не смысл. */
function shortName(name) {
  /* «Питомец — попугай» и «Питомец — собака» отличаются как раз тем,
     что стоит после тире, — берём хвост, а не голову. */
  const dash = String(name).split(' — ');
  let s = dash.length > 1 ? dash[dash.length - 1] : dash[0];
  s = s.split(' и ')[0].split(' по ')[0];
  if (s.length > 11) {
    s = s.split(' ')[0];
    if (s.length > 11) s = s.slice(0, 10) + '.';
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* «12 — 31 августа», а не «12 августа — 31 августа»: месяц в такой
   подписи повторять незачем. */
function rangeLabel(a, b) {
  if (a === b) return R.human(a);
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return sameMonth ? Number(a.slice(8, 10)) + ' — ' + R.human(b) : R.human(a) + ' — ' + R.human(b);
}

function lastDayOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function pad(n) { return String(n).padStart(2, '0'); }
function isoOf(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }

/* ── Период ──────────────────────────────────────────────────
   unit — день / месяц / полгода / год, offset — сколько шагов назад
   от текущего (0 — текущий, −1 — предыдущий). Границы всегда
   календарные: «месяц» — это месяц целиком, а не 30 дней назад. */
function periodRange(todayIso, unit, offset, custom) {
  const [y, m, d] = todayIso.split('-').map(Number);
  const off = offset || 0;
  if (unit === 'custom') {
    /* Произвольный отрезок. Стрелки двигают его на собственную длину:
       выбрали две недели — шаг ровно две недели назад. */
    const a = custom && custom.from, b = custom && custom.to;
    if (!a || !b) return { from: todayIso, to: todayIso };
    const len = R.daysBetween(a, b) + 1;
    return { from: R.addDays(a, off * len), to: R.addDays(b, off * len) };
  }
  if (unit === 'day') {
    const day = R.addDays(todayIso, off);
    return { from: day, to: day };
  }
  if (unit === 'year') {
    return { from: (y + off) + '-01-01', to: (y + off) + '-12-31' };
  }
  if (unit === 'half') {
    /* Полгода считаем скользящим окном из шести календарных месяцев,
       которое заканчивается текущим: «апрель — сентябрь». */
    const end = new Date(y, m - 1 + off * 6, 1);
    const start = new Date(end.getFullYear(), end.getMonth() - 5, 1);
    return {
      from: isoOf(start.getFullYear(), start.getMonth(), 1),
      to: isoOf(end.getFullYear(), end.getMonth(),
                lastDayOfMonth(end.getFullYear(), end.getMonth())),
    };
  }
  const base = new Date(y, m - 1 + off, 1);
  return {
    from: isoOf(base.getFullYear(), base.getMonth(), 1),
    to: isoOf(base.getFullYear(), base.getMonth(),
              lastDayOfMonth(base.getFullYear(), base.getMonth())),
  };
}

function periodName(unit, from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if (unit === 'custom') return from === to ? fd + ' ' + R.MON[fm - 1] + ' ' + fy
                                            : rangeLabel(from, to);
  if (unit === 'day') return fd + ' ' + R.MON[fm - 1] + ' ' + fy;
  if (unit === 'year') return fy + ' год';
  if (unit === 'half') {
    return MON_NOM[fm - 1] + ' — ' + MON_NOM[tm - 1] + (fy === ty ? ' ' + ty : ' ' + fy + '—' + ty);
  }
  return MON_NOM[fm - 1] + ' ' + fy;
}

/* Как назвать период внутри фразы «больше, чем …». */
function periodInName(unit, from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  if (unit === 'day') return fd + ' ' + R.MON[fm - 1];
  if (unit === 'year') return 'в ' + fy + ' году';
  if (unit === 'half') return 'в предыдущие полгода';
  if (unit === 'custom') return 'в предыдущий такой же отрезок';
  return 'в ' + MON_PRE[fm - 1] + ' ' + fy;
}

/* Все операции периода со всем, что нужно списку: описание целиком,
   счёт словами, метка. Через loadTransactions это не проходит —
   там описание уже сокращено, а флаг сведён к признаку спонтанности. */
function rowsOf(db) {
  return db.prepare(
    'SELECT date, amount, amount_from, amount_to, direction, account_from, account_to, category, ' +
    '       description, flag ' +
    'FROM transactions ORDER BY date DESC, seq DESC').all().map(r => ({
      d: r.date, a: BigInt(r.amount), dir: r.direction,
      from: r.account_from || '', to: r.account_to || '',
      c: r.category, desc: r.description, flag: r.flag,
      /* Суммы в валюте валютных счетов; у рублёвой стороны — null. */
      fa: r.amount_from === null ? null : BigInt(r.amount_from),
      ta: r.amount_to === null ? null : BigInt(r.amount_to),
    }));
}

function build(db, todayIso, query) {
  const q = query || {};
  const unit = q.unit || 'month';
  const offset = q.offset || 0;

  const rows = rowsOf(db);
  if (!rows.length) return { empty: true };

  const today = todayIso || R.iso(new Date());
  const tech = new Set(db.prepare("SELECT name FROM categories WHERE type = 'техническая'")
    .all().map(r => r.name));
  const catType = {};
  for (const c of db.prepare('SELECT name, type FROM categories').all()) catType[c.name] = c.type;
  const accName = {};
  const accCur = {};
  for (const a of db.prepare('SELECT id, name, currency FROM accounts').all()) { accName[a.id] = a.name; accCur[a.id] = a.currency || 'RUB'; }

  const isSpend = r => R.isSpending(r, tech);
  /* Цвет категории закрепляется по всей истории, а не по периоду:
     иначе при переключении месяца «Продукты» меняли бы цвет. */
  const colors = R.categoryColors(rows, isSpend);

  const firstDay = rows[rows.length - 1].d;
  const range = periodRange(today, unit, offset, q.custom);
  const from = range.from, to = range.to;
  /* Учёт начался позже начала месяца и не доходит до его конца —
     наблюдаемая часть периода короче календарной. */
  const obsFrom = from < firstDay ? firstDay : from;
  const obsTo = to > today ? today : to;
  const calendarDays = R.daysBetween(from, to) + 1;
  const trackedDays = obsTo < obsFrom ? 0 : R.daysBetween(obsFrom, obsTo) + 1;

  const inPeriod = rows.filter(r => r.d >= from && r.d <= to && isSpend(r));
  let total = 0n;
  for (const r of inPeriod) total += r.a;

  if (!inPeriod.length) {
    return {
      empty: false, noData: true,
      period: periodOut(unit, offset, from, to, today, trackedDays, calendarDays, 0, 0n,
                        trackedDays ? [obsFrom, obsTo] : null),
      firstDay,
    };
  }

  /* ── Категории ────────────────────────────────────────────── */
  const byCat = {};
  for (const r of inPeriod) {
    const c = (byCat[r.c] = byCat[r.c] || { sum: 0n, ops: 0 });
    c.sum += r.a; c.ops++;
  }
  const cats = Object.keys(byCat)
    .sort((a, b) => (byCat[b].sum > byCat[a].sum ? 1 : byCat[b].sum < byCat[a].sum ? -1 : 0))
    .map(name => ({
      name, short: shortName(name),
      type: catType[name] || 'прочее',
      sum: String(byCat[name].sum),
      ops: byCat[name].ops,
      avg: String(divHalfEven(byCat[name].sum, BigInt(byCat[name].ops))),
      color: colors[name] || 'var(--cat-12)',
    }));

  /* ── Типы категорий ───────────────────────────────────────── */
  const byType = {};
  for (const r of inPeriod) {
    const t = catType[r.c] || 'прочее';
    byType[t] = (byType[t] || 0n) + r.a;
  }
  const typeColor = {};
  for (const c of cats) if (!typeColor[c.type]) typeColor[c.type] = c.color;
  const types = TYPE_ORDER.filter(t => byType[t]).map(t => ({
    name: TYPE_NAME[t], key: t, sum: String(byType[t]),
    color: typeColor[t] || 'var(--cat-12)',
  }));

  /* Три доли для полосы в показателях. «Прочее» идёт к
     дискреционному: разовый перевод человеку — такое же решение,
     как покупка, а не обязательство. */
  const must = (byType['базовые'] || 0n) + (byType['обязательные'] || 0n);
  const want = (byType['дискреционные'] || 0n) + (byType['прочее'] || 0n);
  const save = byType['сбережения'] || 0n;
  const split = [
    { name: 'Обязательное',  sum: String(must), color: typeColor['базовые'] || 'var(--cat-1)' },
    { name: 'Дискреционное', sum: String(want), color: typeColor['дискреционные'] || 'var(--cat-6)' },
    { name: 'Сбережения',    sum: String(save), color: typeColor['сбережения'] || 'var(--cat-7)' },
  ].filter(s => s.sum !== '0');

  /* ── Топ-5 крупнейших операций ────────────────────────────── */
  const top5 = inPeriod.slice()
    .sort((a, b) => (b.a > a.a ? 1 : b.a < a.a ? -1 : 0))
    .slice(0, 5)
    .map(r => ({
      desc: r.desc, cat: r.c, color: colors[r.c] || 'var(--cat-12)',
      date: r.d.slice(8, 10) + '.' + r.d.slice(5, 7),
      acc: accName[r.from] || accName[r.to] || '—',
      sum: String(r.a),
    }));

  /* ── Дни ──────────────────────────────────────────────────── */
  const daily = R.dailySpend(rows, isSpend, obsFrom, obsTo, colors, String)
    .map(d => ({ iso: d.iso, date: d.date, dow: d.dow, full: d.full,
                 value: d.value, ops: d.ops, weekend: d.weekend, bd: d.bd, more: d.more }));
  /* Хвост для переключателя 14/30/60 дней — он всегда отсчитывается
     от сегодня, а не от границы периода. */
  const tailFrom = R.addDays(today, -(BARS_TAIL - 1));
  const dailyTail = R.dailySpend(rows, isSpend,
    tailFrom < firstDay ? firstDay : tailFrom, today, colors, String)
    .map(d => ({ iso: d.iso, date: d.date, dow: d.dow, full: d.full,
                 value: d.value, ops: d.ops, weekend: d.weekend, bd: d.bd, more: d.more }));

  /* ── Разовые покупки ──────────────────────────────────────── */
  /* Порог сравнивается строго: «свыше 5 000» — это дороже пяти тысяч,
     а ровно пять тысяч разовой покупкой не считаются. Иначе перевод
     члену семьи ровно на 5 000 ₽ попадал бы в «разовые» и занижал
     средний день. */
  const oneOffRows = inPeriod.filter(r => r.a > ONE_OFF_FROM);
  let oneOffSum = 0n;
  const oneOffs = {};
  for (const r of oneOffRows) {
    oneOffSum += r.a;
    oneOffs[r.d] = (oneOffs[r.d] || 0n) + r.a;
  }
  const oneOffsOut = {};
  for (const k of Object.keys(oneOffs)) oneOffsOut[k] = String(oneOffs[k]);

  /* ── Спонтанные ───────────────────────────────────────────── */
  const spontRows = inPeriod.filter(r => String(r.flag || '').includes('спонтан'));
  let spontSum = 0n;
  for (const r of spontRows) spontSum += r.a;

  const daysWithOps = daily.filter(d => d.value !== '0').length;
  const nDays = BigInt(Math.max(1, trackedDays));
  /* Средние округляем по-банковски, как и весь расчёт: усечение
     давало бы «1 535,61 ₽» там, где по деньгам ровно 1 535,62 ₽. */
  const avgDay = divHalfEven(total, nDays);
  const avgDayNet = divHalfEven(total - oneOffSum, nDays);

  /* Предыдущий такой же период — только сумма: показатель «всего»
     обязан сказать, больше это или меньше обычного, а не висеть
     голым числом. */
  const prevRange = periodRange(today, unit, offset - 1, q.custom);
  let prevSum = 0n, prevOps = 0;
  for (const r of rows) {
    if (r.d < prevRange.from || r.d > prevRange.to || !isSpend(r)) continue;
    prevSum += r.a; prevOps++;
  }

  /* ── Список операций ──────────────────────────────────────────
     Здесь уже не только траты: в списке живут фильтры по направлению,
     и доход с переводом обязаны быть видны. Показатели выше по-прежнему
     считаются только по расходам. */
  const allInPeriod = rows.filter(r => r.d >= from && r.d <= to);
  const opsRows = allInPeriod.map(r => ({
    date: r.d.slice(8, 10) + '.' + r.d.slice(5, 7),
    iso: r.d,
    desc: r.desc,
    cat: r.c,
    color: colors[r.c] || 'var(--cat-12)',
    dir: r.dir,
    /* У перевода два счёта: показываем оба, иначе строка врёт. */
    acc: r.dir === 'перевод'
      ? (accName[r.from] || '—') + ' → ' + (accName[r.to] || '—')
      : (accName[r.from] || accName[r.to] || '—'),
    accFrom: accName[r.from] || '',
    accTo: accName[r.to] || '',
    sum: String(r.a),
    /* Операция по валютному счёту: сумма в его валюте — рядом со счётом;
       в колонке суммы — рубли по курсу дня операции, как в итогах. */
    fx: accCur[r.from] && accCur[r.from] !== 'RUB' && r.fa !== null && r.fa !== undefined ? { sum: String(r.fa), cur: accCur[r.from] }
      : accCur[r.to] && accCur[r.to] !== 'RUB' && r.ta !== null && r.ta !== undefined ? { sum: String(r.ta), cur: accCur[r.to] } : null,
    tag: tagOf(r.flag),
    flag: r.flag || '',
  }));

  /* Наборы значений для выпадающих фильтров — ровно те, что есть в
     периоде: предлагать пустые варианты незачем. */
  const countBy = (list, key) => {
    const m = {};
    for (const o of list) { const k = key(o); if (k) m[k] = (m[k] || 0) + 1; }
    return Object.keys(m).sort((a, b) => m[b] - m[a] || a.localeCompare(b, 'ru'))
      .map(name => ({ name, n: m[name] }));
  };
  const filterOptions = {
    cats: countBy(opsRows, o => o.cat),
    accs: countBy(opsRows.reduce((a, o) => a.concat(
      o.dir === 'перевод' ? [{ x: o.accFrom }, { x: o.accTo }] : [{ x: o.acc }]), []), o => o.x),
    tags: countBy(opsRows, o => o.flag),
    dirs: countBy(opsRows, o => o.dir),
  };

  return {
    empty: false,
    noData: false,
    today, firstDay,
    levels: prefs.levels(db),
    period: periodOut(unit, offset, from, to, today, trackedDays, calendarDays,
                      inPeriod.length, total, [obsFrom, obsTo]),
    total: String(total),
    ops: inPeriod.length,
    trackedDays, daysWithOps,
    avgDay: String(avgDay),
    avgDayNet: String(avgDayNet),
    avgCheck: String(divHalfEven(total, BigInt(inPeriod.length))),
    oneOff: { sum: String(oneOffSum), count: oneOffRows.length, from: String(ONE_OFF_FROM) },
    spont: { sum: String(spontSum), count: spontRows.length },
    prev: { name: periodName(unit, prevRange.from, prevRange.to),
            inName: periodInName(unit, prevRange.from, prevRange.to),
            total: String(prevSum), ops: prevOps },
    split, cats, types, top5, daily, dailyTail,
    oneOffs: oneOffsOut,
    opsRows, filterOptions,
    opsTotal: allInPeriod.length,
    thresholds: { oftenFrom: OFTEN_FROM, bigCheckFrom: String(BIG_CHECK_FROM) },
  };
}

function periodOut(unit, offset, from, to, today, trackedDays, calendarDays, ops, total, obs) {
  return {
    unit, offset, from, to,
    name: periodName(unit, from, to),
    /* Вперёд дальше текущего периода ходить некуда: там пусто. */
    canNext: offset < 0,
    partial: trackedDays < calendarDays ? { tracked: trackedDays, calendar: calendarDays } : null,
    ops,
    /* Показываем наблюдаемый отрезок, а не календарные границы: в
       августе учёт начат 12-го, и «1 августа» ввело бы в заблуждение. */
    label: obs ? rangeLabel(obs[0], obs[1]) : rangeLabel(from, to),
    total: String(total),
  };
}

module.exports = { build, shortName, periodRange, MON_NOM, MON_PRE, ONE_OFF_FROM };
