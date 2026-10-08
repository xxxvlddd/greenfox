'use strict';
/* ============================================================
   ЭКРАН «ОБЯЗАТЕЛЬНЫЕ ПЛАТЕЖИ»
   ============================================================
   Разметка, порядок блоков и поведение перенесены из макета
   Main App/screens/07-platezhi.html. Платежи — из справочника
   регулярных, состояние в цикле — по операциям месяца, вопросы — из
   заметок учёта. Имена начинаются с pm.
   ============================================================ */
var PM = null;                  /* данные экрана */
var pmScope = 'month';          /* «В этом месяце» или «Все» */
var pmOpen = {};                /* раскрытые группы */

/* Короткие месяцы — как в макете этого экрана: «май», а не «мая». */
var PM_MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
var PM_CYCLE_CLS = { done: 'is-done', wait: 'is-wait', miss: 'is-miss', skip: 'is-wait' };
var PM_CYCLE_DOT = { done: 'var(--positive)', wait: 'var(--text-3)', miss: 'var(--warning)', skip: 'var(--text-3)' };
var PM_NUM = ['', 'Один открытый вопрос', 'Два открытых вопроса', 'Три открытых вопроса', 'Четыре открытых вопроса'];

function pmDdmm(iso){ return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : '—'; }
function pmItems(n){ return n + NBSP + plural(n, 'платёж', 'платежа', 'платежей'); }
function pmGroup(id){ return PM.groups.filter(function(g){ return g.id === id; })[0]; }
function pmShort(v){
  var a = Math.abs(v);
  return (a >= 1000 ? Math.round(a / 1000) + 'к' : Math.round(a)) + RUB;
}
function pmText(p, x, y, str, o){
  o = o || {};
  var t = svgEl('text', { x: x, y: y, 'text-anchor': o.anchor || 'middle',
    fill: o.fill || 'var(--text-3)', 'font-size': o.size || 10, 'font-family': o.font || FONT_MONO });
  if (o.weight) t.setAttribute('font-weight', o.weight);
  t.textContent = str;
  p.appendChild(t);
  return t;
}
function pmHead(title, hint, sub, right){
  return '<div class="sec-head"><div style="min-width:0">' +
    '<div class="title-row"><h2 class="sec-title">' + title + '</h2>' +
      (hint ? '<i class="info" title="' + esc(hint) + '">i</i>' : '') + '</div>' +
    (sub || '') + '</div>' + (right ? '<span class="spacer"></span>' + right : '') + '</div>';
}
function pmVisible(gid){
  return PM.payments.filter(function(p){ return p.group === gid && (pmScope === 'all' || p.thisMonth); });
}

