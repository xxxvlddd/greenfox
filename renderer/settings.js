'use strict';
/* ============================================================
   ЭКРАН «НАСТРОЙКИ»
   ============================================================
   Перенесено из макета Main App/screens/10-nastroyki.html: восемь
   разделов слева, строки «подпись — переключатель» справа, рядом с
   параметром — на что он влияет. В макете значения жили в памяти
   страницы; здесь каждое пишется в базу и сразу действует на экранах.

   Поле сохраняется, когда из него уходят или нажимают Enter; рядом
   коротко появляется «сохранено» или причина, почему не сохранено.
   Имена начинаются с sg.
   ============================================================ */
var SG = null;
var sgSec = 'general';
var sgShow = { accounts: false, cats: false, recur: false };
var sgKeyOpen = false;
var sgNote = {};                /* строка → { text, err } под переключателем */
var sgNoteTimer = null;

var SG_SECTIONS = [
  { id: 'general', name: 'Общие' },
  { id: 'accounts', name: 'Счета', cnt: 'accounts' },
  { id: 'cats', name: 'Категории', cnt: 'categories' },
  { id: 'calc', name: 'Расчёты' },
  { id: 'recur', name: 'Регулярные платежи', cnt: 'recurring' },
  { id: 'asst', name: 'Ассистент' },
  { id: 'data', name: 'Данные' },
  { id: 'about', name: 'О программе' }
];
var SG_SCREENS = [['overview', 'Обзор'], ['expenses', 'Расходы'], ['capital', 'Капитал и долги'],
  ['forecast', 'Прогнозы'], ['plans', 'Планы'], ['calendar', 'Календарь'], ['payments', 'Обязательные платежи']];
var SG_GRIP = '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">' +
  '<circle cx="2" cy="2" r="1.3"/><circle cx="8" cy="2" r="1.3"/><circle cx="2" cy="7" r="1.3"/>' +
  '<circle cx="8" cy="7" r="1.3"/><circle cx="2" cy="12" r="1.3"/><circle cx="8" cy="12" r="1.3"/></svg>';

function sgSecName(id){ return SG_SECTIONS.filter(function(s){ return s.id === id; })[0].name; }

