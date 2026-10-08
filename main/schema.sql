-- ============================================================
--  СХЕМА БАЗЫ
-- ============================================================
--  Главный принцип: баланс счёта нигде не хранится как текущее
--  значение. Он получается прогоном операций от стартового снимка.
--  Поля reconciled_balance — это НЕ баланс, а эталон последней сверки:
--  то, что человек увидел в банке и подтвердил. Расчёт сверяется с
--  ним, и расхождение становится видимым, а не затирается.
--
--  Деньги — целые копейки (INTEGER). Дробных рублей в базе нет.
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  bank          TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL,              -- дебетовая карта / кредитная карта / наличные / брокерский / крипто / текущий
  currency      TEXT NOT NULL DEFAULT 'RUB', -- RUB / USD / EUR; кредитка — только RUB
  start_balance INTEGER NOT NULL DEFAULT 0, -- в валюте счёта, копейки или центы, на дату start_date
  start_date    TEXT    NOT NULL,
  credit_limit  INTEGER,                    -- только для кредитных карт
  grace_note    TEXT NOT NULL DEFAULT '',
  is_payment    INTEGER NOT NULL DEFAULT 1, -- платёжный счёт: участвует в «доступно на счетах»
  statement_day  INTEGER,                   -- кредитка: день выписки (необязательно)
  grace_need     INTEGER,                   -- кредитка: сколько осталось внести до грейса, копейки…
  grace_need_at  TEXT,                      -- …на какую дату это сказано…
  grace_need_due TEXT,                      -- …и к какому дню грейса
  reconciled_balance INTEGER,
  reconciled_at      TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  name       TEXT PRIMARY KEY,
  type       TEXT NOT NULL,   -- доход/базовые/обязательные/дискреционные/сбережения/техническая/прочее
  note       TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT    NOT NULL,            -- YYYY-MM-DD
  amount       INTEGER NOT NULL,            -- копейки, всегда положительное число; всегда в рублях
  currency     TEXT    NOT NULL DEFAULT 'RUB',
  -- У валютного счёта своя сумма: сколько ушло с account_from и пришло
  -- на account_to в их валюте, в центах. У рублёвой стороны — пусто, она
  -- берёт amount. amount у такой операции — рублёвая оценка по курсу ЦБ
  -- на дату: по ней считаются траты, остаток счёта — по своей сумме.
  amount_from  INTEGER,
  amount_to    INTEGER,
  direction    TEXT    NOT NULL,            -- расход / доход / перевод
  account_from TEXT REFERENCES accounts(id),
  account_to   TEXT REFERENCES accounts(id),
  category     TEXT    NOT NULL REFERENCES categories(name),
  description  TEXT    NOT NULL DEFAULT '',
  source       TEXT    NOT NULL DEFAULT '',  -- текст / выписка / сверка
  flag         TEXT    NOT NULL DEFAULT '',
  seq          INTEGER NOT NULL DEFAULT 0,   -- порядок внутри дня: от него зависят проценты по кредиту
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  CHECK (amount > 0),
  CHECK (direction IN ('расход','доход','перевод')),
  CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Направление определяет, какие счета обязаны быть заполнены.
  --
  -- У расхода счёт зачисления ДОПУСКАЕТСЯ, и это не послабление ради
  -- удобства. Пополнение брокерского счёта и покупка валюты — это
  -- одновременно и трата, и перемещение: деньги ушли с платёжной
  -- карты, значит для бюджета месяца это расход, но приземлились на
  -- ваш же счёт, значит чистый капитал не упал. Запретив здесь
  -- account_to, мы бы либо потеряли, куда делись деньги, либо
  -- заставили считать вложения переводом — и тогда они пропали бы из
  -- отчёта о тратах. В данных таких операций три, все по категории
  -- «Инвестиции».
  CHECK (
    (direction = 'расход'  AND account_from IS NOT NULL) OR
    (direction = 'доход'   AND account_to   IS NOT NULL AND account_from IS NULL) OR
    (direction = 'перевод' AND account_from IS NOT NULL AND account_to IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS ix_tx_date ON transactions(date, seq);
CREATE INDEX IF NOT EXISTS ix_tx_cat  ON transactions(category);

CREATE TABLE IF NOT EXISTS liabilities (
  id              TEXT PRIMARY KEY,
  creditor        TEXT NOT NULL,
  type            TEXT NOT NULL,
  start_debt      INTEGER,                  -- остаток на дату начала учёта, копейки
  start_date      TEXT,
  rate_bp         INTEGER,                  -- годовая ставка в сотых долях процента: 14,5 % = 1450
  monthly_payment INTEGER,
  payment_day     INTEGER,
  close_date      TEXT,
  account_id      TEXT REFERENCES accounts(id),  -- для долга по кредитке
  in_regular      INTEGER NOT NULL DEFAULT 1,
  reconciled_debt INTEGER,
  reconciled_at   TEXT,
  rate_month      TEXT,                     -- месячная ставка десятичной строкой: «0.0120833333»
  initial_amount  INTEGER                   -- сумма кредита при выдаче, копейки; для прогресса погашения
);

CREATE TABLE IF NOT EXISTS recurring (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  amount       INTEGER NOT NULL,            -- в валюте счёта account_id
  amount_max   INTEGER,                     -- если сумма плавает
  direction    TEXT    NOT NULL,
  period       TEXT    NOT NULL,            -- month / year / week
  day_of_month INTEGER,          -- для месячных и годовых
  day_of_week  INTEGER,          -- для недельных: 1 — понедельник
  month_of_year INTEGER,         -- для годовых
  category     TEXT REFERENCES categories(name),
  account_id   TEXT REFERENCES accounts(id),
  obligatory   INTEGER NOT NULL DEFAULT 1,
  active       INTEGER NOT NULL DEFAULT 1,
  note         TEXT NOT NULL DEFAULT '',
  end_date     TEXT                         -- последний платёж; пусто — бессрочный
);

CREATE TABLE IF NOT EXISTS planned (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  price_min  INTEGER NOT NULL,
  price_max  INTEGER NOT NULL,
  need       TEXT    NOT NULL DEFAULT 'need',   -- need / want
  urgency    TEXT    NOT NULL DEFAULT 'cold',   -- hot / cold
  unsure     INTEGER NOT NULL DEFAULT 0,
  deadline   TEXT,
  saved      INTEGER NOT NULL DEFAULT 0,        -- отложено под покупку
  status     TEXT    NOT NULL DEFAULT 'queue',  -- queue / bought / dropped
  bought_at  TEXT,
  bought_sum INTEGER,
  note       TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT '',   -- категория будущей траты
  replaceable    INTEGER NOT NULL DEFAULT 0, -- «есть чем заменить»
  added          TEXT,                       -- когда позиция встала в очередь
  recurring_cost INTEGER NOT NULL DEFAULT 0  -- стоимость владения в месяц, копейки
);

CREATE TABLE IF NOT EXISTS savings_goals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'target', -- target (есть цель) / track (просто копим)
  target     INTEGER,
  account_id TEXT REFERENCES accounts(id),
  deadline   TEXT,
  note       TEXT NOT NULL DEFAULT '',
  monthly    INTEGER                       -- плановый взнос в месяц, копейки
);

-- Снимки балансов: механизм сверки, а не источник правды.
CREATE TABLE IF NOT EXISTS balance_snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT    NOT NULL,
  account_id TEXT    NOT NULL REFERENCES accounts(id),
  balance    INTEGER NOT NULL,
  source     TEXT    NOT NULL DEFAULT 'сверка',
  UNIQUE (date, account_id)
);