/* ---------- фразы из значений ---------- */
function pmCycleText(p){
  var c = p.cstate;
  if (c.t === 'paid') return 'внесено ' + money(c.sum);
  if (c.t === 'until') return (c.left ? 'ещё ' + money0(c.left) + ' ' : '') + 'до ' + pmDdmm(c.date);
  if (c.t === 'came') return 'поступило ' + pmDdmm(c.date);
  if (c.t === 'put') return 'внесено ' + pmDdmm(c.date);
  if (c.t === 'charged') return 'списано ' + pmDdmm(c.date);
  if (c.t === 'next') return c.date ? 'следующее ' + pmDdmm(c.date) + '.' + c.date.slice(0, 4) : '—';
  if (c.t === 'notCame') return 'не поступило ' + pmDdmm(c.date);
  if (c.t === 'notCharged') return 'не списано ' + pmDdmm(c.date);
  if (c.t === 'skipped') return 'пропущен в этом месяце';
  return 'ожидается ' + pmDdmm(c.date);
}
function pmSubText(p){
  var s = p.sub;
  if (!s) return '';
  if (s.t === 'year') return 'В месячную сумму входит как ' + money(s.sum) + ' — одна двенадцатая';
  if (s.t === 'vol') return 'Добровольный взнос: в обязательную нагрузку не входит';
  if (s.t === 'loan') return 'Аннуитет до ' + humanDate(s.end) + ' ' + s.end.slice(0, 4) + ' · осталось ' + pmItems(s.left);
  if (s.t === 'short') return 'На счёте ' + money(s.sum) + ' — на ближайшее списание не хватает';
  return esc(s.text);
}
function pmAmount(p){
  var range = p.lo !== p.hi;
  var txt = range ? moneyBare(p.lo).replace(/,00$/, '') + ' – ' + money0(p.hi) : money(p.lo);
  var note = p.floatNote || (range ? 'Сумма выбирается при платеже — от ' + money0(p.lo) + ' до ' + money0(p.hi) : '');
  /* Платёж в валюте: сумма — в валюте счёта, рубли — по курсу на сегодня. */
  if (p.cur && p.cur !== 'RUB'){
    range = p.loNat !== p.hiNat;
    txt = range ? moneyIn(p.loNat, p.cur).replace(/,00(?=\s)/, '') + ' – ' + moneyIn(p.hiNat, p.cur) : moneyIn(p.loNat, p.cur);
    note = 'Списывается ' + moneyIn(p.hiNat, p.cur) + ' — в рублях сейчас ' + money0(p.hi) + ', сумма зависит от курса';
  }
  return '<span class="pm-amt">' + (p.flow === 'in' ? '+' : '') + txt + '</span>' +
    (p.float ? ' <i class="pm-float" title="' + esc(note) + '">≈</i>' : '');
}

/* ---------- переключатель в шапке окна ---------- */
function pmHeadControls(){
  if (!PM || PM.empty || PM.error) return '';
  return '<div class="seg" id="pmScopeSeg">' +
    '<button type="button" data-scope="month"' + (pmScope === 'month' ? ' class="is-active"' : '') + '>В этом месяце</button>' +
    '<button type="button" data-scope="all"' + (pmScope === 'all' ? ' class="is-active"' : '') + '>Все</button>' +
  '</div>';
}

/* ============================================================
   РАЗМЕТКА
   ============================================================ */