/* ---------- сборка строк — как в макете ---------- */
function sgRow(name, hint, ctl, affects, preview, key){
  var n = key && sgNote[key];
  return '<div class="row"' + (key ? ' data-row="' + key + '"' : '') + '><div class="row-main">' +
    '<div class="row-name">' + name + '</div>' +
    (hint ? '<div class="row-hint">' + hint + '</div>' : '') +
    (affects ? '<div class="row-aff">Влияет на: ' + affects + '</div>' : '') +
  '</div><div class="row-ctl">' + ctl + (preview || '') +
    (n ? '<div class="row-prev' + (n.err ? '' : ' is-same') + ' sg-note">' + esc(n.text) + '</div>' : '') +
  '</div></div>';
}
function sgSeg(key, val, opts){
  return '<div class="seg">' + opts.map(function(o){
    return '<button type="button" class="' + (String(val) === String(o[0]) ? 'is-active' : '') +
      '" data-pref="' + key + ':' + o[0] + '">' + o[1] + '</button>';
  }).join('') + '</div>';
}
function sgSel(key, val, opts){
  return '<select class="inp" data-pref-sel="' + key + '">' + opts.map(function(o){
    return '<option value="' + esc(o[0]) + '"' + (String(val) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
  }).join('') + '</select>';
}
function sgInp(attr, val, ph, extra){
  return '<input class="inp" type="text" ' + attr + ' value="' + esc(val === null || val === undefined ? '' : val) +
    '" placeholder="' + (ph || '') + '" autocomplete="off"' + (extra || '') + '>';
}
function sgGo(text, screen){ return '<button type="button" class="link-btn" data-goto="' + screen + '">' + text + '</button>'; }
function sgBtn(text, act, extra, acc){
  return '<button type="button" class="btn btn-sm' + (acc ? ' btn-sm--acc' : '') + '" data-sgact="' + act + '"' +
    (extra || '') + '>' + text + '</button>';
}
function sgRubText(cents){ var c = Number(cents) || 0; return fmRaw(c).replace(/^(\d+)/, function(m){ return group(m); }); }
function sgDdmm(iso){ return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : ''; }
function sgStamp(iso){
  var d = iso.slice(0, 10), t = iso.slice(11, 16);
  return (d === SG.today ? 'сегодня' : sgDdmm(d)) + ', ' + t;
}

/* ---------- разделы ---------- */
function sgGeneral(){
  var P = SG.prefs;
  return '<div class="set-title">Общие</div>' +
  '<p class="set-sub">Как приложение выглядит и с чего начинается</p>' +
  sgRow('Тема', 'Системная следует за настройкой macOS.',
    sgSeg('ui.theme', P['ui.theme'], [['light', 'Светлая'], ['dark', 'Тёмная'], ['system', 'Системная']]), '', '', 'ui.theme') +
  sgRow('Плотность интерфейса', 'Плотная уменьшает отступы и высоту строк — на экран помещается больше, заметнее всего в таблицах и списках.',
    sgSeg('ui.density', P['ui.density'], [['normal', 'Обычная'], ['dense', 'Плотная']]), '', '', 'ui.density') +
  sgRow('Экран при запуске', '', sgSel('ui.startScreen', P['ui.startScreen'], SG_SCREENS), '', '', 'ui.startScreen') +
  sgRow('Первый день недели', 'Влияет на сетку календаря.',
    sgSeg('ui.weekStart', P['ui.weekStart'], [['mon', 'Понедельник'], ['sun', 'Воскресенье']]),
    sgGo('Календарь', 'calendar'), '', 'ui.weekStart') +
  sgRow('Горячие клавиши', 'Переход по экранам, ввод операций, поиск, отмена записи. Шпаргалка открывается на любом экране по ⌘/.',
    sgBtn('Показать', 'keys'));
}

function sgAccItem(a, i, n){
  var fx = a.cur && a.cur !== 'RUB';
  var sub = [a.bank, a.typeWord].filter(Boolean).join(' · ') + (a.isPayment ? ' · платёжный' : '') +
    (fx ? ' · в ' + ({ USD: 'долларах', EUR: 'евро' }[a.cur] || a.cur) + ', ≈ ' + money0(a.balance) : '');
  return '<div class="set-item' + (a.archived ? ' is-arch' : '') + '"' + (a.archived ? '' : ' data-acc="' + esc(a.id) + '"') + '>' +
    (a.archived ? '' : '<button type="button" class="grip" data-grip="' + esc(a.id) + '" aria-label="Переместить «' +
      esc(a.name) + '»: перетащите или нажмите стрелку вверх или вниз">' + SG_GRIP + '</button>') +
    '<span class="swatch" style="background:' + a.color + '"></span>' +
    '<span style="min-width:0"><span class="nm">' + esc(a.name) + '</span><div class="sb">' + esc(sub) + '</div></span>' +
    '<span class="spacer"></span>' +
    '<span class="amt">' + (fx ? moneyIn(a.native, a.cur) : money(a.balance)) + '</span>' +
    '<span class="set-acts">' + (a.archived
      ? sgBtn('Вернуть', 'acc-restore', ' data-id="' + esc(a.id) + '"')
      : sgBtn('Изменить', 'acc-edit', ' data-id="' + esc(a.id) + '"') + sgBtn('В архив', 'acc-archive', ' data-id="' + esc(a.id) + '"')) +
    '</span></div>';
}
function sgAccounts(){
  var act = SG.accounts.filter(function(a){ return !a.archived; });
  var arch = SG.accounts.filter(function(a){ return a.archived; });
  return '<div class="set-title">Счета</div>' +
  '<p class="set-sub">Порядок в списке задаёт порядок на экранах · перетащите за ручку</p>' +
  '<div class="set-list" id="sgAccList">' + act.map(sgAccItem).join('') + '</div>' +
  (sgShow.accounts ? '<div class="sg-arch"><div class="lbl">Архив</div>' + (arch.length
      ? '<div class="set-list">' + arch.map(sgAccItem).join('') + '</div>'
      : '<p class="row-hint">В архиве ничего нет.</p>') + '</div>' : '') +
  '<div class="note-warn"><span class="dot"></span><span>' +
    '<b>Флаг «платёжный счёт» решает многое.</b> Только такие счета попадают в «Доступно на счетах», ' +
    'в дневной лимит и в расчёт дней до нуля. Копилка, брокерский счёт и криптокошелёк видны в капитале, ' +
    'но тратить их каждый день не предполагается.</span></div>' +
  '<div class="set-foot">' + sgBtn('Добавить счёт', 'acc-add', '', true) +
    sgBtn(sgShow.accounts ? 'Скрыть архив' : 'Показать архив' + (arch.length ? ' · ' + arch.length : ''), 'acc-arch-toggle') + '</div>';
}

function sgCatItem(c){
  var sub = c.type + (c.system ? ' · служебная, участвует в расчётах' : '');
  return '<div class="set-item' + (c.active ? '' : ' is-arch') + '">' +
    '<span class="swatch" style="background:' + c.color + '"></span>' +
    '<span style="min-width:0"><span class="nm">' + esc(c.name) + '</span><div class="sb">' + esc(sub) + '</div></span>' +
    '<span class="spacer"></span>' +
    '<span class="amt">' + c.ops + NBSP + plural(c.ops, 'операция', 'операции', 'операций') + '</span>' +
    '<span class="set-acts">' + (c.active
      ? sgBtn('Изменить', 'cat-edit', ' data-name="' + esc(c.name) + '"') +
        (c.system ? '' : sgBtn('Объединить', 'cat-merge', ' data-name="' + esc(c.name) + '"'))
      : sgBtn('Вернуть', 'cat-restore', ' data-name="' + esc(c.name) + '"') +
        (c.ops ? '' : sgBtn('Удалить', 'cat-delete', ' data-name="' + esc(c.name) + '"'))) +
    '</span></div>';
}
function sgCats(){
  var act = SG.categories.filter(function(c){ return c.active; });
  var arch = SG.categories.filter(function(c){ return !c.active; });
  return '<div class="set-title">Категории</div>' +
  '<p class="set-sub">Закрытый список · новая категория заводится только с обязательным выбором типа</p>' +
  '<div class="set-list">' + act.map(sgCatItem).join('') + '</div>' +
  (sgShow.cats ? '<div class="sg-arch"><div class="lbl">Архив</div>' + (arch.length
      ? '<div class="set-list">' + arch.map(sgCatItem).join('') + '</div>'
      : '<p class="row-hint">В архиве ничего нет.</p>') + '</div>' : '') +
  '<div class="note-warn"><span class="dot"></span><span>' +
    '<b>Категорию с операциями удалить нельзя.</b> Её можно объединить с другой — тогда операции ' +
    'переедут и сумма сохранится, — либо отправить в архив: она исчезнет из списка выбора, ' +
    'но останется в истории.</span></div>' +
  '<div class="set-foot">' + sgBtn('Добавить категорию', 'cat-add', '', true) +
    sgBtn(sgShow.cats ? 'Скрыть архив' : 'Показать архив' + (arch.length ? ' · ' + arch.length : ''), 'cat-arch-toggle') + '</div>';
}

/* Дневной лимит при другом резерве — как на «Обзоре»: свободные без
   резерва минус новый резерв, делённые на дни горизонта. */
function sgLimitPreview(raw){
  var L = SG.calc.limit;
  if (!L) return '<div class="row-prev is-same" id="sgLimitPrev">лимит не посчитан — нет будущих поступлений</div>';
  var p = fmParse(raw);
  var res = p.ok ? (p.empty ? 0 : p.cents) : null;
  if (res === null || res < 0) return '<div class="row-prev" id="sgLimitPrev">не понятно, сколько — ждём сумму в рублях</div>';
  var base = Number(L.value);
  var now = Math.trunc((Number(L.free0) - res) / L.days);
  var same = Math.abs(now - base) < 50;
  return '<div class="row-prev' + (same ? ' is-same' : '') + '" id="sgLimitPrev">' +
    (same ? 'дневной лимит ' + money0(String(base)) + ' — без изменений'
          : 'дневной лимит: ' + money0(String(base)) + ' → ' + money0(String(now))) + '</div>';
}
/* Курсы валют. В макете здесь «Курс криптовалюты», вписанный руками;
   в приложении счета бывают в долларах и евро, и курс берётся с сайта ЦБ
   на каждый день. Вручную — только когда связи нет. */
function sgFxRow(F){
  if (!F || !F.list.length){
    return sgRow('Курсы валют', 'Появятся, когда заведёте счёт в долларах или евро: курс ЦБ на каждый день, по нему ' +
      'валютные счета входят в «Доступно на счетах», капитал и траты.', sgInp('readonly disabled', '—'));
  }
  var lines = F.list.map(function(x){
    return '<div style="display:flex;align-items:center;gap:8px;width:100%;margin-bottom:6px">' +
      '<span style="flex:none;width:18px;color:var(--text-2)">' + esc(x.sym) + '</span>' +
      sgInp('data-sg-inp="fx:' + x.cur + '" inputmode="decimal" aria-label="Курс: ' + esc(x.name) + '"',
        x.text ? x.text.replace(/0+$/, '').replace(/,$/, ',00') : '', 'нет курса') +
      '<span style="flex:none;font-size:11px;color:var(--text-3);white-space:nowrap">' +
        (x.date ? (x.manual ? 'вручную' : 'ЦБ') + ' на ' + sgDdmm(x.date) : 'нет курса') + '</span></div>';
  }).join('');
  var hint = 'Рублей за единицу, по курсу ЦБ на каждый день: по нему валютные счета входят в «Доступно на счетах», ' +
    'капитал и траты. Обновляется сам раз в три часа; без связи — по последнему известному. Вписать вручную — когда ' +
    'с сайтом ЦБ связи нет: курс ляжет на сегодня.';
  var state = F.busy ? 'обновляю…' : F.error ? 'не обновились: ' + esc(F.error) : F.fetchedAt ? 'обновлены ' + sgStamp(F.fetchedAt) : '';
  return sgRow('Курсы валют', hint, lines +
      '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;width:100%;margin-top:2px">' +
        '<button type="button" class="link-btn" data-sgact="fx-refresh" style="white-space:nowrap">Обновить с сайта ЦБ</button>' +
        (state ? '<span style="font-size:11px;text-align:right;color:' + (F.error && !F.busy ? 'var(--warning)' : 'var(--text-3)') + '">' +
          state + '</span>' : '') +
      '</div>',
    sgGo('Обзор', 'overview') + ' · ' + sgGo('Капитал и долги', 'capital'), '', 'fx');
}
function sgCalc(){
  var C = SG.calc, P = SG.prefs;
  var rate = C.loan && C.loan.rateBp !== null ? String(C.loan.rateBp / 100).replace('.', ',') : '';
  var res = Number(C.reserve);
  return '<div class="set-title">Расчёты</div>' +
  '<p class="set-sub">Параметры, от которых зависят числа на экранах · рядом с каждым написано, на что он влияет</p>' +
  sgRow('Дата начала учёта', 'Балансы не хранятся, а пересчитываются от этой даты по всем операциям. Меняется при новом ' +
      'старте учёта — вместе с начальными остатками счетов.',
    sgInp('readonly', sgDdmm(C.startDate)), sgGo('Капитал и долги', 'capital')) +
  sgRow('Неснижаемый резерв', res
      ? 'Сумма, которая не участвует в дневном лимите. Сейчас — ' + money0(C.reserve) + '.'
      : 'Сумма, которая не участвует в дневном лимите. Сейчас не задан — лимит считается от всех свободных денег.',
    sgInp('data-pref-inp="calc.reserve"', res ? sgRubText(C.reserve) : '0', '0', ' inputmode="decimal"'),
    sgGo('Обзор', 'overview'), sgLimitPreview(res ? fmRaw(res) : '0'), 'calc.reserve') +
  sgRow('Горизонт дневного лимита', 'На сколько дней делятся свободные средства. По умолчанию — до ближайшего поступления.',
    sgSel('calc.horizon', P['calc.horizon'], [['income', 'До ближайшего поступления'], ['7', 'Фиксированно 7 дней'],
                                              ['30', 'Фиксированно 30 дней']]),
    sgGo('Обзор', 'overview'),
    C.limit ? '<div class="row-prev is-same">сейчас ' + nDays(C.limit.days) + ' · лимит ' + money0(C.limit.value) + '</div>' : '',
    'calc.horizon') +
  (C.loan
    ? sgRow('Ставка кредита', 'Годовая ставка для расчёта процентов, остатка и переплаты. Кредит «' + esc(C.loan.creditor) + '».',
        sgInp('data-sg-inp="loanRate"', rate, '14,5', ' inputmode="decimal"'),
        sgGo('Прогнозы', 'forecast') + ' · ' + sgGo('Капитал и долги', 'capital'), '', 'loanRate')
    : sgRow('Ставка кредита', 'Кредита в учёте нет — ставка появится вместе с ним.', sgInp('readonly', '—'))) +
  (C.card
    ? sgRow('Кредитка: лимит, выписка и грейс', 'Карта «' + esc(C.card.name) + '»: кредитный лимит, день выписки и число, ' +
          'до которого нужно внести сумму по выписке. День выписки можно не указывать — тогда грейс считается по долгу на ' +
          'начало цикла.',
        '<div style="display:flex;gap:8px;width:100%">' +
          sgInp('data-sg-inp="cardLimit" aria-label="Кредитный лимит"', C.card.limit === null ? '' : sgRubText(C.card.limit), 'лимит', ' inputmode="decimal"') +
          sgInp('data-sg-inp="cardStmt" aria-label="День выписки"', C.card.statementDay || '', 'выписка', ' inputmode="numeric"') +
          sgInp('data-sg-inp="cardDay" aria-label="День грейса"', C.card.graceDay || '', 'грейс до', ' inputmode="numeric"') + '</div>',
        sgGo('Прогнозы', 'forecast') + ' · ' + sgGo('Обязательные платежи', 'payments'), '', 'cardTerms') +
      sgRow('Осталось внести до грейса', 'Сумма из приложения банка «внесите до …, чтобы не платить проценты» — на сегодня. ' +
          'Действует до ближайшего дня грейса; внесённое потом вычитается само. Пусто — приложение считает само.',
        sgInp('data-sg-inp="cardLeft" aria-label="Осталось внести до грейса"', C.card.graceLeft ? sgRubText(C.card.graceLeft) : '', 'не обязательно', ' inputmode="decimal"'),
        '', C.card.grace ? '<div class="row-prev is-same">Сейчас: до ' + humanDate(C.card.grace.due) + ' осталось внести ' +
          money0(C.card.grace.left) + (C.card.grace.source === 'manual' ? ' — по вашей сумме'
            : C.card.grace.source === 'statement' ? ' — по выписке ' + C.card.grace.statementDay + ' числа' : ' — по долгу на начало цикла') +
          '</div>' : '', 'cardLeft')
    : sgRow('Кредитка: лимит, выписка и грейс', 'Кредитной карты в учёте нет.', sgInp('readonly', '—'))) +
  sgFxRow(C.fx) +
  sgRow('Пороги уровней трат', 'Границы ступеней тепловой шкалы в календаре и в поведенческих срезах, в рублях через дробь. ' +
      'Календарь берёт первые четыре.',
    sgInp('data-pref-inp="calc.levels"', P['calc.levels'], '1000/3000/5000/10000/30000'),
    sgGo('Календарь', 'calendar') + ' · ' + sgGo('Расходы', 'expenses'), '', 'calc.levels') +
  sgRow('Границы зон запаса прочности', 'Сколько месяцев жизни на сбережениях считается критичным и сколько — тонким, через дробь.',
    sgInp('data-pref-inp="calc.zones"', String(P['calc.zones']).replace(/\./g, ','), '1/2'),
    sgGo('Капитал и долги', 'capital') + ' · ' + sgGo('Планы', 'plans'), '', 'calc.zones');
}

function sgRecItem(r){
  /* Пополнение кредитки — не фиксированная сумма: сколько осталось до грейса. */
  var amt = r.self && r.obligatory ? 'сумма к грейсу'
    : r.amountTo === null ? money(r.amount) : money0(r.amount) + ' – ' + money0(r.amountTo);
  return '<div class="set-item' + (r.active ? '' : ' is-arch') + '">' +
    '<span style="min-width:0"><span class="nm">' + esc(r.name) + '</span>' +
      '<div class="sb">' + esc(r.when) + (r.dir === 'доход' ? ' · поступление' : r.obligatory ? '' : ' · по желанию') + '</div></span>' +
    '<span class="spacer"></span>' +
    '<span class="amt">' + (r.dir === 'доход' ? '+' : '') + amt + '</span>' +
    '<span class="set-acts">' + (r.active
      ? sgBtn('Изменить', 'rec-edit', ' data-id="' + r.id + '"') + sgBtn('На паузу', 'rec-pause', ' data-id="' + r.id + '"')
      : sgBtn('Возобновить', 'rec-resume', ' data-id="' + r.id + '"')) +
    '</span></div>';
}
function sgRecur(){
  var act = SG.recurring.filter(function(r){ return r.active; });
  var off = SG.recurring.filter(function(r){ return !r.active; });
  return '<div class="set-title">Регулярные платежи</div>' +
  '<p class="set-sub">Тот же список, что на экране обязательных платежей, в режиме правки справочника</p>' +
  '<div class="set-list">' + act.map(sgRecItem).join('') + '</div>' +
  (sgShow.recur ? '<div class="sg-arch"><div class="lbl">На паузе</div>' + (off.length
      ? '<div class="set-list">' + off.map(sgRecItem).join('') + '</div>'
      : '<p class="row-hint">На паузе ничего нет.</p>') + '</div>' : '') +
  '<div class="set-foot">' + sgBtn('Добавить платёж', 'rec-add', '', true) +
    '<button type="button" class="btn btn-sm" data-goto="payments">Открыть экран платежей</button>' +
    sgBtn(sgShow.recur ? 'Скрыть на паузе' : 'На паузе' + (off.length ? ' · ' + off.length : ''), 'rec-paused-toggle') + '</div>';
}

/* Цена модели — за миллион токенов; «за вопрос» — оценка: обращение к
   данным и ответ на полстраницы, это около 8 000 токенов на входе и 700
   на выходе. */
function sgAskCost(m){ return (m.in * 8000 + m.out * 700) / 1e6; }
function sgCostText(usd){
  if (!usd) return 'бесплатно';
  return usd < 0.001 ? 'меньше $0,001' : '≈ $' + (usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)).replace('.', ',');
}
function sgModelPrice(m){
  return m.free || (!m.in && !m.out) ? 'бесплатно, с ограничением числа запросов'
    : '$' + String(m.in).replace('.', ',') + ' / $' + String(m.out).replace('.', ',') + ' за миллион токенов · ' +
      sgCostText(sgAskCost(m)) + ' за' + NBSP + 'вопрос';
}
var SG_ACCESS = [['read', 'только читает'], ['suggest', 'предлагает записи'], ['write', 'записывает без подтверждения']];
function sgUsd(n){ return '$' + (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ','); }
function sgAsst(){
  var A = SG.ai, P = SG.prefs;
  var info = A.keyInfo;
  var keyCtl = sgKeyOpen || !A.hasKey
    ? (sgKeyOpen
        ? '<input class="inp" type="password" id="sgKeyInp" placeholder="sk-or-v1-…" autocomplete="off" spellcheck="false">' +
          '<div style="display:flex;gap:8px;width:100%;justify-content:flex-end">' + sgBtn('Отмена', 'key-cancel') +
            sgBtn('Сохранить ключ', 'key-save', '', true) + '</div>'
        : sgBtn(A.unreadable ? 'Добавить ключ заново' : 'Добавить ключ', 'key-add', ' style="width:100%"', true))
    : '<div style="display:flex;gap:8px;width:100%">' + sgInp('readonly', A.masked) +
        sgBtn('Заменить', 'key-add', ' style="flex:none"') + '</div>' +
      '<div style="display:flex;gap:12px">' +
        '<button type="button" class="link-btn" data-sgact="key-check">Проверить</button>' +
        '<button type="button" class="link-btn" data-sgact="key-clear">Удалить ключ</button></div>';
  var keyState = A.unreadable ? '<div class="row-prev">система не отдала ключ — добавьте его заново</div>'
    : info ? (info.ok
        ? '<div class="row-prev is-same">ключ работает' + (info.limit !== null ? ' · лимит ключа ' + sgUsd(info.limit) : '') +
          ' · израсходовано ' + sgUsd(info.usage) + '</div>'
        : '<div class="row-prev">' + esc(info.error) + '</div>')
    : '';
  var models = A.models || [];
  var cur = models.filter(function(m){ return m.id === A.model; })[0];
  return '<div class="set-title">Ассистент</div>' +
  '<p class="set-sub">Вспомогательный инструмент · приложение работает и без него</p>' +
  sgRow('Провайдер', 'Через OpenRouter доступны модели Anthropic, OpenAI, Google и других компаний — с одним ключом ' +
      'и одним счётом.', sgInp('readonly', 'OpenRouter')) +
  sgRow('Ключ', 'Хранится в связке ключей macOS, а не в файлах приложения. Показан маскированным. Ключ создаётся ' +
      'на сайте openrouter.ai в разделе Keys.', keyCtl, '', keyState, 'ai.key') +
  /* Подпись о данных — по требованию: человек должен видеть, что уходит
     наружу, ещё до того, как введёт ключ. */
  '<div class="note-warn sg-privacy"><span class="dot"></span><span><b>Что уходит провайдеру.</b> Когда вы пользуетесь ' +
    'ассистентом, часть ваших данных — суммы, категории, названия счетов и описания операций, нужные для ответа, — ' +
    'отправляется в OpenRouter и компании, чья модель выбрана ниже. Вся база целиком не отправляется. Пока ключ не ' +
    'добавлен, из приложения не уходит ничего.</span></div>' +
  sgRow('Модель', 'Одна модель на всё: разбор записей, ответы и отчёты. В списке только модели, которые умеют ' +
      'обращаться к данным приложения.',
    '<div style="display:flex;gap:8px;width:100%">' +
      sgInp('readonly title="' + esc(A.model) + '"', cur ? cur.name : (A.model || 'не выбрана')) +
      sgBtn('Выбрать', 'model-pick', ' style="flex:none"' + (models.length ? '' : ' disabled')) + '</div>' +
    '<button type="button" class="link-btn" data-sgact="models">' + (models.length ? 'Обновить список' : 'Загрузить список') + '</button>',
    '', cur ? '<div class="row-prev is-same">' + sgModelPrice(cur) + '</div>' : '', 'ai.model') +
  sgRow('Уровень полномочий', 'По умолчанию ассистент только предлагает записи — подтверждаете вы.',
    sgSel('ai.access', P['ai.access'], SG_ACCESS), '', '', 'ai.access') +
  (P['ai.access'] === 'write'
    ? '<div class="note-warn"><span class="dot"></span><span><b>Ассистент будет записывать операции без вашего ' +
      'подтверждения</b> — то, что вы попросили внести кнопкой «Ввод операций». Разбор текста не всегда точен: ошибка в категории или сумме попадёт в журнал молча, и найти её ' +
      'потом можно только сверкой. Включайте, только если готовы регулярно проверять историю.</span></div>' : '') +
  sgRow('Месячный лимит расходов', 'В долларах. При исчерпании панель показывает предупреждение и перестаёт обращаться ' +
      'к модели — и для ответов, и для комментариев. 0 — без ограничения.',
    sgInp('data-pref-inp="ai.monthLimit"', String(P['ai.monthLimit']).replace('.', ','), '5', ' inputmode="decimal"'), '',
    '<div class="row-prev is-same">в этом месяце ' + sgUsd(A.spent) + ' из ' + sgUsd(P['ai.monthLimit']) +
      (A.requests ? ' · обращений ' + A.requests : '') + '</div>', 'ai.monthLimit') +
  sgRow('Расписание авто-отчёта', 'Сводка в панели ассистента, с пометкой «решение» там, где он оценивает, а не считает.',
    sgSel('ai.report', P['ai.report'], [['off', 'не делать'], ['weekly', 'еженедельно, по понедельникам'],
                                        ['monthly', 'ежемесячно, 1 числа']]), '', '', 'ai.report') +
  sgRow('Комментарии на экранах', 'Короткая оценка ассистента рядом с числами «Обзора», «Расходов», «Прогнозов» и «Планов». ' +
      'После записей обновляется одним запросом, когда вы закончили вносить, а не на каждую операцию.',
    sgSel('ai.comments', P['ai.comments'], [['auto', 'обновлять сами'], ['manual', 'только по кнопке'], ['off', 'не показывать']]),
    '', '', 'ai.comments');
}

