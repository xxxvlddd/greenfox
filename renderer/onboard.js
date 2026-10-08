'use strict';
/* ============================================================
   МАСТЕР ПЕРВОГО ЗАПУСКА
   ============================================================
   Перенесено из макета Main App/screens/12-onboarding.html. Мастер
   занимает всё окно: при первом запуске за ним ещё нет приложения,
   которое можно было бы затемнить. Слева — путь из трёх шагов и итог,
   который считается на глазах; справа — работа.

   Отличия от макета: в его списках стоят настоящие счета и суммы
   владельца — здесь заготовки без сумм; ветки «у меня есть выгрузка из
   банка» нет — разбора банковских файлов в приложении нет; на шаге 1
   есть дата остатков — учёт можно начать не с сегодняшнего дня, а с
   начала выписки; доходные категории и свои поступления добавляются
   так же, как траты; платёж бывает раз в год — с месяцем. Итог считает
   тот же расчёт, что «Обзор», по уже записанным данным.

   Движение — богаче, чем в макете, по просьбе владельца, но в его же
   правилах: без отскоков и пружин, каждое движение что-то сообщает —
   направление шага, пройденный путь, только что изменённое число.
   При «уменьшить движение» в системе — всё сразу и без движения.

   Пропустить можно любой шаг и всю настройку: рядом с кнопкой написано,
   что станет хуже. Имена начинаются с ob.
   ============================================================ */
var OB = null;                 /* данные мастера: счета, категории, платежи */
var obIsOpen = false;
var obView = 'welcome', obDir = 1, obPrev = null, obJust = null, obMoving = false;
var obDone = { s1: false, s2: false, s3: false }, obSkip = { s1: false, s2: false, s3: false };
var obErr = { s1: '', s2: '', s3: '' };
var obResult = null, obSaving = false;
var OB_STEPS = ['s1', 's2', 's3'];
var OB_META = {
  s1: { t: 'Счета и остатки', s: 'откуда платите' },
  s2: { t: 'Категории', s: 'на что уходит и откуда приходит' },
  s3: { t: 'Регулярные платежи', s: 'что повторяется' }
};
/* Подсказка у кнопки «Пропустить шаг» — что будет, если его пропустить,
   по тому, что уже на шаге: пустой шаг, заведённое раньше или введённое
   сейчас. Тон спокойный, когда пропуск ничего не стоит. */
function obSkipHint(step){
  var fresh = function(a){ return !a.existing && String(a.bal || '').trim() !== ''; };
  if (step === 's1'){
    if (OB.accounts.some(fresh)) return ['warn', 'Если пропустить шаг, введённые сейчас счета и остатки не сохранятся.'];
    if (OB.accounts.some(function(a){ return a.existing; })) return ['calm', 'Счета уже заведены — этот шаг можно пропустить.'];
    return ['warn', 'Если пропустить шаг, экраны останутся пустыми: без остатков приложению не из чего считать.'];
  }
  if (step === 's2'){
    if (obTouched.s2) return ['warn', 'Если пропустить шаг, ваши правки в категориях не сохранятся.'];
    return ['calm', 'Если пропустить шаг, останется список по умолчанию — поменять его можно в любой момент в «Настройках».'];
  }
  var newRec = OB.recurring.some(function(r){ return !r.existing && r.on; });
  var hasIn = OB.recurring.some(function(r){ return r.existing && r.kind === 'in'; });
  if (newRec) return ['warn', 'Если пропустить шаг, введённые сейчас платежи не сохранятся.'];
  if (hasIn) return ['calm', 'Платежи уже заведены — этот шаг можно пропустить.'];
  return ['warn', 'Если пропустить шаг, дневной лимит не посчитается: приложение не будет знать, когда придут следующие деньги.'];
}
var obTouched = { s2: false };
var obRailKept = {};           /* числа итога с прошлой отрисовки — между шагами не обнуляются */
var OB_TYPES = [['debit', 'Дебетовая карта'], ['credit', 'Кредитная карта'], ['cash', 'Наличные'],
  ['savings', 'Копилка или накопления'], ['current', 'Текущий счёт'], ['broker', 'Брокерский'], ['crypto', 'Криптокошелёк']];
/* Группы категорий: тип, заголовок, пояснение. */
var OB_GROUPS = [
  ['доход', 'Доходы', 'откуда приходят деньги'],
  ['базовые', 'Базовые', 'без них не прожить: еда, дорога, лекарства'],
  ['обязательные', 'Обязательные', 'обещаны другим и приходят в срок'],
  ['дискреционные', 'Дискреционные', 'решение тратить принимаете вы'],
  ['сбережения', 'Сбережения', 'деньги не ушли, а переехали'],
  ['прочее', 'Прочее', 'не подошло ни на одну полку']
];
var OB_MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь',
  'декабрь'];

var OB_CHECK = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
  '<path pathLength="1" d="M2.5 7.2 5.6 10.2 11.5 4" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';
var OB_X = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>';
var OB_LOCK = '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" aria-hidden="true"><rect x="2.2" y="5.2" width="7.6" height="5.4" rx="1.2"/>' +
  '<path d="M4.1 5.2V3.9a1.9 1.9 0 0 1 3.8 0v1.3"/></svg>';
var OB_TICK = '<svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
  '<path pathLength="1" d="M2.2 6.2 4.8 8.6 9.8 3.4" stroke="var(--accent-fg)" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';
var OB_SHIELD = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" aria-hidden="true"><path d="M7 1.6 2.4 3.4v3.3c0 2.6 1.9 4.6 4.6 5.7 ' +
  '2.7-1.1 4.6-3.1 4.6-5.7V3.4L7 1.6Z" stroke-linejoin="round"/></svg>';
/* ---------- суммы ---------- */
/* Поле суммы — как в окнах ввода: «450+120», запятая или точка. */
function obCents(v){ var r = fmParse(v); return r.ok ? r.cents : NaN; }
function obIsCredit(a){ return a.type === 'credit'; }
/* Счёт в долларах или евро — в рубли по курсу ЦБ на дату остатков. Курса
   ещё нет (пришёл без связи) — в сумму не входит, пока курс не придёт. */
function obRub(c, cur){
  if (!cur || cur === 'RUB') return c;
  var l = OB.fx && OB.fx[cur];
  if (!l || !l.length) return 0;
  var r = l[0][1];
  for (var i = 0; i < l.length && l[i][0] <= (OB.date || OB.today); i++) r = l[i][1];
  return Math.round(c * Number(r) / 10000);
}
/* Свои деньги — всё, кроме кредитки, в рублях; долг по кредитке — отдельно. */
function obOwn(){
  return OB.accounts.reduce(function(s, a){ var c = obCents(a.bal); return s + (obIsCredit(a) || !isFinite(c) ? 0 : obRub(c, a.cur)); }, 0);
}
var OB_CURS = [['RUB', '₽'], ['USD', '$'], ['EUR', '€']];
function obDebt(){
  return OB.accounts.reduce(function(s, a){ var c = obCents(a.bal); return s + (obIsCredit(a) && isFinite(c) ? Math.abs(c) : 0); }, 0);
}
function obCatsOn(){ return OB.cats.filter(function(c){ return c.on; }).length; }
/* В месяц: годовой платёж — двенадцатая часть, чтобы его месяц не
   выглядел катастрофой, а остальные — праздником. */
function obMonthly(r){ var c = obCents(r.amount); return r.on && isFinite(c) ? c / (r.period === 'y' ? 12 : 1) : 0; }
function obMonthOut(){ return OB.recurring.reduce(function(s, r){ return s + (r.kind === 'out' ? obMonthly(r) : 0); }, 0); }
function obMonthIn(){ return OB.recurring.reduce(function(s, r){ return s + (r.kind === 'in' ? obMonthly(r) : 0); }, 0); }
function obFilled(id){ return obDone[id] && !obSkip[id]; }
function obCatsOf(type){
  return OB.cats.filter(function(c){ return c.on && (type === 'доход' ? c.type === 'доход' : c.type !== 'доход'); })
    .map(function(c){ return c.name; });
}

/* ---------- путь и итог ---------- */
function obStepperHTML(){
  return '<div class="st">' + OB_STEPS.map(function(id, i){
    var cls = obDone[id] ? ' is-done' : (obView === id ? ' is-now' : '');
    if (obJust === id) cls += ' is-just';
    return '<div class="st-item' + cls + '">' + (i === OB_STEPS.length - 1 ? '' : '<span class="st-line"><i></i></span>') +
      '<span class="st-mark">' + (obDone[id] && !obSkip[id] ? OB_CHECK : (i + 1)) + '</span>' +
      '<span class="st-txt"><span class="st-t">' + OB_META[id].t + '</span>' +
        (obSkip[id] ? '<span class="st-skip">пропущен</span>' : '<span class="st-s">' + OB_META[id].s + '</span>') +
      '</span></div>';
  }).join('') + '</div>';
}
/* Строка итога появляется, как только её есть чем заполнить: на своём
   шаге она уже живая, после шага — остаётся. */