function renderPayments(d){
  PM = d;
  if (d.error) return stateHTML('is-error', 'Не получилось собрать экран', d.error);
  if (d.empty) return stateHTML('', 'Здесь пока пусто', 'Расписание появится, как только будут внесены первые операции.',
    ['Добавить платёж', 'data-form="recur"']);
  d.groups.forEach(function(g){ if (pmOpen[g.id] === undefined) pmOpen[g.id] = true; });
  var m = d.metrics, inc = Number(m.incomeM);
  var pctOf = function(c){ return inc ? (Number(c) / inc * 100).toFixed(1).replace('.', ',') + '%' : '—'; };
  var subsNames = d.payments.filter(function(p){ return p.group === 'subs'; }).map(function(p){ return p.name; });
  var nx = m.next;

  return '<div class="scr-payments">' +
    '<section class="grid grid--4">' +
      '<div class="metric"><div class="metric-head"><span class="lbl">Обязательные в месяц</span>' +
          '<i class="info" title="Жильё, кредит и подписки. Годовая подписка приведена к месяцу: сумма ÷ 12. ' +
          'Переводы между своими счетами и добровольные взносы не входят">i</i></div>' +
        '<div class="metric-val">' + money(m.obligM) + '</div>' +
        '<div class="metric-sub">' + pctOf(m.obligM) + ' от среднемесячного дохода ' + money0(m.incomeM) + '</div></div>' +
      '<div class="metric"><div class="metric-head"><span class="lbl">Годовая нагрузка</span>' +
          '<i class="info" title="Двенадцать месячных платежей плюс годовые по разу. Приведённая к месяцу доля ' +
          'годовой подписки в эту сумму повторно не добавляется">i</i></div>' +
        '<div class="metric-val">' + money(m.obligY) + '</div>' +
        '<div class="metric-sub">' + (Number(m.yearlyOnce)
          ? 'Из них разовых годовых — ' + money0(m.yearlyOnce) + ', остальное платится каждый месяц'
          : 'Все обязательные платежи — ежемесячные') + '</div></div>' +
      '<div class="metric"><div class="metric-head"><span class="lbl">Подписки и связь</span>' +
          (subsNames.length ? '<i class="info" title="' + esc(subsNames.join(', ')) + '">i</i>' : '') + '</div>' +
        '<div class="metric-val">' + money(m.subsM) + '</div>' +
        '<div class="metric-sub">' + m.subsCount + NBSP + plural(m.subsCount, 'сервис', 'сервиса', 'сервисов') + ' · ' +
          pctOf(m.subsM) + ' дохода' + (m.subsFloat ? ' · ' + (m.subsFloat === 1 ? 'один' : m.subsFloat) +
          ' с плавающей суммой' : '') + '</div></div>' +
      '<div class="metric"><div class="metric-head"><span class="lbl">Ближайшее списание</span></div>' +
        '<div class="metric-val' + (nx && nx.inDays <= 7 ? ' c-warn' : '') + '">' + (nx ? humanDate(nx.day) : '—') + '</div>' +
        '<div class="metric-sub">' + (nx ? esc(nx.name) + ' · ' + money0(nx.sum) + ' · ' +
          (nx.inDays === 1 ? 'завтра' : 'через ' + nDays(nx.inDays)) + (nx.acc ? ', со счёта «' + esc(nx.acc) + '»' : '')
          : 'В ближайшие два месяца обязательных списаний нет') + '</div></div>' +
    '</section>' +

    '<section class="sec">' +
      pmHead('Годовая нагрузка по месяцам',
        'Двенадцать месяцев вперёд от текущего, а не календарный год. Считаются только обязательные расходы — ' +
        'переводы между своими счетами и добровольные взносы не входят',
        '<p class="sec-sub"><span class="badge badge--forecast">прогноз</span> Двенадцать месяцев вперёд · столбец ' +
        'разбит по группам платежей</p>',
        '<div class="legend" id="pmLegend"></div>') +
      '<div class="chart-wrap" id="pmLoadWrap"><svg id="pmLoadSvg" role="img" ' +
        'aria-label="Обязательные платежи по месяцам на год вперёд"></svg></div>' +
      '<div class="load-note"><span class="dot"></span><span id="pmLoadNote"></span></div>' +
    '</section>' +

    '<section class="sec">' +
      pmHead('Группы платежей',
        'Колонка «В этом цикле» показывает, прошёл ли платёж в текущем месяце: списано, ожидается или пропущено',
        '<p class="sec-sub" id="pmGrpSub"></p>',
        '<button class="btn btn-sm" id="pmToggleAll">Свернуть все</button>') +
      '<div id="pmGroups"></div>' +
    '</section>' +

    '<section class="sec">' +
      pmHead('Заметки и вопросы к подпискам',
        'То, что требует решения, но платежом пока не является. Вопросы собираются из заметок учёта — к покупкам ' +
        'и к регулярным платежам',
        '<p class="sec-sub" id="pmQSub"></p>',
        '<button class="btn btn-sm" data-form="question"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" ' +
        'aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
        '</svg>Новый вопрос</button>') +
      '<div class="qs" id="pmQuestions"></div>' +
    '</section>' +
  '</div>';
}

