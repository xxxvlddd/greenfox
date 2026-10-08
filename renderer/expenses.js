'use strict';
/* ============================================================
   ЭКРАН «РАСХОДЫ»
   ============================================================
   Разметка и порядок блоков перенесены из макета
   Main App/screens/02-rashody.html без изменений. Разница только в
   источнике: в макете ряды были вписаны руками под август, здесь
   каждый приходит из базы для выбранного периода.
   ============================================================ */
var EXP = null;                              /* данные экрана */
var exUnit = 'month', exOffset = 0;          /* выбранный период */
var exCatFilter = null;                      /* фильтр таблицы категорий */
var exBarsDays = 0;                          /* 0 — весь период, иначе хвост в днях */
var exAvgFull = true;                        /* средний день: со всеми тратами */
var exSearch = '';
var exCustom = null;                         /* произвольный период: {from, to} */
/* Фильтры списка операций. Пустой набор значит «не ограничивать»;
   направление по умолчанию — расходы, экран всё-таки про траты. */
var exFlt = { dirs: ['расход'], cats: [], accs: [], tags: [], min: null, max: null };

/* ---------- мелкие помощники ---------- */
/* Доли в полосе показателей макет пишет с одним знаком: 44,6%, а не
   45% — иначе три доли перестают складываться в сотню на глаз. */
function exPct1(part, whole){
  var v = rub(whole) ? rub(part) / rub(whole) * 100 : 0;
  return v.toFixed(1).replace('.', ',') + '%';
}
function exPct(part, whole){
  var v = rub(whole) ? rub(part) / rub(whole) * 100 : 0;
  return (v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)) + '%';
}
function exTimes(n){
  var v = Math.round(n), t = Math.abs(v) % 100, o = t % 10;
  if (t >= 11 && t <= 14) return v + ' раз';
  if (o >= 2 && o <= 4) return v + ' раза';
  return v + ' раз';
}
function exRatio(a, b){ return (a / b).toFixed(1).replace('.', ','); }
/* «из 31 дня», а не «из 31 день»: после «из» нужен родительный. */
function exOfDays(n){ return n + '\u00A0' + plural(n, 'дня', 'дней', 'дней'); }
function exText(parent, x, y, str, opts){
  var o = opts || {};
  var t = document.createElementNS(NS, 'text');
  t.setAttribute('x', x); t.setAttribute('y', y);
  t.setAttribute('text-anchor', o.anchor || 'middle');
  t.setAttribute('fill', o.fill || 'var(--text-3)');
  t.setAttribute('font-size', o.size || 11);
  t.setAttribute('font-family', o.font || FONT_MONO);
  if (o.weight) t.setAttribute('font-weight', o.weight);
  t.textContent = str;
  parent.appendChild(t);
  return t;
}

/* ============================================================
   РАЗМЕТКА
   ============================================================ */
var EX_ICON = {
  prev: '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M9 2 4 7l5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m5 2 5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cal:  '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x=".8" y="2.4" width="12.4" height="11" rx="2.4"/><path d="M.8 6.2h12.4"/><path d="M4.5 .8v3.2M9.5 .8v3.2" stroke-linecap="round"/></svg>',
  find: '<svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.8"/><path d="m10.2 10.2 3.3 3.3" stroke-linecap="round"/></svg>'
};
var EX_UNITS = [['day','День'], ['month','Месяц'], ['half','Полгода'], ['year','Год']];

/* ---------- даты в поле выбора периода ---------- */
/* «2026-09-01» → «01.09.2026» */
function exRuDate(iso){
  if (!iso) return '';
  var p = String(iso).split('-');
  return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : '';
}
/* «01.09.2026», «1.9.26», «01092026» → «2026-09-01». Непонятое — null. */
function exParseDate(str){
  var d = String(str || '').replace(/\D/g, '');
  if (d.length === 8){
    var y = d.slice(4), m = d.slice(2, 4), dd = d.slice(0, 2);
    return exValidDate(y, m, dd);
  }
  var m2 = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/.exec(String(str || '').trim());
  if (!m2) return null;
  var yy = m2[3].length === 2 ? '20' + m2[3] : m2[3];
  return exValidDate(yy, ('0' + m2[2]).slice(-2), ('0' + m2[1]).slice(-2));
}
function exValidDate(y, m, d){
  var iso = y + '-' + m + '-' + d;
  var dt = new Date(Number(y), Number(m) - 1, Number(d));
  if (dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(m) - 1 ||
      dt.getDate() !== Number(d)) return null;
  return iso;
}
/* Быстрые отрезки: их просят чаще, чем произвольные даты. */
var EX_PRESETS = [
  ['7 дней',  function(t){ return [exShift(t, -6), t]; }],
  ['30 дней', function(t){ return [exShift(t, -29), t]; }],
  ['Этот месяц', function(t){ return [t.slice(0, 8) + '01', t]; }],
  ['Прошлый месяц', function(t){
    var y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    var a = new Date(y, m - 2, 1), b = new Date(y, m - 1, 0);
    var f = function(x){ return x.getFullYear() + '-' +
      ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); };
    return [f(a), f(b)];
  }]
];
function exShift(iso, days){
  var p = iso.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2] + days);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
         '-' + ('0' + d.getDate()).slice(-2);
}

function exPeriodBar(p){
  var partial = p.partial
    ? '<span class="badge badge--partial" title="Учёт начат ' + humanDate(EXP.firstDay) +
      ', поэтому период наблюдался не полностью">неполный период · ' +
      p.partial.tracked + ' из ' + exOfDays(p.partial.calendar) + '</span>'
    : '';
  var from = (exCustom && exCustom.from) || p.from;
  var to = (exCustom && exCustom.to) || p.to;
  return '<div class="period-bar">' +
    '<button class="btn btn-step" id="exPrev" title="Предыдущий период" aria-label="Предыдущий период">' +
      EX_ICON.prev + '</button>' +
    '<div class="pop-host">' +
      '<div class="seg seg--text" id="exSegPeriod">' +
        EX_UNITS.map(function(u){
          return '<button data-unit="' + u[0] + '"' + (u[0] === p.unit ? ' class="is-active"' : '') +
                 '>' + u[1] + '</button>';
        }).join('') +
        '<button class="has-ic' + (p.unit === 'custom' ? ' is-active' : '') +
          '" data-pop="range">' + EX_ICON.cal + ' Период…</button>' +
      '</div>' +
      '<div class="pop" id="exPopRange" hidden>' +
        '<div class="pop-title">Произвольный период</div>' +
        /* Поле обычное текстовое, а не type="date": нативное берёт
           формат из настроек системы, и на английской раскладке
           показывало «09/01/2026» — в русском приложении это читается
           как 9 января, а не 1 сентября. */
        '<div class="pop-row"><label for="exFrom">с</label>' +
          '<input type="text" id="exFrom" inputmode="numeric" maxlength="10" ' +
            'placeholder="дд.мм.гггг" value="' + exRuDate(from) + '"></div>' +
        '<div class="pop-row"><label for="exTo">по</label>' +
          '<input type="text" id="exTo" inputmode="numeric" maxlength="10" ' +
            'placeholder="дд.мм.гггг" value="' + exRuDate(to) + '"></div>' +
        '<div class="pop-presets">' + EX_PRESETS.map(function(x, i){
          return '<button type="button" class="btn btn-sm" data-preset="' + i + '">' + x[0] + '</button>';
        }).join('') + '</div>' +
        '<div class="pop-foot"><span class="spacer"></span>' +
          '<button class="btn btn-sm" data-pop-close="1">Отмена</button>' +
          '<button class="btn btn-sm" id="exRangeApply">Показать</button></div>' +
      '</div>' +
    '</div>' +
    '<button class="btn btn-step" id="exNext" title="Следующий период" aria-label="Следующий период"' +
      (p.canNext ? '' : ' disabled') + '>' + EX_ICON.next + '</button>' +
    '<span class="period-name">' + esc(p.name) + '</span>' +
    partial +
    '<span class="spacer"></span>' +
    '<span class="period-meta">' + nOps(p.ops) + ' · ' + esc(p.label) + '</span>' +
  '</div>';
}

