'use strict';
/* ============================================================
   МАСТЕР ПЕРВОГО ЗАПУСКА
   ============================================================
   По макету 12-onboarding.html: три шага — счета с остатками,
   категории, регулярные платежи. Списки заполнены заранее: человек
   правит, а не сочиняет. В макете в них стоят настоящие счета и
   суммы владельца — здесь нейтральные заготовки без сумм.

   Мастер работает, пока в учёте нет ни одной операции. Всё введённое
   записывается одной транзакцией: ошибка в любой строке — не записано
   ничего, а человеку сказано, на каком шаге и что поправить. Счета и
   платежи проходят те же проверки, что окна ввода (entry.js).

   Счета и платежи, которые уже заведены, мастер не переписывает: они
   показываются как есть, править их — в «Настройках». Новые
   добавляются рядом.
   ============================================================ */
const R = require('../core/report');
const prefs = require('./prefs');
const entry = require('./entry');
const fx = require('./fx');
const overview = require('./overview');

const SELF = 'Переводы между своими';
/* Закрытый список категорий по умолчанию. lock — без категории не
   обойтись: на продуктах, жилье и кредите держится расчёт свободных
   денег, «Прочее» — запасная полка для того, что никуда не подошло. */
const CATS = [
  ['Продукты', 'базовые', 'магазины и доставка продуктов', 1, 1],
  ['Транспорт', 'базовые', 'такси, общественный транспорт, бензин', 1, 0],
  ['Здоровье', 'базовые', 'врачи, лекарства, анализы', 1, 0],
  ['Хозтовары и бытовая химия', 'базовые', 'расходники для дома', 1, 0],
  ['Питомцы', 'базовые', 'корм, ветеринар, зоомагазин', 0, 0],
  ['Жильё и коммуналка', 'обязательные', 'аренда или ипотека, коммунальные платежи', 1, 1],
  ['Подписки и связь', 'обязательные', 'мобильная связь, интернет, подписки', 1, 0],
  ['Платежи по кредитам', 'обязательные', 'платежи по графику кредита', 1, 1],
  ['Кафе и рестораны', 'дискреционные', 'кафе, рестораны, доставка готовой еды', 1, 0],
  ['Маркетплейсы', 'дискреционные', 'Wildberries, Ozon, Яндекс Маркет', 1, 0],
  ['Одежда и быт', 'дискреционные', 'одежда, обувь, вещи для дома', 1, 0],
  ['Красота и уход', 'дискреционные', 'стрижка, косметика, процедуры', 1, 0],
  ['Путешествия', 'дискреционные', 'отели, дорога и траты в поездках', 1, 0],
  ['Развлечения и хобби', 'дискреционные', '', 1, 0],
  ['Подарки и праздники', 'дискреционные', 'подарки, цветы, праздники', 1, 0],
  ['Крупные покупки', 'дискреционные', 'разовые траты от 20 000 ₽', 1, 0],
  ['Образование', 'дискреционные', 'курсы, книги, обучение', 1, 0],
  ['Инвестиции', 'сбережения', 'пополнения брокерского счёта', 1, 0],
  ['Переводы другим людям', 'прочее', '', 1, 0],
  ['Прочее', 'прочее', 'то, что не подошло ни на одну полку', 1, 1],
].map(c => ({ name: c[0], type: c[1], note: c[2], on: !!c[3], lock: !!c[4] }));
/* Доходные — своей группой: каналов поступлений бывает больше, чем
   зарплата, — подработка, аренда, проценты. «Зарплата» с замком: на
   ней держатся заготовки шага 3. */
const INCOME = [
  ['Зарплата', 'доход', 'аванс и основная часть', 1, 1],
  ['Подработка и фриланс', 'доход', 'разовые заказы, совместительство', 1, 0],
  ['Бизнес', 'доход', 'доход от своего дела', 0, 0],
  ['Сдача в аренду', 'доход', 'квартира, машина, гараж, вещи', 0, 0],
  ['Проценты и дивиденды', 'доход', 'вклады, накопительные счета, акции', 1, 0],
  ['Кэшбек', 'доход', 'возврат по картам', 1, 0],
  ['Поступления от людей', 'доход', 'возвраты долгов и переводы от других людей', 1, 0],
  ['Прочие доходы', 'доход', 'то, что не подошло никуда', 1, 0],
].map(c => ({ name: c[0], type: c[1], note: c[2], on: !!c[3], lock: !!c[4] }));
/* Техническая — в мастере не показывается: перевод между своими счетами
   тратой не считается и выключать его нечего. */
