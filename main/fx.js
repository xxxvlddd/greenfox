'use strict';
/* ============================================================
   ВАЛЮТЫ И КУРСЫ
   ============================================================
   Счёт бывает в рублях, долларах или евро. Остаток валютного счёта
   живёт в его валюте: «500 $ в копилке» — это 500 долларов, а не
   рубли по курсу дня, когда их положили. В рубли он переводится только
   там, где деньги складываются: доступно на счетах, капитал, графики —
   по курсу ЦБ на тот день, за который считают.

   Курс хранится целым числом — рублей за единицу валюты, умноженных на
   10 000: 84,9057 ₽ за доллар = 849057. Так курс ЦБ (четыре знака после
   запятой) записывается без потерь, а пересчёт остаётся целочисленным,
   с тем же банковским округлением, что и всё остальное.

   Курсы берутся с сайта ЦБ — и только если в учёте есть валютный счёт:
   рублёвый учёт в сеть не ходит. В запросе — только даты, ни одной
   цифры учёта. Нет связи — расчёт идёт по последнему известному курсу;
   нет ни одного — курс можно вписать вручную в «Настройках».

   Сеть подменяется в проверках через useFetch().
   ============================================================ */
const M = require('../core/money');
const DB = require('./db');

const SCALE = 10000n;
const LIST = ['RUB', 'USD', 'EUR'];
const CUR = {
  RUB: { sym: '₽', name: 'рубль', label: 'Рубли' },
  USD: { sym: '$', name: 'доллар США', label: 'Доллары', cbr: 'R01235' },
  EUR: { sym: '€', name: 'евро', label: 'Евро', cbr: 'R01239' },
};
const TIMEOUT_MS = 15000;
const STALE_MS = 3 * 3600 * 1000;      /* чаще раза в три часа ЦБ не спрашиваем */

let fetchImpl = (...a) => fetch(...a);
function useFetch(f) { fetchImpl = f; }

function isCur(c) { return LIST.includes(c); }
function todayIso() {
  if (process.env.FINANCES_TODAY) return process.env.FINANCES_TODAY;
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* «84,9057» → 849057n. Четыре знака после запятой — столько даёт ЦБ;
   больше — не курс, а ошибка ввода. */
function parseRate(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw).trim().replace(/[\s ]/g, '').replace(',', '.');
  const m = /^(\d{1,6})(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return null;
  const v = BigInt(m[1]) * SCALE + BigInt(((m[2] || '') + '0000').slice(0, 4));
  return v > 0n ? v : null;
}
/* 849057n → «84,9057» */
function rateText(r) {
  const s = String(r).padStart(5, '0');
  return s.slice(0, -4) + ',' + s.slice(-4);
}

/* Сумма в валюте → рубли и обратно, в копейках и центах. */
function toRub(cents, rate) { return M.divHalfEven(BigInt(cents) * BigInt(rate), SCALE); }
function fromRub(cents, rate) { return M.divHalfEven(BigInt(cents) * SCALE, BigInt(rate)); }

/* Курсы из базы: по валюте — список [дата, курс] по возрастанию даты. */
function table(db) {
  const out = {};
  for (const r of db.prepare('SELECT date, currency, rate FROM fx_rates ORDER BY currency, date').all()) {
    (out[r.currency] = out[r.currency] || []).push([r.date, BigInt(r.rate)]);
  }
  return out;
}

/* Курс на день: последний известный не позже этого дня. Для дня раньше
   первого известного курса — первый известный: старую операцию лучше
   пересчитать по ближайшему курсу, чем не пересчитать вовсе. Без дня —
   курс на сегодня. Рубль — всегда 1. null — курса нет совсем. */
function rateFn(db) {
  const t = table(db);
  const today = todayIso();
  return (cur, day) => {
    if (!cur || cur === 'RUB') return SCALE;
    const list = t[cur];
    if (!list || !list.length) return null;
    const d = day || today;
    let lo = 0, hi = list.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid][0] <= d) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return list[found >= 0 ? found : 0][1];
  };
}

/* Из одной валюты в другую — через рубль. null — нужного курса нет. */
function convert(cents, from, to, rate, day) {
  if (from === to) return BigInt(cents);
  const a = rate(from, day), b = rate(to, day);
  if (!a || !b) return null;
  const rub = from === 'RUB' ? BigInt(cents) : toRub(cents, a);
  return to === 'RUB' ? rub : fromRub(rub, b);
}