function exMetrics(d){
  /* 1. Всего за период */
  var prevNote = Number(d.prev.total) > 0
    ? (function(){
        var now = rub(d.total), was = rub(d.prev.total);
        var diff = Math.round((now - was) / was * 100);
        return diff === 0
          ? 'Столько же, сколько в ' + esc(d.prev.name)
          : (diff > 0 ? 'На ' + diff + '% больше, чем ' : 'На ' + (-diff) + '% меньше, чем ') +
            esc(d.prev.inName) + ' — ' + money(d.prev.total, 0);
      })()
    : esc(d.period.name.charAt(0).toUpperCase() + d.period.name.slice(1)) +
      ' — первый период наблюдений, сравнить не с чем';

  /* 4. Спонтанные: показателю можно верить только если тег реально
        проставляют. Один тег на девяносто операций — это не измерение. */
  var spontShare = d.ops ? d.spont.count / d.ops : 0;
  var spontWarn = d.spont.count === 0 || spontShare < 0.05;

  return '<section class="grid grid--4">' +
    /* Всего за период */
    '<div class="metric">' +
      '<div class="metric-head"><span class="lbl">Всего за период</span>' +
        '<i class="info" title="Сумма расходов за период без переводов между своими счетами">i</i>' +
        '<span class="spacer"></span><span class="badge badge--fact">факт</span></div>' +
      '<div class="metric-val">' + money(d.total) + '</div>' +
      '<div class="metric-foot"><p class="metric-sub">' + prevNote + '</p></div>' +
    '</div>' +

    /* Средний день */
    '<div class="metric">' +
      '<div class="metric-head"><span class="lbl">Средний день</span>' +
        '<i class="info" title="Расход за период ÷ число дней с учётом (' + d.trackedDays +
          '), а не календарных дней периода">i</i>' +
        '<span class="spacer"></span><span class="badge badge--est">оценка</span></div>' +
      '<div class="metric-val" id="exAvgVal">' + money(d.avgDay) + '</div>' +
      '<p class="metric-sub" id="exAvgNote">' + nDays(d.trackedDays) + ' с учётом, ' +
        nDays(d.daysWithOps) + ' с операциями</p>' +
      '<div class="metric-foot"><button class="btn btn-sm" id="exAvgToggle">Без разовых трат</button></div>' +
    '</div>' +

    /* Структура по типам */
    '<div class="metric">' +
      '<div class="metric-head"><span class="lbl">Структура по типам</span>' +
        '<i class="info" title="Обязательное — базовые и обязательные категории. Дискреционное — то, от чего можно отказаться. Сбережения показаны отдельно, потому что это не трата">i</i>' +
        '<span class="spacer"></span><span class="badge badge--fact">факт</span></div>' +
      '<div class="split-bar">' + d.split.map(function(s){
        return '<i style="width:' + (rub(s.sum) / rub(d.total) * 100).toFixed(2) +
               '%;background:' + s.color + '"></i>';
      }).join('') + '</div>' +
      '<div class="split-legend">' + d.split.map(function(s){
        return '<div class="row"><span class="dot" style="background:' + s.color + '"></span>' +
               s.name + '<span class="spacer"></span><span class="v">' +
               exPct1(s.sum, d.total) + '</span></div>';
      }).join('') + '</div>' +
    '</div>' +

    /* Спонтанные */
    '<div class="metric">' +
      '<div class="metric-head"><span class="lbl">Спонтанные</span>' +
        '<i class="info" title="Операции, помеченные тегом «спонтанная» при вводе. Считается только по проставленным вручную тегам">i</i>' +
        '<span class="spacer"></span><span class="badge badge--fact">факт</span></div>' +
      '<div class="metric-val">' + money(d.spont.sum) + '</div>' +
      '<p class="metric-sub">' + nOps(d.spont.count) + ' · ' + exPct(d.spont.sum, d.total) + ' периода</p>' +
      '<div class="metric-foot">' + (spontWarn
        ? '<p class="note-warn" style="margin-top:0"><span class="dot"></span>' +
          (d.spont.count
            ? 'Тег стоит на ' + d.spont.count + '\u00A0' +
              plural(d.spont.count, 'операции', 'операциях', 'операциях') +
              ' из ' + d.ops + ' — показателю пока нельзя доверять'
            : 'Тег не стоит ни на одной операции периода — считать нечего') + '</p>'
        : '<p class="metric-sub">Тег проставлен на ' + Math.round(spontShare * 100) +
          '% операций периода</p>') +
      '</div>' +
    '</div>' +
  '</section>';
}

/* ============================================================
   ФИЛЬТРЫ СПИСКА ОПЕРАЦИЙ
   ============================================================
   Направление переключается прямо на фишке, остальное — списком в
   выпадающей панели. Набор значений берётся из самого периода:
   предлагать «Путешествия» там, где их не было, незачем.
   ============================================================ */
var EX_DIRS = [['расход', 'Расход'], ['доход', 'Доход'], ['перевод', 'Перевод']];

function exChip(key, label, n){
  return '<button class="chip' + (n ? ' is-active' : '') + '" data-pop="' + key + '">' + label +
    (n ? ' <span class="cnt">' + n + '</span><span class="x" data-clear="' + key + '">×</span>' : '') +
    '</button>';
}
function exOptList(key, options, selected){
  return '<div class="pop-list">' + options.map(function(o){
    var on = selected.indexOf(o.value) >= 0;
    return '<button type="button" class="pop-opt' + (on ? ' is-on' : '') + '" data-opt="' + key +
      '" data-val="' + esc(o.value) + '">' +
      '<span class="box">' + (on ? '✓' : '') + '</span>' +
      (o.color ? '<span class="dot" style="background:' + o.color + '"></span>' : '') +
      '<span>' + esc(o.label) + '</span><span class="n">' + o.n + '</span></button>';
  }).join('') + '</div>';
}
function exPop(key, title, body){
  return '<div class="pop-host">' +
    body.chip +
    '<div class="pop' + (body.right ? ' at-right' : '') + '" id="exPop' + key + '" hidden>' +
      '<div class="pop-title">' + title + '</div>' + body.inner +
      '<div class="pop-foot"><button class="btn btn-sm" data-clear="' + key + '">Сбросить</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-sm" data-pop-close="1">Готово</button></div>' +
    '</div></div>';
}

function exFiltersHTML(d){
  var o = d.filterOptions;
  var catColor = {};
  d.cats.forEach(function(c){ catColor[c.name] = c.color; });
  var cats = o.cats.map(function(x){
    return { value: x.name, label: x.name, n: x.n, color: catColor[x.name] || 'var(--cat-12)' };
  });
  var accs = o.accs.map(function(x){ return { value: x.name, label: x.name, n: x.n }; });
  var noTag = d.opsRows.filter(function(r){ return !r.flag; }).length;
  var tags = o.tags.map(function(x){ return { value: x.name, label: x.name, n: x.n }; });
  if (noTag) tags.unshift({ value: '—', label: 'без метки', n: noTag });

  var dirCount = {};
  o.dirs.forEach(function(x){ dirCount[x.name] = x.n; });

  return EX_DIRS.map(function(dd){
    var on = exFlt.dirs.indexOf(dd[0]) >= 0;
    return '<button class="chip' + (on ? ' is-active' : '') + '" data-dir="' + dd[0] + '">' +
      dd[1] + ' <span class="cnt">' + (dirCount[dd[0]] || 0) + '</span>' +
      (on ? '<span class="x">×</span>' : '') + '</button>';
  }).join('') +
  '<span style="width:1px;height:18px;background:var(--border)"></span>' +
  exPop('cats', 'Категория', { chip: exChip('cats', 'Категория', exFlt.cats.length),
                               inner: exOptList('cats', cats, exFlt.cats) }) +
  exPop('accs', 'Счёт', { chip: exChip('accs', 'Счёт', exFlt.accs.length),
                          inner: exOptList('accs', accs, exFlt.accs) }) +
  exPop('sum', 'Сумма операции', { chip: exChip('sum', 'Сумма',
        (exFlt.min !== null || exFlt.max !== null) ? 1 : 0),
    inner: '<div class="pop-row"><label for="exMin">от</label>' +
             '<input type="number" id="exMin" placeholder="0" value="' +
               (exFlt.min === null ? '' : exFlt.min) + '"></div>' +
           '<div class="pop-row"><label for="exMax">до</label>' +
             '<input type="number" id="exMax" placeholder="без предела" value="' +
               (exFlt.max === null ? '' : exFlt.max) + '"></div>' }) +
  exPop('tags', 'Метки', { chip: exChip('tags', 'Теги', exFlt.tags.length),
                           inner: exOptList('tags', tags, exFlt.tags), right: true });
}

/* Мало данных — меньше 30 дней наблюдений в периоде. */
var EX_FEW = 30;
function exFew(d){ return !!(d && d.daily && d.daily.length < EX_FEW); }
function exFewBadge(d){
  return exFew(d) ? '<span class="badge badge--partial" title="Показатель станет достоверным после ' + EX_FEW +
    ' дней наблюдений">мало данных</span>' : '';
}
function exFewNote(){
  var left = EX_FEW - EXP.daily.length;
  return 'Данных пока мало: ' + nDays(EXP.daily.length) + ' наблюдений из ' + EX_FEW + ', показатель станет ' +
    'достоверным, когда наберётся ещё ' + nDays(left) + '. Сейчас одна покупка сдвигает всю картину — решений по ' +
    'нему лучше не принимать.';
}
function exSecHead(title, hint, sub, right){
  return '<div class="sec-head"><div style="min-width:0">' +
    '<div class="title-row"><h2 class="sec-title">' + title + '</h2>' +
      (hint ? '<i class="info" title="' + hint + '">i</i>' : '') + '</div>' +
    (sub ? '<p class="sec-sub">' + sub + '</p>' : '') +
  '</div>' + (right ? '<span class="spacer"></span>' + right : '') + '</div>';
}