const TECH = [[SELF, 'техническая', 'не участвует в расчёте расходов']];
const LOCKED = new Set(CATS.concat(INCOME).filter(c => c.lock).map(c => c.name));
const GROUPS = ['доход', 'базовые', 'обязательные', 'дискреционные', 'сбережения', 'прочее'];

/* Заготовки шага 1 и шага 3 — без сумм: суммы знает только человек. */
const ACCOUNTS = [
  { name: 'Основная карта', type: 'debit', isPay: true },
  { name: 'Наличные', type: 'cash', isPay: true },
];
const RECURRING = [
  { kind: 'in', name: 'Зарплата', cat: 'Зарплата' },
  { kind: 'in', name: 'Аванс', cat: 'Зарплата' },
  { kind: 'out', name: 'Аренда или ипотека', cat: 'Жильё и коммуналка' },
  { kind: 'out', name: 'Коммунальные платежи', cat: 'Жильё и коммуналка' },
  { kind: 'out', name: 'Платёж по кредиту', cat: 'Платежи по кредитам' },
  { kind: 'out', name: 'Мобильная связь', cat: 'Подписки и связь' },
  { kind: 'out', name: 'Домашний интернет', cat: 'Подписки и связь' },
];
const TYPE_KEY = { 'дебетовая карта': 'debit', 'кредитная карта': 'credit', 'текущий': 'current', 'наличные': 'cash',
                   'брокерский': 'broker', 'крипто': 'crypto' };

function fail(msg) { const e = new Error(msg); e.user = true; throw e; }
const opsCount = db => db.prepare('SELECT COUNT(*) n FROM transactions').get().n;

/* Что показать в мастере: заведённое — как есть, остальное — заготовки. */
function state(db, today) {
  const ops = opsCount(db);
  const accs = db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY sort_order').all();
  const catRows = db.prepare('SELECT * FROM categories').all();
  const have = {};
  for (const c of catRows) have[c.name] = c;
  const cats = catRows.length
    ? catRows.filter(c => GROUPS.includes(c.type)).sort((a, b) => a.sort_order - b.sort_order)
        .map(c => ({ name: c.name, type: c.type, on: !!c.active, lock: LOCKED.has(c.name), existing: true }))
    : INCOME.concat(CATS).map(c => Object.assign({}, c));
  const recs = db.prepare('SELECT * FROM recurring WHERE active = 1 ORDER BY direction, day_of_month').all()
    .filter(r => r.category !== SELF);
  return {
    available: ops === 0, ops, today,
    /* Сам предлагается при первом запуске: чистая база, мастер ещё не проходили. */
    auto: ops === 0 && !accs.length && prefs.get(db, 'ui.onboarded') !== '1',
    date: accs.map(a => a.start_date).sort()[0] || today,
    accounts: accs.length
      ? accs.map(a => ({ existing: true, id: a.id, name: a.name, type: TYPE_KEY[a.type] || 'current', cur: a.currency || 'RUB',
          bal: String(a.start_balance), isPay: !!a.is_payment, limit: a.credit_limit === null ? '' : String(a.credit_limit) }))
      : ACCOUNTS.map(a => Object.assign({ bal: '', cur: 'RUB' }, a)),
    /* Курсы ЦБ — итог слева пересчитывает доллары и евро в рубли. */
    fx: fx.forForms(db),
    cats, groups: GROUPS,
    recurring: recs.length
      ? recs.map(r => ({ existing: true, id: r.id, kind: r.direction === 'доход' ? 'in' : 'out', name: r.name, cat: r.category,
          day: r.day_of_month || '', amount: String(r.amount), on: true, period: r.period === 'year' ? 'y' : r.period === 'month' ? 'm' : r.period,
          month: r.month_of_year || '' }))
      : RECURRING.map(r => Object.assign({ day: '', amount: '', on: false, period: 'm', month: '' }, r)),
  };
}

/* Категории: заготовки, если справочник пуст, переключатели, свои. */
/* toggles — переключатели шага 2 (его могли пропустить); свои категории
   записываются всегда: их заводят и прямо у платежа на шаге 3. */