function sgData(){
  var D = SG.data, P = SG.prefs;
  return '<div class="set-title">Данные</div>' +
  '<p class="set-sub">Всё хранится локально · в облако ничего не уходит, кроме того, что вы сами отправите ассистенту</p>' +
  sgRow('Папка хранения', 'Файл базы и копии лежат здесь. Папку можно перенести, например, в синхронизируемую — но не ' +
      'открывайте одну базу на двух компьютерах одновременно.',
    '<div style="display:flex;gap:8px;width:100%">' + sgInp('readonly title="' + esc(D.dir) + '"', D.dir.replace(/^\/Users\/[^/]+/, '~')) +
      sgBtn('Выбрать', 'data-move', ' style="flex:none"') + '</div>' +
    '<button type="button" class="link-btn" data-sgact="data-reveal">Показать в Finder</button>', '', '', 'data.dir') +
  sgRow('Автоматический бэкап', 'Копия делается по расписанию, а также перед переносом базы, загрузкой таблицы и ' +
      'объединением категорий.',
    '<div style="display:flex;gap:8px;width:100%">' +
      sgSel('data.backupEvery', P['data.backupEvery'], [['daily', 'ежедневно'], ['weekly', 'еженедельно'],
                                                      ['change', 'при каждом изменении']]) +
      sgInp('data-pref-inp="data.backupKeep"', P['data.backupKeep'], '30', ' inputmode="numeric" style="max-width:72px"') + '</div>',
    '', '<div class="row-prev is-same">хранить копий: ' + P['data.backupKeep'] + ' · ' +
      (D.lastBackup ? 'последняя — ' + sgStamp(D.lastBackup) : 'копий пока нет') + '</div>' +
      (D.backups ? '<button type="button" class="link-btn" data-sgact="backups-reveal">Открыть папку с копиями</button>' : ''),
    'data.backup') +
  sgRow('Экспорт в CSV', 'Те же таблицы, что лежали в папке учёта: журнал операций, счета, категории, платежи, кредиты, ' +
      'планы, цели. Каждая выгрузка — в новую папку.',
    '<div style="display:flex;gap:8px;width:100%">' + sgBtn('Все таблицы', 'export-all') +
      sgBtn('Выбрать…', 'export-pick') + '</div>', '', '', 'data.export') +
  sgRow('Импорт CSV', 'Журнал операций в том же формате. Строки проверяются до записи: дата, сумма, категория из списка, ' +
      'счета. Отчёт показывается до подтверждения.',
    sgBtn('Выбрать файл', 'import', ' style="width:100%"'), '', '', 'data.import') +
  sgRow('Проверка целостности', 'Пересчитывает балансы с нуля и сверяет с подтверждёнными. Находит расхождения, потерянные ' +
      'счета и операции вне справочников.',
    sgBtn('Проверить сейчас', 'integrity', ' style="width:100%"', true), '', '', 'data.integrity') +
  sgRow('Мастер первого запуска', 'Счета с остатками, категории и регулярные платежи за три шага. Работает, пока в учёте ' +
      'нет ни одной операции.', sgBtn('Открыть', 'onboard', ' style="width:100%"')) +
  '<div class="set-foot">' + sgBtn('Сделать бэкап сейчас', 'backup-now', '', true) + '</div>';
}