/* Валюты, в которых есть счета, — для них и нужны курсы. */
function inUse(db) {
  return db.prepare("SELECT DISTINCT currency FROM accounts WHERE currency != 'RUB'").all()
    .map(r => r.currency).filter(c => isCur(c) && c !== 'RUB');
}

/* ---------- загрузка с сайта ЦБ ---------- */
const ruDate = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}

/* Ответ ЦБ: <Record Date="25.09.2026" …><Nominal>1</Nominal><Value>84,9057</Value>… */
function parseDynamic(xml) {
  const out = [];
  const re = /<Record Date="(\d\d)\.(\d\d)\.(\d{4})"[^>]*>\s*<Nominal>(\d+)<\/Nominal>\s*<Value>([\d,.]+)<\/Value>/g;
  let m;
  while ((m = re.exec(String(xml)))) {
    const value = parseRate(m[5]), nominal = BigInt(m[4]);
    if (!value || nominal <= 0n) continue;
    out.push({ date: m[3] + '-' + m[2] + '-' + m[1], rate: M.divHalfEven(value, nominal) });
  }
  return out;
}

async function fetchRange(cur, from, to) {
  const url = 'https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=' + ruDate(from) + '&date_req2=' + ruDate(to) +
              '&VAL_NM_RQ=' + CUR[cur].cbr;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (GREENFOX)' } });
    if (!res.ok) throw new Error('сайт ЦБ ответил ошибкой ' + res.status);
    return parseDynamic(await res.text());
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('сайт ЦБ не ответил за 15 секунд');
    throw new Error(/ошибкой/.test(e.message) ? e.message : 'нет связи с сайтом ЦБ');
  } finally { clearTimeout(timer); }
}

/* С какого дня нужны курсы: с самого раннего остатка или операции на
   валютном счёте, но не раньше чем за два года. И хотя бы за две недели:
   в выходные и праздники курса на сегодня нет — нужен последний
   установленный. */
function needFrom(db, cur, today) {
  const a = db.prepare('SELECT MIN(start_date) d FROM accounts WHERE currency = ?').get(cur).d;
  const t = db.prepare('SELECT MIN(t.date) d FROM transactions t JOIN accounts a ON a.id IN (t.account_from, t.account_to) ' +
                       'WHERE a.currency = ?').get(cur).d;
  const first = [a, t, addDays(today, -14)].filter(Boolean).sort()[0];
  const floor = addDays(today, -730);
  return first < floor ? floor : first;
}

let running = null;
/* Подтянуть курсы. Возвращает, сколько новых записей легло в базу.
   opts.force — по кнопке «Обновить»: не смотрим, когда спрашивали. */