function renderExpenses(d){
  EXP = d;
  if (d.empty) return stateHTML('', 'Операций пока нет',
    'Как только появится первая запись, здесь будет разбор трат.', stAdd(d));
  if (d.error) return stateHTML('is-error', 'Не получилось собрать экран', d.error);

  if (d.noData){
    return '<div class="scr-expenses">' + exPeriodBar(d.period) +
      stateHTML('', 'В этом периоде трат нет',
        'Учёт начат ' + humanDate(d.firstDay) + '. Выберите другой период — стрелками слева.') +
    '</div>';
  }

  var cd = d.cats.length;
  return '<div class="scr-expenses">' +
    exPeriodBar(d.period) +
    exMetrics(d) +

    /* ---------- СТРУКТУРА ---------- */
    '<section class="sec">' +
      exSecHead('Структура',
        'Площадь плитки — доля категории в расходах периода. Цвет категории закреплён и одинаков на всех экранах',
        '<span class="badge badge--fact">факт</span> Площадь плитки — доля в тратах · ' +
          money(d.total) + ' за ' + esc(d.period.name)) +
      '<div class="tmap" id="exTmap" role="img" aria-label="Структура расходов по категориям, площадь плитки соответствует доле"></div>' +
      '<p class="note" id="exTmapNote"></p>' +
    '</section>' +

    /* ---------- КАТЕГОРИИ И ТОП-5 ---------- */
    '<section class="grid grid--2">' +
      '<div>' +
        exSecHead('Категории',
          'Все категории периода. Наведите на строку — подсветится её плитка в «Структуре» выше',
          'Наведите на строку — подсветится плитка выше',
          '<div class="seg seg--text" id="exSegCatType">' +
            ['Все','Базовые','Обязательные','Дискреционные','Сбережения'].map(function(t, i){
              return '<button data-type="' + (i ? t.toLowerCase() : '') + '"' +
                     (i === 0 ? ' class="is-active"' : '') + '>' + t + '</button>';
            }).join('') + '</div>') +
        '<div class="cat-scroll"><table class="tbl" id="exCatTable">' +
          '<thead><tr><th>Категория</th><th class="r">Сумма</th><th class="r">Опер.</th>' +
            '<th class="r">Ср. чек</th><th class="r" style="width:120px">Доля</th></tr></thead>' +
          '<tbody></tbody>' +
          '<tfoot><tr><td>Итого</td><td class="r num">' + money(d.total) + '</td>' +
            '<td class="r num">' + d.ops + '</td><td class="r num">' + money(d.avgCheck) + '</td>' +
            '<td class="r num">100%</td></tr></tfoot>' +
        '</table></div>' +
        '<p class="note">' + (Number(d.prev.total) > 0
          ? esc(d.prev.inName.charAt(0).toUpperCase() + d.prev.inName.slice(1)) +
            ' было ' + money(d.prev.total, 0) + ' за ' + nOps(d.prev.ops) +
            '. Колонка сравнения по каждой категории появится вместе с экраном «Прогнозы».'
          : 'Сравнивать не с чем — это первый период наблюдений. Колонка сравнения с предыдущим ' +
            'периодом появится, когда закроется следующий.') + '</p>' +
      '</div>' +
      '<div>' +
        exSecHead('Топ-' + Math.min(5, cd ? d.top5.length : 0) + ' крупнейших трат периода',
          'Пять самых дорогих отдельных операций за период',
          '<span class="badge badge--fact">факт</span> Пять самых дорогих отдельных операций') +
        '<div class="top5" id="exTop5"></div>' +
      '</div>' +
    '</section>' +

    /* ---------- ПАРЕТО ---------- */
    '<section class="sec">' +
      exSecHead('Парето 80/20',
        'Категории по убыванию суммы и накопленная доля. Показывает, на скольких категориях держится основная масса трат',
        '<span id="exParetoSub">—</span>',
        '<div class="legend">' +
          '<span class="legend-static"><span class="legend-sq"></span>Сумма по категории</span>' +
          '<span class="legend-static"><span class="legend-sq" style="background:var(--text-2)"></span>Накопленная доля</span>' +
          '<span class="legend-static"><span class="legend-dash" style="border-color:var(--warning)"></span>Порог 80%</span>' +
        '</div>') +
      '<div class="chart-wrap" id="exParetoWrap">' +
        '<svg id="exParetoSvg" role="img" aria-label="Диаграмма Парето по категориям расходов"></svg>' +
        '<div class="pt" id="exParetoTip" aria-hidden="true"></div>' +
      '</div>' +
    '</section>' +

    /* ---------- ПРИВЫЧКИ И ТИПЫ ---------- */
    '<section class="grid grid--2">' +
      '<div>' +
        exSecHead('Привычки и решения',
          'Категории разложены по двум признакам: как часто вы покупаете и на какую сумму в среднем. Пороги «часто» и «крупный чек» настраиваются',
          'Привычку меняют правилом, решение — паузой перед покупкой. Это разные рычаги') +
        '<div class="qd" id="exQuadrants"></div>' +
        '<div class="qd-verdict" id="exQdVerdict"></div>' +
      '</div>' +
      '<div>' +
        exSecHead('Обязательное против дискреционного',
          'Разбивка суммы периода по типам категорий из справочника',
          '<span class="badge badge--fact">факт</span> Разбивка по типу категорий за период') +
        '<div class="stack" id="exTypeStack"></div>' +
        '<div class="tb" id="exTypeBreakdown"></div>' +
        (d.types.some(function(t){ return t.key === 'сбережения'; })
          ? '<p class="note">Сбережения — пополнения брокерского счёта. Формально это не трата, ' +
            'но по вашему решению они учитываются как расход, поэтому показаны отдельным сегментом.</p>'
          : '') +
      '</div>' +
    '</section>' +

    /* ---------- ТРАТЫ ПО ДНЯМ ---------- */
    '<section class="sec">' +
      exSecHead('Траты по дням',
        'Сумма расходов за каждый день периода без переводов между своими счетами',
        '<span class="badge badge--fact">факт</span> <span id="exDailySub"></span>',
        '<div class="seg" id="exSegDays">' +
          '<button data-days="14">14д</button><button data-days="30">30д</button>' +
          '<button data-days="60">60д</button>' +
          '<button data-days="0" class="is-active">Период</button></div>') +
      '<div id="exBarsHost"></div>' +
      '<div class="legend" style="margin-top:16px">' +
        '<span class="legend-static"><span class="legend-sq"></span>Будни</span>' +
        '<span class="legend-static"><span class="legend-sq" style="opacity:.32"></span>Выходные</span>' +
        '<span class="legend-static"><span class="legend-sq" style="background:var(--danger);opacity:.8"></span>Самый дорогой день</span>' +
        '<span class="legend-static"><span class="legend-dash"></span>Средний день</span>' +
      '</div>' +
      '<p class="note" id="exDailyNote"></p>' +
    '</section>' +

    /* ---------- ПОВЕДЕНЧЕСКИЕ СРЕЗЫ ----------
       Средние по дням недели обманчивы, пока наблюдений меньше 30: блок не
       прячется, а приглушается, с бейджем и объяснением — по макету
       состояний. */
    '<section class="grid grid--3">' +
      '<div' + (exFew(d) ? ' class="is-few"' : '') + '>' +
        exSecHead('Средний расход по дням недели',
          'Сумма по дню недели ÷ сколько раз этот день встретился в периоде',
          '<span class="badge badge--est">оценка</span> Сумма по дню ÷ число таких дней', exFewBadge(d)) +
        '<div class="wd-bars" id="exWdBars"></div>' +
        '<div class="wd-labels" id="exWdLabels"></div>' +
        '<p class="note" id="exWdNote">—</p>' +
      '</div>' +
      '<div' + (exFew(d) ? ' class="is-few"' : '') + '>' +
        exSecHead('Будни и выходные',
          'Сравнивается средний день, а не сумма: будних дней в периоде всегда больше, и сумма была бы больше просто из-за этого',
          '<span class="badge badge--est">оценка</span> Сравниваем средний день, а не сумму', exFewBadge(d)) +
        '<div class="wk" id="exWkCompare"></div>' +
        '<p class="note" id="exWkNote"></p>' +
      '</div>' +
      '<div>' +
        exSecHead('Дни по уровню трат',
          'Сколько дней периода попало в каждый диапазон. Пороги настраиваются',
          '<span class="badge badge--fact">факт</span> Сколько дней попало в каждый диапазон') +
        '<div class="levels" id="exLevels"></div>' +
        '<p class="note" id="exLevelsNote">—</p>' +
      '</div>' +
    '</section>' +

    /* ---------- ВСЕ ОПЕРАЦИИ ---------- */
    '<section class="sec">' +
      '<div class="sec-head"><div style="min-width:0">' +
        '<div class="title-row"><h2 class="sec-title">Все операции</h2></div>' +
        '<p class="sec-sub">' + nOps(d.opsTotal) + ' за период, включая доходы и переводы</p>' +
      '</div><span class="spacer"></span>' +
        '<button class="btn btn-sm" id="exOpsToggle">Свернуть</button>' +
        '<button class="btn btn-sm" data-soon="Экспорт в CSV">Экспорт в CSV</button>' +
      '</div>' +
      '<div id="exOpsPanel">' +
        '<div class="ops-controls">' +
          '<div class="ops-search">' + EX_ICON.find +
            /* Значение подставляется обратно: иначе после смены периода
               поле выглядит пустым, а список остаётся отфильтрованным. */
            '<input type="text" id="exOpsSearch" value="' + esc(exSearch) +
              '" placeholder="Поиск по описанию, категории, счёту или сумме">' +
          '</div>' +
          '<div class="ops-filters">' + exFiltersHTML(d) + '</div>' +
        '</div>' +
        '<div class="ops-body"><table class="tbl">' +
          '<thead><tr><th style="width:80px">Дата</th><th>Описание</th>' +
            '<th style="width:200px">Категория</th><th style="width:180px">Счёт</th>' +
            '<th style="width:130px" class="r">Сумма</th></tr></thead>' +
          '<tbody id="exOpsBody"></tbody>' +
        '</table></div>' +
        '<div class="ops-foot">' +
          '<span class="sec-sub" style="margin:0" id="exOpsCount"></span>' +
          '<span class="spacer"></span>' +
          '<span class="sec-sub" style="margin:0">Сумма отфильтрованного</span>' +
          '<span class="v" id="exOpsSum"></span>' +
        '</div>' +
      '</div>' +
    '</section>' +
  '</div>';
}

