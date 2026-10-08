'use strict';
/* ============================================================
   РАСЧЁТНОЕ ЯДРО
   ============================================================
   Главный принцип, унаследованный от build.py и нарушать который
   нельзя: баланс счёта — вычисляемая величина, а не хранимая. Он
   получается прогоном всех операций от стартового снимка. Справочник
   счетов и список долгов — не источник правды, а эталон для сверки.

   Соблазн положить баланс в колонку таблицы и обновлять его при вводе
   операции разрушил бы проверяемость: любая ошибка записи осталась бы
   незамеченной навсегда.
   ============================================================ */
const { parseAmount, fmt, mulRate, divHalfEven } = require('./money');

/* Короткая подпись: всё до первой открывающей скобки. */
function short(desc) {
  return String(desc || '').split(/\s+\(/)[0].trim();
}

/* Операции из уже разобранных строк CSV или строк таблицы. */
function loadTransactions(rows) {
  const out = rows
    .filter(r => r.date)
    .map((r, i) => ({
      i,                                   /* исходный порядок — для устойчивой сортировки */
      d: r.date,
      a: parseAmount(r.amount),
      dir: r.direction,
      from: r.account_from || '',
      to: r.account_to || '',
      c: r.category,
      t: short(r.description),
      imp: String(r.flag || '').includes('спонтанная'),
      inv: r.category === 'Инвестиции',
      /* Суммы в валюте валютных счетов; у рублёвой стороны — null. */
      fa: r.amount_from ? parseAmount(r.amount_from) : null,
      ta: r.amount_to ? parseAmount(r.amount_to) : null,
    }));
  /* Сортировка только по дате. Внутри дня порядок остаётся как в
     источнике — от него зависит расчёт процентов по кредиту, если в
     один день пройдёт больше одного платежа. */
  out.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : x.i - y.i));
  return out;
}

/* ── Стартовое состояние ────────────────────────────────────────
   Остаток каждого счёта на дату его снимка и долг по кредиту с месячной
   ставкой — из справочников базы: так в учёт попадают счета и кредит,
   заведённые формами. Без кредита ставка нулевая: процентов нет.      */
const NO_RATE = { num: 0n, den: 1n };
const EMPTY_START = { opening: {}, loan: null };

/* «0.0120833333» → дробь целых чисел: в двоичной плавающей точке такая
   ставка непредставима точно. */
function parseRate(s) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(s || '').trim());
  if (!m) return null;
  const frac = m[2] || '';
  return { num: BigInt(m[1] + frac), den: 10n ** BigInt(frac.length) };
}

/* Из справочников базы: счета со своим стартовым остатком и датой,
   кредит — первая запись о кредите с долгом на начало учёта. */
function startFrom(accounts, liabilities) {
  const opening = {};
  for (const a of accounts) opening[a.id] = { bal: BigInt(a.start_balance || 0), date: a.start_date || null };
  const l = (liabilities || []).filter(x => !x.account_id && x.type !== 'кредитная карта' &&
                                           x.start_debt !== null && x.start_debt !== undefined)[0];
  const loan = l ? { debt: BigInt(l.start_debt), date: l.start_date || null,
                     rate: parseRate(l.rate_month) ||
                           (l.rate_bp ? { num: BigInt(l.rate_bp), den: 120000n } : NO_RATE) } : null;
  return { opening, loan };
}

/* Состояние до первой операции — с этой точки начинается график
   капитала. Счета, заведённые позже, в него не входят. */
function startState(start) {
  const s = start || EMPTY_START;
  const first = s.first || null;
  const bal = {};
  for (const id of Object.keys(s.opening)) {
    const o = s.opening[id];
    if (!o.date || !first || o.date <= first) bal[id] = o.bal;
  }
  const loan = s.loan && (!s.loan.date || !first || s.loan.date <= first) ? s.loan.debt : 0n;
  return { bal, loan };
}

/* ── Валютные счета ──────────────────────────────────────────────
   fx — { cur: { id счёта: 'USD' }, rate: (валюта, день) → курс × 10 000 }.
   Прогон ведёт остаток каждого счёта в его валюте (nat), а bal — те же
   остатки в рублях по курсу дня: на bal стоят все экраны, им валюта не
   видна. Без валютных счетов bal и nat — один и тот же объект, и прогон
   ровно тот же, что был: на нём держится сходимость с build.py.      */
const SCALE = 10000n;
function rubAt(fx, nat, day) {
  const out = Object.assign({}, nat);
  for (const id of Object.keys(fx.cur)) {
    if (out[id] === undefined) continue;
    const k = fx.rate(fx.cur[id], day);
    /* Курса нет совсем — в рублёвых суммах этого счёта нет; экран
       настроек говорит, что курс нужно вписать. */
    out[id] = k ? divHalfEven(out[id] * k, SCALE) : 0n;
  }
  return out;
}
/* Сколько операция сняла со счёта или положила на него в его валюте.
   У валютной стороны без своей суммы (так быть не должно — сверка это
   ловит) — рублёвая сумма по курсу дня, а не рубли как доллары. */
function side(fx, id, own, rub, day) {
  if (!fx || !fx.cur[id]) return rub;
  if (own !== null && own !== undefined) return own;
  const k = fx.rate(fx.cur[id], day);
  return k ? divHalfEven(rub * SCALE, k) : 0n;
}

/* Прогон: балансы всех счетов и остаток кредита на конец каждого дня,
   в котором была операция или открылся счёт. */