/* Время проверки приходит в UTC — показываем местное. */
function sgLocalStamp(iso){
  var d = new Date(iso);
  if (isNaN(d)) return '';
  var p = function(n){ return String(n).padStart(2, '0'); };
  return sgStamp(d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()));
}
function sgUpdRow(U){
  if (!U) return '';
  var status, err = false, act = '';
  if (U.mode === 'dev') status = 'Работает в установленном приложении — в песочнице и при запуске из исходников не проверяется';
  else if (U.available){
    status = 'Доступна версия ' + esc(U.available.version);
    act = '<button type="button" class="link-btn" data-sgact="upd-install">Обновить</button>';
  }
  else if (U.error){ status = 'Не удалось проверить: ' + esc(U.error); err = true; }
  else if (U.checkedAt) status = 'Проверено ' + sgLocalStamp(U.checkedAt) + ' — у вас последняя версия';
  else status = U.mode === 'off' ? 'Не проверяется' : 'Ещё не проверялось';
  if (U.mode !== 'dev') act += '<button type="button" class="link-btn" data-sgact="upd-check">Проверить сейчас</button>';
  return sgRow('Обновления', 'Раз в сутки GREENFOX спрашивает у GitHub, вышла ли новая версия, — о вас и вашем учёте в ' +
      'запросе ничего нет. Новая версия ставится, только если она подписана автором.',
    sgSeg('upd.check', SG.prefs['upd.check'], [['on', 'Проверять'], ['off', 'Не проверять']]), '',
    '<div class="row-prev' + (err ? '' : ' is-same') + '">' + status + '</div>' +
    (act ? '<div style="display:flex;gap:12px">' + act + '</div>' : ''), 'upd.check');
}
function sgAbout(){
  var A = SG.about;
  return '<div class="set-title">О программе</div>' +
  '<p class="set-sub">Домашняя бухгалтерия · локальное приложение для macOS</p>' +
  '<div class="sg-brand"><img class="brand-fox" src="fox.svg" width="40" height="40" alt="" aria-hidden="true">' +
    '<span class="brand-name">GREENFOX</span></div>' +
  sgRow('Версия', '', '<div class="amt">' + esc(A.version) + '</div>') +
  sgUpdRow(A.update) +
  sgRow('Последний бэкап', '', '<div class="amt">' + (A.lastBackup ? sgStamp(A.lastBackup) : 'ещё не делался') + '</div>') +
  sgRow('Операций в базе', A.firstDate ? 'С начала учёта ' + humanDate(A.firstDate) + ' ' + A.firstDate.slice(0, 4) + ' года.' : '',
    '<div class="amt">' + A.ops + '</div>') +
  sgRow('Журнал изменений', 'Что появилось в приложении от версии к версии.', sgBtn('Открыть', 'changelog', ' style="width:100%"')) +
  sgRow('Лицензия', 'Свободная программа: её можно использовать, изучать, менять и распространять на условиях GNU GPL 3.0. ' +
    'Гарантий нет. © 2026 Valeriy Babenko.', '<div class="amt">GPL-3.0</div>') +
  sgRow('Исходный код', 'Код, установка и сообщения об ошибках — на GitHub.', '<div class="amt">github.com/xxxvlddd/greenfox</div>');
}

