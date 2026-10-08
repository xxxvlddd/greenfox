'use strict';
/* ============================================================
   БАЗА
   ============================================================
   Открывает файл базы, накатывает схему и хранит версию схемы в
   таблице настроек. Всё остальное приложение обращается к данным
   только отсюда: одна точка входа означает, что запись деньгами мимо
   проверок невозможна.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 8;

function open(Database, file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(file);
  /* Журнал с опережающей записью: падение приложения посреди записи
     не оставит базу в половинчатом состоянии. */
  db.pragma('journal_mode = WAL');
  /* Внешние ключи в SQLite по умолчанию выключены — включаем, иначе
     операция может сослаться на несуществующий счёт. */
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

function getSetting(db, key, fallback) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ' +
             'ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

/* Колонки, которых не было в первой версии схемы. Новая база получает
   их сразу из schema.sql, старая — здесь. Проверяем по факту, а не по
   номеру версии: так шаг безопасно повторить. */
const ADDED_COLUMNS = {
  liabilities: [
    ['rate_month', 'TEXT'],
    ['initial_amount', 'INTEGER'],
  ],
  recurring: [
    ['end_date', 'TEXT'],
  ],
  transactions: [
    ['amount_from', 'INTEGER'],
    ['amount_to', 'INTEGER'],
  ],
  savings_goals: [
    ['monthly', 'INTEGER'],
  ],
  planned: [
    ['category', "TEXT NOT NULL DEFAULT ''"],
    ['replaceable', 'INTEGER NOT NULL DEFAULT 0'],
    ['added', 'TEXT'],
    ['recurring_cost', 'INTEGER NOT NULL DEFAULT 0'],
  ],
};

function migrate(db) {
  const was = Number(getSetting(db, 'schema_version', '0'));
  if (was === SCHEMA_VERSION) return;
  /* 1 → 2: у плана покупок появились категория, «есть чем заменить»,
     дата добавления и стоимость владения.
     2 → 3: заметки к дням календаря — таблицу создаёт schema.sql при
     каждом открытии, здесь переносить нечего.
     3 → 4: отметки «Решено» у вопросов к платежам — так же.
     4 → 5: стартовое состояние учёта переехало из кода в базу. У кредита
     появились точная месячная ставка и сумма при выдаче, у регулярного
     платежа — дата окончания, у цели — плановый взнос.
     5 → 6: комментарии ассистента на экранах и авто-отчёты — таблицы
     создаёт schema.sql, переносить нечего.
     6 → 7: валютные счета. У операции — суммы в валюте счетов списания и
     зачисления, курсы ЦБ — своей таблицей. Все прежние счета рублёвые,
     переносить нечего.
     7 → 8: поправка «до первого снимка» переехала из кода в данные. Трата
     в день открытия счёта, прошедшая до снимка его остатка, этим
     остатком уже учтена; раньше её возвращали при каждом расчёте по
     списку в коде, теперь стартовый остаток — на начало того дня. */
  for (const table of Object.keys(ADDED_COLUMNS)) {
    const have = new Set(db.prepare('PRAGMA table_info(' + table + ')').all().map(c => c.name));
    for (const [name, def] of ADDED_COLUMNS[table]) {
      if (!have.has(name)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + name + ' ' + def);
    }
  }
  if (was < 5) {
    /* Долг из таблиц подтверждён в тот же день, что и счета. Без даты его
       сравнивали бы с концом истории, а не с днём сверки. */
    db.prepare('UPDATE liabilities SET reconciled_at = (SELECT MAX(reconciled_at) FROM accounts) ' +
               'WHERE reconciled_at IS NULL AND reconciled_debt IS NOT NULL').run();
  }
  /* Такие траты помечены в описании словами «до первого снимка». */
  if (was > 0 && was < 8) {
    const pre = db.prepare("SELECT account_from a, account_to b, amount FROM transactions t WHERE description LIKE '%до первого снимка%' " +
      'AND date = (SELECT start_date FROM accounts WHERE id = COALESCE(t.account_from, t.account_to))').all();
    const fix = db.prepare('UPDATE accounts SET start_balance = start_balance + ? WHERE id = ?');
    db.transaction(() => {
      for (const p of pre) {
        if (p.a) fix.run(p.amount, p.a);
        else if (p.b) fix.run(-p.amount, p.b);
      }
    })();
  }
  setSetting(db, 'schema_version', SCHEMA_VERSION);
}

function isEmpty(db) {
  return db.prepare('SELECT COUNT(*) n FROM transactions').get().n === 0;
}

module.exports = { open, migrate, getSetting, setSetting, isEmpty, SCHEMA_VERSION };