/* ---------- график годовой нагрузки ---------- */
function pmRenderLoad(){
  var wrap = document.getElementById('pmLoadWrap'), svg = document.getElementById('pmLoadSvg');
  if (!wrap || !svg) return;
  var H = 250, W = Math.max(520, wrap.clientWidth || 900);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  var PL = 58, PR = 12, PT = 14, PB = 30, PW = W - PL - PR, PH = H - PT - PB;
  var LOAD = PM.load;
  var totals = LOAD.map(function(m){ return Number(m.total) / 100; });
  var maxV = Math.max.apply(null, totals.concat([1]));
  var v = maxV * 1.08 / 4, mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), step = mag * 10;
  [1, 2, 2.5, 5, 10].some(function(k){ if (mag * k >= v){ step = mag * k; return true; } return false; });
  var hi = Math.ceil(maxV * 1.08 / step) * step;
  var Y = function(x){ return PT + (hi - x) / hi * PH; };
  var slot = PW / LOAD.length, bw = Math.min(46, slot * 0.62);

  for (var g = 0; g <= hi + 1; g += step){
    var zero = g === 0;
    svg.appendChild(svgEl('line', { x1: PL, y1: Y(g), x2: PL + PW, y2: Y(g),
      stroke: zero ? 'var(--border-strong)' : 'var(--border)', 'stroke-width': 1, 'stroke-dasharray': zero ? 'none' : '3 3' }));
    pmText(svg, PL - 10, Y(g) + 3.5, zero ? '0' + RUB : pmShort(g), { anchor: 'end' });
  }
  LOAD.forEach(function(m, i){
    var cx = PL + slot * i + slot / 2, x = cx - bw / 2, acc = 0, future = i > 0;
    /* Слои месяца — одной группой: при наведении она подсвечивается. */
    var col = svgEl('g', { 'class': 'load-m', 'data-i': i });
    svg.appendChild(col);
    m.parts.forEach(function(part){
      var s = Number(part.sum) / 100;
      if (!s) return;
      var y0 = Y(acc + s), y1 = Y(acc);
      col.appendChild(svgEl('rect', { x: x, y: y0, width: bw, height: Math.max(1, y1 - y0),
        fill: pmGroup(part.group).color, 'fill-opacity': future ? .55 : .85 }));
      acc += s;
    });
    /* Пунктирная верхняя кромка — признак расчётного месяца. */
    if (future){
      svg.appendChild(svgEl('line', { x1: x, y1: Y(totals[i]), x2: x + bw, y2: Y(totals[i]),
        stroke: 'var(--text-3)', 'stroke-width': 1.4, 'stroke-dasharray': '3 2' }));
    } else {
      svg.appendChild(svgEl('rect', { x: x - 3, y: Y(totals[i]) - 3, width: bw + 6, height: Y(0) - Y(totals[i]) + 3,
        fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.4, rx: 3 }));
    }
    pmText(svg, cx, H - 10, PM_MON[m.month] + (m.month === 0 || i === 0 ? NBSP + String(m.year).slice(2) : ''));
    if (totals[i] > totals[0]){
      pmText(svg, cx, Y(totals[i]) - 8, '+' + money0(String(Number(m.total) - Number(LOAD[0].total))),
        { size: 10, weight: 600, fill: 'var(--warning)' });
    }
  });
  pmLoadTips(wrap, svg, PL, PT, PW, PH, slot);

  var used = PM.groups.filter(function(gr){
    return gr.load && LOAD.some(function(m){ return m.parts.some(function(p){ return p.group === gr.id && Number(p.sum); }); });
  });
  document.getElementById('pmLegend').innerHTML = used.map(function(gr){
    return '<span class="legend-item"><span class="legend-line" style="background:' + gr.color + '"></span>' +
           gr.name.toLowerCase() + '</span>';
  }).join('') + '<span class="legend-item"><span class="legend-line" style="background:var(--text-3)"></span>прогноз</span>';
}
/* Подсказки — те же, что у столбцов «Обзора»: окошко над графиком,
   мышь не ловит, у крайних столбцов прижато к краю, а если сверху мешает
   шапка — уходит под подписи месяцев. Сам график — картинка, поэтому
   поверх него лежат прозрачные колонки по месяцам: они и ловят наведение. */