var SG_RENDER = { general: sgGeneral, accounts: sgAccounts, cats: sgCats, calc: sgCalc, recur: sgRecur,
                  asst: sgAsst, data: sgData, about: sgAbout };

/* Пункты — во внутренней обёртке: она стоит на месте, пока прокручивается
   раздел, а сама колонка тянется на всю высоту — с ней и линия. */
function sgNavHTML(){
  return '<div class="set-nav-in">' + SG_SECTIONS.map(function(s){
    var n = s.cnt ? SG.counts[s.cnt] : 0;
    return '<button type="button" class="' + (s.id === sgSec ? 'is-on' : '') + '" data-sec="' + s.id + '">' +
      s.name + (n ? '<span class="cnt">' + n + '</span>' : '') + '</button>';
  }).join('') + '</div>';
}

function renderSettings(d){
  SG = d;
  if (d.error) return stateHTML('is-error', 'Не получилось собрать экран', d.error);
  return '<div class="scr-settings"><section class="set">' +
    '<nav class="set-nav" id="sgNav" aria-label="Разделы настроек">' + sgNavHTML() + '</nav>' +
    '<div class="set-body" id="sgBody">' + SG_RENDER[sgSec]() + '</div>' +
  '</section></div>';
}

/* Раздел меняется на том же месте — без появления подмена читается как
   мигание. После записи — без появления: менялось одно поле. Фокус
   возвращается в поле, где он был. */
