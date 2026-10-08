'use strict';
/* ============================================================
   ЭКРАН «КАЛЕНДАРЬ»
   ============================================================
   Разметка, порядок блоков и поведение перенесены из макета
   Main App/screens/06-kalendar.html. В макете был расписан один
   сентябрь — здесь любой месяц от начала учёта до двух вперёд, а
   заметки к дням сохраняются. Имена начинаются с cl.
   ============================================================ */
var CL = null;                  /* данные экрана */
var clMonth = null;             /* выбранный месяц: {year, month}; null — текущий */
var clMode = 'exp';             /* чем залита ячейка */
var clSel = null;               /* выбранный день */
var clNoteTimer = null;

var CL_DOW = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
var CL_MARK = { inc: '●', due: '▲', plan: '◆', mov: '↔' };
var CL_MARK_NAME = { inc: 'доход', due: 'обязательный платёж', plan: 'событие из планов', mov: 'перевод' };
var CL_MODES = [['exp', 'Траты', 'траты'], ['inc', 'Доходы', 'доходы'], ['evt', 'События', 'события']];
/* Пять ступеней шкалы, в рублях. Границы те же, что подписаны в легенде;
   берутся из настроек — первые четыре порога уровней трат. */
var CL_HEAT = [1000, 3000, 5000, 10000];
var CL_DOW_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function clDate(iso){ var p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function clIso(dt){
  return dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);
}
function clLongDate(iso){
  var dt = clDate(iso);
  return dt.getDate() + NBSP + MONTHS[dt.getMonth()] + NBSP + dt.getFullYear() + ', ' + CL_DOW[dt.getDay()];
}
function clHeat(cents){
  var v = Number(cents) / 100;
  if (!v) return 0;
  for (var i = 0; i < CL_HEAT.length; i++) if (v <= CL_HEAT[i]) return i + 1;
  return 5;
}
function clLevel(day){
  if (!day.past) return 0;                     /* будущее не заливаем */
  if (clMode === 'exp') return clHeat(day.exp);
  if (clMode === 'inc') return Number(day.inc) ? 5 : 0;
  return day.marks.length ? Math.min(day.marks.length + 1, 5) : 0;
}
function clInMonth(iso){ return Number(iso.slice(5, 7)) - 1 === CL.month && Number(iso.slice(0, 4)) === CL.year; }