function pmTip(m, i){
  var LOAD = PM.load, first = LOAD[0];
  var name = PM.monthNames[m.month].charAt(0).toUpperCase() + PM.monthNames[m.month].slice(1) + ' ' + m.year;
  var rows = m.parts.filter(function(p){ return Number(p.sum); }).map(function(p){
    var g = pmGroup(p.group);
    return '<div class="t-row"><span class="d" style="background:' + g.color + '"></span>' +
           '<span class="k">' + g.name + '</span><span class="spacer"></span>' +
           '<span class="num">' + money(p.sum) + '</span></div>';
  }).join('');
  var yearly = [], more = [];
  m.parts.forEach(function(p){ yearly = yearly.concat(p.yearly); });
  if (yearly.length) more.push('Годовой платёж: ' + esc(yearly.join(', ')));
  var diff = Number(m.total) - Number(first.total);
  if (i > 0 && diff) more.push('На ' + money0(String(Math.abs(diff))) + ' ' + (diff > 0 ? 'больше' : 'меньше') +
                               ', чем в этом месяце');
  var loanNow = first.parts.filter(function(p){ return p.group === 'loan'; })[0];
  var loanThen = m.parts.filter(function(p){ return p.group === 'loan'; })[0];
  if (loanNow && Number(loanNow.sum) && loanThen && !Number(loanThen.sum)) more.push('Кредит к этому месяцу закрыт');
  return '<div class="t-date">' + name + '</div>' +
    '<div class="t-sum">' + money(m.total) + ' · ' + (i === 0 ? 'этот месяц' : 'прогноз') + '</div>' +
    (rows ? '<div class="t-line"></div>' + rows : '') +
    (more.length ? '<div class="t-more">' + more.join('. ') + '</div>' : '');
}
function pmLoadTips(wrap, svg, PL, PT, PW, PH, slot){
  var old = wrap.querySelector('.load-hits');
  if (old) old.remove();
  var n = PM.load.length;
  var hits = document.createElement('div');
  hits.className = 'load-hits';
  hits.style.left = PL + 'px'; hits.style.top = PT + 'px';
  hits.style.width = PW + 'px'; hits.style.height = PH + 'px';
  hits.innerHTML = PM.load.map(function(m, i){
    return '<div class="load-hit" data-i="' + i + '" style="left:' + (slot * i).toFixed(1) + 'px;width:' +
      slot.toFixed(1) + 'px"><div class="tip' + (i <= 1 ? ' at-left' : i >= n - 2 ? ' at-right' : '') + '">' +
      pmTip(m, i) + '</div></div>';
  }).join('');
  wrap.appendChild(hits);
  var light = function(i){
    var gs = svg.querySelectorAll('.load-m');
    for (var k = 0; k < gs.length; k++) gs[k].classList.toggle('is-hot', gs[k].getAttribute('data-i') === i);
  };
  hits.addEventListener('mouseover', function(e){
    var h = e.target.closest ? e.target.closest('.load-hit') : null;
    light(h ? h.getAttribute('data-i') : null);
  });
  hits.addEventListener('mouseleave', function(){ light(null); });
  placeTips(hits);
}

/* Вывод под графиком: обычный месяц, всплески и когда закроется кредит. */
function pmRenderLoadNote(){
  var LOAD = PM.load, count = {}, base = LOAD[0].total;
  LOAD.forEach(function(m){ count[m.total] = (count[m.total] || 0) + 1; });
  Object.keys(count).forEach(function(k){ if (count[k] > count[base]) base = k; });
  var spikes = LOAD.filter(function(m){ return Number(m.total) > Number(base); });
  var drops = LOAD.filter(function(m){ return Number(m.total) < Number(base); });
  var txt = '<b>' + (spikes.length || drops.length ? 'Обычный месяц — ' + money(base) + '.'
                                                   : 'Нагрузка ровная: ' + money(base) + ' каждый месяц.') + '</b>';
  spikes.forEach(function(m){
    var names = [];
    m.parts.forEach(function(p){ names = names.concat(p.yearly); });
    var diff = Number(m.total) - Number(base);
    txt += ' ' + PM.monthNames[m.month].charAt(0).toUpperCase() + PM.monthNames[m.month].slice(1) + ' ' + m.year +
      (names.length ? ' — спишется ' + esc(names.join(', ')) : '') + ': ' + money0(String(diff)) +
      ' сверх обычного, это ' + (diff / Number(base) * 100).toFixed(1).replace('.', ',') + '% месячной нагрузки.';
  });
  if (PM.loanEnd && PM.loanPay){
    var last = LOAD[LOAD.length - 1].end;
    txt += ' Кредит закроется ' + humanDate(PM.loanEnd) + ' ' + PM.loanEnd.slice(0, 4) + ' — после этого нагрузка ' +
      'упадёт на ' + money(PM.loanPay) + (PM.loanEnd > last ? ', но эта дата за правым краем графика.' : '.');
  }
  document.getElementById('pmLoadNote').innerHTML = txt;
}