function sgRenderBody(animate){
  var body = document.getElementById('sgBody');
  if (!body) return;
  var act = document.activeElement, keep = null;
  if (act && body.contains(act)){
    ['data-pref-inp', 'data-pref-sel', 'data-sg-inp', 'data-pref', 'data-sgact', 'data-grip', 'id'].some(function(a){
      var v = act.getAttribute(a);
      if (v){ keep = '[' + a + '="' + v + '"]'; return true; }
      return false;
    });
  }
  body.innerHTML = SG_RENDER[sgSec]();
  document.getElementById('sgNav').innerHTML = sgNavHTML();
  document.getElementById('headSub').textContent = sgSecName(sgSec);
  if (animate){
    appear(body);
    stagger(body, '.row, .set-item');
  }
  if (keep){
    var back = body.querySelector(keep);
    if (back && back.focus) back.focus();
  }
}
function sgReload(animate){
  return window.api.settings().then(function(d){
    if (!d || d.error) return;
    SG = d;
    sgRenderBody(animate);
  });
}
/* «сохранено» под переключателем — на две секунды; причина отказа —
   до следующей правки. */
function sgSay(key, text, err){
  sgNote = {};
  sgNote[key] = { text: text, err: !!err };
  clearTimeout(sgNoteTimer);
  if (!err) sgNoteTimer = setTimeout(function(){ sgNote = {}; var el = document.querySelector('#sgBody .sg-note'); if (el) el.remove(); }, 2000);
}