function obRailRows(){
  var r = [];
  if (obView === 's1' || obDone.s1){
    r.push({ id: 'own', k: 'Свои деньги', v: obOwn(), f: fmC });
    if (obDebt() > 0) r.push({ id: 'debt', k: 'Долг по кредитке', v: -obDebt(), f: fmC });
  }
  if (obView === 's2' || obDone.s2){
    r.push({ id: 'cats', k: 'Категорий выбрано', v: obCatsOn(), f: function(n){
      return Math.round(n) + NBSP + 'из' + NBSP + OB.cats.length; } });
  }
  if (obView === 's3' || obDone.s3){
    r.push({ id: 'in', k: 'Поступлений в месяц', v: obMonthIn(), f: fmC });
    r.push({ id: 'due', k: 'Обязательных в месяц', v: -obMonthOut(), f: fmC });
  }
  return r;
}
function obRailHTML(){
  var rows = obRailRows();
  var head = '<div class="rl-h">Итог</div>';
  if (!rows.length) return head + '<p class="rl-empty">Здесь будут появляться числа по мере заполнения.</p>';
  return head + rows.map(function(x){
    return '<div class="rl-row is-new" data-rl="' + x.id + '"><span class="k">' + x.k + '</span>' +
      '<span class="v" data-v="0">' + x.f(0) + '</span></div>';
  }).join('');
}
/* Первое значение — докрутка от нуля, дальше: пока человек печатает —
   сразу, без докрутки, с короткой вспышкой. */
function obPaintRail(instant){
  obRailRows().forEach(function(x){
    var row = document.querySelector('#obRl [data-rl="' + x.id + '"]');
    if (!row) return;
    var el = row.querySelector('.v');
    var was = parseFloat(el.getAttribute('data-v'));
    if (was === x.v) return;
    if (instant || REDUCED){ setNow(el, x.v, x.f); if (!REDUCED) obBump(el); }
    else { obCount(el, x.v, x.f, 0, was); if (was) obBump(el); }
  });
}
function obSyncRail(instant){
  var box = document.getElementById('obRl');
  if (!box) return;
  if (obRailRows().length !== box.querySelectorAll('.rl-row').length) box.innerHTML = obRailHTML();
  obPaintRail(instant);
}

/* ---------- движение — своё, не зависит от первой отрисовки приложения ---------- */
/* Докрутка числа: быстрый старт — счёт пошёл, мягкая остановка — можно
   прочитать итог. Метка на элементе гасит прежний цикл. */
function obCount(el, to, fmt, delay, from){
  var f = isFinite(from) ? from : 0;
  el.setAttribute('data-v', to);
  if (REDUCED){ el.textContent = fmt(to); return; }
  var tok = (Number(el.getAttribute('data-tok')) || 0) + 1;
  el.setAttribute('data-tok', tok);
  var t0 = null;
  var tick = function(t){
    if (Number(el.getAttribute('data-tok')) !== tok) return;
    if (t0 === null) t0 = t + (delay || 0);
    var p = Math.max(0, Math.min(1, (t - t0) / 720)), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(f + (to - f) * e);
    if (p < 1) requestAnimationFrame(tick);
  };
  el.textContent = fmt(f);
  requestAnimationFrame(tick);
}
function obBump(el){
  el.classList.remove('is-bump');
  void el.offsetWidth;            /* иначе снятый и возвращённый в одном кадре класс не заметят */
  el.classList.add('is-bump');
}
/* Одноразовый класс движения: снимается по окончании, чтобы следующий
   раз сработал снова. */
function obPlay(el, cls){
  if (!el || REDUCED) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(function(){ el.classList.remove(cls); }, 900);
}

/* ---------- приветствие ---------- */
function obWelcomeHTML(){
  /* Знак собирают точки (renderer/onboard-fx.js); картинка под холстом —
     на случай, если холст не заработал. Название — по буквам, чтобы
     каждая поднималась своей. */
  var word = 'GREENFOX'.split('').map(function(ch){
    return '<span class="lt" aria-hidden="true"><span>' + ch + '</span></span>';
  }).join('');
  return '<div class="ob-pane is-welcome"><div class="wl-fill"></div><div class="wl">' +
    '<div class="wl-fox" aria-hidden="true"><img src="fox.svg" alt=""></div>' +
    '<h2 class="brand-name wl-word" aria-label="GREENFOX">' + word + '</h2>' +
    '<p class="wl-lead">Домашняя бухгалтерия: считает, сколько у вас свободных денег сегодня — с учётом всего, что уже ' +
      'обещано другим.</p>' +
    '<div class="wl-list">' +
      '<div><div class="t">Сколько можно потратить</div><div class="s">Из остатка вычитается всё, что расписано ' +
        'до следующего прихода денег.</div></div>' +
      '<div><div class="t">Куда уходит</div><div class="s">Разбор по категориям, сравнение месяцев, поиск по любой ' +
        'операции.</div></div>' +
      '<div><div class="t">Что будет дальше</div><div class="s">Остаток на месяц вперёд, график кредита, сроки по ' +
        'целям и планам.</div></div>' +
    '</div>' +
    '<div class="wl-btns"><button type="button" class="btn btn-primary" data-ob-go="s1">Настроить за три шага</button></div>' +
    '<p class="wl-priv">' + OB_SHIELD + ' Данные лежат в папке на этом компьютере. Аккаунт не нужен.</p>' +
  '</div></div>';
}