/* ============================================================
   ТАБЛИЦА КАТЕГОРИЙ
   ============================================================ */
function exRenderCats(){
  var body = document.querySelector('#exCatTable tbody');
  if (!body) return;
  body.innerHTML = '';
  var top = rub(EXP.cats[0].sum);
  EXP.cats.forEach(function(c, i){
    if (exCatFilter && c.type !== exCatFilter) return;
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><div class="cat-cell"><span class="dot" style="background:' + c.color + '"></span>' +
        '<span>' + esc(c.name) + '</span></div></td>' +
      '<td class="r num">' + money(c.sum) + '</td>' +
      '<td class="r num">' + c.ops + '</td>' +
      '<td class="r num">' + money(c.avg) + '</td>' +
      '<td class="num share-cell">' +
        '<span class="share-track"><i style="width:' + (rub(c.sum) / top * 100).toFixed(1) +
          '%;background:' + c.color + '"></i></span>' +
        '<span class="share-val">' + exPct(c.sum, EXP.total) + '</span></td>';
    tr.addEventListener('mouseenter', function(){ exHighlight(i, true); });
    tr.addEventListener('mouseleave', function(){ exHighlight(i, false); });
    body.appendChild(tr);
  });
}
/* связь таблицы и плитки */
function exHighlight(index, on){
  var tile = document.querySelector('#exTmap [data-cat="' + index + '"]') ||
             document.querySelector('#exTmap [data-in~="' + index + '"]');
  if (tile) tile.classList.toggle('is-hot', on);
}

/* ============================================================
   ПЛИТОЧНАЯ ДИАГРАММА
   ============================================================
   Раскладка squarified: плитки укладываются рядами так, чтобы их
   пропорции были ближе к квадрату. Вытянутые полоски по площади
   читаются плохо, а именно площадь здесь и несёт смысл.
   ============================================================ */
function exSquarify(items, x, y, w, h){
  var out = [];
  var total = items.reduce(function(a, b){ return a + b.sum; }, 0);
  if (!total || w <= 0 || h <= 0) return out;
  var scale = (w * h) / total;
  var rest = items.map(function(it){ return { it: it, area: it.sum * scale }; });

  /* насколько вытянута худшая плитка ряда: 1 — идеальный квадрат */
  function worst(row, len){
    var s = 0, mx = 0, mn = Infinity;
    row.forEach(function(r){ s += r.area; if (r.area > mx) mx = r.area; if (r.area < mn) mn = r.area; });
    if (!s) return Infinity;
    return Math.max(len * len * mx / (s * s), (s * s) / (len * len * mn));
  }
  function layoutRow(row, len, vertical, cx, cy){
    var s = row.reduce(function(a, r){ return a + r.area; }, 0);
    var thick = s / len;
    var pos = vertical ? cy : cx;
    row.forEach(function(r){
      var size = r.area / thick;
      out.push(vertical
        ? { it: r.it, x: cx,  y: pos, w: thick, h: size }
        : { it: r.it, x: pos, y: cy,  w: size,  h: thick });
      pos += size;
    });
    return thick;
  }

  var cx = x, cy = y, cw = w, ch = h, row = [];
  while (rest.length){
    var vertical = cw >= ch;            /* узкую сторону режем поперёк */
    var len = vertical ? ch : cw;
    if (!row.length || worst(row.concat([rest[0]]), len) <= worst(row, len)){
      row.push(rest.shift());
    } else {
      var thick = layoutRow(row, len, vertical, cx, cy);
      if (vertical){ cx += thick; cw -= thick; } else { cy += thick; ch -= thick; }
      row = [];
    }
  }
  if (row.length){
    var v = cw >= ch;
    layoutRow(row, v ? ch : cw, v, cx, cy);
  }
  return out;
}

/* Цвет текста выбираем по самой плитке, а не по теме: палитра
   категорий пёстрая, и белый читается не на всех цветах. Берём тот из
   двух цветов, который даёт больший контраст. */
