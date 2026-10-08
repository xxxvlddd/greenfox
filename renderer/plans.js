'use strict';
/* ============================================================
   ЭКРАН «ПЛАНЫ»
   ============================================================
   Разметка, порядок блоков и поведение перенесены из макета
   Main App/screens/05-plany.html. В макете очередь была вписана руками,
   здесь — из базы, а метки нужности и срочности, переключённые на
   карточке, записываются обратно. Имена начинаются с pl.
   ============================================================ */
var PL = null;                  /* данные экрана */
var plSort = 'prio';            /* порядок очереди */
var plSrc = 'card';             /* откуда платить в примерочной */
var plChecked = {};             /* отмеченные в примерочной позиции */

var PL_QUADS = [
  { id: 'buy',   need: 'need', urg: 'hot',  title: 'Купить сейчас',    hint: 'Нужно и горит' },
  { id: 'aware', need: 'want', urg: 'hot',  title: 'Осознанная трата', hint: 'Хочется, но срок поджимает' },
  { id: 'plan',  need: 'need', urg: 'cold', title: 'Запланировать',    hint: 'Нужно, но не срочно' },
  { id: 'wait',  need: 'want', urg: 'cold', title: 'Подождать',        hint: 'Хочется и не горит' }
];
var PL_PRIO = { buy: 0, plan: 1, aware: 2, wait: 3 };
var PL_CHECK = '<svg width="9" height="7" viewBox="0 0 9 7" fill="none" aria-hidden="true">' +
  '<path d="M1 3.4 3.4 5.8 8 1.2" stroke="var(--accent-fg)" stroke-width="1.6" stroke-linecap="round" ' +
  'stroke-linejoin="round"/></svg>';