-- Заметки к дням календаря: то, что человек хочет помнить о дне, —
-- «отель оплачен наполовину». Пустая заметка не хранится.
CREATE TABLE IF NOT EXISTS day_notes (
  date       TEXT PRIMARY KEY,               -- YYYY-MM-DD
  text       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

-- Вопросы к платежам, которые человек закрыл кнопкой «Решено». Сами
-- вопросы собираются из заметок учёта; здесь — только отметка, что
-- вопрос снят, по его постоянному ключу.
CREATE TABLE IF NOT EXISTS resolved_questions (
  key         TEXT PRIMARY KEY,              -- plan:<id> или rec:<id>
  resolved_at TEXT NOT NULL
);

-- Обращения к ассистенту и их стоимость: по этой таблице считается
-- месячный лимит расходов. Текст запросов и ответов здесь не хранится.
CREATE TABLE IF NOT EXISTS ai_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT    NOT NULL,               -- ISO-время обращения
  model      TEXT    NOT NULL,
  kind       TEXT    NOT NULL,               -- chat / parse / comment / check
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_micro INTEGER NOT NULL DEFAULT 0      -- стоимость в миллионных долях доллара
);

-- Комментарии ассистента на экранах: последний на каждый экран. fp —
-- отпечаток данных экрана, по которым он написан: другие данные — пора
-- обновить.
CREATE TABLE IF NOT EXISTS ai_comments (
  screen     TEXT PRIMARY KEY,               -- overview / expenses / forecast / plans
  text       TEXT    NOT NULL,
  judgment   INTEGER NOT NULL DEFAULT 0,     -- 1 — оценка или совет: бейдж «решение»
  fp         TEXT    NOT NULL,
  at         TEXT    NOT NULL                -- ISO-время
);

-- Авто-отчёты: сводка за неделю или месяц, в панели ассистента.
CREATE TABLE IF NOT EXISTS ai_reports (
  period     TEXT PRIMARY KEY,               -- 2026-09-28 (неделя с понедельника) или 2026-09 (месяц)
  kind       TEXT    NOT NULL,               -- weekly / monthly
  title      TEXT    NOT NULL,
  answer     TEXT    NOT NULL,               -- ответ блоками, JSON
  at         TEXT    NOT NULL,
  read       INTEGER NOT NULL DEFAULT 0
);

-- Курсы валют к рублю: рублей за единицу × 10 000 (84,9057 ₽ = 849057).
-- С сайта ЦБ — на каждый день, когда ЦБ его устанавливал; вручную — на
-- день ввода, когда связи нет. Курс на день — последний не позже него.
CREATE TABLE IF NOT EXISTS fx_rates (
  date     TEXT    NOT NULL,
  currency TEXT    NOT NULL,
  rate     INTEGER NOT NULL,
  source   TEXT    NOT NULL DEFAULT 'cbr',   -- cbr / manual
  PRIMARY KEY (date, currency),
  CHECK (rate > 0),
  CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

-- Платёж, который в этом месяце пропущен по решению: «Пропустить» на
-- «Обязательных платежах». period — месяц ГГГГ-ММ.
CREATE TABLE IF NOT EXISTS skipped_payments (
  recurring_id INTEGER NOT NULL,
  period       TEXT    NOT NULL,
  at           TEXT    NOT NULL,
  PRIMARY KEY (recurring_id, period)
);

-- Вопросы к платежам, заданные руками («Новый вопрос»). Закрытые — в
-- resolved_questions под ключом q:<id>, как и вопросы из заметок.
CREATE TABLE IF NOT EXISTS questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  recurring_id INTEGER,
  text         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL
);

-- Дни, отмеченные «без трат»: в такой день записей нет, и это не пропуск.
CREATE TABLE IF NOT EXISTS quiet_days (
  date TEXT PRIMARY KEY,
  at   TEXT NOT NULL,
  CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