/* ---------- шаг 1: счета ---------- */
function obTypeName(t){ return (OB_TYPES.filter(function(x){ return x[0] === t; })[0] || ['', t])[1]; }
function obAccRowHTML(a, i){
  var sw = '<span class="ac-sw" style="background:var(--cat-' + (i % 12 + 1) + ')"></span>';
  var bal = isFinite(obCents(a.bal)) ? obCents(a.bal) : 0;
  if (a.existing){
    return '<div class="ac-row">' + sw + '<span class="ac-nm"><span class="n">' + esc(a.name) + '</span>' +
      '<span class="s">' + obTypeName(a.type) + ' · уже заведён — править в «Настройках»</span></span>' +
      '<span class="ac-in ac-fixed">' + moneyIn(String(obIsCredit(a) ? -Math.abs(bal) : bal), a.cur) + '</span><span class="ac-x-sp"></span></div>';
  }
  var h = '<div class="ac-row is-edit' + (a.fresh ? ' is-fresh' : '') + '" data-oarow="' + i + '">' + sw +
    '<span class="ac-nm"><input class="inp" data-oa="' + i + ':name" value="' + esc(a.name) + '" placeholder="Например, «Карта Сбер»" ' +
      'aria-label="Название счёта"></span>' +
    '<span class="ac-ty"><select class="inp" data-oa="' + i + ':type" aria-label="Тип счёта">' + OB_TYPES.map(function(t){
      return '<option value="' + t[0] + '"' + (t[0] === a.type ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') +
    '</select></span>' +
    '<span class="ac-in"><input class="inp" data-oa="' + i + ':bal" inputmode="decimal" value="' + esc(a.bal) + '" ' +
      'placeholder="' + (obIsCredit(a) ? 'долг' : 'остаток') + '" aria-label="' + (obIsCredit(a) ? 'Долг' : 'Остаток') + '"></span>' +
    /* Валюта счёта: копилка в долларах, карта для подписок в евро. Кредитка — только в рублях. */
    (obIsCredit(a) ? '<span class="ac-cur is-na" title="Кредитка — только в рублях">₽</span>'
      : '<span class="ac-cur"><select class="inp" data-oa="' + i + ':cur" aria-label="Валюта счёта">' + OB_CURS.map(function(c){
          return '<option value="' + c[0] + '"' + (c[0] === (a.cur || 'RUB') ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') +
        '</select></span>') +
    (obIsCredit(a) ? '<span class="ac-pay is-na">не платёжный</span>'
      : '<button type="button" class="ac-pay" data-oapay="' + i + '" role="switch" aria-checked="' + (a.isPay ? 'true' : 'false') + '">' +
          '<span class="tg' + (a.isPay ? ' is-on' : '') + '">' + OB_TICK + '</span>платёжный</button>') +
    '<button type="button" class="ac-x" data-oadel="' + i + '" title="Убрать счёт" aria-label="Убрать счёт">' + OB_X + '</button>' +
  '</div>';
  a.fresh = false;
  /* Кредитка тянет за собой лимит и день грейса: без них не посчитать,
     до какого числа долг возвращается без процентов. */
  if (obIsCredit(a)){
    var fld = function(key, label, ph, mode, aria){
      return '<div class="f"><div class="l">' + label + '</div><input class="inp" data-oa="' + i + ':' + key + '" inputmode="' + mode + '" ' +
        'value="' + esc(a[key] || '') + '" placeholder="' + ph + '" aria-label="' + aria + '"></div>';
    };
    h += '<div class="ac-more">' +
      fld('limit', 'Кредитный лимит', '', 'decimal', 'Кредитный лимит') +
      fld('avail', 'Доступно', '', 'decimal', 'Доступно по карте') +
      fld('graceDay', 'Грейс до … числа', '1–28', 'numeric', 'День грейса') +
      fld('statementDay', 'День выписки', 'не обяз.', 'numeric', 'День выписки') +
      fld('graceLeft', 'Осталось до грейса', 'не обяз.', 'decimal', 'Осталось внести до грейса') +
      '<div class="why">Долг, лимит и «доступно» — хватит двух любых, третье посчитается. «Осталось до грейса» — ' +
        'сумма из приложения банка «внесите до …, чтобы не платить проценты»: по ней приложение будет следить за ' +
        'грейсом с первого дня.</div></div>';
  }
  return h;
}
function obS1HTML(){
  return '<div class="ob-pane"><div class="ob-scroll">' +
    '<h2 class="ob-h">С каких счетов вы платите?</h2>' +
    '<p class="ob-sub">Нужны остатки — те же, что видно в приложении банка. Ошибиться не страшно: остатки сверяются ' +
      'потом, и расхождение приложение найдёт само.</p>' +
    '<div class="ob-date"><span class="l">Остатки на</span><input class="inp" id="obDate" inputmode="numeric" ' +
      'value="' + exRuDate(OB.date) + '" placeholder="дд.мм.гггг" aria-label="Дата остатков">' +
      '<span class="h">' + (OB.accounts.some(function(a){ return a.existing; })
        ? 'Дата для новых счетов — у заведённых она своя.'
        : 'С этой даты начнётся учёт. Переносите историю из выписки — поставьте день, с которого она начинается.') + '</span></div>' +
    '<div class="ac ob-stagger">' + OB.accounts.map(obAccRowHTML).join('') + '</div>' +
    '<div class="ac-add"><button type="button" class="btn btn-sm" data-ob-add="acc">Добавить счёт</button></div>' +
    obErrHTML('s1') +
  '</div>' + obFootHTML('s1') + '</div>';
}

/* ---------- шаг 2: категории ---------- */
function obCatChipHTML(c, i){
  return '<button type="button" class="ct' + (c.on ? ' is-on' : '') + (c.lock ? ' is-locked' : '') + '" ' +
    'style="--c:var(--cat-' + (i % 12 + 1) + ')" data-oc="' + i + '" aria-pressed="' + (c.on ? 'true' : 'false') + '"' +
    (c.lock ? ' title="На этой категории держится расчёт"' : '') + '>' +
    '<span class="sw"></span>' + esc(c.name) + (c.lock ? '<span class="lk">' + OB_LOCK + '</span>' : '') + '</button>';
}
function obS2HTML(){
  var groups = OB_GROUPS.map(function(g){
    var idx = [];
    OB.cats.forEach(function(c, i){ if (c.type === g[0]) idx.push(i); });
    if (!idx.length) return '';
    var on = idx.filter(function(i){ return OB.cats[i].on; }).length;
    return '<div class="cg"><div class="cg-h"><span class="t">' + g[1] + '</span><span class="s">' + g[2] + '</span>' +
      '<span class="badge badge--muted num">' + on + '/' + idx.length + '</span></div>' +
      '<div class="cg-w">' + idx.map(function(i){ return obCatChipHTML(OB.cats[i], i); }).join('') + '</div></div>';
  }).join('');
  return '<div class="ob-pane"><div class="ob-scroll">' +
    '<h2 class="ob-h">На что уходят деньги — и откуда приходят?</h2>' +
    '<p class="ob-sub">Список уже составлен — правьте, а не сочиняйте. Выключенная категория просто не предлагается ' +
      'при вводе; включить её можно в любой момент. Свою можно добавить в любую группу — и в доходы: подработка, ' +
      'аренда, проценты по вкладу.</p>' +
    '<div class="ob-stagger">' + groups + '</div>' +
    '<div class="cg-add"><input class="inp" id="obCatNew" placeholder="Своя категория, например «Ремонт»" ' +
      'aria-label="Новая категория"><select class="inp" id="obCatType" aria-label="Группа категории">' +
      OB_GROUPS.map(function(g){ return '<option value="' + g[0] + '"' + (g[0] === 'дискреционные' ? ' selected' : '') + '>' +
        g[1].toLowerCase() + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="btn btn-sm" data-ob-add="cat">Добавить</button></div>' +
    '<p class="note">Категории с замком выключить нельзя: на продуктах, жилье и кредите держится расчёт свободных ' +
      'денег, на зарплате — заготовки поступлений, а «Прочее» — запасная полка, без неё операцию, которая никуда не ' +
      'подошла, будет некуда положить. Переводы между своими счетами тратой не считаются и в список не входят.</p>' +
    obErrHTML('s2') +
  '</div>' + obFootHTML('s2') + '</div>';
}

/* ---------- шаг 3: регулярные платежи ---------- */
function obRecRowHTML(r, i){
  if (r.existing){
    var per = r.period === 'y' ? 'раз в год' + (r.month ? ', ' + OB_MONTHS[Number(r.month) - 1] : '') : 'каждый месяц';
    return '<div class="rc-row is-saved"><span class="tg is-on is-fixed">' + OB_TICK + '</span>' +
      '<span class="rc-d rc-dt">' + (r.day ? r.day + NBSP + 'чис.' : '—') + '</span>' +
      '<span class="rc-n"><span class="rc-t">' + esc(r.name) + '</span><span class="rc-meta"><span class="s">' + esc(r.cat) + ' · ' + per +
        ' · уже заведён</span></span></span>' +
      '<span class="rc-v' + (r.kind === 'in' ? ' c-pos' : '') + '">' + fmC(r.kind === 'in' ? obCents(r.amount) : -obCents(r.amount)) +
      '</span></div>';
  }
  /* Доходы — все, и выключенные тоже: выбрали «Сдачу в аренду» — она
     включится. Траты — включённые. Нет подходящей — «Своя категория…». */
  var cats = r.kind === 'in'
    ? OB.cats.filter(function(c){ return c.type === 'доход'; }).map(function(c){ return c.name; })
    : obCatsOf('расход');
  if (r.custom && r.cat && cats.indexOf(r.cat) < 0) cats = [r.cat].concat(cats);
  var period = '<select class="inp rc-per" data-orf="' + i + ':period" aria-label="Периодичность">' +
    '<option value="m"' + (r.period !== 'y' ? ' selected' : '') + '>каждый месяц</option>' +
    '<option value="y"' + (r.period === 'y' ? ' selected' : '') + '>раз в год</option></select>' +
    (r.period === 'y' ? '<select class="inp rc-mon" data-orf="' + i + ':month" aria-label="Месяц">' +
      '<option value="">месяц…</option>' + OB_MONTHS.map(function(m, k){
        return '<option value="' + (k + 1) + '"' + (Number(r.month) === k + 1 ? ' selected' : '') + '>' + m + '</option>'; }).join('') +
      '</select>' : '');
  return '<div class="rc-row is-edit' + (r.on ? '' : ' is-off') + (r.fresh ? ' is-fresh' : '') + '" data-orrow="' + i + '">' +
    '<button type="button" class="tg' + (r.on ? ' is-on' : '') + '" data-or="' + i + '" role="switch" ' +
      'aria-checked="' + (r.on ? 'true' : 'false') + '" aria-label="' + esc(r.name || 'платёж') + '">' + OB_TICK + '</button>' +
    '<span class="rc-d"><input class="inp" data-orf="' + i + ':day" inputmode="numeric" value="' + esc(r.day) + '" ' +
      'placeholder="число" aria-label="Число месяца"></span>' +
    '<span class="rc-n">' + (r.custom
      ? '<input class="inp" data-orf="' + i + ':name" value="' + esc(r.name) + '" placeholder="' +
          (r.kind === 'in' ? 'Например, подработка' : 'Например, страховка') + '" aria-label="Название">'
      : '<span class="rc-t">' + esc(r.name) + '</span>') +
      '<span class="rc-meta">' + (r.custom
        ? (r.catNew
            ? '<input class="inp rc-newcat" data-orf="' + i + ':newcat" placeholder="' + (r.kind === 'in' ? 'Например, «Сдача гаража»'
                : 'Например, «Страховка»') + '" aria-label="Своя категория">'
            : '<select class="inp rc-cat" data-orf="' + i + ':cat" aria-label="Категория">' + cats.map(function(c){
                return '<option' + (c === r.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
              '<option value="__new">Своя категория…</option></select>')
        : '<span class="s">' + esc(r.cat) + '</span>') + period + '</span></span>' +
    '<span class="rc-a"><input class="inp" data-orf="' + i + ':amount" inputmode="decimal" value="' + esc(r.amount) + '" ' +
      'placeholder="сумма" aria-label="Сумма"></span>' +
    (r.custom ? '<button type="button" class="ac-x" data-ordel="' + i + '" title="Убрать" aria-label="Убрать">' + OB_X + '</button>'
              : '<span class="ac-x-sp"></span>') +
  '</div>';
}
function obS3HTML(){
  var col = function(kind, title, total, add){
    var rows = [];
    OB.recurring.forEach(function(r, i){ if (r.kind === kind){ rows.push(obRecRowHTML(r, i)); r.fresh = false; } });
    return '<div class="rc-col"><div class="rc-ch">' + title + '<span class="c" id="obRc' + kind + '">' + fmC(total) + '</span></div>' +
      rows.join('') + '<button type="button" class="rc-add" data-ob-add="rec-' + kind + '">' +
      '<span class="pl">+</span>' + add + '</button></div>';
  };
  return '<div class="ob-pane"><div class="ob-scroll">' +
    '<h2 class="ob-h">Что повторяется каждый месяц?</h2>' +
    '<p class="ob-sub">Главный шаг из трёх. Пока приложение не знает, что уже обещано и когда придут следующие деньги, ' +
      'любая «свободная сумма» — выдумка. Впишите сумму и число — строка включится сама.</p>' +
    '<div class="rc">' + col('in', 'Поступления', obMonthIn(), 'Добавить поступление') +
      col('out', 'Списания', -obMonthOut(), 'Добавить списание') + '</div>' +
    '<p class="note">Число — это расписание, а не проведённая операция: когда деньги придут или уйдут на самом деле, ' +
      'операция встанет в журнал, а приложение сверит её с расписанием. Годовые платежи в итогах раскладываются на ' +
      'двенадцать месяцев. Всё здесь привязано к первому платёжному счёту; другой счёт, сумму «от и до», неделю или ' +
      'квартал — в «Настройках» → «Регулярные платежи».</p>' +
    obErrHTML('s3') +
  '</div>' + obFootHTML('s3') + '</div>';
}

/* ---------- подвал шага, ошибка ---------- */
function obFootHTML(step){
  var i = OB_STEPS.indexOf(step);
  return '<div class="ob-foot">' +
    '<button type="button" class="btn btn-quiet" data-ob-go="' + (i === 0 ? 'welcome' : OB_STEPS[i - 1]) + '" data-dir="-1">Назад</button>' +
    '<span class="spacer"></span>' +
    obCostHTML(step) +
    '<button type="button" class="btn btn-quiet" data-ob-skip="' + step + '">Пропустить шаг</button>' +
    '<button type="button" class="btn btn-primary" data-ob-next="' + step + '"' + (obSaving ? ' disabled' : '') + '>' +
      (i === OB_STEPS.length - 1 ? 'Готово' : 'Дальше') + '</button></div>';
}
function obCostHTML(step){
  var h = obSkipHint(step);
  return '<span class="ob-cost' + (h[0] === 'calm' ? ' is-calm' : '') + '" id="obCost">' + h[1] + '</span>';
}
/* Подсказка меняется вместе с шагом: ввели остаток — пропуск уже стоит
   введённого. */
function obSyncCost(){
  var el = document.getElementById('obCost');
  if (!el || OB_STEPS.indexOf(obView) < 0) return;
  var h = obSkipHint(obView);
  el.textContent = h[1];
  el.classList.toggle('is-calm', h[0] === 'calm');
}
function obErrHTML(step){
  return obErr[step] ? '<div class="note-warn ob-err"><span class="dot"></span><span>' + esc(obErr[step]) + '</span></div>' : '';
}

/* ---------- итог ---------- */
function obDoneHTML(){
  var r = obResult || { empty: true };
  var ready = !r.empty && r.dayLimit !== null && r.dayLimit !== undefined;
  /* Обещано больше, чем есть: лимит — ноль, и сказано, сколько не хватает. */
  var short = ready && Number(r.free) < 0 ? -Number(r.free) : 0;
  var dash = '—';
  var when = r.nextIncome ? humanDate(r.nextIncome) : '';
  var rows = r.empty ? '' :
    '<div class="dn-row"><span class="k">На платёжных счетах<span class="s">чем платите каждый день</span></span>' +
      '<span class="v" data-cnt="' + r.available + '" data-fmt="2">' + money(r.available) + '</span></div>' +
    '<div class="dn-row"><span class="k">Обязательные до поступления<span class="s">' + (when ? 'до ' + when : 'поступлений нет') +
      '</span></span><span class="v' + (when ? ' c-neg' : '') + '"' + (when ? ' data-cnt="-' + r.dueBefore + '" data-fmt="2"' : '') + '>' +
      (when ? money('-' + r.dueBefore) : dash) + '</span></div>' +
    '<div class="dn-row"><span class="k">Свободно<span class="s">' + (when ? 'до ' + when + ', ' + nDays(r.daysToIncome) : 'не посчитать') +
      '</span></span><span class="v"' + (ready ? ' data-cnt="' + r.free + '" data-fmt="0"' : '') + '>' + (ready ? money0(r.free) : dash) +
      '</span></div>' +
    '<div class="dn-row is-key"><span class="k">Можно тратить в день</span>' +
      '<span class="v" id="obKey">' + (ready ? money0(short ? '0' : r.dayLimit) : dash) + '</span></div><div class="dn-bar"><i></i></div>' +
    (short ? '<div class="note-warn dn-short"><span class="dot"></span><span><b>До ' + when + ' обещано больше, чем есть.</b> ' +
      'Обязательные платежи — ' + money(r.dueBefore) + ', на платёжных счетах — ' + money(r.available) + ': не хватает ' +
      money(String(short)) + '. Дневной лимит — ноль, пока не придут деньги или не появится остаток на другом счёте.</span></div>' : '');
  var miss = [];
  if (r.empty) miss.push(1);
  if (!when) miss.push(3);
  var tail;
  if (ready){
    tail = '<p class="dn-hint"><span class="dot"></span><span>Первую трату — кнопкой «Добавить операцию» или ' +
      '<code>⌘E</code>. С ключом ассистента (Настройки → Ассистент) можно и словами: <code>вчера 1200 в пятёрочке</code>.</span></p>' +
      '<div class="dn-btns"><button type="button" class="btn btn-primary" data-ob-finish="1">Открыть обзор</button>' +
      '<button type="button" class="btn btn-quiet" data-ob-go="s1" data-dir="-1">Вернуться к настройке</button></div>';
  } else {
    tail = '<div class="note-warn" style="margin-top:20px"><span class="dot"></span><span>Без ' +
      (miss.length === 1 ? 'шага ' : 'шагов ') + miss.join(' и ') + ' главное число не считается: приложение не знает, ' +
      (r.empty ? 'сколько у вас денег' : '') + (r.empty && !when ? ' и ' : '') + (!when ? 'когда придут следующие' : '') +
      '. Открыть приложение можно и так — экраны будут пустыми или без дневного лимита.</span></div>' +
      '<div class="dn-btns"><button type="button" class="btn btn-primary" data-ob-go="s' + miss[0] + '" data-dir="-1">Доделать шаг ' +
      miss[0] + '</button><button type="button" class="btn btn-quiet" data-ob-finish="1">Всё равно открыть</button></div>';
  }
  return '<div class="ob-pane is-done"><div class="dn"><div class="dn-glow" aria-hidden="true"></div><div class="dn-w ob-stagger">' +
    '<div class="dn-top"><span class="dn-ok"><i class="ring"></i><i class="ring r2"></i>' +
      '<svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
      '<path pathLength="1" d="M2.5 7.2 5.6 10.2 11.5 4" stroke="var(--accent-fg)" stroke-width="1.8" stroke-linecap="round" ' +
      'stroke-linejoin="round"/></svg></span><h2>' + (ready ? 'Готово. Вот первое число.' : 'Настройка отложена.') + '</h2></div>' +
    '<p class="dn-sub">' + (ready ? 'Всё остальное приложение посчитает само — из того, что вы внесёте дальше.'
      : 'Вернуться к мастеру можно в любой момент: Настройки → Данные → Мастер первого запуска.') + '</p>' +
    (rows ? '<div class="dn-rows">' + rows + '</div>' : '') + tail + '</div></div></div>';
}

/* ---------- движение ----------
   Только прозрачность и сдвиг — их считает видеокарта, и кадры не
   теряются. Прежнее размытие экрана и перерисовки под маской на Retina
   стоили кадров, а анимации, заданные в стилях, проигрывались заново при
   каждой перерисовке шага — дёргалось всё. Теперь движение запускается
   только явно: при смене экрана и в ответ на действие.

   Смена экрана — без пустого кадра: прежний экран переносится в слой
   поверх и гаснет там, новый уже стоит на своём месте и проявляется.
   Путь слева при этом не перерисовывается. */
var OB_OUT = 'cubic-bezier(.16, 1, .3, 1)';         /* мягкая остановка */
var OB_AWAY = 'cubic-bezier(.4, 0, .9, .6)';        /* уход: разгон без рывка */
function obA(el, frames, o){
  if (!el || REDUCED || !el.animate) return null;
  try { return el.animate(frames, Object.assign({ fill: 'backwards', easing: OB_OUT }, o || {})); } catch (e) { return null; }
}
/* Подъём по очереди: dy — откуда, step — шаг очереди. */
/* Подушка перед появлением: кадр, в котором собирается новый экран,
   длинный — появление начинается после него и не теряет первых кадров. */
var OB_CUSHION = 90;
function obRise(list, base, step, dy, dur, dx){
  var out = [];
  list.forEach(function(el, i){
    var a = obA(el, [{ opacity: 0, transform: 'translate(' + (dx || 0) + 'px,' + (dy || 0) + 'px)' },
                     { opacity: 1, transform: 'none' }], { duration: dur, delay: OB_CUSHION + base + Math.min(i, 12) * step });
    if (a) out.push(a);
  });
  return out;
}
/* Прежний экран — в слой поверх тела мастера, на то же место и с той же
   прокруткой. Без id: getElementById и поиск по #obBody видят только
   живой экран. */
function obGhost(el){
  var body = document.getElementById('obBody'), stage = document.getElementById('obStage');
  var br = body.getBoundingClientRect(), r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
  var keep = [].map.call(el.querySelectorAll('.ob-scroll'), function(x){ return x.scrollTop; });
  var g = document.createElement('div');
  g.className = 'ob-ghost';
  g.setAttribute('aria-hidden', 'true');
  g.style.cssText = 'left:' + (br.left - sr.left) + 'px;top:' + (br.top - sr.top) + 'px;width:' + br.width + 'px;height:' + br.height + 'px';
  el.style.position = 'absolute'; el.style.margin = '0';
  el.style.left = (r.left - br.left) + 'px'; el.style.top = (r.top - br.top) + 'px';
  el.style.width = r.width + 'px'; el.style.height = r.height + 'px';
  el.removeAttribute('id');
  [].forEach.call(el.querySelectorAll('[id]'), function(x){ x.removeAttribute('id'); });
  g.appendChild(el);
  stage.appendChild(g);
  [].forEach.call(el.querySelectorAll('.ob-scroll'), function(x, i){ x.scrollTop = keep[i] || 0; });
  return g;
}
function obAway(el, dy, dur){
  if (!el) return;
  var g = obGhost(el);
  var a = obA(g, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(' + dy + 'px)' }],
              { duration: dur, easing: OB_AWAY, fill: 'forwards' });
  if (a) a.onfinish = function(){ g.remove(); }; else g.remove();
}
/* Уход с приветствия: текст и фон гаснут быстро, а знак рассыпается
   поверх следующего шага ещё полсекунды — точки разлетаются по новому
   экрану и тают. */
function obAwayWelcome(old){
  var g = obGhost(old);
  if (typeof obFxLeave === 'function') obFxLeave();
  obA(old.querySelector('.wl'), [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }],
      { duration: 220, easing: OB_AWAY, fill: 'forwards' });
  obA(old.querySelector('.wl-fill'), [{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: OB_AWAY, fill: 'forwards' });
  setTimeout(function(){ g.remove(); }, 700);
}
/* Старт приветствия — когда окно уже показано и шрифты на месте: иначе
   первые кадры проигрываются в скрытом окне, и человек видит середину. */
var obShown = false, obShownWait = [];
function obReady(){
  return new Promise(function(res){
    var go = function(){ requestAnimationFrame(function(){ requestAnimationFrame(res); }); };
    var fonts = document.fonts && document.fonts.load
      ? Promise.all([document.fonts.ready, document.fonts.load('400 32px "Special Gothic Expanded One"')]).catch(function(){})
      : Promise.resolve();
    var shown = obShown ? Promise.resolve() : new Promise(function(ok){
      obShownWait.push(ok);
      setTimeout(ok, 900);           /* окно, которое не показывают (проверки), — не ждём вечно */
    });
    Promise.all([fonts, shown]).then(go);
  });
}
/* Шаг: блоки поднимаются по очереди, строки списков — внутри своей очереди. */
function obEnterStep(pane, dir){
  var units = [], sc = pane.querySelector('.ob-scroll');
  if (sc) [].forEach.call(sc.children, function(k){
    if (k.classList.contains('ob-stagger')) [].forEach.call(k.children, function(x){ units.push(x); });
    else units.push(k);
  });
  obRise(units, 30, 30, 16 * dir, 640);
  obA(pane.querySelector('.ob-foot'), [{ opacity: 0 }, { opacity: 1 }], { duration: 520, delay: 140 });
}
/* Путь слева появляется сбоку — один раз, при входе в шаги. */
function obEnterRail(rail){
  obRise([].slice.call(rail.querySelectorAll('.st-item')).concat([rail.querySelector('.rl')]), 60, 70, 0, 720, -22);
}
/* Итог: строки по очереди; значок, кольца и полоса — в стилях (.is-enter). */
function obEnterDone(pane){
  var w = pane.querySelector('.dn-w');
  if (w) obRise([].slice.call(w.children), 60, 90, 16, 760);
  obA(pane.querySelector('.dn-glow'), [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 0.9, transform: 'none' }],
      { duration: 1600, delay: 120 });
}
/* Приветствие: знак собирается из точек, следом по буквам встаёт
   название, потом текст, карточки и кнопка. Всё ждёт показа окна. */
function obEnterWelcome(pane, move){
  var still = REDUCED || !move;
  var sc = typeof obFxStart === 'function' ? obFxStart(pane, { still: still }) : null;
  if (still) return;
  /* Прогрев холста — пока на экране ещё ничего не движется. */
  if (sc && sc.warm) sc.warm();
  var anims = [];
  var lt = pane.querySelectorAll('.wl-word .lt > span');
  [].forEach.call(lt, function(x, i){
    var a = obA(x, [{ transform: 'translateY(105%)' }, { transform: 'none' }], { duration: 900, delay: 900 + i * 55 });
    if (a) anims.push(a);
  });
  anims = anims.concat(obRise([pane.querySelector('.wl-lead')], 1300, 0, 14, 820));
  /* Карточки — одним блоком: у списка фон-линии, он не должен проступать
     раньше карточек. */
  anims = anims.concat(obRise([pane.querySelector('.wl-list')], 1450, 0, 18, 860));
  anims = anims.concat(obRise([pane.querySelector('.wl-btns'), pane.querySelector('.wl-priv')], 1750, 110, 14, 820));
  if (!sc && !anims.length) return;
  /* До старта всё стоит в начальном положении: анимации созданы и
     поставлены на паузу. */
  anims.forEach(function(a){ a.pause(); });
  /* Окно показано и шрифты на месте — и ещё подушка: первый запуск
     после установки занят (macOS проверяет приложение, графика
     готовится), движение начинается, когда браузер освободился. */
  obReady().then(function(){
    whenIdle(function(){
      if (!pane.isConnected) return;
      if (sc) sc.play();
      anims.forEach(function(a){ a.play(); });
    }, 350, 900);
  });
}

/* ---------- сборка ---------- */
function obPaneHTML(){
  return obView === 'welcome' ? obWelcomeHTML() : obView === 's1' ? obS1HTML() : obView === 's2' ? obS2HTML()
       : obView === 's3' ? obS3HTML() : obDoneHTML();
}
/* quiet — перерисовка на месте (добавили строку, поменяли тип счёта):
   без движения. Иначе — смена экрана с движением. */
function obRender(quiet){
  var body = document.getElementById('obBody');
  var solo = obView === 'welcome' || obView === 'done';
  var move = !quiet && !REDUCED;
  /* Итог переживает смену шага: прежние числа остаются на месте, докручивается
     только то, что изменилось, а появляется — новая строка. */
  var rows = body.querySelectorAll('#obRl .rl-row'), kept = rows.length ? {} : obRailKept;
  [].forEach.call(rows, function(r){
    kept[r.getAttribute('data-rl')] = parseFloat(r.querySelector('.v').getAttribute('data-v'));
  });
  obRailKept = kept;
  var tmp = document.createElement('div');
  tmp.innerHTML = obPaneHTML();
  var pane = tmp.firstElementChild;
  var old = body.querySelector(':scope > .ob-pane');
  var rail = body.querySelector(':scope > .ob-rail');
  var dir = obDir >= 0 ? 1 : -1;
  /* Прежний экран уходит в слой поверх; приветствие — дольше: знак рассыпается. */
  if (old){
    if (move && old.classList.contains('is-welcome')) obAwayWelcome(old);
    else if (move) obAway(old, -12 * dir, 300);
    else {
      if (old.classList.contains('is-welcome') && typeof obFxStop === 'function') obFxStop();
      old.remove();
    }
  }
  var railNew = false;
  if (solo){
    if (rail){ if (move) obAway(rail, 0, 300); else rail.remove(); rail = null; }
  } else {
    if (!rail){
      rail = document.createElement('div');
      rail.className = 'ob-rail';
      rail.innerHTML = '<div class="ob-st"></div><div class="rl" id="obRl"></div>';
      body.insertBefore(rail, body.firstChild);
      railNew = true;
    }
    rail.classList.toggle('is-enter', move);
    rail.querySelector('.ob-st').innerHTML = obStepperHTML();
  }
  body.className = 'ob-body' + (solo ? ' is-solo' : '') + (move ? ' is-enter' : '');
  pane.classList.toggle('is-enter', move);
  body.appendChild(pane);
  obJust = null;
  if (!solo){
    document.getElementById('obRl').innerHTML = obRailHTML();
    obRailRows().forEach(function(x){
      if (!(x.id in kept)) return;
      var row = document.querySelector('#obRl [data-rl="' + x.id + '"]'), el = row.querySelector('.v');
      row.classList.remove('is-new');
      el.setAttribute('data-v', kept[x.id]);
      el.textContent = x.f(kept[x.id]);
    });
    obPaintRail(!move);
  }
  /* Итог: строки докручиваются по очереди, следом — главное число. */
  if (obView === 'done' && obResult && !obResult.empty){
    [].forEach.call(pane.querySelectorAll('.dn-row .v[data-cnt]'), function(el, i){
      var to = Number(el.getAttribute('data-cnt')), dec = el.getAttribute('data-fmt') === '2';
      obCount(el, to, function(v){ return dec ? money(String(Math.round(v))) : money0(String(Math.round(v))); }, move ? 520 + i * 120 : 0);
    });
    var key = document.getElementById('obKey');
    if (key && obResult.dayLimit !== null && obResult.dayLimit !== undefined){
      obCount(key, Math.max(0, Number(obResult.dayLimit)), function(v){ return money0(String(Math.round(v))); }, move ? 960 : 0);
    }
  }
  if (move){
    /* Второй щелчок двойного по «Дальше» попал бы в кнопку нового экрана
       и проскочил шаг: первые мгновения экран щелчков мышью не принимает. */
    pane.style.pointerEvents = 'none';
    setTimeout(function(){ pane.style.pointerEvents = ''; }, 280);
    if (obView === 'done') obEnterDone(pane);
    else if (!solo) obEnterStep(pane, dir);
    if (railNew) obEnterRail(rail);
  }
  if (obView === 'welcome') obEnterWelcome(pane, move);
  var i = OB_STEPS.indexOf(obView);
  document.getElementById('obCount').textContent = i >= 0 ? 'шаг ' + (i + 1) + ' из ' + OB_STEPS.length : '';
  document.getElementById('obQuit').hidden = obView === 'done';
}
/* Смена экрана: сразу, без паузы между уходом и приходом. */
function obGo(view, dir){
  obPrev = obView;
  obDir = dir === undefined ? 1 : dir;
  obView = view;
  obRender(false);
  var sc = document.querySelector('#obBody .ob-scroll');
  if (sc) sc.scrollTop = 0;
}
/* ---------- проверки шага — до того как идти дальше ---------- */
function obCheck(step){
  if (step === 's1'){
    if (!exParseDate(document.getElementById('obDate') ? document.getElementById('obDate').value : exRuDate(OB.date))) {
      return 'Дата остатков: в виде дд.мм.гггг';
    }
    for (var i = 0; i < OB.accounts.length; i++){
      var a = OB.accounts[i];
      if (a.existing) continue;
      var named = String(a.name || '').trim(), c = obCents(a.bal);
      if (!named && !String(a.bal || '').trim()) continue;
      if (!named) return 'Счёт без названия: впишите, как он называется';
      var blankBal = !String(a.bal || '').trim();
      if (!blankBal && !isFinite(c)) return '«' + named + '»: остаток — числом';
      if (obIsCredit(a)){
        /* Долг, лимит и «доступно» — хватит двух любых. */
        var has = function(v){ return String(v || '').trim() !== '' && isFinite(obCents(v)); };
        var known = (has(a.bal) ? 1 : 0) + (has(a.limit) ? 1 : 0) + (has(a.avail) ? 1 : 0);
        if (known < 2 || (!has(a.limit) && !has(a.avail))) return '«' + named + '»: впишите лимит или сколько доступно — хватит двух чисел из трёх';
        if (has(a.statementDay)){
          var sd = Number(a.statementDay);
          if (!(sd >= 1 && sd <= 28 && Math.round(sd) === sd)) return '«' + named + '»: день выписки — число от 1 до 28';
        }
        var gd = Number(a.graceDay);
        if (!(gd >= 1 && gd <= 28 && Math.round(gd) === gd)) return '«' + named + '»: день грейса — число от 1 до 28';
      }
    }
  }
  if (step === 's3'){
    for (var j = 0; j < OB.recurring.length; j++){
      var r = OB.recurring[j];
      if (r.existing || !r.on) continue;
      var nm = String(r.name || '').trim() || (r.kind === 'in' ? 'Новое поступление' : 'Новое списание');
      if (r.custom && !String(r.name || '').trim()) return nm + ': впишите название';
      if (!(obCents(r.amount) > 0)) return '«' + nm + '»: впишите сумму';
      var d = Number(r.day);
      if (!(d >= 1 && d <= 31 && Math.round(d) === d)) return '«' + nm + '»: число месяца — от 1 до 31';
      if (r.period === 'y' && !(Number(r.month) >= 1)) return '«' + nm + '»: раз в год — в каком месяце?';
      if (!r.cat) return '«' + nm + '»: выберите категорию';
    }
  }
  return '';
}

/* ---------- запись ---------- */
/* Сумма из поля — копейками строкой; пусто — пустая строка. */
function obCentsStr(v){
  var c = obCents(v);
  return String(v === undefined || v === null ? '' : v).trim() !== '' && isFinite(c) ? String(Math.abs(c)) : '';
}
/* Кредитка: из двух чисел — долг, лимит, «доступно» — пустое третье
   подсказкой показывает, каким оно станет. */
function obCardHint(i){
  var a = OB.accounts[i];
  if (!a || !obIsCredit(a)) return;
  var row = document.querySelector('#obBody [data-oarow="' + i + '"]');
  if (!row) return;
  var more = row.nextElementSibling;
  var num = function(v){ var c = obCents(v); return String(v || '').trim() !== '' && isFinite(c) ? Math.abs(c) : null; };
  var d = num(a.bal), l = num(a.limit), v = num(a.avail);
  var put = function(el, cents){ if (el) el.placeholder = cents === null || cents < 0 ? (el === row.querySelector('[data-oa$=":bal"]') ? 'долг' : '') : '= ' + money0(String(cents)).replace(NBSP + '₽', ''); };
  var elD = row.querySelector('[data-oa$=":bal"]'), elL = more && more.querySelector('[data-oa$=":limit"]'), elV = more && more.querySelector('[data-oa$=":avail"]');
  put(elD, d === null && l !== null && v !== null ? l - v : null);
  put(elL, l === null && d !== null && v !== null ? d + v : null);
  put(elV, v === null && d !== null && l !== null ? l - d : null);
}
function obPayload(){
  var steps = { s1: obFilled('s1'), s2: obFilled('s2'), s3: obFilled('s3') };
  var date = exParseDate(exRuDate(OB.date)) || OB.today;
  return {
    date: date, steps: steps,
    accounts: OB.accounts.map(function(a){
      var c = obCents(a.bal);
      return { existing: !!a.existing, name: a.name, type: a.type, isPay: !!a.isPay, cur: obIsCredit(a) ? 'RUB' : (a.cur || 'RUB'),
        bal: isFinite(c) && String(a.bal).trim() !== '' ? String(obIsCredit(a) ? -Math.abs(c) : c) : '',
        limit: obIsCredit(a) ? obCentsStr(a.limit) : null, graceDay: obIsCredit(a) ? Number(a.graceDay) : null,
        avail: obIsCredit(a) ? obCentsStr(a.avail) : null, statementDay: obIsCredit(a) ? String(a.statementDay || '').trim() : null,
        graceLeft: obIsCredit(a) ? obCentsStr(a.graceLeft) : null };
    }),
    cats: OB.cats.map(function(c){ return { name: c.name, type: c.type, on: !!c.on, custom: !!c.custom }; }),
    recurring: OB.recurring.map(function(r){
      return { existing: !!r.existing, kind: r.kind, name: r.name, cat: r.cat, on: !!r.on, day: Number(r.day),
               amount: String(obCents(r.amount)), period: r.period === 'y' ? 'y' : 'm', month: r.period === 'y' ? Number(r.month) : null };
    })
  };
}
function obStepOf(msg){
  var m = /^Шаг (\d)/.exec(msg || '');
  if (m) return 's' + m[1];
  if (/^Категории/.test(msg || '')) return 's2';
  return obView === 'done' || obView === 'welcome' ? 's1' : obView;
}
function obFinish(){
  if (obSaving) return;
  obSaving = true;
  window.api.onboardApply(obPayload()).then(function(r){
    obSaving = false;
    if (!r || !r.ok){
      var step = obStepOf(r && r.error);
      obErr[step] = (r && r.error) || 'не записалось';
      obDone[step] = false;
      obGo(step, -1);
      return;
    }
    obResult = r.result;
    obErr = { s1: '', s2: '', s3: '' };
    /* Записанное становится «уже заведённым»: вернувшись к шагам, человек
       видит его как есть, а не заготовки, которые запишутся второй раз. */
    return window.api.onboardState().then(function(s){
      if (s && !s.error) obLoad(s);
      obGo('done', 1);
    });
  });
}

/* ---------- открыть и закрыть ---------- */
function obLoad(s){
  OB = s;
  OB.accounts.forEach(function(a){
    a.bal = a.bal === '' ? '' : fmRaw(Math.abs(Number(a.bal)) * (a.type === 'credit' ? 1 : Math.sign(Number(a.bal)) || 1));
    if (a.limit) a.limit = fmRaw(a.limit);
  });
  OB.recurring.forEach(function(r){ if (r.amount !== '') r.amount = fmRaw(r.amount); });
}
function obOpen(s, overApp){
  obLoad(s);
  obIsOpen = true;
  if (typeof updRender === 'function') updRender();
  obView = 'welcome'; obDir = 1; obPrev = null; obJust = null; obMoving = false; obResult = null;
  obDone = { s1: false, s2: false, s3: false }; obSkip = { s1: false, s2: false, s3: false };
  obErr = { s1: '', s2: '', s3: '' };
  obTouched = { s2: false }; obRailKept = {};
  if (asIsOpen) asToggle(false);
  fmClose();
  var layer = document.getElementById('obLayer');
  layer.hidden = false;
  document.body.style.overflow = 'hidden';
  obRender(false);
  /* Из «Настроек» — поверх уже открытого приложения: мастер проявляется.
     При первом запуске за ним ничего нет — он сразу на месте. */
  if (overApp) obA(document.getElementById('obStage'), [{ opacity: 0 }, { opacity: 1 }], { duration: 360 });
}
/* Из «Настроек»: мастер работает, пока в учёте нет операций. */
function obStart(){
  return window.api.onboardState().then(function(s){
    if (!s || s.error){ toast('Мастер не открылся: ' + ((s && s.error) || 'нет данных')); return; }
    if (!s.available){ toast('Мастер работает на чистой базе, а в учёте уже есть операции'); return; }
    obOpen(s, true);
  });
}
/* Закрыть: под мастером уже нарисован «Обзор», мастер растворяется
   поверх него. */
function obClose(){
  obIsOpen = false;
  window.scrollTo(0, 0);
  current = 'overview';
  refreshAssistant();
  if (typeof obFxStop === 'function') obFxStop();
  var stage = document.getElementById('obStage');
  var done = function(){
    document.getElementById('obLayer').hidden = true;
    document.getElementById('obBody').innerHTML = '';
    [].forEach.call(stage.querySelectorAll('.ob-ghost'), function(g){ g.remove(); });
    document.body.style.overflow = '';
    /* Пока шёл мастер, плашка обновления ждала. */
    if (typeof updRender === 'function') updRender();
  };
  /* Под мастером уже нарисован «Обзор»: мастер гаснет поверх него и чуть
     приближается — как будто растворяется в приложении. */
  Promise.resolve(draw()).then(function(){
    var a = obA(stage, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.015)' }],
                { duration: 460, easing: OB_OUT, fill: 'forwards' });
    if (!a){ done(); return; }
    a.onfinish = function(){ done(); a.cancel(); };
  });
}

/* ---------- события ---------- */
function obInit(){
  var layer = document.getElementById('obLayer');
  /* Окно показано — можно начинать приветствие. */
  if (window.api.onShown) window.api.onShown(function(){
    obShown = true;
    obShownWait.splice(0).forEach(function(f){ f(); });
  });
  layer.addEventListener('click', function(e){
    var t = e.target.closest ? e.target : null;
    if (!t) return;
    var b;
    if ((b = t.closest('[data-ob-go]'))){
      obGo(b.getAttribute('data-ob-go'), b.getAttribute('data-dir') === '-1' ? -1 : 1);
      return;
    }
    if ((b = t.closest('[data-ob-next]'))){
      var s = b.getAttribute('data-ob-next');
      obErr[s] = obCheck(s);
      if (obErr[s]){ obRender(true); obPlay(document.querySelector('#obBody .ob-err'), 'is-shake'); return; }
      if (s === 's1') OB.date = exParseDate(document.getElementById('obDate').value) || OB.date;
      if (!obDone[s] || obSkip[s]) obJust = s;
      obDone[s] = true; obSkip[s] = false;
      if (s === 's3') obFinish(); else obGo(OB_STEPS[OB_STEPS.indexOf(s) + 1], 1);
      return;
    }
    if ((b = t.closest('[data-ob-skip]'))){
      var k = b.getAttribute('data-ob-skip');
      obErr[k] = '';
      obDone[k] = true; obSkip[k] = true;
      if (k === 's3') obFinish(); else obGo(OB_STEPS[OB_STEPS.indexOf(k) + 1], 1);
      return;
    }
    if (t.closest('#obQuit')){
      /* «Пропустить настройку» закрывает оставшиеся шаги как пропущенные
         и ведёт на итог — там честно написано, что из этого вышло. */
      OB_STEPS.forEach(function(x){ if (!obDone[x]){ obDone[x] = true; obSkip[x] = true; } });
      obFinish();
      return;
    }
    if (t.closest('[data-ob-finish]')){ obClose(); return; }
    /* Переключатели правим на месте: перерисовка проиграла бы появление
       экрана, которого не было. */
    if ((b = t.closest('[data-oc]'))){
      var c = OB.cats[Number(b.getAttribute('data-oc'))];
      if (!c || c.lock){ obPlay(b, 'is-nope'); return; }
      c.on = !c.on;
      obTouched.s2 = true;
      b.classList.toggle('is-on', c.on);
      b.setAttribute('aria-pressed', c.on ? 'true' : 'false');
      if (c.on) obPlay(b, 'is-pop');
      obSyncCost();
      var cg = b.closest('.cg'), badge = cg && cg.querySelector('.badge');
      if (badge){
        var chips = cg.querySelectorAll('[data-oc]');
        badge.textContent = [].filter.call(chips, function(x){ return x.classList.contains('is-on'); }).length + '/' + chips.length;
      }
      obSyncRail(false);
      return;
    }
    if ((b = t.closest('[data-or]'))){
      var r = OB.recurring[Number(b.getAttribute('data-or'))];
      obSetRec(r, b.closest('.rc-row'), !r.on);
      obSyncTotals();
      return;
    }
    if ((b = t.closest('[data-oapay]'))){
      var a = OB.accounts[Number(b.getAttribute('data-oapay'))];
      a.isPay = !a.isPay;
      b.setAttribute('aria-checked', a.isPay ? 'true' : 'false');
      b.querySelector('.tg').classList.toggle('is-on', a.isPay);
      if (a.isPay) obPlay(b.querySelector('.tg'), 'is-pop');
      return;
    }
    if ((b = t.closest('[data-oadel]'))){
      obRemove(b.closest('.ac-row'), function(){ OB.accounts.splice(Number(b.getAttribute('data-oadel')), 1); obRender(true); obSyncRail(true); obSyncCost(); });
      return;
    }
    if ((b = t.closest('[data-ordel]'))){
      obRemove(b.closest('.rc-row'), function(){ OB.recurring.splice(Number(b.getAttribute('data-ordel')), 1); obRender(true); obSyncTotals(); obSyncCost(); });
      return;
    }
    if ((b = t.closest('[data-ob-add]'))){
      var kind = b.getAttribute('data-ob-add');
      if (kind === 'acc'){
        OB.accounts.push({ name: '', type: 'debit', bal: '', isPay: true, fresh: !REDUCED });
        obRender(true);
        var ins = document.querySelectorAll('#obBody [data-oa$=":name"]');
        if (ins.length) ins[ins.length - 1].focus();
      } else if (kind === 'cat'){
        var inp = document.getElementById('obCatNew'), nm = inp ? inp.value.replace(/\s+/g, ' ').trim() : '';
        if (!nm){ if (inp) inp.focus(); return; }
        if (OB.cats.some(function(x){ return x.name.toLowerCase() === nm.toLowerCase(); })){
          obErr.s2 = 'Такая категория уже есть: ' + nm; obRender(true); return;
        }
        obErr.s2 = '';
        obTouched.s2 = true;
        OB.cats.push({ name: nm, type: document.getElementById('obCatType').value, on: true, lock: false, custom: true });
        obRender(true);
        obPlay(document.querySelector('#obBody [data-oc="' + (OB.cats.length - 1) + '"]'), 'is-pop');
        obSyncRail(false);
      } else {
        var dirIn = kind === 'rec-in';
        var cats = obCatsOf(dirIn ? 'доход' : 'расход');
        OB.recurring.push({ kind: dirIn ? 'in' : 'out', name: '', cat: dirIn ? (cats.filter(function(c){ return c !== 'Зарплата'; })[0] || 'Зарплата')
          : (cats.indexOf('Подписки и связь') >= 0 ? 'Подписки и связь' : cats[0]), day: '', amount: '', on: false,
          period: 'm', month: '', custom: true, fresh: !REDUCED });
        obRender(true);
        var names = document.querySelectorAll('#obBody .rc-row.is-edit [data-orf$=":name"]');
        if (names.length) names[names.length - 1].focus();
      }
    }
  });
  layer.addEventListener('input', function(e){
    var t = e.target, f = t.getAttribute && (t.getAttribute('data-oa') || t.getAttribute('data-orf'));
    if (!f) return;
    var p = f.split(':'), i = Number(p[0]), key = p[1];
    if (t.getAttribute('data-oa') !== null){
      OB.accounts[i][key] = t.value;
      if (key === 'bal'){ obSyncRail(true); obSyncCost(); }
      if (key === 'bal' || key === 'limit' || key === 'avail') obCardHint(i);
    } else {
      if (key === 'newcat') return;
      var r = OB.recurring[i];
      r[key] = t.value;
      /* Вписали сумму — строка включается; стёрли — выключается. */
      if (key === 'amount' && !r.existing){
        var on = String(t.value).trim() !== '';
        if (on !== r.on) obSetRec(r, t.closest('.rc-row'), on);
      }
      if (key === 'amount'){ obSyncTotals(); obSyncCost(); }
    }
  });
  layer.addEventListener('change', function(e){
    var t = e.target, f = t.getAttribute && (t.getAttribute('data-oa') || t.getAttribute('data-orf'));
    if (f){
      var p = f.split(':'), i = Number(p[0]), key = p[1];
      /* Тип счёта меняет набор полей: у кредитки — лимит и грейс. */
      if (t.getAttribute('data-oa') !== null && key === 'type'){
        var a = OB.accounts[i];
        a.type = t.value;
        /* Копилка, брокерский и крипта — не на каждый день: в «доступно» не входят. */
        a.isPay = !(t.value === 'credit' || t.value === 'broker' || t.value === 'crypto' || t.value === 'savings');
        if (t.value === 'credit') a.cur = 'RUB';
        obRender(true);
        obSyncRail(true);
        /* Кредитка открывает лимит и грейс — блок выезжает из-под строки. */
        if (t.value === 'credit') obRise([document.querySelector('#obBody [data-oarow="' + i + '"] + .ac-more')], 0, 0, -8, 420);
      }
      /* Валюта счёта: доллары — подтянуть курс ЦБ, итог слева пересчитает. */
      if (t.getAttribute('data-oa') !== null && key === 'cur'){
        OB.accounts[i].cur = t.value;
        obSyncRail(true); obSyncCost();
        if (t.value !== 'RUB' && !(OB.fx && OB.fx[t.value] && OB.fx[t.value].length)){
          window.api.fxEnsure(t.value).then(function(tb){ if (tb && !tb.error){ OB.fx = tb; obSyncRail(true); } });
        }
      }
      /* Раз в год — нужен месяц; периодичность меняет и итог месяца. */
      if (t.getAttribute('data-orf') !== null && (key === 'period' || key === 'month')){
        OB.recurring[i][key] = t.value;
        if (key === 'period'){ obRender(true); obSyncTotals(); }
      }
      /* Категория платежа: выбранная выключенная — включается; «Своя
         категория…» — поле для названия прямо в строке. */
      if (t.getAttribute('data-orf') !== null && key === 'cat'){
        var rr = OB.recurring[i];
        if (t.value === '__new'){
          rr.catNew = true;
          obRender(true);
          var nc = document.querySelector('#obBody [data-orf="' + i + ':newcat"]');
          if (nc) nc.focus();
        } else {
          rr.cat = t.value;
          obCatOn(t.value);
        }
      }
      /* Сумма — с пробелами между разрядами, когда из поля ушли. */
      if ((t.getAttribute('data-oa') !== null && (key === 'bal' || key === 'limit')) ||
          (t.getAttribute('data-orf') !== null && key === 'amount')){
        var pr = fmParse(t.value);
        if (pr.ok && !pr.empty){
          t.value = obPretty(pr.cents);
          if (t.getAttribute('data-oa') !== null) OB.accounts[i][key] = t.value; else OB.recurring[i][key] = t.value;
        }
      }
    }
    if (t.id === 'obDate'){
      var d = exParseDate(t.value);
      if (d){ OB.date = d; t.value = exRuDate(d); }
    }
  });
  /* Своя категория у платежа записывается, когда из поля ушли. */
  layer.addEventListener('focusout', function(e){
    var f = e.target.getAttribute && e.target.getAttribute('data-orf');
    if (f && /:newcat$/.test(f)){
      var r = OB.recurring[Number(f.split(':')[0])];
      if (r && r.catNew) obNewCat(r, e.target.value);
    }
  });
  layer.addEventListener('keydown', function(e){
    if (e.key === 'Enter' && e.target.id === 'obCatNew'){ e.preventDefault(); layer.querySelector('[data-ob-add="cat"]').click(); }
    /* Своя категория у платежа: Enter — готово, Esc — передумали. */
    var f = e.target.getAttribute && e.target.getAttribute('data-orf');
    /* Записываем сразу, не дожидаясь потери фокуса: окно могло быть не
       в фокусе, и тогда уход из поля не наступит. Фокус — на список
       категорий той же строки, чтобы продолжить с клавиатуры. */
    if (f && /:newcat$/.test(f) && (e.key === 'Enter' || e.key === 'Escape')){
      e.preventDefault();
      e.stopPropagation();
      var ri = Number(f.split(':')[0]), rr = OB.recurring[ri];
      if (rr && rr.catNew) obNewCat(rr, e.key === 'Enter' ? e.target.value : '');
      var sel = document.querySelector('#obBody [data-orf="' + ri + ':cat"]');
      if (sel) sel.focus();
    }
  });
}
/* «104 000» и «48 250,50» — как в окнах ввода. */
function obPretty(cents){ return fmRaw(cents).replace(/^(-?)(\d+)/, function(m, sg, d){ return sg + group(d); }); }
/* Категорию, выбранную у платежа, — включить: выключенная не
   предлагается при вводе, а платёж по ней приходит каждый месяц. */
function obCatOn(name){
  var c = OB.cats.filter(function(x){ return x.name === name; })[0];
  if (c && !c.on){ c.on = true; obSyncRail(false); }
}
/* Своя категория прямо у платежа: доход — в доходы, трата — в
   обязательные; совпала с существующей — берём её. */
function obNewCat(r, raw){
  var nm = String(raw || '').replace(/\s+/g, ' ').trim();
  r.catNew = false;
  if (nm){
    var same = OB.cats.filter(function(x){ return x.name.toLowerCase() === nm.toLowerCase(); })[0];
    if (same){ r.cat = same.name; obCatOn(same.name); }
    else {
      OB.cats.push({ name: nm, type: r.kind === 'in' ? 'доход' : 'обязательные', on: true, lock: false, custom: true });
      r.cat = nm;
      obSyncRail(false);
    }
  }
  obRender(true);
}
/* Включить или выключить строку платежа — на месте, с подсветкой. */
function obSetRec(r, row, on){
  r.on = on;
  var tg = row.querySelector('[data-or]');
  row.classList.toggle('is-off', !on);
  tg.classList.toggle('is-on', on);
  tg.setAttribute('aria-checked', on ? 'true' : 'false');
  if (on){ obPlay(row, 'is-lit'); obPlay(tg, 'is-pop'); }
  obSyncCost();
}
/* Убрать строку: она сжимается и гаснет, потом список пересобирается. */
function obRemove(row, after){
  if (!row || REDUCED){ after(); return; }
  row.style.height = row.offsetHeight + 'px';
  void row.offsetWidth;
  row.classList.add('is-gone');
  setTimeout(after, 220);
}
/* Итоги колонок шага 3 и строки итога — сразу, пока человек печатает. */
function obSyncTotals(){
  var a = document.getElementById('obRcin'), b = document.getElementById('obRcout');
  if (a) a.textContent = fmC(obMonthIn());
  if (b) b.textContent = fmC(-obMonthOut());
  obSyncRail(true);
}
