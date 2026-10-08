'use strict';
/* ============================================================
   ГРАФИКИ ЭКРАНА «ОБЗОР»
   ============================================================
   Код отрисовки перенесён из макета 01-obzor.html. Отличие одно, но
   принципиальное: в макете модель была вписана константами, здесь
   всё приходит из базы — стартовый остаток, темпы трат, расписание
   событий и ряд трат по дням.

   Рисуем в реальных пикселях и перерисовываем при изменении размера:
   растягивание viewBox сжимало бы вместе с графиком и подписи осей.
   ============================================================ */
var NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs){
  var n = document.createElementNS(NS, tag);
  for (var k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

var SCENARIOS = [
  { key:'lean',  label:'Экономная', varName:'--sc-lean',  note:'только необходимое каждый день' },
  { key:'usual', label:'Обычная',   varName:'--sc-usual', note:'медианный день' },
  { key:'free',  label:'Свободная', varName:'--sc-free',  note:'средний день, с редкими крупными покупками' }
];
var CHIP_MIN = 20000;   /* какой суммой событие заслуживает подписи над графиком */
var CHIP_MAX = 6;       /* сколько подписей рассматривать — лишние отсеет раскладка */

var horizonDays = 30;
var barsDays = 14;
var activeScenarios = { lean:true, usual:true, free:true };
var DATA = null;        /* полезная нагрузка с главного процесса */

function today(){ var p = DATA.today.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }
function dayDate(offset){
  var t = today();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() + Math.round(offset));
}
function dayLabel(offset){ var d = dayDate(offset); return d.getDate() + ' ' + MON_SHORT[d.getMonth()]; }

function buildSeries(rate, horizon){
  var out = [], bal = rub(DATA.startBalance);
  for (var d = 0; d <= horizon; d++){
    if (d > 0){
      bal -= rate;
      if (DATA.events[d]) bal += rub(DATA.events[d].sum);
    }
    out.push(bal);
  }
  return out;
}
function firstZero(a){
  for (var d = 1; d < a.length; d++){
    if (a[d] < 0 && a[d-1] >= 0) return d - 1 + a[d-1] / (a[d-1] - a[d]);
  }
  return null;
}
/* Шкала подстраивается под данные: на 90 днях свободный темп уходит
   далеко за любые заранее выбранные границы. */
function niceAxis(min, max){
  var pad = (max - min) * 0.08;
  min -= pad; max += pad;
  var raw = (max - min) / 4;
  var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var step = mag * 10;
  var mult = [1, 2, 2.5, 5, 10];
  for (var i = 0; i < mult.length; i++){
    if (mag * mult[i] >= raw){ step = mag * mult[i]; break; }
  }
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step: step };
}

/* ============================================================
   «НА СКОЛЬКО ХВАТИТ ДЕНЕГ»
   ============================================================ */