/* ---------- группы платежей ---------- */
function pmRow(p){
  var g = pmGroup(p.group), sub = pmSubText(p);
  return '<tr' + (p.cycle === 'miss' ? ' class="is-miss"' : '') + '>' +
    '<td><div class="pm-name">' + esc(p.name) +
        (p.flow === 'mov' ? '<span class="pm-tag">перевод, не расход</span>' : '') +
        (p.voluntary ? '<span class="pm-tag">добровольный</span>' : '') + '</div>' +
      (sub ? '<div class="pm-sub">' + sub + '</div>' : '') + '</td>' +
    '<td><span class="pm-cat"><span class="dot" style="background:' + g.color + '"></span>' + esc(p.cat) + '</span></td>' +
    '<td class="r">' + pmAmount(p) + '</td>' +
    '<td style="color:var(--text-2)">' + p.when + '</td>' +
    '<td style="color:var(--text-2)">' + esc(p.acc) + '</td>' +
    '<td><span class="pm-cycle ' + PM_CYCLE_CLS[p.cycle] + '"><span class="dot" style="background:' +
      PM_CYCLE_DOT[p.cycle] + '"></span>' + pmCycleText(p) + '</span></td>' +
    '<td class="r"><span class="pm-acts">' + (p.cycle === 'miss'
      /* Пропущенный платёж вносится фактом: сумма, категория и счёт — из
         расписания, дата — сегодняшняя. */
      ? '<button class="btn btn-sm btn-sm--acc" data-form="fact" data-kind="' +
          (p.flow === 'in' ? 'inc' : p.flow === 'mov' ? 'mov' : 'due') + '" data-sum="' + esc(p.cur && p.cur !== 'RUB' ? p.hiNat : p.hi) +
          '" data-name="' + esc(p.name) + '" data-cat="' + esc(p.cat) + '" data-acc="' + esc(p.accId || '') +
          '">Внести</button>' +
        '<button class="btn btn-sm" data-act="pay-skip" data-id="' + p.id + '">Пропустить</button>'
      : '<button class="btn btn-sm" data-form="recur" data-id="' + p.id + '">Изменить</button>' +
        '<button class="btn btn-sm" data-act="rec-pause" data-id="' + p.id + '">На паузу</button>') + '</span></td>' +
  '</tr>';
}
function pmRenderGroups(){
  var host = document.getElementById('pmGroups');
  if (!host) return;
  var shown = 0, groupsShown = 0;
  host.innerHTML = PM.groups.map(function(g){
    var list = pmVisible(g.id);
    if (!list.length) return '';
    shown += list.length; groupsShown++;
    var m = list.reduce(function(s, p){ return s + BigInt(p.perMonth); }, 0n);
    var y = list.reduce(function(s, p){ return s + BigInt(p.perYear); }, 0n);
    return '<div class="grp' + (pmOpen[g.id] ? ' is-open' : '') + '" data-g="' + g.id + '">' +
      '<button type="button" class="grp-head">' +
        '<span class="grp-chev"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
          '<path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
          'stroke-linejoin="round"/></svg></span>' +
        '<span class="grp-name">' + g.name + '</span><span class="grp-count">' + list.length + '</span>' +
        '<span class="spacer"></span>' +
        '<span class="grp-sum">' + (g.id === 'inc' ? '+' : '') + money0(String(m)) + '<span class="per">в месяц</span></span>' +
      '</button>' +
      '<div class="grp-body"><table class="tbl"><thead><tr>' +
        '<th>Платёж</th><th>Категория</th><th class="r">Сумма</th><th>Периодичность</th><th>Счёт</th>' +
        '<th>В этом цикле</th><th class="r">Действия</th></tr></thead>' +
        '<tbody>' + list.map(pmRow).join('') + '</tbody></table>' +
        '<div class="grp-foot"><span>В месяц <span class="v">' + money(String(m)) + '</span></span>' +
          '<span>В год <span class="v">' + money(String(y)) + '</span></span><span class="spacer"></span>' +
          '<span>' + pmItems(list.length) + ' в группе</span></div>' +
      '</div>' +
    '</div>';
  }).join('');
  document.getElementById('pmGrpSub').innerHTML =
    (pmScope === 'month' ? 'Показаны платежи, которые списываются в этом месяце'
                         : 'Показаны все платежи, включая годовые вне текущего месяца') +
    ' · ' + pmItems(shown) + ' в ' + groupsShown + NBSP + plural(groupsShown, 'группе', 'группах', 'группах');
  pmSyncToggleAll();
}
function pmSyncToggleAll(){
  var anyOpen = PM.groups.some(function(g){ return pmOpen[g.id] && pmVisible(g.id).length; });
  document.getElementById('pmToggleAll').textContent = anyOpen ? 'Свернуть все' : 'Развернуть все';
}
/* Свернуть или развернуть одну группу. Раскрыли — строки выходят по
   очереди; свёрнутую не трогаем: исчезновение и так мгновенное. */