function applyCats(db, cats, toggles) {
  const empty = !db.prepare('SELECT COUNT(*) n FROM categories').get().n;
  const ins = db.prepare('INSERT OR IGNORE INTO categories(name,type,note,active,sort_order) VALUES(?,?,?,?,?)');
  let order = 0;
  if (empty) {
    for (const c of INCOME) ins.run(c.name, c.type, c.note, c.on ? 1 : 0, order++);
    for (const c of TECH) ins.run(c[0], c[1], c[2], 1, order++);
    for (const c of CATS) ins.run(c.name, c.type, c.note, c.on ? 1 : 0, order++);
  }
  for (const c of cats || []) {
    const name = String(c.name || '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const row = db.prepare('SELECT * FROM categories WHERE name = ?').get(name);
    if (row) {
      /* Замок — не выключается: на этих категориях держится расчёт. */
      if (toggles) db.prepare('UPDATE categories SET active = ? WHERE name = ?').run(LOCKED.has(name) || c.on ? 1 : 0, name);
    } else if (c.custom) {
      try { entry.addCategory(db, { name, type: GROUPS.includes(c.type) ? c.type : 'дискреционные', note: '' }); }
      catch (e) { if (e.user) fail('Категории: ' + e.message); throw e; }
      if (!c.on) db.prepare('UPDATE categories SET active = 0 WHERE name = ?').run(name);
    }
  }
}

/* Записать всё, что введено в мастере. p — { date, accounts, cats,
   recurring, steps: { s1, s2, s3 } } — шаги, которые человек прошёл,
   а не пропустил: пропущенный шаг не записывается. */
function apply(db, p, todayIso) {
  const today = todayIso || R.iso(new Date());
  if (opsCount(db)) fail('Мастер работает на чистой базе, а в учёте уже есть операции');
  const steps = (p && p.steps) || {};
  const date = p && p.date;
  if (steps.s1 && (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || date > today)) fail('Шаг 1: дата остатков — не позже сегодняшней');
  db.transaction(() => {
    /* Категории нужны всегда: без них не записать ни одной операции. */
    applyCats(db, p.cats, !!steps.s2);
    if (steps.s1) {
      /* Сначала платёжные: кредитке нужен счёт, с которого её гасят. */
      const fresh = (p.accounts || []).filter(a => !a.existing && (String(a.name || '').trim() || String(a.bal || '') !== ''));
      fresh.sort((a, b) => (a.type === 'credit') - (b.type === 'credit'));
      for (const a of fresh) {
        const name = String(a.name || '').trim();
        try {
          entry.saveAccount(db, { name, type: a.type, bal: a.bal === '' ? '0' : String(a.bal), balDate: date,
            isPay: !!a.isPay, limit: a.limit, graceDay: a.graceDay, bank: '', cur: a.type === 'credit' ? 'RUB' : (a.cur || 'RUB') }, today);
        } catch (e) { if (e.user) fail('Шаг 1, счёт «' + (name || 'без названия') + '»: ' + e.message); throw e; }
      }
    }
    if (steps.s3) {
      /* Суммы шага 3 — в рублях: платежи ложатся на рублёвый платёжный счёт. */
      const payer = db.prepare("SELECT id FROM accounts WHERE is_payment = 1 AND archived = 0 AND currency = 'RUB' ORDER BY sort_order").get();
      const fresh = (p.recurring || []).filter(r => !r.existing && r.on);
      /* Категорию, выбранную у платежа, включаем: выключенная не
         предлагается при вводе, а платёж по ней приходит каждый месяц. */
      for (const r of fresh) if (r.cat) db.prepare('UPDATE categories SET active = 1 WHERE name = ?').run(r.cat);
      if (fresh.length && !payer) {
        fail(db.prepare('SELECT 1 FROM accounts WHERE is_payment = 1 AND archived = 0').get()
          ? 'Шаг 3: суммы платежей — в рублях, а платёжные счета на шаге 1 все в валюте. Добавьте рублёвую карту или наличные'
          : 'Шаг 3: сначала нужен платёжный счёт — карта или наличные, на шаге 1');
      }
      for (const r of fresh) {
        const name = String(r.name || '').trim();
        try {
          /* Раз в год — с месяцем: годовая страховка или домен. */
          entry.saveRecurring(db, { name, type: r.kind === 'in' ? 'доход' : 'обязательный', cat: r.cat, amount: r.amount,
            fixed: true, every: r.period === 'y' ? 'y' : 'm', day: r.day, month: r.period === 'y' ? r.month : undefined,
            accId: payer.id }, today);
        } catch (e) { if (e.user) fail('Шаг 3, «' + (name || 'платёж без названия') + '»: ' + e.message); throw e; }
      }
    }
    prefs.set(db, 'ui.onboarded', '1');
  })();
  return { ok: true, result: summary(db, today) };
}

/* Первое настоящее число — тем же расчётом, что «Обзор». */
function summary(db, today) {
  const o = overview.build(db, today);
  if (o.empty) return { empty: true };
  return { available: o.available, dueBefore: o.dueBefore, free: o.free, dayLimit: o.dayLimit,
           nextIncome: o.nextIncome, daysToIncome: o.daysToIncome, limitDays: o.limitDays };
}

module.exports = { state, apply, summary, CATS, INCOME };
