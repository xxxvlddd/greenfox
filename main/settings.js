'use strict';
/* ============================================================
   ДАННЫЕ ДЛЯ ЭКРАНА «НАСТРОЙКИ»
   ============================================================
   Восемь разделов: общие, счета, категории, расчёты, регулярные
   платежи, ассистент, данные, о программе. Здесь только чтение:
   записывают prefs.js (настройки), entry.js (справочники) и главный
   процесс (ключ, папка, копии).

   Деньги — строками копеек; цвета счетов и категорий — те же, что на
   «Капитале» и «Расходах».
   ============================================================ */
const R = require('../core/report');
const book = require('./book');
const prefs = require('./prefs');
const overview = require('./overview');
const capital = require('./capital');
const entry = require('./entry');
const fx = require('./fx');
const grace = require('./grace');

const SELF = 'Переводы между своими';
const ACC_WORD = { 'дебетовая карта': 'дебетовая', 'кредитная карта': 'кредитная', 'наличные': 'наличные',
                   'брокерский': 'брокерский', 'крипто': 'криптокошелёк', 'текущий': 'текущий счёт', 'копилка': 'копилка' };
const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября',
                 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

/* «месяц · 5 числа», «год · 23 августа», «неделя · понедельник». */
function when(r) {
  if (r.period === 'week') return 'неделя · ' + WEEKDAYS[(r.day_of_week || 1) - 1];
  if (r.period === 'year') {
    return 'год · ' + (r.day_of_month || '?') + (r.month_of_year ? ' ' + MON_GEN[r.month_of_year - 1] : ' числа');
  }
  return (r.period === 'quarter' ? 'квартал' : 'месяц') + ' · ' + (r.day_of_month || '?') + ' числа';
}

/* Сколько ассистент стоил в этом месяце, в долларах. */
function aiSpent(db, todayIso) {
  const month = todayIso.slice(0, 7);
  const r = db.prepare("SELECT COALESCE(SUM(cost_micro), 0) s, COUNT(*) n FROM ai_usage WHERE substr(at, 1, 7) = ?")
    .get(month);
  return { usd: r.s / 1e6, requests: r.n };
}