var EX_TILE_DARK = '#111110', EX_TILE_LIGHT = '#ffffff';
function exLum(hex){
  var h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length < 6) return 0;
  function lin(c){ c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  return 0.2126 * lin(parseInt(h.slice(0, 2), 16)) +
         0.7152 * lin(parseInt(h.slice(2, 4), 16)) +
         0.0722 * lin(parseInt(h.slice(4, 6), 16));
}
function exContrast(l1, l2){ return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
function exTextOn(hex){
  var L = exLum(hex);
  return exContrast(L, exLum(EX_TILE_DARK)) >= exContrast(L, exLum(EX_TILE_LIGHT))
    ? EX_TILE_DARK : EX_TILE_LIGHT;
}

var EX_GAP = 3, EX_PAD = 18;
/* Ниже этих размеров плитка не несёт сведений: подпись не влезает,
   площадь на глаз не сравнивается, а у края блока такая плитка
   читается как обрывок. */
var EX_MIN_W = 30, EX_MIN_H = 22;
var EX_TMAP_FONT = '500 12px ' + FONT_SANS;
/* Ширину подписи меряем canvas'ом: он берёт те же метрики шрифта, что
   и вёрстка, но отвечает до отрисовки. Оценка «символов × константу»
   врёт, а замер по scrollWidth требует второго прохода по DOM. */
var exMeasureCtx = null;
function exTextWidth(str){
  if (!exMeasureCtx) exMeasureCtx = document.createElement('canvas').getContext('2d');
  exMeasureCtx.font = EX_TMAP_FONT;
  return exMeasureCtx.measureText(str).width;
}
/* Цвет плитки приходит токеном var(--cat-N) — для расчёта контраста
   нужно его значение. */
function exColorValue(token){
  var m = /var\((--[\w-]+)\)/.exec(token);
  return m ? (cssVar(m[1]) || '#9b9b97') : token;
}

/* Остаток — одна плитка из нескольких самых мелких категорий. */
function exRestItem(list){
  var cents = 0, ops = 0;
  list.forEach(function(t){ cents += Number(t.cents); ops += t.ops; });
  return {
    name: 'Ещё ' + list.length + '\u00A0' + plural(list.length, 'категория', 'категории', 'категорий'),
    short: 'Ещё ' + list.length, sum: cents / 100, cents: String(cents),
    ops: ops, color: 'var(--surface-2)', index: -1, list: list.slice()
  };
}

/* Раскладка с гарантией: ни одна плитка не выходит мельче порога.
   Пока такая находится, самая мелкая категория уходит в общий
   остаток, и раскладка пересчитывается целиком — от этого остаток
   растёт и в какой-то момент сам становится читаемым. */
function exLayoutTiles(items, W, H){
  var kept = items.slice(), folded = [], rects = [], merged = null;
  for (var pass = 0; pass <= items.length; pass++){
    merged = folded.length ? exRestItem(folded) : null;
    var list = kept.slice();
    if (merged) list.push(merged);
    list.sort(function(a, b){ return b.sum - a.sum; });
    rects = exSquarify(list, 0, 0, W, H);
    var bad = rects.filter(function(r){
      return r.w < EX_MIN_W + EX_GAP || r.h < EX_MIN_H + EX_GAP;
    });
    if (!bad.length) break;
    /* Складывать дальше некуда — лучше показать как есть, чем свести
       мозаику к трём плиткам. */
    if (kept.length <= 3) break;
    folded.push(kept.pop());
  }
  return { rects: rects, merged: merged };
}

function exRenderTreemap(){
  var box = document.getElementById('exTmap');
  var note = document.getElementById('exTmapNote');
  if (!box) return;
  box.innerHTML = '';

  /* Размер области берём точный, дробный: clientWidth округляет до
     целого, и на этом округлении плитки правого столбца уезжали за
     край блока. */
  var rect = box.getBoundingClientRect();
  var W = rect.width || box.clientWidth || 560;
  var H = rect.height || box.clientHeight || 380;
  var items = EXP.cats.map(function(c, i){
    return { name: c.name, short: c.short, sum: rub(c.sum), cents: c.sum,
             ops: c.ops, color: c.color, index: i };
  });

  var laid = exLayoutTiles(items, W, H);
  var rects = laid.rects, merged = laid.merged;
  var unlabeled = [];

  rects.forEach(function(r){
    /* Зазор режем внутрь плитки и только между соседями: у внешних
       краёв мозаика прижата к границам блока, поэтому там зазора нет.
       Раньше он вычитался у всех одинаково, и правый столбец
       оказывался то короче соседнего, то шириной в пиксель. */
    var gl = r.x > 0.5 ? EX_GAP / 2 : 0;
    var gt = r.y > 0.5 ? EX_GAP / 2 : 0;
    var gr = (r.x + r.w) < W - 0.5 ? EX_GAP / 2 : 0;
    var gb = (r.y + r.h) < H - 0.5 ? EX_GAP / 2 : 0;
    var x = r.x + gl, y = r.y + gt;
    var w = Math.max(r.w - gl - gr, 1), h = Math.max(r.h - gt - gb, 1);
    /* Страховка от округлений: за границы области не выходим никогда. */
    if (x + w > W) w = Math.max(W - x, 1);
    if (y + h > H) h = Math.max(H - y, 1);
    var color = exColorValue(r.it.color);
    var tile = document.createElement('div');
    tile.className = 'tmap-tile' + (r.it.list ? ' is-rest' : '');
    tile.setAttribute('data-cat', r.it.index);
    tile.style.cssText =
      'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;' +
      'width:' + w.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;' +
      'background:' + color + ';color:' + exTextOn(color) + ';';
    tile.title = r.it.list
      ? r.it.list.map(function(t){ return t.name + ' — ' + money(t.cents); }).join('\n')
      : r.it.name + ' — ' + money(r.it.cents) + ' · ' +
        exPct(r.it.cents, EXP.total) + ' · ' + r.it.ops + ' оп.';
    /* Строка таблицы подсвечивает свою плитку; у собранной плитки
       адресов несколько. */
    if (r.it.list) tile.setAttribute('data-in',
      r.it.list.map(function(t){ return t.index; }).join(' '));

    /* Не влезло полное название — берём короткое, не влезло и оно — не
       пишем вовсе. Обрезанное «Переводы другим лю…» только шумит. */
    var room = w - EX_PAD;
    var label = exTextWidth(r.it.name) <= room ? r.it.name
              : (exTextWidth(r.it.short) <= room ? r.it.short : null);
    var sum = r.it.cents;

    if (label && h >= 62){
      tile.innerHTML = '<span class="tmap-nm">' + esc(label) + '</span>' +
                       '<span class="tmap-sum">' + money(sum, 0) + '</span>' +
                       '<span class="tmap-pct">' + exPct(sum, EXP.total) + '</span>';
    } else if (label && h >= 40){
      tile.innerHTML = '<span class="tmap-nm">' + esc(label) + '</span>' +
                       '<span class="tmap-pct">' + exPct(sum, EXP.total) + '</span>';
    } else if (w >= 40 && h >= 24){
      tile.className += ' is-tiny';
      tile.innerHTML = '<span class="tmap-pct">' + exPct(sum, EXP.total) + '</span>';
      unlabeled.push(r.it);
    } else if (r.it.list && w >= 22 && h >= 22){
      /* Собранная плитка подписывается долей даже в узкой колонке:
         пустой прямоугольник в углу мозаики читается как сбой. */
      tile.className += ' is-tiny';
      tile.innerHTML = '<span class="tmap-pct">' + exPct(sum, EXP.total) + '</span>';
    } else if (!r.it.list){
      unlabeled.push(r.it);
    }

    tile.addEventListener('mouseenter', function(){ exHighlight(r.it.index, true); });
    tile.addEventListener('mouseleave', function(){ exHighlight(r.it.index, false); });
    box.appendChild(tile);
  });

  var parts = [];
  if (merged){
    parts.push('Мелкие категории собраны в одну плитку: ' +
      merged.list.map(function(t){ return t.name; }).join(', ') +
      ' — вместе ' + money(merged.cents, 0) + ' (' + exPct(merged.cents, EXP.total) + ').');
  }
  if (unlabeled.length){
    parts.push('Без подписи ' + unlabeled.length + ' ' +
      plural(unlabeled.length, 'плитка', 'плитки', 'плиток') +
      ' — для подписи слишком малы: ' + unlabeled.map(function(u){ return u.name; }).join(', ') + '.');
  }
  parts.push('Наведите на плитку — подсветится строка в таблице ниже.');
  note.textContent = nbsp(parts.join(' '));
}

/* ============================================================
   ТОП-5
   ============================================================ */
function exRenderTop5(){
  var box = document.getElementById('exTop5');
  if (!box) return;
  box.innerHTML = EXP.top5.map(function(t, i){
    var share = rub(t.sum) / rub(EXP.total);
    var warn = share > 0.15 ? '<span class="badge badge--partial">искажает средние</span>' : '';
    return '<div class="row">' +
      '<span class="rank">' + (i + 1) + '</span>' +
      '<div class="desc">' +
        '<div class="d1">' + esc(t.desc) + '</div>' +
        '<div class="d2"><span class="dot" style="background:' + t.color + '"></span>' + esc(t.cat) +
          '<span>·</span><span class="num">' + t.date + '</span><span>·</span><span>' +
          esc(t.acc) + '</span>' + warn + '</div>' +
      '</div>' +
      '<div class="sum"><div class="s1">' + money(t.sum) + '</div>' +
        '<div class="s2">' + exPct(t.sum, EXP.total) + ' периода</div></div>' +
    '</div>';
  }).join('');
}

/* ============================================================
   ПАРЕТО 80/20
   ============================================================
   Рисуем в реальных пикселях и перерисовываем на resize: при
   масштабировании viewBox подписи категорий плыли вместе с осями.
   ============================================================ */
function exRenderPareto(){
  var wrap = document.getElementById('exParetoWrap');
  var svg = document.getElementById('exParetoSvg');
  if (!svg) return;
  svg.innerHTML = '';

  var cats = EXP.cats, n = cats.length;
  /* ниже 58 px на категорию подписи начинают наезжать — включаем прокрутку */
  var W = Math.max(wrap.clientWidth || 900, 64 + n * 58);
  var H = 268;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);

  var PL = 52, PR = W - 44, PW = PR - PL, PT = 12, PB = 198;
  var top = rub(cats[0].sum);
  var step = 6000;
  while (Math.ceil(top / step) > 4) step *= 2;
  var MAXV = Math.ceil(top / step) * step;
  var slot = PW / n, bw = Math.min(46, slot * 0.56);
  var Y = function(v){ return PB - v / MAXV * (PB - PT); };
  var YP = function(p){ return PB - p / 100 * (PB - PT); };

  [MAXV, MAXV * 0.75, MAXV * 0.5, MAXV * 0.25, 0].forEach(function(g){
    var y = Y(g);
    svg.appendChild(svgEl('line', { x1: PL, y1: y, x2: PR, y2: y,
      stroke: g === 0 ? 'var(--border-strong)' : 'var(--border)', 'stroke-width': 1,
      'stroke-dasharray': g === 0 ? 'none' : '3 3' }));
    exText(svg, PL - 10, y + 3.5, g === 0 ? '0' + RUB : fmtR(g / 1000) + 'к', { anchor: 'end', size: 10 });
  });
  [100, 80, 50, 0].forEach(function(p){
    exText(svg, PR + 10, YP(p) + 3.5, p + '%', { anchor: 'start', size: 10 });
  });

  /* порог 80% */
  var y80 = YP(80);
  svg.appendChild(svgEl('line', { x1: PL, y1: y80, x2: PR, y2: y80,
    stroke: 'var(--warning)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));

  var total = rub(EXP.total);
  var cum = 0, crossIndex = null, pts = [];
  /* Геометрия столбцов остаётся под рукой: по ней подсказка находит,
     над каким столбцом мышь, и где у него верх. */
  var hit = [];
  cats.forEach(function(c, i){
    cum += rub(c.sum);
    var cumPct = cum / total * 100;
    if (crossIndex === null && cumPct >= 80) crossIndex = i;
    var x = PL + slot * i + slot / 2;
    pts.push([x, YP(cumPct)]);

    var inCore = (crossIndex === null || i <= crossIndex);
    var bar = svgEl('rect', {
      x: x - bw / 2, y: Y(rub(c.sum)), width: bw, height: Math.max(PB - Y(rub(c.sum)), 1),
      rx: 3, fill: c.color, opacity: inCore ? 0.9 : 0.3
    });
    svg.appendChild(bar);
    hit.push({ x: x, top: Y(rub(c.sum)), cat: c, cum: cumPct, bar: bar,
               base: inCore ? 0.9 : 0.3 });
    exText(svg, x, PB + 18, c.short, { size: 10, font: FONT_SANS,
      fill: inCore ? 'var(--text-2)' : 'var(--text-3)' });
    exText(svg, x, PB + 33, exPct(c.sum, EXP.total), { size: 10 });
  });

  svg.appendChild(svgEl('path', {
    d: pts.map(function(p, i){ return (i ? 'L ' : 'M ') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' '),
    fill: 'none', stroke: 'var(--text-2)', 'stroke-width': 1.6,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  }));
  pts.forEach(function(p){
    svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 3,
      fill: 'var(--bg)', stroke: 'var(--text-2)', 'stroke-width': 1.6 }));
  });

  exWireParetoTip(wrap, hit, PL, PR, W);

  var core = (crossIndex === null ? n : crossIndex + 1);
  document.getElementById('exParetoSub').textContent = nbsp(core + ' из ' + n +
    ' категорий формируют 80% всех трат за период. ' +
    (n - core > 0
      ? 'Остальные ' + (n - core) + ' вместе дают меньше пятой части — экономить на них почти бессмысленно'
      : 'Меньше траты не даёт ни одна категория — период слишком короткий, чтобы делить их на главные и второстепенные'));
}

/* Подсказка на столбце Парето: сумма категории, её доля и сколько
   операций за ней стоит. Столбец под мышью гасит прозрачность — видно,
   о каком именно идёт речь. */
function exWireParetoTip(wrap, hit, PL, PR, W){
  var tip = document.getElementById('exParetoTip');
  if (!tip || !hit.length) return;
  var svg = document.getElementById('exParetoSvg');
  var slot = (PR - PL) / hit.length;
  var active = null;

  function hide(){
    tip.classList.remove('is-on');
    if (active){ active.bar.setAttribute('opacity', active.base); active = null; }
  }
  function move(e){
    var x = e.clientX - svg.getBoundingClientRect().left;
    var i = Math.floor((x - PL) / slot);
    if (x < PL || x > PR || i < 0 || i >= hit.length){ hide(); return; }
    var h = hit[i];
    if (h !== active){
      if (active) active.bar.setAttribute('opacity', active.base);
      active = h;
      h.bar.setAttribute('opacity', 1);
      tip.innerHTML =
        '<div class="t-nm"><span class="dot" style="background:' + h.cat.color + '"></span>' +
          esc(h.cat.name) + '</div>' +
        '<div class="t-sum">' + money(h.cat.sum) + '</div>' +
        '<div class="t-meta">' + exPct(h.cat.sum, EXP.total) + ' периода · ' +
          nOps(h.cat.ops) + ' · средний чек ' + money(h.cat.avg, 0) + '<br>' +
          'накопленная доля ' + Math.round(h.cum) + '%</div>';
    }
    tip.classList.add('is-on');
    var w = tip.offsetWidth || 210, ht = tip.offsetHeight || 84;
    var left = Math.max(2, Math.min(h.x - w / 2, W - w - 2));
    /* Над столбцом, если сверху есть место; иначе — сразу под его
       верхней кромкой, чтобы подсказка не уходила за край блока. */
    var top = h.top - ht - 10;
    tip.style.left = left + 'px';
    tip.style.top = (top < 0 ? h.top + 10 : top) + 'px';
  }
  /* Обработчик переживает перерисовку: сам график пересобирается при
     смене периода и размера окна, а обёртка остаётся та же. */
  if (!wrap.ptWired){
    wrap.addEventListener('mousemove', function(e){ if (wrap.ptMove) wrap.ptMove(e); });
    wrap.addEventListener('mouseleave', function(){ if (wrap.ptHide) wrap.ptHide(); });
    wrap.ptWired = true;
  }
  wrap.ptMove = move;
  wrap.ptHide = hide;
}

/* ============================================================
   ПРИВЫЧКИ И РЕШЕНИЯ — матрица «частота × средний чек»
   ============================================================ */
var EX_QUADRANTS = [
  { key:'often-small', often:true,  big:false, name:'Привычки',
    hint:'Меняются правилом — списком покупок, лимитом на неделю' },
  { key:'often-big',   often:true,  big:true,  name:'Тревожная зона',
    hint:'Часто и дорого одновременно' },
  { key:'rare-small',  often:false, big:false, name:'Мелочи',
    hint:'На итог месяца влияют слабо' },
  { key:'rare-big',    often:false, big:true,  name:'Решения',
    hint:'Каждая покупка обдумывается отдельно. Работает пауза перед оплатой' }
];

function exRenderQuadrants(){
  var host = document.getElementById('exQuadrants');
  if (!host) return;
  var oftenFrom = EXP.thresholds.oftenFrom;
  var bigFrom = rub(EXP.thresholds.bigCheckFrom);

  var filled = EX_QUADRANTS.map(function(q){
    var inside = EXP.cats.filter(function(c){
      var often = c.ops >= oftenFrom;
      var big = rub(c.avg) >= bigFrom;
      return often === q.often && big === q.big;
    });
    var sum = 0, ops = 0;
    inside.forEach(function(c){ sum += rub(c.sum); ops += c.ops; });
    return { q: q, cats: inside, sum: sum, ops: ops };
  });
  var lead = filled.reduce(function(a, b){ return b.sum > a.sum ? b : a; });

  function cell(f){
    if (!f.cats.length){
      return '<div class="qd-cell is-empty">' +
        '<div class="qd-nm" style="color:var(--text-2)">' + f.q.name + '</div>' +
        '<div class="qd-meta" style="margin-top:6px">' +
          (f.q.key === 'often-big'
            ? 'Таких категорий нет — вы нигде не покупаете и часто, и дорого одновременно. Это хороший знак'
            : 'В этом периоде таких категорий не нашлось') +
        '</div></div>';
    }
    var rows = f.cats.map(function(c){
      return '<div class="qd-i"><span class="dot" style="background:' + c.color + '"></span>' +
        '<span class="nm" title="' + esc(c.name) + '">' + esc(c.name) + '</span>' +
        '<span class="spacer"></span>' +
        '<span class="amt">' + money(c.sum, 0) + '</span>' +
        '<span class="n">' + c.ops + ' оп</span></div>';
    }).join('');
    return '<div class="qd-cell' + (f === lead ? ' is-lead' : '') + '">' +
      '<div class="qd-top"><span class="qd-nm">' + f.q.name + '</span>' +
        '<span class="qd-sh">' + Math.round(f.sum / rub(EXP.total) * 100) + '%</span></div>' +
      '<div class="qd-sum">' + fmtR(f.sum) + ' ₽</div>' +
      '<div class="qd-meta">' + f.ops + ' операций · средний чек ' +
        fmtR(f.sum / f.ops) + ' ₽</div>' +
      '<div class="qd-list">' + rows + '</div>' +
      '<div class="qd-hint">' + f.q.hint + '</div>' +
    '</div>';
  }

  var byKey = {};
  filled.forEach(function(f){ byKey[f.q.key] = f; });

  host.innerHTML =
    '<div class="qd-corner"></div>' +
    '<div class="qd-colh"><b>Мелкий чек</b><span>до ' + money(EXP.thresholds.bigCheckFrom, 0) + '</span></div>' +
    '<div class="qd-colh"><b>Крупный чек</b><span>от ' + money(EXP.thresholds.bigCheckFrom, 0) + '</span></div>' +
    '<div class="qd-rowh"><b>Часто</b><span>от ' + oftenFrom + ' оп.</span></div>' +
    cell(byKey['often-small']) + cell(byKey['often-big']) +
    '<div class="qd-rowh"><b>Редко</b><span>до ' + oftenFrom + ' оп.</span></div>' +
    cell(byKey['rare-small']) + cell(byKey['rare-big']);

  var dec = byKey['rare-big'], hab = byKey['often-small'];
  var verdict = document.getElementById('exQdVerdict');
  if (!dec.ops || !hab.ops){
    verdict.innerHTML = '<span class="dot"></span><span>Пока мало операций, чтобы делить траты ' +
      'на привычки и решения: за период их ' + EXP.ops + '.</span>';
    return;
  }
  verdict.innerHTML = '<span class="dot"></span>' +
    '<span><b>' + dec.ops + ' операций из ' + EXP.ops + ' дали ' +
    Math.round(dec.sum / rub(EXP.total) * 100) + '% периода.</b> ' +
    'На привычные покупки пришлось ' + Math.round(hab.sum / rub(EXP.total) * 100) +
    '% — операций в ' + exTimes(hab.ops / dec.ops) + ' больше, а денег в ' +
    exRatio(dec.sum, hab.sum) + ' раза меньше. ' +
    'Экономить проще там, где решений мало, а суммы велики.</span>';
}

/* ============================================================
   ОБЯЗАТЕЛЬНОЕ ПРОТИВ ДИСКРЕЦИОННОГО
   ============================================================ */
var EX_TYPE_HINT = {
  'базовые':       'повседневная жизнь, сократить трудно',
  'обязательные':  'фиксированные обязательства',
  'дискреционные': 'то, чем можно управлять',
  'сбережения':    'не трата, а перенос в активы',
  'прочее':        'разовые переводы вне категорий'
};

function exRenderTypes(){
  var stack = document.getElementById('exTypeStack');
  var box = document.getElementById('exTypeBreakdown');
  if (!stack) return;
  stack.innerHTML = ''; box.innerHTML = '';

  EXP.types.forEach(function(t){
    var share = rub(t.sum) / rub(EXP.total) * 100;
    var seg = document.createElement('i');
    seg.style.width = share + '%';
    seg.style.background = t.color;
    if (share > 12) seg.textContent = exPct(t.sum, EXP.total);
    seg.title = t.name + ' — ' + money(t.sum);
    stack.appendChild(seg);

    var inside = EXP.cats.filter(function(c){ return c.type === t.key; });
    var ops = inside.reduce(function(a, c){ return a + c.ops; }, 0);
    var bars = inside.map(function(c){
      return '<i style="width:' + (rub(c.sum) / rub(t.sum) * 100) + '%;background:' + c.color + '" ' +
             'title="' + esc(c.name) + ' — ' + money(c.sum) + '"></i>';
    }).join('');
    var names = inside.map(function(c){ return c.name; }).join(' · ');

    var row = document.createElement('div');
    row.className = 'tb-row';
    row.innerHTML =
      '<div class="tb-head">' +
        '<span class="dot" style="background:' + t.color + '"></span>' +
        '<span class="nm">' + t.name + '</span>' +
        '<span class="hint">' + (EX_TYPE_HINT[t.key] || '') + '</span>' +
        '<span class="spacer"></span>' +
        '<span class="sum">' + money(t.sum) + '</span>' +
        '<span class="sh">' + exPct(t.sum, EXP.total) + '</span>' +
      '</div>' +
      '<div class="tb-bar">' + bars + '</div>' +
      /* Счётчик идёт первым: перечень категорий переносится на вторую
         строку, и при обратном порядке число уезжало за край блока. */
      '<div class="tb-meta"><span class="num">' + nOps(ops) + '</span> · ' + esc(names) + '</div>';
    box.appendChild(row);
  });
}

/* ============================================================
   ТРАТЫ ПО ДНЯМ
   ============================================================ */
function exDays(){
  if (!exBarsDays) return EXP.daily;
  return EXP.dailyTail.slice(Math.max(0, EXP.dailyTail.length - exBarsDays));
}

function exRenderDaily(){
  var host = document.getElementById('exBarsHost');
  if (!host) return;
  var days = exDays();
  var sub = document.getElementById('exDailySub');

  if (!days.length){
    host.innerHTML = '<div class="bars-empty">За выбранный отрезок наблюдений нет.</div>';
    document.getElementById('exDailyNote').textContent = '';
    if (sub) sub.textContent = '—';
    return;
  }

  host.innerHTML =
    '<div class="bars-wrap">' +
      '<div class="bars-axis" id="exBarsAxis"></div>' +
      '<div class="bars-plot">' +
        '<div class="bars-grid" id="exBarsGrid"></div>' +
        '<div class="bars-avg" id="exBarsAvg"><b></b></div>' +
        '<div class="bars" id="exBars"></div>' +
        '<div class="bars-labels" id="exBarsLabels"></div>' +
      '</div>' +
    '</div>';

  var vals = days.map(function(d){ return rub(d.value); });
  var sum = vals.reduce(function(s, v){ return s + v; }, 0);
  var avg = sum / days.length;
  var med = medianOf(vals);
  /* Потолок шкалы: без него один дорогой день прижимает к нулю все
     остальные и читать график невозможно. Порог считается по самим
     данным, а не назначен числом. */
  var CAP = barsCap(vals);
  var H = 170;
  var clipped = days.filter(function(d){ return rub(d.value) > CAP; });
  var maxVal = Math.max.apply(null, vals);

  if (sub) sub.textContent = days[0].date + ' — ' + days[days.length - 1].date +
    ' · ' + nDays(days.length);

  var axis = document.getElementById('exBarsAxis');
  var grid = document.getElementById('exBarsGrid');
  [CAP, CAP * 0.75, CAP * 0.5, CAP * 0.25, 0].forEach(function(g){
    var top = (1 - g / CAP) * H;
    var s = document.createElement('span');
    s.style.top = top + 'px';
    s.textContent = g === 0 ? '0' + RUB : fmtR(g / 1000) + 'к' + RUB;
    axis.appendChild(s);
    var i = document.createElement('i');
    i.style.top = top + 'px';
    if (g === 0) i.className = 'zero';
    grid.appendChild(i);
  });

  var avgEl = document.getElementById('exBarsAvg');
  avgEl.style.top = (24 + (1 - Math.min(avg, CAP) / CAP) * H) + 'px';
  avgEl.querySelector('b').textContent = fmtR(avg) + RUB;

  var bars = document.getElementById('exBars');
  var labels = document.getElementById('exBarsLabels');

  /* Прореживаем подписи по фактической ширине колонки, а не по числу
     дней: в узкой колонке даже 14 дат сливаются в сплошную строку. */
  var colW = (bars.clientWidth || 900) / days.length;
  var labelStep = colW < 26 ? 3 : (colW < 38 ? 2 : 1);
  var dense = colW < 34;
  labels.className = 'bars-labels' + (dense ? ' is-dense' : '');

  days.forEach(function(d, idx){
    var v = rub(d.value);
    var col = document.createElement('div');
    col.className = 'bar-col' + (d.weekend ? ' is-weekend' : '') +
      (v === 0 ? ' is-zero' : '') +
      (v === maxVal && maxVal > 0 ? ' is-max' : '');

    var over = v > CAP;
    var barH = Math.min(v, CAP) / CAP * H;
    var bar = document.createElement('div');
    bar.className = 'bar' + (over ? ' is-clipped' : '');
    bar.style.height = Math.max(barH, 2) + 'px';
    col.appendChild(bar);

    if (over){
      var lbl = document.createElement('div');
      lbl.className = 'bar-over';
      lbl.textContent = fmtR(v) + RUB;
      col.appendChild(lbl);
    }

    var tip = document.createElement('div');
    tip.className = 'tip' +
      (idx <= 1 ? ' at-left' : (idx >= days.length - 2 ? ' at-right' : ''));
    tip.innerHTML = '<div class="t-date">' + d.date + ', ' + d.dow + '</div>' +
      '<div class="t-sum">' + (v === 0 ? 'День без трат' : money(d.value)) + '</div>';
    col.appendChild(tip);
    bars.appendChild(col);

    var lb = document.createElement('div');
    /* Считаем от конца: последний день подписан всегда, он же точка отсчёта */
    var fromEnd = days.length - 1 - idx;
    lb.innerHTML = (fromEnd % labelStep === 0)
      ? d.date + (dense ? '' : '<small>' + d.dow + '</small>')
      : '';
    labels.appendChild(lb);
  });

  placeTips(bars);

  var below = vals.filter(function(v){ return v < avg; }).length;
  var parts = ['Средний день ' + fmtR(avg) + RUB + ' выше, чем ' + below + ' из ' +
               exOfDays(days.length) + '. Медиана — ' + fmtR(med) + RUB + '.'];
  if (clipped.length){
    parts.push((clipped.length === 1 ? 'Один столбец не помещается' :
                clipped.length + ' столбца не помещаются') +
      ' в шкалу и обрезаны сверху: ' +
      clipped.map(function(c){ return c.date + ' — ' + fmtR(rub(c.value)) + RUB; }).join(', ') +
      '. Вместе эти дни дают ' +
      Math.round(clipped.reduce(function(a, c){ return a + rub(c.value); }, 0) / sum * 100) +
      '% всех трат отрезка.');
  }
  document.getElementById('exDailyNote').textContent = nbsp(parts.join(' '));
}

/* ============================================================
   ДНИ НЕДЕЛИ
   ============================================================ */
function exRenderWeekdays(){
  var bars = document.getElementById('exWdBars');
  if (!bars) return;
  var labels = document.getElementById('exWdLabels');
  var order = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  var acc = {};
  order.forEach(function(k){ acc[k] = { sum: 0, n: 0 }; });
  EXP.daily.forEach(function(d){
    if (!acc[d.dow]) return;
    acc[d.dow].sum += rub(d.value); acc[d.dow].n++;
  });
  var avgs = order.map(function(k){ return acc[k].n ? acc[k].sum / acc[k].n : 0; });
  var max = Math.max.apply(null, avgs);

  bars.innerHTML = ''; labels.innerHTML = '';
  avgs.forEach(function(v, i){
    var col = document.createElement('div');
    col.className = 'wd-col' + (v === max && max > 0 ? ' is-max' : '');
    col.innerHTML = '<span class="v">' + fmtR(v) + ' ₽</span>' +
                    '<span class="b" style="height:' + (max ? Math.max(v / max * 108, 2) : 2) + 'px"></span>';
    bars.appendChild(col);
    var lb = document.createElement('div');
    lb.textContent = order[i];
    labels.appendChild(lb);
  });

  var full = { 'пн':'понедельник', 'вт':'вторник', 'ср':'среда', 'чт':'четверг',
               'пт':'пятница', 'сб':'суббота', 'вс':'воскресенье' };
  var maxDay = full[order[avgs.indexOf(max)]];
  var perDow = Math.floor(EXP.daily.length / 7);
  var note = 'Дороже всего обходится ' + maxDay + ' — ' + fmtR(max) + RUB + ' в среднем.';
  /* Пока на каждый день недели приходится два-три наблюдения, одна
     покупка двигает всю колонку — об этом экран обязан предупредить. */
  if (perDow < 8){
    note += ' ' + nDays(EXP.daily.length) + ' наблюдений — это примерно по ' + perDow +
      ' на каждый день недели, поэтому одна крупная покупка сдвигает всю колонку. ' +
      'Выводы о «дорогих днях недели» можно делать месяца через три.';
  }
  document.getElementById('exWdNote').textContent = nbsp(exFew(EXP) ? exFewNote() : note);
}

/* ============================================================
   БУДНИ И ВЫХОДНЫЕ — две пары полос на общей шкале
   ============================================================ */
function exRenderWeekend(){
  var host = document.getElementById('exWkCompare');
  if (!host) return;
  var wd = { sum: 0, n: 0, net: 0 }, we = { sum: 0, n: 0, net: 0 };
  EXP.daily.forEach(function(d){
    var t = d.weekend ? we : wd;
    var v = rub(d.value);
    t.sum += v; t.n++; t.net += v - rub(EXP.oneOffs[d.iso] || '0');
  });
  if (!wd.n || !we.n){
    host.innerHTML = '';
    document.getElementById('exWkNote').textContent =
      'В периоде нет ' + (wd.n ? 'выходных' : 'будних дней') + ' — сравнивать не с чем.';
    return;
  }

  var groups = [
    ['Все траты', [
      ['Будни',    wd.sum / wd.n, false, wd.n],
      ['Выходные', we.sum / we.n, true,  we.n]
    ]],
    ['Без разовых дороже ' + money(EXP.oneOff.from, 0), [
      ['Будни',    wd.net / wd.n, false, wd.n],
      ['Выходные', we.net / we.n, true,  we.n]
    ]]
  ];
  var max = Math.max(wd.sum / wd.n, we.sum / we.n);

  host.innerHTML = groups.map(function(g){
    return '<div class="wk-group"><div class="gt">' + g[0] + '</div>' +
      g[1].map(function(r){
        return '<div class="wk-row' + (r[2] ? ' is-we' : '') + '">' +
          '<span class="k">' + r[0] + '<br><span class="cap">' + r[3] + ' дн.</span></span>' +
          '<span class="track"><i style="width:' + (max ? r[1] / max * 100 : 0) + '%"></i></span>' +
          '<span class="v">' + fmtR(r[1]) + ' ₽</span>' +
        '</div>';
      }).join('') + '</div>';
  }).join('');

  var r1 = (we.sum / we.n) / (wd.sum / wd.n);
  var r2 = (wd.net / wd.n) ? (we.net / we.n) / (wd.net / wd.n) : 0;
  var note;
  if (r1 >= 1){
    note = 'Выходной день дороже будня в ' + exRatio(we.sum / we.n, wd.sum / wd.n) + ' раза. ' +
      (r2 >= 1
        ? 'Разовые покупки дороже ' + money(EXP.oneOff.from, 0) + ' этот разрыв не объясняют: ' +
          'без них выходной всё равно дороже в ' + exRatio(we.net / we.n, wd.net / wd.n) + ' раза. '
        : 'Разрыв держится на разовых покупках: без них будний день дороже. ');
  } else {
    note = 'Будний день дороже выходного в ' + exRatio(wd.sum / wd.n, we.sum / we.n) + ' раза. ';
  }
  note += 'Выходных в периоде всего ' + we.n + ', поэтому одна суббота заметно двигает среднее.';
  document.getElementById('exWkNote').textContent = nbsp(exFew(EXP) ? exFewNote() : note);
}

/* ============================================================
   ДНИ ПО УРОВНЮ ТРАТ
   ============================================================ */
function exRenderLevels(){
  var host = document.getElementById('exLevels');
  if (!host) return;
  /* Ступени — пороги уровней трат из настроек. */
  var T = EXP.levels && EXP.levels.length >= 4 ? EXP.levels : [1000, 3000, 5000, 10000, 30000];
  var LV = [['Без трат', 0, 0], ['до ' + fmtR(T[0]) + RUB, 0.01, T[0]]];
  for (var k = 1; k < T.length; k++) LV.push([fmtR(T[k - 1]) + ' – ' + fmtR(T[k]) + RUB, T[k - 1], T[k]]);
  LV.push(['свыше ' + fmtR(T[T.length - 1]) + RUB, T[T.length - 1], 1e12]);
  var days = EXP.daily;
  var counts = LV.map(function(l){
    return days.filter(function(d){
      var v = rub(d.value);
      if (l[1] === 0 && l[2] === 0) return v === 0;
      return v > l[1] - 0.001 && v <= l[2] && v > 0;
    }).length;
  });
  var max = Math.max.apply(null, counts);

  host.innerHTML = LV.map(function(l, i){
    return '<div class="row' + (i === 0 ? ' is-zero' : '') + '">' +
      '<span>' + nbsp(l[0]) + '</span>' +
      '<span class="track"><i style="width:' + (max ? counts[i] / max * 100 : 0) + '%"></i></span>' +
      '<span class="n">' + counts[i] + ' дн.</span>' +
      '<span class="p">' + Math.round(counts[i] / days.length * 100) + '%</span>' +
    '</div>';
  }).join('');

  /* «Обычный» и «тяжёлый» день — третий и четвёртый пороги. */
  var calm = T[2], hard = T[3];
  var under5k = days.filter(function(d){ return rub(d.value) <= calm; }).length;
  var heavy = days.filter(function(d){ return rub(d.value) > hard; });
  var note = under5k + ' из ' + exOfDays(days.length) + ' уложились в ' + fmtR(calm) + RUB + ' — ' +
    'обычный день у вас недорогой.';
  if (heavy.length){
    note += ' Период вытянули ' + heavy.length + ' ' +
      plural(heavy.length, 'день', 'дня', 'дней') + ': ' +
      heavy.map(function(d){ return d.date + ' — ' + fmtR(rub(d.value)) + RUB; }).join(', ') + '.';
  }
  document.getElementById('exLevelsNote').textContent = nbsp(note);
}

/* ============================================================
   ВСЕ ОПЕРАЦИИ
   ============================================================ */
function exOpsFiltered(){
  var q = exSearch.trim().toLowerCase();
  return EXP.opsRows.filter(function(o){
    if (exFlt.dirs.length && exFlt.dirs.indexOf(o.dir) < 0) return false;
    if (exFlt.cats.length && exFlt.cats.indexOf(o.cat) < 0) return false;
    if (exFlt.accs.length && exFlt.accs.indexOf(o.accFrom) < 0 &&
        exFlt.accs.indexOf(o.accTo) < 0) return false;
    if (exFlt.tags.length && exFlt.tags.indexOf(o.flag || '—') < 0) return false;
    var v = rub(o.sum);
    if (exFlt.min !== null && v < exFlt.min) return false;
    if (exFlt.max !== null && v > exFlt.max) return false;
    if (q && (o.desc + ' ' + o.cat + ' ' + o.acc + ' ' + money(o.sum))
              .toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
}

/* Фишка показывает, сколько значений в ней выбрано: по свёрнутой
   панели иначе не видно, что список отфильтрован. */
function exSyncChips(){
  [['cats', exFlt.cats.length], ['accs', exFlt.accs.length], ['tags', exFlt.tags.length],
   ['sum', (exFlt.min !== null || exFlt.max !== null) ? 1 : 0]].forEach(function(p){
    var chip = document.querySelector('.ops-filters [data-pop="' + p[0] + '"]');
    if (!chip) return;
    chip.classList.toggle('is-active', !!p[1]);
    var cnt = chip.querySelector('.cnt'), x = chip.querySelector('.x');
    if (p[1]){
      if (!cnt){
        chip.insertAdjacentHTML('beforeend',
          ' <span class="cnt"></span><span class="x" data-clear="' + p[0] + '">×</span>');
        cnt = chip.querySelector('.cnt');
      }
      cnt.textContent = p[0] === 'sum' ? '' : p[1];
    } else {
      if (cnt) cnt.remove();
      if (x) x.remove();
    }
  });
  EX_DIRS.forEach(function(d){
    var chip = document.querySelector('.ops-filters [data-dir="' + d[0] + '"]');
    if (!chip) return;
    var on = exFlt.dirs.indexOf(d[0]) >= 0;
    chip.classList.toggle('is-active', on);
    var x = chip.querySelector('.x');
    if (on && !x) chip.insertAdjacentHTML('beforeend', '<span class="x">×</span>');
    if (!on && x) x.remove();
  });
  var opts = document.querySelectorAll('.ops-filters .pop-opt');
  for (var i = 0; i < opts.length; i++){
    var key = opts[i].getAttribute('data-opt'), val = opts[i].getAttribute('data-val');
    var on2 = exFlt[key] && exFlt[key].indexOf(val) >= 0;
    opts[i].classList.toggle('is-on', !!on2);
    opts[i].querySelector('.box').textContent = on2 ? '✓' : '';
  }
}

function exRenderOps(){
  var body = document.getElementById('exOpsBody');
  if (!body) return;
  var rows = exOpsFiltered();

  body.innerHTML = rows.map(function(o){
    var tag = o.tag ? '<span class="tag tag--' + o.tag.cls + '">' + esc(o.tag.text) + '</span>' : '';
    /* Знак берётся из направления: расход уменьшает деньги, доход
       увеличивает, перевод между своими счетами не меняет ничего. */
    var sum = o.dir === 'расход' ? money('-' + o.sum)
            : (o.dir === 'доход' ? '+' + money(o.sum) : money(o.sum));
    var tone = o.dir === 'доход' ? ' c-pos' : (o.dir === 'перевод' ? ' c-mute' : '');
    return '<tr>' +
      '<td class="num">' + o.date + '</td>' +
      '<td>' + esc(o.desc) + tag + '</td>' +
      '<td><div class="cat-cell"><span class="dot" style="background:' + o.color + '"></span>' +
        '<span>' + esc(o.cat) + '</span></div></td>' +
      '<td style="color:var(--text-2)">' + esc(o.acc) +
        (o.fx ? ' <span style="color:var(--text-3)">· ' + moneyIn(o.fx.sum, o.fx.cur) + '</span>' : '') + '</td>' +
      '<td class="r num sum-cell' + tone + '">' + sum + '</td>' +
    '</tr>';
  }).join('');

  /* В итог идут деньги со знаком: складывать расход с доходом без
     знака значило бы складывать разное. Перевод денег не меняет. */
  var cents = 0;
  rows.forEach(function(o){
    if (o.dir === 'расход') cents -= Number(o.sum);
    else if (o.dir === 'доход') cents += Number(o.sum);
  });
  var q = exSearch.trim();
  var count = nOps(rows.length) +
    (rows.length === EXP.opsTotal ? ' — прокрутите список' : ' из ' + EXP.opsTotal);
  document.getElementById('exOpsCount').textContent = q ? count + ' · «' + q + '»' : count;
  document.getElementById('exOpsSum').textContent = money(String(Math.round(cents)));
  exSyncChips();
}

/* ============================================================
   СБОРКА ЭКРАНА
   ============================================================ */
function drawExpenses(){
  if (!EXP || EXP.empty || EXP.noData || EXP.error) return;
  exRenderCats();
  exRenderTreemap();
  exRenderTop5();
  exRenderPareto();
  exRenderQuadrants();
  exRenderTypes();
  exRenderDaily();
  exRenderWeekdays();
  exRenderWeekend();
  exRenderLevels();
  exRenderOps();
}

/* Плитка, Парето и столбцы зависят от фактической ширины колонки. */
function redrawExpensesWidth(){
  if (!EXP || EXP.empty || EXP.noData || EXP.error) return;
  exRenderTreemap();
  exRenderPareto();
  exRenderDaily();
}