function pmToggleGroup(el){
  var id = el.getAttribute('data-g');
  pmOpen[id] = !pmOpen[id];
  el.classList.toggle('is-open', pmOpen[id]);
  if (pmOpen[id]) stagger(el, 'tbody tr');
  pmSyncToggleAll();
}

/* ---------- вопросы ---------- */
function pmRenderQuestions(){
  var Q = PM.questions, n = Q.length;
  document.getElementById('pmQSub').textContent = !n ? 'Открытых вопросов нет'
    : (PM_NUM[n] || n + NBSP + 'открытых вопросов') + ' · ни один пока не превратился в платёж';
  document.getElementById('pmQuestions').innerHTML = !n
    ? '<p class="note" style="margin-top:0">Все вопросы закрыты.</p>'
    : Q.map(function(q){
        return '<div class="q-row"><span class="dot"></span>' +
          '<div class="q-main"><div class="q-text">' + esc(q.text) + '</div><div class="q-meta">' + esc(q.meta) + '</div></div>' +
          '<span class="q-acts"><button class="btn btn-sm" data-q="' + esc(q.key) + '">Решено</button>' +
          '<button class="btn btn-sm btn-sm--acc" data-form="recur" data-note="' + esc(q.text) + '">Создать платёж</button>' +
          '</span></div>';
      }).join('');
}
/* «Решено»: вопрос записывается закрытым и уходит из списка. */
function pmResolve(key){
  window.api.resolveQuestion(key).then(function(r){
    if (!r || !r.ok){ toast('Не сохранилось: ' + ((r && r.error) || 'ошибка базы')); return; }
    PM.questions = PM.questions.filter(function(q){ return q.key !== key; });
    pmRenderQuestions();
  });
}

/* ============================================================
   СБОРКА ЭКРАНА
   ============================================================ */
function drawPayments(){
  if (!PM || PM.empty || PM.error) return;
  pmRenderLoad();
  pmRenderLoadNote();
  pmRenderGroups();
  pmRenderQuestions();
  if (document.fonts && document.fonts.status !== 'loaded' && document.fonts.ready){
    document.fonts.ready.then(function(){ if (current === 'payments') pmRenderLoad(); });
  }
}
function redrawPaymentsWidth(){
  if (!PM || PM.empty || PM.error) return;
  pmRenderLoad();
}