/* ---------- переключатели в шапке окна ---------- */
function clHeadControls(){
  if (!CL || CL.empty || CL.error) return '';
  var arrow = function(d){
    return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="' + d +
           '" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  };
  return '<div class="mon">' +
      '<button class="mon-btn" id="clPrev" aria-label="Предыдущий месяц"' + (CL.canPrev ? '' : ' disabled') + '>' +
        arrow('M8.5 3 5 7l3.5 4') + '</button>' +
      '<span class="mon-name" id="clMonName">' + CL.monthName + '</span>' +
      '<button class="mon-btn" id="clNext" aria-label="Следующий месяц"' + (CL.canNext ? '' : ' disabled') + '>' +
        arrow('M5.5 3 9 7l-3.5 4') + '</button>' +
    '</div>' +
    '<div class="seg" id="clModeSeg">' + CL_MODES.map(function(m){
      return '<button type="button" data-mode="' + m[0] + '"' + (m[0] === clMode ? ' class="is-active"' : '') + '>' +
             m[1] + '</button>';
    }).join('') + '</div>';
}

/* ============================================================
   РАЗМЕТКА
   ============================================================ */
function renderCalendar(d){
  CL = d;
  if (d.error) return stateHTML('is-error', 'Не получилось собрать экран', d.error);
  if (d.empty) return stateHTML('', 'Здесь пока пусто', 'Календарь заполнится, как только будут внесены первые операции.', stAdd(d));
  if (!clSel || !d.days[clSel] || !clInMonth(clSel)){
    clSel = clInMonth(d.today) ? d.today : d.cells.filter(clInMonth)[0];
  }
  if (d.levels && d.levels.length >= 4) CL_HEAT = d.levels.slice(0, 4);
  var labels = ['без трат'].concat(CL_HEAT.map(function(v){ return 'до ' + fmtR(v); }), ['свыше']);
  /* Первый день недели — из настроек. */
  var dow = d.weekStart === 'sun' ? CL_DOW_SHORT : CL_DOW_SHORT.slice(1).concat(CL_DOW_SHORT[0]);
  return '<div class="scr-calendar">' +
    '<section class="sec" style="border-top:none;padding-bottom:16px">' +
      '<div class="sec-head" style="margin-bottom:0"><div style="min-width:0">' +
        '<div class="title-row"><h2 class="sec-title" id="clTitle">' + d.monthName + '</h2>' +
          '<i class="info" title="До сегодняшнего дня — факт по внесённым операциям. После — ожидание по обычному ' +
          'темпу трат и расписанию регулярных платежей">i</i></div>' +
        '<p class="sec-sub" id="clSub"></p></div>' +
        '<span class="spacer"></span><span class="lbl">Стрелки — по дням, Enter — открыть день</span>' +
      '</div>' +
    '</section>' +
    '<section class="cal">' +
      '<div class="cal-left">' +
        '<div class="cal-dow">' + dow.map(function(x){ return '<span>' + x + '</span>'; }).join('') + '</div>' +
        '<div class="cal-grid" id="clGrid" role="grid" aria-label="' + d.monthName + '"></div>' +
      '</div>' +
      '<div class="dp-wrap"><aside class="dp" id="clPanel"></aside></div>' +
    '</section>' +
    '<section class="sec">' +
      '<div class="sec-head"><div style="min-width:0">' +
        '<div class="title-row"><h2 class="sec-title">Как читать календарь</h2></div>' +
        '<p class="sec-sub">Заливка ячейки — величина трат за день · маркеры в углу — события дня</p>' +
      '</div></div>' +
      '<div class="leg">' +
        '<div class="leg-block"><div class="leg-title">Заливка — траты за день</div>' +
          '<div class="leg-scale">' + labels.map(function(t, i){
            return '<span class="leg-step"><i style="background:' + (i ? 'var(--heat-' + i + ')' : 'var(--bg)') +
                   '"></i><span>' + nbsp(t) + '</span></span>';
          }).join('') + '</div></div>' +
        '<div class="leg-block"><div class="leg-title">Маркеры событий</div>' +
          '<div class="leg-marks">' +
            '<span class="leg-mark"><span class="cal-mark cal-mark--inc">●</span> доход</span>' +
            '<span class="leg-mark"><span class="cal-mark cal-mark--due">▲</span> обязательный платёж</span>' +
            '<span class="leg-mark"><span class="cal-mark cal-mark--plan">◆</span> событие из планов</span>' +
            '<span class="leg-mark"><span class="cal-mark cal-mark--mov">↔</span> перевод между своими</span>' +
          '</div>' +
          '<p class="note" style="margin-top:12px">Маркеров в ячейке максимум три, остальные сворачиваются в «+N». ' +
            'Точка в левом нижнем углу — к дню есть заметка.</p></div>' +
        '<div class="leg-block"><div class="leg-title">Границы ячейки</div>' +
          '<div class="leg-marks">' +
            '<span class="leg-mark"><b style="color:var(--accent)">рамка</b> сегодня</span>' +
            '<span class="leg-mark"><b>толстая рамка</b> выбранный день</span>' +
            '<span class="leg-mark"><b style="color:var(--text-3)">пунктир</b> будущее, суммы ожидаемые</span>' +
          '</div>' +
          '<p class="note" style="margin-top:12px">У будущих дней заливки нет: тепловая шкала показывает ' +
            'наблюдённые траты, а не расчётные.</p></div>' +
      '</div>' +
    '</section>' +
  '</div>';
}

/* ---------- сетка месяца ---------- */
function clRenderGrid(){
  var host = document.getElementById('clGrid');
  if (!host) return;
  host.innerHTML = CL.cells.map(function(key){
    var day = CL.days[key];
    var lvl = clLevel(day);
    var cls = 'cal-day';
    if (!clInMonth(key)) cls += ' is-out';
    if (!day.past) cls += ' is-future';
    if (key === CL.today) cls += ' is-today';
    if (key === clSel) cls += ' is-sel';
    var marks = day.marks.slice(0, 3).map(function(m){
      return '<span class="cal-mark cal-mark--' + m + '" title="' + CL_MARK_NAME[m] + '">' + CL_MARK[m] + '</span>';
    }).join('');
    if (day.marks.length > 3) marks += '<span class="cal-more">+' + (day.marks.length - 3) + '</span>';
    var exp = Number(day.exp), inc = Number(day.inc);
    var body = day.past && !day.tracked ? '<div class="cal-none">учёт не вёлся</div>'
      : day.past && !exp && !inc ? '<div class="cal-none">без трат</div>'
      : (exp ? '<div class="cal-exp">−' + money0(day.exp) + '</div>' : '') +
        (inc ? '<div class="cal-inc">+' + money0(day.inc) + '</div>' : '');
    return '<button type="button" class="' + cls + '" data-key="' + key + '" role="gridcell"' +
      (lvl ? ' style="background:var(--heat-' + lvl + ')"' : '') + ' aria-label="' + clLongDate(key) + '">' +
      '<div class="cal-top"><span class="cal-num">' + Number(key.slice(8)) + '</span>' +
        '<span class="cal-marks">' + marks + '</span></div>' +
      body +
      (day.bal === null ? '' : '<div class="cal-bal">' + money0(day.bal) + '</div>') +
      (day.note ? '<span class="cal-note-dot" title="к дню есть заметка"></span>' : '') +
    '</button>';
  }).join('');
  var label = CL_MODES.filter(function(m){ return m[0] === clMode; })[0][2];
  document.getElementById('clSub').textContent = 'Заливка ячейки — ' + label + ' за день · до ' +
    humanDate(CL.today) + ' факт, дальше ожидание';
}

/* ---------- панель дня ---------- */
function clOpRow(o){
  var amt = Number(o.sum);
  var mark = o.kind === 'exp' ? '<span class="cal-mark cal-mark--plain">·</span>'
                              : '<span class="cal-mark cal-mark--' + o.kind + '">' + CL_MARK[o.kind] + '</span>';
  /* У перевода между своими знака нет: деньги не пришли и не ушли. */
  var sum = o.kind === 'mov' ? money(String(Math.abs(amt)))
          : (amt > 0 ? '+' : '−') + money(String(Math.abs(amt)));
  return '<div class="dp-op"><div class="dp-op-main">' +
      '<div class="dp-op-desc" title="' + esc(o.desc) + '">' + esc(o.desc) + '</div>' +
      '<div class="dp-op-meta">' + mark + '<span>' + esc(o.cat) + '</span><span>·</span><span>' + esc(o.acc) + '</span>' +
        (o.fx ? '<span>·</span><span>' + moneyIn(o.fx.sum, o.fx.cur) + '</span>' : '') + '</div>' +
    '</div><div class="dp-op-amt' + (o.kind === 'inc' ? ' c-pos' : '') + '">' + sum + '</div></div>';
}
function clPlanRow(p){
  var amt = Number(p.sum);
  return '<div class="dp-plan">' +
    (CL_MARK[p.kind] ? '<span class="cal-mark cal-mark--' + p.kind + '">' + CL_MARK[p.kind] + '</span>'
                     : '<span class="cal-mark cal-mark--plain">·</span>') +
    '<div class="dp-op-main"><div class="dp-op-desc">' + esc(p.name) + '</div>' +
      '<div class="dp-op-meta"><span>' + p.meta + '</span></div></div>' +
    '<div class="dp-op-amt' + (amt > 0 ? ' c-pos' : '') + '">' +
      (p.kind === 'mov' ? '' : amt > 0 ? '+' : '−') + money(String(Math.abs(amt))) + '</div>' +
    /* Внести фактом — то же событие, но уже случившееся: окно открывается
       с суммой и счётом из расписания и сегодняшней датой. */
    (p.kind === 'plan'
      ? '<button class="btn btn-sm" data-form="buy" data-id="' + p.id + '">Внести фактом</button>'
      : '<button class="btn btn-sm" data-form="fact" data-kind="' + p.kind + '" data-sum="' + esc(p.sum) +
        '" data-name="' + esc(p.name) + '" data-cat="' + esc(p.cat || '') + '" data-acc="' + esc(p.acc || '') +
        '">Внести фактом</button>') +
  '</div>';
}
function clRenderPanel(animate){
  var panel = document.getElementById('clPanel');
  if (!panel) return;
  var key = clSel, day = CL.days[key];
  var exp = Number(day.exp), inc = Number(day.inc);
  var html =
    '<div class="dp-head"><div class="dp-title"><h3>' + clLongDate(key) + '</h3>' +
      (day.past ? '<span class="badge badge--fact">факт</span>' : '<span class="badge badge--forecast">прогноз</span>') +
    '</div></div>' +
    '<div class="dp-sums">' +
      '<div class="dp-sum"><div class="k">Доход</div><div class="v' + (inc ? ' c-pos' : '') + '">' +
        (inc ? '+' + money(day.inc) : '—') + '</div></div>' +
      '<div class="dp-sum"><div class="k">Расход</div><div class="v">' + (exp ? '−' + money(day.exp) : '—') + '</div></div>' +
      '<div class="dp-sum"><div class="k">Остаток на конец дня</div><div class="v' +
        (day.bal !== null && Number(day.bal) < 0 ? ' c-neg' : '') + '">' + (day.bal === null ? '—' : money(day.bal)) +
      '</div></div>' +
    '</div><div class="dp-body">';
  if (day.past){
    html += '<div class="dp-sec"><div class="dp-sec-head"><span class="lbl">Операции дня</span><span class="spacer"></span>' +
      (day.ops.length ? '<span class="lbl">' + nOps(day.ops.length) + '</span>' : '') + '</div>';
    if (!day.tracked){
      html += '<div class="dp-empty"><span>В этот день учёт ещё не вёлся — он начат ' + humanDate(CL.firstDay) + '.</span></div>';
    } else if (day.ops.length){
      html += day.ops.map(clOpRow).join('');
    } else {
      html += '<div class="dp-empty"><span>Операций за этот день нет.</span>' +
        '<span class="row"><button class="btn btn-sm" data-form="expense" data-date="' + key + '">Добавить операцию</button>' +
        '<button class="btn btn-sm" data-soon="Отметка дня без трат">Отметить день без трат</button></span></div>';
    }
    html += '</div>';
  } else {
    html += '<div class="dp-sec"><div class="dp-sec-head"><span class="lbl">Плановые события дня</span></div>' +
      (day.plans.length ? day.plans.map(clPlanRow).join('')
        : '<div class="dp-empty"><span>Обязательных платежей и поступлений в этот день не ожидается. ' +
          'Показан только обычный темп трат — ' + money0(CL.rate) + ' в день.</span></div>') +
    '</div>';
  }
  html += '</div>' +
    '<div class="dp-sec dp-note-sec"><div class="dp-sec-head"><span class="lbl">Заметка дня</span></div>' +
      '<textarea class="dp-note" id="clNote" data-key="' + key + '" placeholder="Например: отель оплачен ' +
        'наполовину, остаток при заселении">' + esc(day.note || '') + '</textarea></div>' +
    /* Операция в будущем — не факт, а план: учёт не принимает операций
       с завтрашней датой. На будущий день кнопка заводит покупку со
       сроком на этот день — она и появится в календаре. */
    '<div class="dp-foot"><button class="btn btn-quiet" ' +
      (day.past ? 'data-form="expense" data-date="' + key + '">' : 'data-form="plan" data-deadline="' + key + '">') +
      '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 2v10M2 7h10" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' +
      (day.past ? 'Добавить операцию на ' : 'Запланировать покупку на ') + humanDate(key) + '</button></div>';
  panel.innerHTML = html;
  /* Панель стоит поверх своего места, поэтому её появление ничего не
     двигает. Сдвиг мягкий: он говорит «это другой день», а не
     «страница уехала». */
  if (animate) appear(panel);
  stagger(panel, '.dp-op');
}

/* Выбрать день: сетка и панель пересобираются, остальной экран стоит. */
function clSelect(key, animate){
  if (!CL || !CL.days[key]) return;
  clSel = key;
  clRenderGrid();
  clRenderPanel(animate);
}
/* Стрелки ходят по дням сетки, как в макете. */
function clStep(step){
  var d = clDate(clSel);
  d.setDate(d.getDate() + step);
  var key = clIso(d);
  if (!CL.days[key]) return false;
  clSelect(key, true);
  var cell = document.querySelector('.scr-calendar .cal-day[data-key="' + key + '"]');
  if (cell) cell.focus();
  return true;
}
/* Заметка сохраняется сама, через полсекунды после последней буквы. */
function clNoteInput(el){
  var key = el.getAttribute('data-key'), text = el.value;
  clearTimeout(clNoteTimer);
  clNoteTimer = setTimeout(function(){
    window.api.dayNote(key, text).then(function(r){
      if (!r || !r.ok){ toast('Заметка не сохранилась: ' + ((r && r.error) || 'ошибка базы')); return; }
      if (CL && CL.days[key]){
        var had = !!CL.days[key].note;
        CL.days[key].note = text.trim();
        /* Точка-заметка в ячейке появляется и пропадает сразу. */
        if (had !== !!CL.days[key].note && current === 'calendar'){
          var cell = document.querySelector('.scr-calendar .cal-day[data-key="' + key + '"]');
          if (cell){
            var dot = cell.querySelector('.cal-note-dot');
            if (CL.days[key].note && !dot) cell.insertAdjacentHTML('beforeend',
              '<span class="cal-note-dot" title="к дню есть заметка"></span>');
            if (!CL.days[key].note && dot) dot.remove();
          }
        }
      }
    });
  }, 500);
}

function drawCalendar(){
  if (!CL || CL.empty || CL.error) return;
  clRenderGrid();
  clRenderPanel(false);
}