function drawRunway(){
  var wrap   = document.getElementById('runwayWrap');
  var svg    = document.getElementById('runwaySvg');
  var ribbon = document.getElementById('runwayRibbon');
  if (!wrap || !svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  ribbon.innerHTML = '';

  var W = Math.max(320, wrap.clientWidth || 640);
  var H = 236;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);

  var DAYS = horizonDays;
  var PL = 56, PR = 10, PT = 8, PH = 192;
  var PWD = W - PL - PR;

  var rates = { lean: rub(DATA.rates.lean), usual: rub(DATA.rates.usual), free: rub(DATA.rates.free) };
  var series = {
    lean:  buildSeries(rates.lean,  DAYS),
    usual: buildSeries(rates.usual, DAYS),
    free:  buildSeries(rates.free,  DAYS)
  };
  /* Шкалу считаем по всем трём сценариям, а не только по включённым:
     иначе график прыгает при каждом переключении легенды. */
  var all = series.lean.concat(series.usual, series.free);
  var ax = niceAxis(Math.min.apply(null, all), Math.max.apply(null, all));
  var X = function(d){ return PL + d / DAYS * PWD; };
  var Y = function(v){ return PT + (ax.hi - v) / (ax.hi - ax.lo) * PH; };

  /* сетка и ось значений */
  for (var g = ax.lo; g <= ax.hi + 1; g += ax.step){
    var y = Y(g), zero = Math.abs(g) < 1;
    svg.appendChild(svgEl('line', { x1: PL, y1: y, x2: PL + PWD, y2: y,
      stroke: zero ? 'var(--border-strong)' : 'var(--border)', 'stroke-width': 1,
      'stroke-dasharray': zero ? 'none' : '3 3' }));
    var t = svgEl('text', { x: PL - 10, y: y + 3.5, 'text-anchor': 'end',
      fill: 'var(--text-3)', 'font-size': 10, 'font-family': FONT_MONO });
    t.textContent = zero ? ('0' + RUB) : (g > 0 ? fmtR(g/1000) + 'к' : '−' + fmtR(-g/1000) + 'к');
    svg.appendChild(t);
  }

  /* вертикальные отметки всех событий горизонта */
  var marks = [];
  for (var d in DATA.events){
    var dd = parseInt(d, 10);
    if (dd > DAYS) continue;
    var sum = rub(DATA.events[d].sum);
    var color = sum >= 0 ? 'var(--positive)' : 'var(--warning)';
    svg.appendChild(svgEl('line', { x1: X(dd), y1: PT, x2: X(dd), y2: PT + PH,
      stroke: color, 'stroke-width': 1, 'stroke-dasharray': '2 4', 'stroke-opacity': .5 }));
    if (Math.abs(sum) >= CHIP_MIN) marks.push({ day: dd, sum: sum, names: DATA.events[d].names, color: color });
  }
  /* сначала самые крупные события — если места не хватит, отсеются мелкие */
  marks.sort(function(a, b){ return Math.abs(b.sum) - Math.abs(a.sum); });
  marks = marks.slice(0, CHIP_MAX);
  marks.sort(function(a, b){ return a.day - b.day; });

  function path(arr){
    return arr.map(function(v, i){ return (i ? 'L ' : 'M ') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
  }
  var defs = svgEl('defs', {});
  svg.appendChild(defs);
  var base = Math.min(Y(ax.lo), PT + PH);

  SCENARIOS.forEach(function(s){
    if (!activeScenarios[s.key]) return;
    var color = cssVar(s.varName) || 'currentColor';
    var gid = 'grad-' + s.key;
    var lg = svgEl('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' });
    lg.appendChild(svgEl('stop', { offset: '0%',   'stop-color': color, 'stop-opacity': .14 }));
    lg.appendChild(svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
    defs.appendChild(lg);
    svg.appendChild(svgEl('path', {
      d: path(series[s.key]) + ' L ' + X(DAYS).toFixed(1) + ' ' + base + ' L ' + X(0).toFixed(1) + ' ' + base + ' Z',
      fill: 'url(#' + gid + ')', stroke: 'none' }));
    svg.appendChild(svgEl('path', { d: path(series[s.key]), fill: 'none', stroke: color,
      'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  });

  /* Точки пересечения с нулём — там, где деньги кончаются.
     Сценарии часто упираются в ноль в один и тот же день: его назначает
     крупный обязательный платёж, а не темп трат. Кружки рисуем все, а
     подпись — одну на день, иначе три одинаковые даты наезжают друг на
     друга и превращаются в кашу. */
  var zeroLabels = {};
  SCENARIOS.forEach(function(s){
    if (!activeScenarios[s.key]) return;
    var z = firstZero(series[s.key]);
    if (z === null) return;
    var color = cssVar(s.varName) || 'currentColor';
    var x = X(z), y = Y(0);
    svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 4, fill: 'var(--bg)' }));
    svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 4, fill: 'none', stroke: color, 'stroke-width': 2 }));
    var day = Math.ceil(z);
    if (!zeroLabels[day]) zeroLabels[day] = { x: x, day: day, colors: [] };
    zeroLabels[day].colors.push(color);
    /* Подпись ставим у самого раннего пересечения этого дня. */
    if (x < zeroLabels[day].x) zeroLabels[day].x = x;
  });
  Object.keys(zeroLabels).map(function(k){ return zeroLabels[k]; })
    .sort(function(a, b){ return a.x - b.x; })
    .forEach(function(m, i){
      /* Один сценарий — его цвет; несколько — нейтральный, чтобы подпись
         не приписывала общую дату одной линии. */
      var color = m.colors.length === 1 ? m.colors[0] : 'var(--text-2)';
      var anchor = m.x > PL + PWD - 46 ? 'end' : 'start';
      var t = svgEl('text', { x: m.x + (anchor === 'end' ? -8 : 8), y: Y(0) + (i % 2 ? 19 : -11),
        fill: color, 'font-size': 10, 'font-family': FONT_MONO, 'text-anchor': anchor });
      t.textContent = dayLabel(m.day) + (m.colors.length > 1 ? ' · все' : '');
      svg.appendChild(t);
    });

  /* ось дат */
  var ticks = W < 560 ? 4 : 6;
  var stepD = Math.max(1, Math.round(DAYS / ticks));
  for (var dx = 0; dx <= DAYS; dx += stepD){
    var anchor2 = (dx === 0) ? 'start' : (dx + stepD > DAYS ? 'end' : 'middle');
    var t2 = svgEl('text', { x: X(dx), y: PT + PH + 19, 'text-anchor': anchor2,
      fill: 'var(--text-3)', 'font-size': 10, 'font-family': FONT_MONO });
    t2.textContent = dayLabel(dx);
    svg.appendChild(t2);
  }

  /* лента подписей над графиком — HTML, чтобы текст не тянулся вместе
     с осями. Подпись встаёт в первый ряд, где не пересекается с уже
     стоящими; если не влезла ни в один — не показывается вовсе. */
  var RW = ribbon.clientWidth || W;
  var rows = [[], []];
  marks.forEach(function(m){
    var chip = document.createElement('div');
    chip.className = 'evt-chip';
    chip.innerHTML = '<span class="d" style="background:' + m.color + '"></span>' +
      '<span class="n">' + dayLabel(m.day) + ' · ' + m.names.map(esc).join(' и ') + '</span>' +
      '<span class="s" style="color:' + m.color + '">' + (m.sum > 0 ? '+' : '') + fmtR(m.sum) + (RUB + '</span>');
    ribbon.appendChild(chip);
    var w = chip.offsetWidth;
    var left = Math.max(0, Math.min(X(m.day) / W * RW - w / 2, RW - w));
    var row = -1;
    for (var r = 0; r < rows.length && row < 0; r++){
      var free = true;
      for (var k = 0; k < rows[r].length; k++){
        if (!(left + w + 8 <= rows[r][k][0] || left >= rows[r][k][1] + 8)){ free = false; break; }
      }
      if (free) row = r;
    }
    if (row < 0){ ribbon.removeChild(chip); return; }
    rows[row].push([left, left + w]);
    chip.style.top = (row * 21) + 'px';
    chip.style.left = left + 'px';
  });

  /* легенда: сценарий и день, когда деньги кончатся; клик гасит линию */
  document.getElementById('runwayLegend').innerHTML = SCENARIOS.map(function(s){
    var z = firstZero(series[s.key]);
    var when = z === null ? DAYS + 'д+' : dayLabel(Math.ceil(z));
    return '<button class="legend-btn' + (activeScenarios[s.key] ? '' : ' is-off') + '" data-sc="' + s.key + '">' +
      '<span class="legend-line" style="background:var(' + s.varName + ')"></span>' + s.label +
      '<span class="d">' + when + '</span></button>';
  }).join('');

  /* темпы трат — то, чем сценарии отличаются друг от друга */
  document.getElementById('runwayRates').innerHTML = SCENARIOS.map(function(s){
    return '<span><b>' + s.label + '</b> · ' + s.note + ' — <i>' + fmtR(rates[s.key]) + (RUB + '/день</i></span>');
  }).join('') + '<span style="color:var(--text-3)">' + DATA.ratesNote + '</span>';
}

/* ============================================================
   «ТРАТЫ ПО ДНЯМ»
   ============================================================ */
/* Потолок шкалы в макете был задан числом. Здесь он считается по
   самим данным: берём уровень, выше которого оказывается примерно
   каждый седьмой день, и округляем до круглого. Иначе на одних
   данных половина столбцов упирается в потолок, а на других график
   вырождается в плинтус.                                          */
function barsCap(vals){
  var v = vals.slice().sort(function(a, b){ return a - b; });
  if (!v.length) return 10000;
  var p = v[Math.min(v.length - 1, Math.floor(v.length * 0.86))];
  var med = v[v.length >> 1];
  var target = Math.max(p, med * 3, 2000);
  var mag = Math.pow(10, Math.floor(Math.log(target) / Math.LN10));
  var mult = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  for (var i = 0; i < mult.length; i++){
    if (mag * mult[i] >= target) return mag * mult[i];
  }
  return mag * 10;
}
function medianOf(a){
  var v = a.slice().sort(function(x, y){ return x - y; });
  if (!v.length) return 0;
  var m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m-1] + v[m]) / 2;
}