/* ---------- запись ---------- */
function sgSetPref(key, value){
  return window.api.setPref(key, value).then(function(r){
    if (!r || !r.ok){ sgSay(key, (r && r.error) || 'не сохранено', true); sgRenderBody(false); return r; }
    sgSay(key, 'сохранено');
    if (key === 'ui.theme' || key === 'ui.density') applyPrefs(Object.assign({}, SG.prefs, { [key]: r.value }));
    return sgReload(false).then(function(){ return r; });
  });
}
function sgCardTerms(which){
  var v = function(k){ return document.querySelector('#sgBody [data-sg-inp="' + k + '"]').value; };
  var p = fmParse(v('cardLimit')), left = fmParse(v('cardLeft'));
  var key = which === 'cardLeft' ? 'cardLeft' : 'cardTerms';
  if (!p.ok || p.empty){ sgSay(key, 'лимит: сумма в рублях, например 100 000', true); sgRenderBody(false); return; }
  if (!left.ok){ sgSay(key, 'осталось внести: сумма в рублях', true); sgRenderBody(false); return; }
  window.api.setCardTerms({ limit: String(p.cents), graceDay: v('cardDay'), statementDay: v('cardStmt'),
                            graceLeft: left.empty ? '' : String(left.cents) }).then(function(r){
    if (!r || !r.ok){ sgSay(key, (r && r.error) || 'не сохранено', true); sgRenderBody(false); return; }
    sgSay(key, 'сохранено');
    sgReload(false);
  });
}
function sgAct(btn){
  var act = btn.getAttribute('data-sgact'), id = btn.getAttribute('data-id'), name = btn.getAttribute('data-name');
  var done = function(text){
    return function(r){
      if (!r || !r.ok){ toast('Не сохранилось: ' + ((r && r.error) || 'ошибка базы')); return; }
      fmToast(text, r.undo);
      sgReload(false);
    };
  };
  if (act === 'fx-refresh'){
    if (SG.calc && SG.calc.fx) SG.calc.fx.busy = true;
    sgRenderBody(false);
    return window.api.fxRefresh().then(function(r){
      if (r && r.error) sgSay('fx', 'не обновились: ' + r.error, true); else sgSay('fx', 'курсы обновлены');
      sgReload(false);
    });
  }
  if (act === 'acc-add') return fmOpen('account');
  if (act === 'acc-edit') return fmOpen('account', { id: id });
  if (act === 'acc-archive') return window.api.archiveAccount(id).then(done('Счёт отправлен в архив'));
  if (act === 'acc-restore') return window.api.restoreAccount(id).then(done('Счёт снова в списке'));
  if (act === 'acc-arch-toggle'){ sgShow.accounts = !sgShow.accounts; return sgRenderBody(false); }
  if (act === 'cat-add') return fmOpen('cat');
  if (act === 'cat-edit') return fmOpen('cat', { cat: sgCatBy(name) });
  if (act === 'cat-merge') return fmOpen('merge', { cat: sgCatBy(name), cats: SG.categories });
  if (act === 'cat-restore') return window.api.restoreCategory(name).then(done('Категория снова в списке'));
  if (act === 'cat-delete') return window.api.deleteCategory(name).then(done('Категория удалена'));
  if (act === 'cat-arch-toggle'){ sgShow.cats = !sgShow.cats; return sgRenderBody(false); }
  if (act === 'rec-add') return fmOpen('recur');
  if (act === 'rec-edit') return fmOpen('recur', { id: id });
  if (act === 'rec-pause') return window.api.pauseRecurring(id).then(done('Платёж поставлен на паузу'));
  if (act === 'rec-resume') return window.api.resumeRecurring(id).then(done('Платёж снова в расписании'));
  if (act === 'rec-paused-toggle'){ sgShow.recur = !sgShow.recur; return sgRenderBody(false); }
  if (act === 'key-add'){
    sgKeyOpen = true; sgRenderBody(false);
    var inp = document.getElementById('sgKeyInp');
    if (inp) inp.focus();
    return;
  }
  if (act === 'key-cancel'){ sgKeyOpen = false; return sgRenderBody(false); }
  if (act === 'key-save') return sgSaveKey();
  if (act === 'key-clear'){
    return window.api.clearAiKey().then(function(){
      sgKeyOpen = false; sgSay('ai.key', 'ключ удалён');
      refreshAssistant();
      sgReload(false);
    });
  }
  if (act === 'key-check'){
    btn.disabled = true;
    return window.api.checkAiKey().then(function(){ sgReload(false); });
  }
  if (act === 'model-pick') return fmOpen('models', { list: SG.ai.models, cur: SG.ai.model });
  if (act === 'models'){
    btn.textContent = 'Загружаю…'; btn.disabled = true;
    return window.api.aiModels().then(function(r){
      if (!r || !r.ok) sgSay('ai.model', (r && r.error) || 'список не загрузился', true);
      else sgSay('ai.model', 'моделей в списке: ' + r.count);
      sgReload(false);
    });
  }
  if (act === 'data-move') return sgMoveData();
  if (act === 'data-reveal') return window.api.reveal('data');
  if (act === 'backups-reveal') return window.api.reveal('backups').then(function(r){ if (r && !r.ok) toast(r.error); });
  if (act === 'backup-now'){
    btn.disabled = true;
    return window.api.backupNow().then(function(r){
      fmToast(r && r.ok ? 'Копия сохранена: ' + r.name : 'Копия не сделана: ' + ((r && r.error) || 'ошибка'), null);
      sgReload(false);
    });
  }
  if (act === 'export-all') return sgExport(null);
  if (act === 'export-pick') return fmOpen('export');
  if (act === 'import') return sgImport();
  if (act === 'integrity') return sgIntegrity();
  if (act === 'onboard') return obStart();
  if (act === 'changelog') return sgChangelog();
  if (act === 'upd-check'){
    sgSay('upd.check', 'проверяю…');
    sgRenderBody(false);
    return window.api.updateCheck().then(function(st){
      if (st && st.mode) SG.about.update = st;
      sgNote = {};
      sgRenderBody(false);
    });
  }
  if (act === 'upd-install') return window.api.updateInstall();
  if (act === 'keys') return fmOpen('keys');
}
function sgCatBy(name){ return SG.categories.filter(function(c){ return c.name === name; })[0]; }

function sgSaveKey(){
  var inp = document.getElementById('sgKeyInp');
  var key = inp ? inp.value : '';
  window.api.setAiKey(key).then(function(r){
    if (!r || !r.ok){ sgSay('ai.key', (r && r.error) || 'ключ не сохранён', true); sgRenderBody(false);
      var again = document.getElementById('sgKeyInp'); if (again){ again.value = key; again.focus(); } return; }
    sgKeyOpen = false;
    sgSay('ai.key', r.info && r.info.ok ? 'ключ сохранён и работает' : 'ключ сохранён, но ' +
      ((r.info && r.info.error) || 'проверить его не удалось').replace(/^./, function(c){ return c.toLowerCase(); }), !(r.info && r.info.ok));
    refreshAssistant();
    sgReload(false).then(function(){
      /* Список моделей нужен сразу после ключа — грузим, если его ещё нет. */
      if (!SG.ai.models.length) window.api.aiModels().then(function(){ sgReload(false); });
    });
  });
}

function sgMoveData(){
  window.api.pickFolder().then(function(dir){
    if (!dir) return;
    window.api.moveData(dir).then(function(r){
      if (!r || !r.ok){ sgSay('data.dir', (r && r.error) || 'база не перенесена', true); sgRenderBody(false); return; }
      fmToast('База перенесена. Прежний файл остался на старом месте как копия', null);
      sgReload(false);
    });
  });
}
function sgExport(tables){
  return window.api.pickFolder().then(function(dir){
    if (!dir) return;
    return window.api.exportCsv(dir, tables).then(function(r){
      if (!r || !r.ok){ sgSay('data.export', (r && r.error) || 'не выгружено', true); sgRenderBody(false); return; }
      fmClose();
      fmToast('Выгружено таблиц: ' + r.files.length + ' — в папку «' + r.dir.split('/').pop() + '»', null);
      window.api.reveal('export');
    });
  });
}
function sgImport(){
  window.api.pickFile().then(function(file){
    if (!file) return;
    window.api.importPreview(file).then(function(r){
      if (!r || r.error || !r.ok){ sgSay('data.import', (r && r.error) || 'файл не прочитан', true); sgRenderBody(false); return; }
      fmOpen('import', { report: r });
    });
  });
}
function sgIntegrity(){
  window.api.integrity().then(function(r){
    if (!r || r.error){ toast('Проверка не прошла: ' + ((r && r.error) || 'ошибка')); return; }
    fmOpen('integrity', { report: r });
  });
}
function sgChangelog(){
  window.api.changelog().then(function(text){ fmOpen('changelog', { text: text || '' }); });
}

