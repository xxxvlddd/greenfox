'use strict';
/* ============================================================
   НАСТРОЙКИ: ЗНАЧЕНИЯ ПО УМОЛЧАНИЮ И ПРАВИЛА
   ============================================================
   Настройки лежат в таблице settings строками. Здесь — значение по
   умолчанию для каждой и правило, что в неё можно записать. Экраны
   читают настройки только отсюда: значение по умолчанию живёт в одном
   месте, и неправильное значение в базу не попадает.

   Деньги — копейки строкой, как везде. Пороги трат — в рублях: так их
   вводит человек и так они подписаны на экранах.
   ============================================================ */
const DB = require('./db');

const DEFAULTS = {
  'ui.theme': 'system',             /* system | light | dark */
  'ui.density': 'normal',           /* normal | dense */
  'ui.startScreen': 'overview',
  'ui.weekStart': 'mon',            /* mon | sun */
  'ui.onboarded': '0',              /* мастер первого запуска пройден или пропущен */
  'calc.reserve': '0',              /* копейки */
  'calc.horizon': 'income',         /* income | 7 | 30 */
  'calc.levels': '1000/3000/5000/10000/30000',
  'calc.zones': '1/2',              /* месяцы: критично / тонко */
  'ai.model': '',
  'ai.access': 'suggest',           /* read | suggest | write */
  'ai.monthLimit': '5',             /* доллары */
  'ai.report': 'weekly',            /* off | weekly | monthly */
  'ai.comments': 'auto',            /* auto | manual | off */
  'data.backupEvery': 'daily',      /* daily | weekly | change */
  'data.backupKeep': '30',
  'upd.check': 'on',                /* on | off — раз в сутки спрашивать GitHub о новой версии */
};
const SCREENS = ['overview', 'expenses', 'capital', 'forecast', 'plans', 'calendar', 'payments'];

function fail(msg) { const e = new Error(msg); e.user = true; throw e; }

/* Число из поля: пробелы и запятая допустимы, как в окнах ввода. */
function num(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw).replace(/[\s ]/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
/* Рубли из поля — в копейки. Больше двух знаков после запятой не
   угадываем. */
function rubToCents(raw) {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(raw).replace(/[\s ]/g, '').replace(',', '.'));
  return m ? BigInt(m[1]) * 100n + BigInt(((m[2] || '') + '00').slice(0, 2)) : null;
}
const oneOf = (list, msg) => v => (list.includes(String(v)) ? String(v) : fail(msg));

const NORMALIZE = {
  'ui.theme': oneOf(['system', 'light', 'dark'], 'Тема: светлая, тёмная или системная'),
  'ui.density': oneOf(['normal', 'dense'], 'Плотность: обычная или плотная'),
  'ui.startScreen': oneOf(SCREENS, 'Экран при запуске: выберите из списка'),
  'ui.weekStart': oneOf(['mon', 'sun'], 'Первый день недели: понедельник или воскресенье'),
  'ui.onboarded': oneOf(['0', '1'], 'Мастер: пройден или нет'),
  'calc.reserve': v => {
    const c = String(v).trim() === '' ? 0n : rubToCents(v);
    if (c === null) fail('Резерв: сумма в рублях, например 20 000');
    if (c > 100000000000n) fail('Резерв: слишком большая сумма');
    return String(c);
  },
  'calc.horizon': oneOf(['income', '7', '30'], 'Горизонт: до поступления, 7 или 30 дней'),
  'calc.levels': v => {
    const p = String(v).split('/').map(num);
    if (p.length < 4 || p.length > 6 || p.some(x => !(x > 0) || !Number.isInteger(x)) ||
        p.some((x, i) => i > 0 && x <= p[i - 1])) {
      fail('Пороги: от 4 до 6 целых сумм по возрастанию через дробь, например 1000/3000/5000/10000/30000');
    }
    return p.join('/');
  },
  'calc.zones': v => {
    const p = String(v).split('/').map(num);
    if (p.length !== 2 || !(p[0] > 0) || !(p[1] > p[0]) || p[1] > 24) {
      fail('Зоны: два числа месяцев по возрастанию через дробь, например 1/2');
    }
    return p.join('/');
  },
  'ai.model': v => {
    const s = String(v || '').trim();
    if (s && !/^[a-z0-9._-]+\/[a-z0-9._:+-]+$/i.test(s)) fail('Модель: название вида «компания/модель», как на сайте OpenRouter');
    return s;
  },
  'ai.access': oneOf(['read', 'suggest', 'write'], 'Полномочия: выберите из списка'),
  'ai.monthLimit': v => {
    const n = num(v);
    if (!(n >= 0) || n > 10000) fail('Лимит: сумма в долларах, например 5');
    return String(n);
  },
  'ai.report': oneOf(['off', 'weekly', 'monthly'], 'Авто-отчёт: выберите из списка'),
  'ai.comments': oneOf(['auto', 'manual', 'off'], 'Комментарии: выберите из списка'),
  'data.backupEvery': oneOf(['daily', 'weekly', 'change'], 'Бэкап: ежедневно, еженедельно или при каждом изменении'),
  'upd.check': oneOf(['on', 'off'], 'Обновления: проверять или нет'),
  'data.backupKeep': v => {
    const n = num(v);
    if (!Number.isInteger(n) || n < 1 || n > 365) fail('Хранить копий: целое число от 1 до 365');
    return String(n);
  },
};

function get(db, key) { return DB.getSetting(db, key, DEFAULTS[key]); }
function all(db) {
  const o = {};
  for (const k of Object.keys(DEFAULTS)) o[k] = get(db, k);
  return o;
}
function set(db, key, raw) {
  if (!NORMALIZE[key]) fail('Неизвестная настройка: ' + key);
  const value = NORMALIZE[key](raw);
  const prev = get(db, key);
  DB.setSetting(db, key, value);
  return { ok: true, key, value, prev };
}

/* Для расчётов — уже числами. */
function reserve(db) { return BigInt(get(db, 'calc.reserve')); }
function levels(db) { return get(db, 'calc.levels').split('/').map(Number); }
function zones(db) { return get(db, 'calc.zones').split('/').map(Number); }

module.exports = { DEFAULTS, SCREENS, get, all, set, reserve, levels, zones, rubToCents };