/* ---------- мелкие помощники ---------- */
function plDec1(v){ return v.toFixed(1).replace('.', ','); }
function plMonths(v){ return v === null ? '—' : plDec1(v) + NBSP + 'мес.'; }
function plItems(n){ return n + NBSP + plural(n, 'позиция', 'позиции', 'позиций'); }
function plGDays(n){ return n + NBSP + plural(n, 'дня', 'дней', 'дней'); }
/* «9,5 дня» — дробное число всегда требует родительного падежа. */
function plFDays(v){ return plDec1(v) + NBSP + 'дня'; }
function plCap(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
/* «У 2 позиций» читается как опечатка — малые числа пишем словом. */
function plOfItems(n){
  return ['', 'одной позиции', 'двух позиций', 'трёх позиций', 'четырёх позиций'][n] || n + NBSP + 'позиций';
}
/* Строчная первая буква — только у русского слова, не у марки: «куртка»,
   но «Apple Pencil Pro». */
function plLower(s){
  return /^[А-ЯЁ][а-яё]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
function plDayLabel(d){
  var p = PL.today.split('-').map(Number), x = new Date(p[0], p[1] - 1, p[2] + d);
  return x.getDate() + NBSP + MONTHS[x.getMonth()];
}
function plDmy(iso){ return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '—'; }
function plMax(p){ return Number(p.max); }
function plSum(list){ return list.reduce(function(s, p){ return s + plMax(p); }, 0); }
function plQuad(p){
  for (var i = 0; i < PL_QUADS.length; i++) if (PL_QUADS[i].need === p.need && PL_QUADS[i].urg === p.urg) return PL_QUADS[i];
  return PL_QUADS[3];
}
function plPrice(p){
  return p.min === p.max ? money0(p.max) : moneyBare(p.min).replace(/,00$/, '') + ' – ' + money0(p.max);
}
/* Во что покупка обходится запасу: сумма в днях среднего расхода. */
function plCostDays(cents){
  var m = Number(PL.reserve.monthly);
  return m > 0 ? cents / m * 30.44 : 0;
}
function plHead(title, hint, sub, right){
  return '<div class="sec-head"><div style="min-width:0">' +
    '<div class="title-row"><h2 class="sec-title">' + title + '</h2>' +
      (hint ? '<i class="info" title="' + esc(hint) + '">i</i>' : '') + '</div>' +
    (sub || '') + '</div>' + (right ? '<span class="spacer"></span>' + right : '') + '</div>';
}
function plHeadLabel(d){
  var b = d.bought.length;
  return plItems(d.queue.length) + ' в очереди · ' + b + ' ' + plural(b, 'куплена', 'куплены', 'куплено');
}

/* ---------- запас прочности ---------- */
/* Дни до нуля на платёжных счетах — тем же расчётом, что обычный темп
   на «Прогнозах»: дневной темп плюс поступления и платежи по расписанию. */
function plZeroDay(start){
  var r = PL.reserve, bal = start;
  for (var d = 1; d <= r.horizon; d++){
    bal = bal - Number(r.rate) + Number(r.events[d] || 0);
    if (bal < 0) return d;
  }
  return null;
}
function plBaseMonths(){
  var m = Number(PL.reserve.monthly);
  return m > 0 ? Number(PL.reserve.liquid) / m : null;
}
/* Тон — по дням до поступления, а не по запасу: запас держит копилка и
   он почти не шевелится, а дни до нуля рушатся по-настоящему. */
function plToneOf(days, months){
  if (months !== null && months < ZONES[0]) return 'negative';
  if (days !== null && days <= 5) return 'negative';
  if (days !== null && days <= 9) return 'warning';
  return 'positive';
}
function plStateAfter(sum){
  var base = plZeroDay(Number(PL.reserve.avail));
  var days = plSrc === 'card' ? plZeroDay(Number(PL.reserve.avail) - sum) : base;
  var m = Number(PL.reserve.monthly);
  var months = m > 0 ? (Number(PL.reserve.liquid) - sum) / m : null;
  return { days: days, months: months, tone: plToneOf(days, months) };
}
function plDaysText(d){ return d === null ? 'хватит' : d + NBSP + 'дн.'; }
function plTone(t){ return t === 'negative' ? 'var(--danger)' : (t === 'warning' ? 'var(--warning)' : 'var(--positive)'); }
function plZonePct(months){ return zonePct(months); }

/* ============================================================
   РАЗМЕТКА
   ============================================================ */
function renderPlans(d){
  PL = d;
  if (d.error) return stateHTML('is-error', 'Не получилось собрать экран', d.error);
  if (d.reserve) setZones(d.reserve.zones);
  if (d.empty) return stateHTML('', 'Здесь пока пусто', 'Планы появятся, как только будут внесены первые операции.',
    ['Добавить позицию', 'data-form="plan"']);
  plChecked = {};
  var Q = d.queue, sum = plSum(Q);
  var minSum = Q.reduce(function(s, p){ return s + Number(p.min); }, 0);
  var forks = Q.filter(function(p){ return p.min !== p.max; }).length;
  var saved = Q.reduce(function(s, p){ return s + Number(p.saved); }, 0);
  var last = d.bought[0];
  var baseM = plBaseMonths(), afterM = baseM === null ? null : (Number(d.reserve.liquid) - sum) / Number(d.reserve.monthly);
  var costCls = afterM === null ? '' : afterM < ZONES[0] ? ' c-neg' : afterM < ZONES[1] ? ' c-warn' : '';

  return '<div class="scr-plans">' +
    '<div class="verdict" id="plVerdict"></div>' +

    /* ---------- показатели ---------- */
    '<section class="grid grid--4">' +
      '<div class="metric"><div class="metric-head"><span class="lbl">В очереди</span></div>' +
        '<div class="metric-val">' + plItems(Q.length) + '</div>' +
        '<div class="metric-sub">' + (!last ? 'Купленных из очереди пока нет'
          : d.bought.length === 1 ? 'Плюс одна куплена ' + humanDate(last.boughtAt)
          : 'Плюс ' + d.bought.length + NBSP + 'куплены, последняя — ' + humanDate(last.boughtAt)) + '</div></div>' +
      '<div class="metric"><div class="metric-head"><span class="lbl">Суммарно нужно</span>' +
          '<i class="info" title="' + esc('По верхней границе цены. Нижняя граница — ' + money0(String(minSum))) + '">i</i></div>' +
        '<div class="metric-val">' + money0(String(sum)) + '</div>' +
        '<div class="metric-sub">' + (forks
          ? 'Диапазон ' + moneyBare(String(minSum)).replace(/,00$/, '') + ' – ' + money0(String(sum)) + ': у ' +
            plOfItems(forks) + ' цена задана вилкой'
          : 'Цены всех позиций заданы точно') + '</div></div>' +
      '<div class="metric"><div class="metric-head"><span class="lbl">Отложено под позиции</span>' +
          '<i class="info" title="Приложение умеет копить под конкретную позицию; здесь — сколько уже отложено">i</i></div>' +
        '<div class="metric-val' + (saved ? '' : ' c-warn') + '">' + money0(String(saved)) + '</div>' +
        '<div class="metric-sub">' + (saved ? 'Отложено под ' + plItems(Q.filter(function(p){ return Number(p.saved) > 0; }).length)
          : 'Ни под одну позицию деньги пока не откладывались — готовность считать не из чего') + '</div></div>' +
      '<div class="metric"><div class="metric-head"><span class="lbl">Стоит запаса прочности</span>' +
          '<i class="info" title="На сколько сократится запас прочности, если купить всю очередь по верхней границе цен">i</i></div>' +
        '<div class="metric-val' + costCls + '">' + plFDays(plCostDays(sum)) + '</div>' +
        '<div class="metric-sub">' + (baseM === null ? 'Средний расход ещё не посчитан'
          : 'Купить всё сразу — запас упадёт с ' + plDec1(baseM) + ' до ' + plDec1(afterM) + ' месяца') + '</div></div>' +
    '</section>' +

    /* ---------- очередь ---------- */
    '<section class="sec">' +
      plHead('Очередь покупок',
        'Группы — это приоритет: пересечение «нужно / хочется» и «горит / не горит». Метки меняются кнопками прямо ' +
        'на карточке, позиция сразу переезжает в другую группу',
        '<p class="sec-sub"><span class="badge badge--decision">решение</span> Сгруппирована по приоритету · ' +
        'нужность и срочность переключаются на карточке</p>',
        '<span class="lbl">Сортировка</span>' +
        '<div class="seg" id="plSortSeg">' + [['prio', 'по приоритету'], ['price', 'по цене'], ['added', 'по дате']]
          .map(function(s){
            return '<button type="button" data-sort="' + s[0] + '"' + (s[0] === plSort ? ' class="is-active"' : '') + '>' +
                   s[1] + '</button>';
          }).join('') + '</div>') +
      '<p class="note" id="plUnsure" style="margin-top:0;margin-bottom:18px"></p>' +
      '<div id="plQueue"></div>' +
    '</section>' +

    /* ---------- влияние на запас ---------- */
    '<section class="sec">' +
      plHead('Влияние на запас прочности',
        'Запас прочности — на сколько месяцев хватит ликвидных активов при среднем расходе. Дни до нуля считаются ' +
        'только по платёжным счетам и только до ближайшего поступления',
        '<p class="sec-sub"><span class="badge badge--forecast">прогноз</span> Нажмите позиции, которые примеряете — ' +
        'итог пересчитается</p>',
        '<span class="lbl">Платить</span>' +
        '<div class="seg" id="plSrcSeg">' +
          '<button type="button" data-src="card"' + (plSrc === 'card' ? ' class="is-active"' : '') + '>с платёжных счетов</button>' +
          '<button type="button" data-src="cash"' + (plSrc === 'cash' ? ' class="is-active"' : '') + '>из копилки</button>' +
        '</div>' +
        '<button class="btn btn-sm" id="plImpAll">Отметить все</button>') +
      '<div class="try" id="plTry"></div>' +
    '</section>' +
    '<section class="grid grid--3">' +
      '<div class="res-cell"><div class="k">Отмечено</div>' +
        '<div class="res-flow"><b id="plResSum">' + money0('0') + '</b></div>' +
        '<div class="s" id="plResSumSub"></div></div>' +
      '<div class="res-cell"><div class="k">Дней до нуля на платёжных счетах</div>' +
        '<div class="res-flow"><b class="was" id="plDaysWas"></b><span class="arr">→</span><b id="plResDays"></b></div>' +
        '<div class="s" id="plResDaysSub"></div></div>' +
      '<div class="res-cell"><div class="k">Запас прочности</div>' +
        '<div class="res-flow"><b class="was">' + plMonths(baseM) + '</b><span class="arr">→</span>' +
          '<b id="plResMonths">' + plMonths(baseM) + '</b></div>' +
        '<div class="zone-bar">' + zoneBarFill() +
          '<span class="zone-mark ghost" style="left:' + plZonePct(baseM).toFixed(1) + '%"></span>' +
          '<span class="zone-mark" id="plZoneMark" style="left:' + plZonePct(baseM).toFixed(1) + '%"></span>' +
        '</div>' +
        '<div class="zone-labels"><span>критично</span><span>тонко</span><span>комфортно</span></div></div>' +
      '<div class="res-verdict" id="plImpVerdict" style="grid-column:1/-1"></div>' +
    '</section>' +

    /* ---------- куплено ---------- */
    plBoughtSection(d) +
  '</div>';
}

/* ---------- вывод экрана ---------- */
/* Экран отвечает на вопрос «что из этого брать». Ответ вынесен строкой
   наверх, а не оставлен читателю на вычисление из групп. */
function plRenderVerdict(){
  var Q = PL.queue, txt;
  if (!Q.length){
    txt = '<b>Очередь покупок пуста.</b> Добавьте позицию — экран покажет, во что она обойдётся запасу прочности.';
  } else {
    var buy = Q.filter(function(p){ return plQuad(p).id === 'buy'; });
    var rest = Q.filter(function(p){ return plQuad(p).id !== 'buy'; });
    if (!buy.length){
      txt = '<b>Срочных покупок в очереди нет.</b> ' + (Q.length === 1 ? 'Единственная позиция' : 'Все ' + plItems(Q.length)) +
            ' на ' + money0(String(plSum(Q))) + ' ' + (Q.length === 1 ? 'может' : 'могут') + ' подождать.';
    } else {
      txt = '<b>Сейчас ' + (buy.length === 1 ? 'оправдана одна покупка' : 'оправданы ' + plItems(buy.length)) + ' — ' +
            buy.map(function(p){ return esc(plLower(p.name)) + ', ' + plPrice(p); }).join('; ') + '.</b>' +
            (rest.length ? ' Остальные ' + plItems(rest.length) + ' на ' + money0(String(plSum(rest))) +
              ' не горят: это ' + plFDays(plCostDays(plSum(rest))) + ' запаса прочности, которые можно не тратить.' : '');
    }
    var unsure = Q.filter(function(p){ return p.unsure; }).length;
    if (unsure) txt += ' У ' + plOfItems(unsure) + ' нужность не определена — решение за вами.';
  }
  document.getElementById('plVerdict').innerHTML = '<span class="dot"></span><span>' + txt + '</span>';
}

/* ---------- неуточнённые метки ---------- */
function plRenderUnsure(){
  var list = PL.queue.filter(function(p){ return p.unsure; });
  var box = document.getElementById('plUnsure');
  if (!list.length){ box.style.display = 'none'; return; }
  box.style.display = 'block';
  var names = list.map(function(p){ return esc(p.name); });
  box.innerHTML = 'Метка «полезно и хочется» — это не решение, а уход от него. Так помечены ' +
    (names.length > 1 ? names.slice(0, -1).join(', ') + ' и ' + names[names.length - 1] : names[0]) +
    ' на ' + money0(String(plSum(list))) + ': пока нужность не выбрана, позиция стоит в «Подождать».';
}

/* ---------- очередь ---------- */
function plSorted(){
  var a = PL.queue.slice();
  if (plSort === 'price') a.sort(function(x, y){ return plMax(y) - plMax(x); });
  else if (plSort === 'added') a.sort(function(x, y){ return (x.added || '') < (y.added || '') ? -1 : (x.added || '') > (y.added || '') ? 1 : x.id - y.id; });
  else a.sort(function(x, y){
    var d = PL_PRIO[plQuad(x).id] - PL_PRIO[plQuad(y).id];
    return d !== 0 ? d : plMax(y) - plMax(x);
  });
  return a;
}
/* Переключатель одной оси метки. Неопределённая нужность показывается как
   «не выбрано ничего», а не подставленным за человека значением. */
function plTagSwitch(p, axis){
  var opts = axis === 'need' ? [['need', 'Нужно'], ['want', 'Хочется']] : [['hot', 'Горит'], ['cold', 'Не горит']];
  var cur = axis === 'need' ? p.need : p.urg;
  var unset = axis === 'need' && p.unsure;
  return '<span class="tsw' + (unset ? ' is-unset' : '') + '" data-axis="' + axis + '" data-id="' + p.id + '">' +
    opts.map(function(o){
      return '<button type="button" class="' + (!unset && o[0] === cur ? 'is-on' : '') + '" data-val="' + o[0] + '">' +
             o[1] + '</button>';
    }).join('') + '</span>';
}
function plCard(p){
  var q = plQuad(p);
  var meta = [p.deadline ? 'Срок — ' + humanDate(p.deadline) : 'Срок не задан'];
  if (p.note) meta.push(esc(plCap(p.note)));
  var saved = Number(p.saved);
  return '<div class="q-card' + (q.id === 'buy' ? ' is-primary' : '') + '">' +
    '<div class="q-top"><span class="q-name">' + esc(p.name) + '</span><span class="spacer"></span>' +
      '<span class="q-price">' + plPrice(p) + '</span></div>' +
    '<div class="q-cat">' + esc([p.cat, p.type].filter(Boolean).join(' · ') || 'Категория не задана') + '</div>' +
    '<div class="q-switches">' + plTagSwitch(p, 'need') + plTagSwitch(p, 'urg') +
      (p.unsure ? '<span class="q-hint">нужность не выбрана</span>' : '') +
      (p.repl ? '<span class="tg">Есть чем заменить</span>' : '') + '</div>' +
    '<div class="q-meta">' + meta.join(' · ') + '</div>' +
    '<div class="q-cost">Стоит <b>' + plFDays(plCostDays(plMax(p))) + '</b> запаса прочности' +
      (p.min !== p.max ? ' по верхней границе цены' : '') + '</div>' +
    '<div class="q-alloc"><span>' + (saved
        ? 'Отложено ' + money0(p.saved) + ' из ' + money0(p.max)
        : 'Под эту позицию ничего не отложено — готовность считать не из чего') + '</span>' +
      /* Окна для откладывания под позицию в макетах нет — кнопка честно
         говорит, что оно ещё впереди. */
      '<span class="spacer"></span><button class="btn-link" data-soon="Откладывание под позицию">Отложить</button></div>' +
    '<div class="q-foot">' +
      '<button class="btn btn-sm btn-sm--acc" data-soon="Откладывание под позицию">Отложить сумму</button>' +
      '<button class="btn btn-sm" data-form="buy" data-id="' + p.id + '">Купил</button>' +
      '<button class="btn btn-sm" data-form="plan" data-id="' + p.id + '">Изменить</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-act="plan-drop" data-id="' + p.id + '">Убрать</button>' +
    '</div>' +
  '</div>';
}
function plRenderQueue(){
  var host = document.getElementById('plQueue');
  if (!PL.queue.length){
    host.innerHTML = '<p class="note" style="margin-top:0">В очереди ничего нет.</p>';
    return;
  }
  /* Непарную ячейку закрывает пустая заглушка: иначе сквозь неё
     проступил бы цвет разделителей сплошным блоком. */
  var pad = function(n){ return n % 2 ? '<div class="q-card"></div>' : ''; };
  if (plSort === 'prio'){
    /* Пустые группы не рисуются: держать ради них заголовок незачем. */
    host.innerHTML = PL_QUADS.slice().sort(function(a, b){ return PL_PRIO[a.id] - PL_PRIO[b.id]; })
      .map(function(q){
        var items = PL.queue.filter(function(p){ return plQuad(p).id === q.id; })
                            .sort(function(x, y){ return plMax(y) - plMax(x); });
        if (!items.length) return '';
        return '<div class="q-group' + (q.id === 'buy' ? ' is-primary' : '') + '">' +
          '<div class="q-group-head"><span class="q-group-title">' + q.title + '</span>' +
            '<span class="q-group-meta">' + q.hint.toLowerCase() + ' · ' + plItems(items.length) +
              ' · <span class="num">' + money0(String(plSum(items))) + '</span></span>' +
            '<span class="q-group-rule"></span></div>' +
          '<div class="q-list">' + items.map(plCard).join('') + pad(items.length) + '</div>' +
        '</div>';
      }).join('');
  } else {
    var flat = plSorted();
    host.innerHTML = '<div class="q-list">' + flat.map(plCard).join('') + pad(flat.length) + '</div>';
  }
  /* Сменили метку или порядок — карточки перескладываются, и лестница
     показывает, что список другой, а не просто моргнул. */
  stagger(host, '.q-card');
}

/* ---------- примерочная ---------- */
function plRenderTry(){
  var base = plZeroDay(Number(PL.reserve.avail));
  var horizon = PL.reserve.horizon;
  document.getElementById('plTry').innerHTML = plSorted().map(function(p){
    var st = plStateAfter(plMax(p));
    /* Из копилки дни до нуля не меняются, и разница в месяцах у мелких
       позиций округлялась бы в «−0,0». Показываем то, что осмысленно, —
       цену покупки в днях среднего расхода. */
    var lost = (base === null ? horizon + 1 : base) - (st.days === null ? horizon + 1 : st.days);
    var cost = plSrc === 'card'
      ? (lost <= 0 ? 'запас держится' : '−' + nDays(lost) + ' до поступления')
      : plFDays(plCostDays(plMax(p))) + ' расхода';
    var on = !!plChecked[p.id];
    return '<button type="button" class="try-btn' + (on ? ' is-on' : '') + '" data-id="' + p.id +
      '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
      '<span class="try-box">' + PL_CHECK + '</span>' +
      '<span style="min-width:0"><span class="try-nm">' + esc(p.name) + '</span>' +
        '<span class="try-sub">' + money0(p.max) + ' · ' + cost + '</span></span></button>';
  }).join('');
  stagger(document.getElementById('plTry'), '.try-btn');
  var all = PL.queue.length && PL.queue.every(function(p){ return plChecked[p.id]; });
  document.getElementById('plImpAll').textContent = all ? 'Снять все' : 'Отметить все';
}
function plRecalc(){
  var Q = PL.queue;
  var sum = Q.reduce(function(s, p){ return s + (plChecked[p.id] ? plMax(p) : 0); }, 0);
  var count = Q.filter(function(p){ return plChecked[p.id]; }).length;
  var st = plStateAfter(sum);
  var base = plZeroDay(Number(PL.reserve.avail)), baseM = plBaseMonths();
  var inc = PL.reserve.income;

  /* Отметили позицию — сумма докручивается до нового значения, а не
     подменяется молча: видно, на сколько именно она выросла. */
  var sumEl = document.getElementById('plResSum');
  countUp(sumEl, sum, function(v){ return money0(String(Math.round(v))); });
  bump(sumEl);
  document.getElementById('plResSumSub').textContent = count
    ? plItems(count) + ' из ' + Q.length + ' · ' + plFDays(plCostDays(sum)) + ' среднего расхода'
    : 'ничего не выбрано — в очереди ' + plItems(Q.length);

  var flat = 'res-flow' + (count ? '' : ' is-flat');
  document.getElementById('plDaysWas').textContent = plDaysText(base);
  var dEl = document.getElementById('plResDays');
  dEl.parentNode.className = flat;
  dEl.textContent = plDaysText(st.days);
  dEl.style.color = sum ? plTone(st.tone) : '';
  /* Значение бывает словом «хватит», докручивать нечего — только вспышка. */
  bump(dEl);
  document.getElementById('plResDaysSub').textContent =
    plSrc === 'cash' ? 'оплата из копилки платёжные счета не трогает'
    : !sum ? (inc ? plLower(inc.name) + ' придёт ' + humanDate(inc.date) + ' — через ' + nDays(inc.day)
                  : 'поступлений в ближайший месяц не ждём')
    : (st.days === null ? 'до поступления хватает' : 'деньги кончатся ' + plDayLabel(st.days));

  var mEl = document.getElementById('plResMonths');
  mEl.parentNode.className = flat;
  if (st.months === null) mEl.textContent = '—';
  else countUp(mEl, st.months, plMonths);
  bump(mEl);
  document.getElementById('plZoneMark').style.left = plZonePct(st.months).toFixed(1) + '%';

  plRenderImpVerdict(sum, count, st, base, baseM);
}
/* Вывод показывается всегда: меняется текст и тон, но не высота блока. */
function plRenderImpVerdict(sum, count, st, base, baseM){
  var box = document.getElementById('plImpVerdict');
  var inc = PL.reserve.income;
  var cls = 'res-verdict', txt;
  if (!count){
    txt = 'Ничего не отмечено — показано текущее состояние: <b>' + plDaysText(base) +
          '</b> до нуля на платёжных счетах и запас <b>' + plMonths(baseM) +
          '</b> Нажмите позицию выше, чтобы примерить покупку.';
  } else if (plSrc === 'cash'){
    cls += st.months !== null && st.months < ZONES[0] ? ' is-neg' : ' is-warn';
    txt = '<b>Оплата из копилки не трогает платёжные счета</b> — дней до поступления останется столько же (' +
          plDaysText(base) + '). Но запас прочности падает так же: ' + plMonths(baseM) + ' → <b>' + plMonths(st.months) +
          '</b>' + (st.months !== null && st.months < ZONES[0] ? ' Это критическая зона — ' + zoneCritText() + ' жизни на сбережениях.' : '');
  } else if (st.tone === 'negative'){
    cls += ' is-neg';
    txt = (st.months !== null && st.months < ZONES[0]
            ? '<b>Запас прочности уходит в критическую зону</b> — ' + zoneCritText() + ' жизни на сбережениях. ' : '') +
          'Платёжные счета обнулятся <b>' + (st.days === null ? 'не раньше поступления' : plDayLabel(st.days)) + '</b>' +
          (st.days !== null && inc && inc.day > st.days ? ' — за ' + plGDays(inc.day - st.days) + ' до поступления' : '') +
          '. Разрыв придётся закрывать кредиткой или копилкой.';
  } else if (st.tone === 'warning'){
    cls += ' is-warn';
    txt = 'До поступления останется <b>' + plDaysText(st.days) + '</b> вместо ' + plDaysText(base) +
          ' — впритык, но проходит. Запас прочности ' + plMonths(baseM) + ' → ' + plMonths(st.months);
  } else {
    cls += ' is-pos';
    txt = '<b>Покупка укладывается.</b> До поступления останется ' + plDaysText(st.days) + ', запас прочности ' +
          plMonths(baseM) + ' → ' + plMonths(st.months);
  }
  box.className = cls;
  box.innerHTML = '<span class="dot"></span><span>' + txt + '</span>';
}

/* ---------- куплено ---------- */
function plBoughtSection(d){
  var B = d.bought;
  var rows = B.map(function(p){
    var plan = Number(p.max), fact = p.boughtSum === null ? null : Number(p.boughtSum);
    var diff = fact === null ? null : fact - plan;
    return '<tr>' +
      '<td><div class="t-name">' + esc(p.name) + '</div>' + (p.note ? '<div class="t-sub">' + esc(plCap(p.note)) + '</div>' : '') + '</td>' +
      '<td style="color:var(--text-2)">' + esc(p.cat || '—') + (p.type ? '<div class="t-sub">' + p.type + '</div>' : '') + '</td>' +
      '<td class="r num" style="color:var(--text-2)">' + money(p.max) + '</td>' +
      '<td class="r num" style="font-weight:600">' + (fact === null ? '—' : money(p.boughtSum)) + '</td>' +
      (diff === null ? '<td class="r" style="color:var(--text-3)">—</td>'
        : '<td class="r num ' + (diff > 0 ? 'c-neg' : 'c-pos') + '">' + (diff > 0 ? '+' : '') + money(String(diff)) +
          '<div class="t-sub">' + (diff > 0 ? '+' : '−') + plDec1(Math.abs(diff) / plan * 100) + '%</div></td>') +
      '<td class="r num" style="color:var(--text-2)">' + plDmy(p.boughtAt) + '</td>' +
      '<td class="r num" style="color:var(--text-2)">' + (p.waited === null ? '—' : nDays(p.waited)) + '</td>' +
    '</tr>';
  }).join('');
  var n = B.length;
  var few = n && n < 5
    ? (n === 1 ? 'Одна закрытая позиция' : ['', '', 'Две', 'Три', 'Четыре'][n] + ' закрытые позиции') +
      ' — слишком мало, чтобы делать выводы о том, насколько точно вы планируете цены. Показатель «против плана» ' +
      'станет осмысленным после 5–7 покупок.'
    : '';
  return '<section class="sec">' +
    plHead('Куплено из очереди',
      'Сама трата лежит в общем списке расходов. Здесь то, чего там нет: плановая цена из карточки позиции и сколько ' +
      'позиция ждала в очереди',
      '<p class="sec-sub"><span class="badge badge--fact">факт</span> План против факта и время ожидания · учёт с ' +
        humanDate(d.firstDay) + ' ' + d.firstDay.slice(0, 4) + '</p>') +
    (n
      ? '<table class="tbl"><thead><tr><th>Позиция</th><th>Категория</th><th class="r">План</th><th class="r">Факт</th>' +
        '<th class="r">Отклонение</th><th class="r">Куплено</th><th class="r">Ждали</th></tr></thead>' +
        '<tbody id="plBoughtBody">' + rows + '</tbody></table>'
      : '<p class="note" style="margin-top:0">Из очереди пока ничего не куплено.</p>') +
    (few ? '<p class="note" style="margin-top:10px">' + few + '</p>' : '') +
  '</section>';
}

/* ============================================================
   СБОРКА ЭКРАНА
   ============================================================ */
function plRenderAll(){
  plRenderVerdict();
  plRenderUnsure();
  plRenderQueue();
  plRenderTry();
  plRecalc();
}
function drawPlans(){
  if (!PL || PL.empty || PL.error) return;
  plRenderAll();
}
/* Метка, переключённая на карточке: сразу перескладываем экран и пишем
   в базу. Не записалось — возвращаем экран к тому, что в базе. */
function plSetTag(id, axis, val){
  var p = PL.queue.filter(function(x){ return x.id === id; })[0];
  if (!p) return;
  if (axis === 'need'){ if (p.need === val && !p.unsure) return; p.need = val; p.unsure = false; }
  else { if (p.urg === val) return; p.urg = val; }
  plRenderAll();
  window.api.planTag(id, axis, val).then(function(r){
    if (!r || !r.ok){ toast('Метка не сохранилась: ' + ((r && r.error) || 'ошибка базы')); draw(); }
  });
}