function refresh(db, today, opts) {
  if (running) return running;
  running = run(db, today || todayIso(), opts || {}).finally(() => { running = null; });
  return running;
}
async function run(db, today, opts) {
  /* opts.curs — валюты, которые нужны ещё до появления счёта: мастер
     первого запуска пересчитывает остаток в долларах, пока счёт не записан. */
  const curs = inUse(db).concat((opts.curs || []).filter(c => isCur(c) && c !== 'RUB')).filter((c, i, a) => a.indexOf(c) === i);
  if (!curs.length) return { ok: true, added: 0, skipped: 'нет валютных счетов' };
  const last = Date.parse(DB.getSetting(db, 'fx.fetchedAt', '')) || 0;
  const t = table(db);
  /* История закрыта — новых курсов ждём не чаще раза в три часа: в
     выходные и праздники ЦБ курс не ставит, и «нет курса на сегодня» —
     не повод спрашивать снова. Счёт с остатком на более раннюю дату —
     история открыта, идём сразу. */
  /* Закрыта — значит, у ЦБ уже спрашивали с нужного дня: на выходной
     или праздник курса нет, и ждать его бесполезно. */
  const asked = c => DB.getSetting(db, 'fx.asked.' + c, '');
  const covered = curs.every(c => {
    const need = needFrom(db, c, today);
    return t[c] && t[c].length && (t[c][0][0] <= need || (asked(c) && asked(c) <= need));
  });
  if (!opts.force && covered && Date.now() - last < STALE_MS) return { ok: true, added: 0, skipped: 'курсы свежие' };
  const put = db.prepare("INSERT INTO fx_rates(date, currency, rate, source) VALUES(?,?,?,'cbr') " +
                         'ON CONFLICT(date, currency) DO UPDATE SET rate = excluded.rate, source = excluded.source');
  let added = 0;
  try {
    for (const cur of curs) {
      const have = db.prepare("SELECT MIN(date) lo, MAX(date) hi FROM fx_rates WHERE currency = ? AND source = 'cbr'").get(cur);
      const from = needFrom(db, cur, today);
      const ranges = [];
      /* ЦБ ставит курс на завтра уже сегодня — берём и его: в полночь он
         понадобится, а связи может не быть. */
      const askedFrom = DB.getSetting(db, 'fx.asked.' + cur, '');
      if (!have.lo) ranges.push([from, addDays(today, 1)]);
      else {
        if (from < have.lo && (!askedFrom || from < askedFrom)) ranges.push([from, addDays(have.lo, -1)]);
        ranges.push([addDays(have.hi, opts.force ? -7 : 0), addDays(today, 1)]);
      }
      for (const [a, b] of ranges) {
        if (a > b) continue;
        const rows = await fetchRange(cur, a, b);
        db.transaction(() => { for (const r of rows) { put.run(r.date, cur, String(r.rate)); added++; } })();
        const was = DB.getSetting(db, 'fx.asked.' + cur, '');
        if (!was || a < was) DB.setSetting(db, 'fx.asked.' + cur, a);
      }
    }
    /* Местное время, как у копий базы: его показывают человеку. */
    const n = new Date(), p2 = x => String(x).padStart(2, '0');
    DB.setSetting(db, 'fx.fetchedAt', n.getFullYear() + '-' + p2(n.getMonth() + 1) + '-' + p2(n.getDate()) + 'T' +
                  p2(n.getHours()) + ':' + p2(n.getMinutes()) + ':' + p2(n.getSeconds()));
    DB.setSetting(db, 'fx.error', '');
    return { ok: true, added };
  } catch (e) {
    DB.setSetting(db, 'fx.error', e.message);
    return { ok: false, added, error: e.message };
  }
}

/* Курс вручную — когда с ЦБ взять не получается. Ложится на сегодня и
   действует, пока не придёт курс ЦБ на более поздний день. */
function setManual(db, cur, raw, today) {
  if (!isCur(cur) || cur === 'RUB') { const e = new Error('Валюта: доллар или евро'); e.user = true; throw e; }
  const rate = parseRate(raw);
  if (!rate) { const e = new Error('Курс: число рублей за единицу, например 84,91'); e.user = true; throw e; }
  const day = today || todayIso();
  const prev = db.prepare('SELECT * FROM fx_rates WHERE date = ? AND currency = ?').get(day, cur);
  db.prepare("INSERT INTO fx_rates(date, currency, rate, source) VALUES(?,?,?,'manual') " +
             "ON CONFLICT(date, currency) DO UPDATE SET rate = excluded.rate, source = 'manual'").run(day, cur, String(rate));
  return { ok: true, prev };
}

/* Что показать в «Настройках»: курс на сегодня по каждой валюте счетов. */
function status(db, today) {
  const day = today || todayIso();
  const rows = inUse(db).map(cur => {
    const r = db.prepare('SELECT * FROM fx_rates WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1').get(cur, day) ||
              db.prepare('SELECT * FROM fx_rates WHERE currency = ? ORDER BY date LIMIT 1').get(cur);
    return { cur, sym: CUR[cur].sym, name: CUR[cur].name, rate: r ? String(r.rate) : null, text: r ? rateText(r.rate) : '',
             date: r ? r.date : null, manual: !!(r && r.source === 'manual') };
  });
  return { list: rows, fetchedAt: DB.getSetting(db, 'fx.fetchedAt', ''), error: DB.getSetting(db, 'fx.error', ''),
           busy: !!running };
}

/* Курсы для окон ввода: пересчёт подсказок прямо в окне, без запроса. */
function forForms(db) {
  const t = table(db), out = {};
  for (const c of Object.keys(t)) out[c] = t[c].map(([d, r]) => [d, String(r)]);
  return out;
}

module.exports = { SCALE, LIST, CUR, isCur, parseRate, rateText, toRub, fromRub, rateFn, convert, inUse, table,
                   parseDynamic, refresh, setManual, status, forForms, useFetch };