function replay(rows, start, fxIn) {
  const s = start || EMPTY_START;
  const fx = fxIn && fxIn.cur && Object.keys(fxIn.cur).length ? fxIn : null;
  const dates = new Set(rows.map(r => r.d));
  for (const id of Object.keys(s.opening)) if (s.opening[id].date) dates.add(s.opening[id].date);
  const days = Array.from(dates).sort();
  const first = days[0] || null;
  const st = startState(Object.assign({}, s, { first }));
  const bal = st.bal;
  let loan = st.loan;
  const rate = s.loan ? s.loan.rate : NO_RATE;

  const hist = [];
  for (const day of days) {
    /* Счёт, заведённый позже начала учёта, появляется в день своего
       снимка — до него его остатка в капитале нет. */
    for (const id of Object.keys(s.opening)) {
      const o = s.opening[id];
      if (o.date && o.date === day && first && o.date > first) bal[id] = o.bal;
    }
    if (s.loan && s.loan.date && s.loan.date === day && first && s.loan.date > first) loan = s.loan.debt;
    for (const r of rows) {
      if (r.d !== day) continue;
      if (Object.prototype.hasOwnProperty.call(bal, r.from)) bal[r.from] -= side(fx, r.from, r.fa, r.a, day);
      if (Object.prototype.hasOwnProperty.call(bal, r.to)) bal[r.to] += side(fx, r.to, r.ta, r.a, day);
      /* Платёж по кредиту делится на проценты и тело долга. */
      if (r.c === 'Платежи по кредитам' && s.loan) {
        const interest = mulRate(loan, rate.num, rate.den);
        loan = loan - (r.a - interest);
      }
    }
    const nat = Object.assign({}, bal);
    hist.push({ d: day, bal: fx ? rubAt(fx, nat, day) : nat, nat, loan });
  }
  /* Остаток на любой день — в рублях по курсу этого дня (см. balanceOn). */
  if (fx) hist.rubAt = (nat, day) => rubAt(fx, nat, day);
  return hist;
}

/* Сверка расчёта со справочниками. Возвращает список расхождений —
   пустой список означает, что учёт сходится.                        */
/* opts — что известно о счетах помимо самих остатков: какие счета
   вообще есть (known) и какие из них кредитки с лимитом (cards). */
function check(rows, hist, accounts, liabilities, opts) {
  const o = opts || {};
  const known = o.known || new Set();
  const cards = o.cards || [];
  const problems = [];
  const warnings = [];
  if (!hist.length) return { problems: ['нет ни одной операции'], warnings };
  const final = hist[hist.length - 1].bal;
  const loan = hist[hist.length - 1].loan;

  /* Остаток на дату сверки, а не на сегодня: после сверки операции
     продолжают вноситься, и сравнение с концом истории давало бы
     ложное «не сходится». Без даты — как в build.py, на конец. */
  const at = day => {
    if (!day) return { bal: final, loan };
    let f = null;
    for (const h of hist) { if (h.d <= day) f = h; else break; }
    return f || { bal: {}, loan: 0n };
  };
  for (const a of accounts) {
    /* Сверенный остаток валютного счёта — в его валюте. */
    const snapA = at(a.at);
    const got = (snapA.nat || snapA.bal)[a.id];
    const want = parseAmount(a.balance);
    if (got === undefined) {
      problems.push(`счёт ${a.id} есть в справочнике, но нет в расчёте`);
    } else if (got - want > 1n || want - got > 1n) {
      problems.push(`${a.id}: расчёт ${fmt(got)}, в справочнике ${fmt(want)} (Δ ${fmt(got - want)})`);
    }
  }

  for (const l of liabilities) {
    const want = parseAmount(l.current_debt);
    /* Долг по кредитке — минус остатка её счёта, остальное — кредит. */
    const accId = l.account_id !== undefined ? l.account_id
      : (l.type === 'кредитная карта' ? cards[0] && cards[0].id : null);
    const snap = at(l.at);
    const got = accId ? -(snap.bal[accId] || 0n) : snap.loan;
    if (got - want > 1n || want - got > 1n) {
      problems.push(`${l.id}: расчёт ${fmt(got)}, в справочнике ${fmt(want)} (Δ ${fmt(got - want)})`);
    }
  }

  /* Долг по кредитке физически не может превысить лимит: если превысил,
     скорее всего пропущено пополнение. Это предупреждение, а не отказ. */
  for (const c of cards) {
    if (c.limit === null || c.limit === undefined) continue;
    const over = -(final[c.id] || 0n) - c.limit;
    if (over > 1n) {
      warnings.push(`долг по кредитке превышает лимит на ${fmt(over)} ₽ — вероятно, пропущено пополнение`);
    }
  }

  const seen = new Set();
  for (const r of rows) { if (r.from) seen.add(r.from); if (r.to) seen.add(r.to); }
  for (const a of seen) {
    if (!known.has(a)) {
      problems.push(`неизвестный счёт в операциях: ${a}`);
    }
  }

  for (const r of rows) {
    if (r.dir === 'расход' && !r.from) problems.push(`${r.d} ${r.t}: расход без счёта списания`);
    if (r.dir === 'перевод' && !(r.from && r.to)) problems.push(`${r.d} ${r.t}: перевод без обоих счетов`);
    if (r.dir === 'доход' && !r.to) problems.push(`${r.d} ${r.t}: доход без счёта зачисления`);
  }
  return { problems, warnings };
}

module.exports = { short, loadTransactions, startState, startFrom, parseRate, replay, check, rubAt, NO_RATE };