/* ---------- порядок счетов: перетаскивание за ручку и стрелки ---------- */
var sgDrag = null;
function sgOrder(){
  return Array.prototype.map.call(document.querySelectorAll('#sgAccList .set-item[data-acc]'),
    function(el){ return el.getAttribute('data-acc'); });
}
function sgSaveOrder(ids, focusId){
  window.api.reorderAccounts(ids).then(function(r){
    if (!r || !r.ok){ toast('Порядок не сохранился: ' + ((r && r.error) || 'ошибка')); sgReload(false); return; }
    fmToast('Порядок счетов сохранён', r.undo);
    sgReload(false).then(function(){
      var g = focusId && document.querySelector('#sgAccList [data-grip="' + focusId + '"]');
      if (g) g.focus();
    });
  });
}
function sgDragStart(e, grip){
  var item = grip.closest('.set-item');
  var items = Array.prototype.slice.call(document.querySelectorAll('#sgAccList .set-item[data-acc]'));
  var from = items.indexOf(item);
  if (from < 0) return;
  sgDrag = { item: item, items: items, from: from, to: from, startY: e.clientY,
             rects: items.map(function(it){ return it.getBoundingClientRect(); }) };
  item.classList.add('is-drag');
  document.addEventListener('pointermove', sgDragMove);
  document.addEventListener('pointerup', sgDragEnd);
  e.preventDefault();
}
function sgDragMove(e){
  var d = sgDrag;
  if (!d) return;
  var dy = e.clientY - d.startY, r0 = d.rects[d.from];
  d.item.style.transform = 'translateY(' + dy + 'px)';
  var mid = r0.top + r0.height / 2 + dy, to = 0;
  d.rects.forEach(function(r, i){ if (i !== d.from && r.top + r.height / 2 < mid) to++; });
  d.to = to;
  d.items.forEach(function(it, i){
    if (it === d.item) return;
    var shift = d.from < to && i > d.from && i <= to ? -r0.height : d.from > to && i >= to && i < d.from ? r0.height : 0;
    it.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
  });
}
function sgDragEnd(){
  var d = sgDrag;
  sgDrag = null;
  document.removeEventListener('pointermove', sgDragMove);
  document.removeEventListener('pointerup', sgDragEnd);
  if (!d) return;
  d.items.forEach(function(it){ it.style.transform = ''; });
  d.item.classList.remove('is-drag');
  if (d.to === d.from) return;
  var ids = sgOrder(), moved = ids.splice(d.from, 1)[0];
  ids.splice(d.to, 0, moved);
  sgSaveOrder(ids, moved);
}
function sgGripKey(e, grip){
  var step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
  if (!step) return false;
  var ids = sgOrder(), id = grip.getAttribute('data-grip'), i = ids.indexOf(id), j = i + step;
  if (j < 0 || j >= ids.length) return true;
  ids.splice(i, 1); ids.splice(j, 0, id);
  sgSaveOrder(ids, id);
  return true;
}

/* ---------- события ---------- */
function sgClick(t){
  var sec = t.closest('#sgNav [data-sec]');
  if (sec){ sgSec = sec.getAttribute('data-sec'); sgKeyOpen = false; sgNote = {}; sgRenderBody(true); return true; }
  var pref = t.closest('#sgBody [data-pref]');
  if (pref){
    var v = pref.getAttribute('data-pref'), i = v.indexOf(':');
    sgSetPref(v.slice(0, i), v.slice(i + 1));
    return true;
  }
  var act = t.closest('#sgBody [data-sgact]');
  if (act){ sgAct(act); return true; }
  return false;
}
function sgChange(el){
  var sel = el.getAttribute('data-pref-sel');
  if (sel){ sgSetPref(sel, el.value); return true; }
  var inp = el.getAttribute('data-pref-inp');
  if (inp){
    var v = el.value;
    /* Резерв вводится рублями — в базу уходят копейки. */
    if (inp === 'calc.reserve'){
      var p = fmParse(v);
      if (!p.ok || p.cents < 0){ sgSay(inp, 'резерв: сумма в рублях, например 20 000', true); sgRenderBody(false); return true; }
      v = fmRaw(p.cents);
    }
    if (inp === 'calc.zones') v = v.replace(/,/g, '.');
    sgSetPref(inp, v);
    return true;
  }
  var own = el.getAttribute('data-sg-inp');
  if (own === 'loanRate'){
    window.api.setLoanRate(el.value).then(function(r){
      if (!r || !r.ok){ sgSay('loanRate', (r && r.error) || 'не сохранено', true); sgRenderBody(false); return; }
      sgSay('loanRate', r.same ? 'ставка та же' : 'сохранено');
      sgReload(false);
    });
    return true;
  }
  if (own === 'cardLimit' || own === 'cardDay' || own === 'cardStmt' || own === 'cardLeft'){ sgCardTerms(own); return true; }
  if (own && own.indexOf('fx:') === 0){
    window.api.fxManual(own.slice(3), el.value).then(function(r){
      if (!r || !r.ok){ sgSay('fx', (r && r.error) || 'не сохранено', true); sgRenderBody(false); return; }
      sgSay('fx', 'курс записан на сегодня');
      sgReload(false);
    });
    return true;
  }
  return false;
}
/* Резерв пересчитывает лимит на каждый знак — без докрутки, иначе
   строка мигала бы при наборе. */
function sgInput(el){
  if (el.getAttribute('data-pref-inp') === 'calc.reserve'){
    var prev = document.getElementById('sgLimitPrev');
    if (prev){ prev.outerHTML = sgLimitPreview(el.value); bump(document.getElementById('sgLimitPrev')); }
    return true;
  }
  return false;
}
function sgKeydown(e){
  var t = e.target;
  if (!t || !t.closest) return false;
  var grip = t.closest('#sgAccList [data-grip]');
  if (grip && sgGripKey(e, grip)){ e.preventDefault(); return true; }
  if (e.key === 'Enter' && t.id === 'sgKeyInp'){ e.preventDefault(); sgSaveKey(); return true; }
  if (e.key === 'Enter' && t.matches && t.matches('#sgBody input.inp:not([readonly])')){ t.blur(); return true; }
  if (e.key === 'Escape' && t.id === 'sgKeyInp'){ sgKeyOpen = false; sgRenderBody(false); return true; }
  return false;
}