function build(db, todayIso, ctx) {
  const today = todayIso || R.iso(new Date());
  const c = ctx || {};
  const P = prefs.all(db);
  const B = book.load(db);
  const snap = B.hist.length ? R.balanceOn(B.hist, today) : { bal: {}, loan: 0n };

  /* ── Счета ── */
  const accAll = db.prepare('SELECT * FROM accounts ORDER BY archived, sort_order').all();
  const color = capital.accountColors(accAll);
  const accOps = {};
  for (const t of db.prepare('SELECT account_from, account_to FROM transactions').all()) {
    if (t.account_from) accOps[t.account_from] = (accOps[t.account_from] || 0) + 1;
    if (t.account_to && t.account_to !== t.account_from) accOps[t.account_to] = (accOps[t.account_to] || 0) + 1;
  }
  const accounts = accAll.map(a => ({
    id: a.id, name: a.name, bank: a.bank && a.bank !== '—' ? a.bank : '', type: a.type,
    typeWord: ACC_WORD[a.type] || a.type, isPayment: !!a.is_payment, isCredit: a.type === 'кредитная карта',
    balance: String(snap.bal[a.id] || 0n), color: color[a.id], archived: !!a.archived, ops: accOps[a.id] || 0,
    native: String((snap.nat || snap.bal)[a.id] || 0n), cur: a.currency || 'RUB',
    limit: a.credit_limit === null ? null : String(a.credit_limit), graceNote: a.grace_note || '',
  }));

  /* ── Категории: служебная «Переводы между своими» в списке не
       показывается — её не правят. Цвет — как на «Расходах». ── */
  const isSpend = r => R.isSpending(r, overview.techCategories(db));
  const catColor = R.categoryColors(B.rows, isSpend);
  const use = {};
  for (const u of db.prepare('SELECT category, COUNT(*) n, SUM(amount) s FROM transactions GROUP BY category').all()) {
    use[u.category] = u;
  }
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all()
    .filter(x => x.type !== 'техническая')
    .map(x => ({ name: x.name, type: x.type, note: x.note || '', active: !!x.active,
                 ops: use[x.name] ? use[x.name].n : 0, sum: use[x.name] ? String(use[x.name].s) : '0',
                 color: catColor[x.name] || 'var(--border-strong)', system: entry.SYSTEM_CATS.has(x.name) }));

  /* ── Регулярные платежи: активные по сроку, на паузе — в конце ── */
  const accName = {};
  for (const a of accAll) accName[a.id] = a.name;
  /* Порядок — как в макете: сначала платежи, потом поступления; месячные
     — крупные выше, затем годовые и недельные. */
  const PERIOD_ORDER = { month: 0, quarter: 0, year: 1, week: 2 };
  const recurring = db.prepare('SELECT * FROM recurring').all()
    .sort((a, b) => (b.active - a.active) || ((a.direction === 'доход') - (b.direction === 'доход')) ||
                    (PERIOD_ORDER[a.period] - PERIOD_ORDER[b.period]) || (b.amount - a.amount))
    .map(r => ({ id: r.id, name: r.name, when: when(r), amount: String(r.amount),
                 amountTo: r.amount_max === null ? null : String(r.amount_max),
                 dir: r.direction, obligatory: !!r.obligatory, active: !!r.active,
                 self: r.category === SELF, acc: accName[r.account_id] || '' }));

  /* ── Расчёты ── */
  const ov = B.rows.length ? overview.build(db, today) : null;
  const loanRow = db.prepare("SELECT * FROM liabilities WHERE account_id IS NULL AND type != 'кредитная карта'").get();
  const card = accAll.filter(a => a.type === 'кредитная карта' && !a.archived)[0] || null;
  const graceRule = card ? entry.graceRuleFor(db, card) : null;
  const starts = accAll.map(a => a.start_date).filter(Boolean).sort();
  const calc = {
    startDate: starts[0] || null,
    reserve: P['calc.reserve'], horizon: P['calc.horizon'], levels: P['calc.levels'], zones: P['calc.zones'],
    /* Для предпросмотра лимита при наборе резерва: свободные без резерва
       и число дней горизонта. */
    limit: ov && ov.limitDays ? { free0: String(BigInt(ov.free) + BigInt(ov.reserve)), days: ov.limitDays,
                                  value: ov.dayLimit, nextIncome: ov.nextIncome } : null,
    loan: loanRow ? { creditor: loanRow.creditor, rateBp: loanRow.rate_bp } : null,
    card: card ? Object.assign({ name: card.name, limit: card.credit_limit === null ? null : String(card.credit_limit),
                   graceDay: graceRule ? graceRule.day_of_month : null, statementDay: card.statement_day || null },
                   /* Как приложение сейчас считает грейс — для подписи под полем. */
                   (() => {
                     const G = B.hist.length ? book.schedule(db, accAll.filter(a => !a.archived), B, today).grace : null;
                     return G ? { grace: grace.out(G), graceLeft: G.source === 'manual' ? String(G.left) : null } : {};
                   })()) : null,
    /* Курсы ЦБ по валютам счетов. */
    fx: fx.status(db, today),
  };

  /* ── Ассистент ── */
  const key = c.keyStatus || { hasKey: false, unreadable: false, masked: '' };
  let models = [];
  try { models = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'ai.models'").pluck().get() || '[]'); }
  catch (e) { models = []; }
  const spent = aiSpent(db, today);
  const ai = {
    hasKey: key.hasKey, unreadable: key.unreadable, masked: key.masked,
    keyInfo: c.keyInfo || null,
    model: P['ai.model'], models, modelsAt: db.prepare("SELECT value FROM settings WHERE key = 'ai.models.at'").pluck().get() || null,
    access: P['ai.access'], monthLimit: P['ai.monthLimit'], report: P['ai.report'], comments: P['ai.comments'],
    spent: spent.usd, requests: spent.requests,
  };

  /* ── Данные и о программе ── */
  const opsCount = db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
  const firstOp = db.prepare('SELECT MIN(date) d FROM transactions').get().d;
  return {
    today, prefs: P,
    accounts, categories, recurring, calc, ai,
    data: { dir: c.dataDir || '', isDefault: !!c.isDefaultDir, backupEvery: P['data.backupEvery'],
            backupKeep: P['data.backupKeep'], lastBackup: c.lastBackup || null, backups: c.backups || 0 },
    about: { version: c.version || '', ops: opsCount, firstDate: starts[0] || firstOp || null,
             lastBackup: c.lastBackup || null, update: c.update || null },
    counts: { accounts: accounts.filter(a => !a.archived).length,
              categories: categories.filter(x => x.active).length,
              recurring: recurring.filter(r => r.active).length },
  };
}

module.exports = { build, when };