/* Подсказка всегда над графиком. Если график подъехал под шапку и места
   сверху нет — опускаем подсказки под шкалу дат. Класть их на столбцы
   нельзя: мышь тогда не проходит к соседнему дню. */
function placeTips(bars){
  var tips = bars.querySelectorAll('.tip'), h = 0;
  for (var i = 0; i < tips.length; i++) h = Math.max(h, tips[i].offsetHeight);
  var head = document.querySelector('.head');
  var place = function(){
    var headBottom = head ? head.getBoundingClientRect().bottom : 0;
    bars.classList.toggle('tips-down', bars.getBoundingClientRect().top - headBottom < h + 34);
  };
  if (!bars.tipPlace) bars.addEventListener('mouseover', function(){ bars.tipPlace(); });
  bars.tipPlace = place;
  place();
}

function drawBars(){
  var host = document.getElementById('barsHost');
  var note = document.getElementById('barsNote');
  var per  = document.getElementById('barsPeriod');
  if (!host) return;

  var ALL = DATA.daily;
  if (barsDays > ALL.length){
    host.innerHTML = '<div class="bars-empty">Учёт начат ' + humanDate(ALL[0] ? ALL[0].iso : DATA.today) +
      ' — данных за ' + nDays(barsDays) + ' пока нет.</div>';
    per.textContent = 'Период пока недоступен';
    note.textContent = 'Период станет доступен, когда наберётся история. Сейчас в журнале ' +
      nDays(ALL.length) + ' наблюдений.';
    return;
  }

  host.innerHTML =
    '<div class="bars-wrap">' +
      '<div class="bars-axis" id="barsAxis"></div>' +
      '<div class="bars-plot">' +
        '<div class="bars-grid" id="barsGrid"></div>' +
        '<div class="bars-avg" id="barsAvg"><b></b></div>' +
        '<div class="bars" id="bars"></div>' +
        '<div class="bars-labels" id="barsLabels"></div>' +
      '</div>' +
    '</div>';

  var days = ALL.slice(ALL.length - barsDays).map(function(d){
    return { date:d.date, dow:d.dow, full:d.full, value:rub(d.value),
             ops:d.ops, weekend:d.weekend, bd:d.bd, more:d.more };
  });
  var vals = days.map(function(d){ return d.value; });
  var total = vals.reduce(function(s, v){ return s + v; }, 0);
  var avg = total / days.length;
  var med = medianOf(vals);
  var below = vals.filter(function(v){ return v < avg; }).length;
  var CAP = barsCap(vals);
  var clipped = days.filter(function(d){ return d.value > CAP; });
  var maxVal = Math.max.apply(null, vals);
  var H = 170;

  per.textContent = days[0].date + ' — ' + days[days.length-1].date + ' · среднее ' + fmtR(avg) + (RUB + ' в день');

  var axis = document.getElementById('barsAxis');
  var grid = document.getElementById('barsGrid');
  [CAP, CAP*0.75, CAP*0.5, CAP*0.25, 0].forEach(function(g){
    var top = (1 - g / CAP) * H;
    var s = document.createElement('span');
    s.style.top = top + 'px';
    s.textContent = g === 0 ? ('0' + RUB) : fmtR(g / 1000) + ('к' + RUB);
    axis.appendChild(s);
    var i = document.createElement('i');
    i.style.top = top + 'px';
    if (g === 0) i.className = 'zero';
    grid.appendChild(i);
  });

  var avgEl = document.getElementById('barsAvg');
  avgEl.style.top = (24 + (1 - Math.min(avg, CAP) / CAP) * H) + 'px';
  avgEl.querySelector('b').textContent = fmtR(avg) + RUB;

  var bars = document.getElementById('bars');
  var labels = document.getElementById('barsLabels');

  /* Прореживаем подписи по фактической ширине колонки, а не по числу
     дней: в узкой колонке даже 14 дат сливаются в сплошную строку. */
  var colW = (bars.clientWidth || 460) / days.length;
  var labelStep = colW < 26 ? 3 : (colW < 38 ? 2 : 1);
  var dense = colW < 34;
  if (dense) labels.className = 'bars-labels is-dense';

  days.forEach(function(d, idx){
    var col = document.createElement('div');
    col.className = 'bar-col' + (d.weekend ? ' is-weekend' : '') +
      (d.value === maxVal && maxVal > 0 ? ' is-max' : '');

    var over = d.value > CAP;
    var barH = Math.min(d.value, CAP) / CAP * H;
    var bar = document.createElement('div');
    bar.className = 'bar' + (over ? ' is-clipped' : '');
    bar.style.height = barH + 'px';
    col.appendChild(bar);

    if (over){
      var lbl = document.createElement('div');
      lbl.className = 'bar-over';
      lbl.textContent = fmtR(d.value) + RUB;
      col.appendChild(lbl);
    }

    var tip = document.createElement('div');
    tip.className = 'tip' +
      (idx <= 1 ? ' at-left' : (idx >= days.length - 2 ? ' at-right' : ''));
    var rows = (d.bd || []).map(function(b){
      return '<div class="t-row"><span class="d" style="background:' + b.c + '"></span>' +
             '<span class="k">' + esc(b.n) + '</span><span class="spacer"></span>' +
             '<span class="num">' + money(b.s) + '</span></div>';
    }).join('');
    tip.innerHTML =
      '<div class="t-date">' + esc(d.full) + '</div>' +
      '<div class="t-sum">' + fmtK(d.value) + RUB +
        (d.ops ? ' · ' + d.ops + ' опер.' : ' · трат не было') + '</div>' +
      (rows ? '<div class="t-line"></div>' + rows : '') +
      (d.more ? '<div class="t-more">' + esc(d.more) + '</div>' : '');
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

  var parts = ['Средний день ' + fmtR(avg) + (RUB + ' выше, чем ') + below + ' из ' +
               nDays(days.length) + '. Медиана — ' + fmtR(med) + (RUB + '.')];
  if (clipped.length){
    parts.push((clipped.length === 1 ? 'Один столбец не помещается' : clipped.length + ' столбца не помещаются') +
      ' в шкалу и обрезаны сверху: ' +
      clipped.map(function(c){ return c.date + ' — ' + fmtR(c.value) + RUB; }).join(', ') +
      '. Вместе эти дни дают ' +
      Math.round(clipped.reduce(function(s, c){ return s + c.value; }, 0) / total * 100) +
      '% всех трат периода.');
  }
  note.textContent = parts.join(' ');
}

/* ============================================================
   «БЛИЖАЙШИЕ 14 ДНЕЙ»
   ============================================================ */
function drawUpcoming(){
  var body = document.getElementById('upcomingBody');
  if (!body) return;
  var html = '', lastGroup = '';

  DATA.table.forEach(function(e){
    var group = e.day <= 7 ? 'На этой неделе' : 'На следующей неделе';
    if (group !== lastGroup){
      html += '<tr class="grp"><td colspan="5">' + group + '</td></tr>';
      lastGroup = group;
    }
    var amt = rub(e.amount), bal = rub(e.balance);
    html += '<tr>' +
      '<td><span class="d-cell"><span class="dt">' + e.date + '</span>' +
        '<span class="dw">' + e.dow + '</span></span></td>' +
      '<td><span class="e-cell"><span class="en">' + esc(e.name) + '</span>' +
        '<span class="tag tag--' + e.kind + '">' + e.tag + '</span></span></td>' +
      '<td class="acc-cell">' + esc(e.acc) + '</td>' +
      '<td class="col-sum"><span class="sum-cell' + (amt > 0 ? ' c-pos' : '') + '">' +
        (amt > 0 ? '+' : '') + fmtK(amt) + (RUB + '</span></td>') +
      '<td class="col-bal"><span class="bal-cell' + (bal < 0 ? ' c-neg' : '') + '">' +
        fmtK(bal) + (RUB + '</span></td>') +
    '</tr>';
  });

  if (!html){
    html = '<tr><td colspan="5" style="color:var(--text-3)">' +
      'В ближайшие ' + nDays(DATA.tableDays) + ' по расписанию ничего не ждём.</td></tr>';
  }
  body.innerHTML = html;

  /* Итоги под таблицей: сколько придёт, сколько спишется и что в сумме. */
  var inc = 0, out = 0;
  DATA.table.forEach(function(e){
    var v = rub(e.amount);
    if (v > 0) inc += v; else out += v;
  });
  var foot = document.getElementById('upcomingFoot');
  if (foot){
    foot.innerHTML =
      '<span class="tot"><span class="k">Поступит</span>' +
        '<span class="v c-pos">+' + fmtK(inc) + (RUB + '</span></span>') +
      '<span class="tot"><span class="k">Спишется</span>' +
        '<span class="v">' + fmtK(out) + (RUB + '</span></span>') +
      '<span class="spacer"></span>' +
      '<span class="tot"><span class="k">Итог по счетам</span>' +
        '<span class="v' + (inc + out >= 0 ? ' c-pos' : ' c-neg') + '">' +
        (inc + out > 0 ? '+' : '') + fmtK(inc + out) + (RUB + '</span></span>');
  }
}
