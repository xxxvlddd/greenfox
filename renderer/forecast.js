'use strict';
/* ============================================================
   ЭКРАН «ПРОГНОЗЫ»
   ============================================================
   Разметка, порядок блоков и графики перенесены из макета
   Main App/screens/04-prognozy.html. В макете исходные величины были
   вписаны под 10 сентября — здесь всё приходит из базы. Имена
   начинаются с fc: скрипты окна живут в одной области видимости.
   ============================================================ */
var FC = null;                  /* данные экрана */
var fcScen = 'usual';           /* закреплённый сценарий */
var fcExtra = 0;                /* «платить сверх платежа», ₽ в месяц */
var fcAlt = null;               /* график кредита с доплатой */
var fcAltTok = 0;               /* ответ на устаревший ввод не рисуем */
/* Закреплённый сценарий помнится между запусками. Хранилище может быть
   недоступно — тогда просто начинаем с обычного темпа. */
try { fcScen = localStorage.getItem('fc.scen') || 'usual'; } catch (e) { fcScen = 'usual'; }

var FC_SCEN = [
  { id: 'free',  name: 'Свободный темп', def: 'Средний день с начала учёта, со всеми разовыми тратами' },
  { id: 'usual', name: 'Обычный темп',   def: 'Медианный день с начала учёта — половина дней была дешевле' },
  { id: 'lean',  name: 'Экономный темп', def: 'Только базовые траты каждого дня, без разовых' }
];
var FC_EXTRA = [0, 2000, 5000, 10000];
var FC_HEAD_BADGE = '<span class="badge badge--forecast" title="Числа этого экрана рассчитаны, а не ' +
  'наблюдались. Наблюдённые остатки помечены бейджем «факт»">прогноз, если не помечено иначе</span>';

/* ---------- мелкие помощники ---------- */
/* «13 дней» после «не хватает» — родительный падеж. */
function fcGDays(n){ return n + NBSP + plural(n, 'дня', 'дней', 'дней'); }
function fcMonths(n){ return n + NBSP + plural(n, 'месяц', 'месяца', 'месяцев'); }
function fcDate(off){
  var p = FC.today.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2] + off);
}
function fcDayLabel(off){ var x = fcDate(off); return x.getDate() + NBSP + MONTHS[x.getMonth()]; }
function fcDmy(iso){ return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : ''; }
function fcDdmm(iso){ return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : ''; }
/* Копейки числом → «12 345 ₽». Сценарии считаются в целых копейках. */
function fcC(v){ return money0(String(Math.round(v))); }
function fcSigned0(cents){ var s = String(cents); return (s.charAt(0) === '-' ? '' : '+') + money0(s); }
/* Рубли без знака валюты: первая граница коридора «121 490 – 229 204 ₽». */
function fcR(cents){ return fmtR(Number(cents) / 100); }
function fcSignedR(cents){ var v = Number(cents) / 100; return (v >= 0 ? '+' : '') + fmtR(v); }
function fcLower(s){
  return s && s.charAt(1) !== s.charAt(1).toUpperCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
function fcCap(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function fcRate(bp){ return (bp / 100).toFixed(2).replace('.', ',').replace(/,?0+$/, '') + '%'; }
function fcShort(v){
  var a = Math.abs(v), sign = v < 0 ? '−' : '';
  return sign + (a >= 1000 ? Math.round(a / 1000) + 'к' : Math.round(a)) + RUB;
}
function fcTone(t){
  return t === 'negative' ? 'var(--danger)' : (t === 'warning' ? 'var(--warning)' : 'var(--positive)');
}
function fcText(p, x, y, str, o){
  o = o || {};
  var t = svgEl('text', { x: x, y: y, 'text-anchor': o.anchor || 'middle',
    fill: o.fill || 'var(--text-3)', 'font-size': o.size || 10, 'font-family': o.font || FONT_MONO });
  if (o.weight) t.setAttribute('font-weight', o.weight);
  t.textContent = str;
  p.appendChild(t);
  return t;
}
/* Шаг шкалы круглый, потолок подгоняется под него — как в макете. */
function fcAxis(maxV){
  var v = Math.max(maxV, 1) * 1.05 / 5;
  var mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
  var mult = [1, 2, 2.5, 5, 10], step = mag * 10;
  for (var i = 0; i < mult.length; i++) if (mag * mult[i] >= v){ step = mag * mult[i]; break; }
  return { step: step, hi: Math.ceil(Math.max(maxV, 1) * 1.05 / step) * step };
}
/* Рисуем в реальных пикселях: viewBox под фактическую ширину колонки. */
function fcSize(svg, wrap, minW, H){
  var W = Math.max(minW, wrap.clientWidth || minW);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  return W;
}
function fcHead(title, hint, sub, right, style){
  return '<div class="sec-head"' + (style ? ' style="' + style + '"' : '') + '><div style="min-width:0">' +
    '<div class="title-row"><h2 class="sec-title">' + title + '</h2>' +
      (hint ? '<i class="info" title="' + esc(hint) + '">i</i>' : '') + '</div>' +
    (sub || '') +
  '</div>' + (right ? '<span class="spacer"></span>' + right : '') + '</div>';
}

/* ============================================================
   РАЗМЕТКА
   ============================================================ */
function renderForecast(d){
  FC = d;
  if (d.error) return stateHTML('is-error', 'Не получилось собрать экран', d.error);
  if (d.empty) return stateHTML('', 'Здесь пока пусто',
    'Прогноз появится, как только будут внесены первые операции.', stAdd(d));
  if (!FC_SCEN.some(function(s){ return s.id === fcScen; })) fcScen = 'usual';
  return '<div class="scr-forecast">' +
    fcScenSection(d) + fcMonthSection(d) +
    '<section class="grid grid--2">' + fcLoanCol(d) + fcGraceCol(d) + '</section>' +
    fcGoalsSection(d) +
  '</div>';
}

/* ---------- 1. на сколько хватит денег ---------- */
function fcRunway(rate){
  var s = FC.scen, bal = Number(s.avail), zero = null, min = bal, minDay = 0, out = [bal];
  for (var d = 1; d <= s.horizon; d++){
    bal = bal - rate + Number(s.events[d] || 0);
    out.push(bal);
    if (bal < 0 && zero === null) zero = d;
    if (bal < min){ min = bal; minDay = d; }
  }
  /* Шкала у каждой карточки своя, но ноль есть всегда: общая шкала
     сжала бы размах всех трёх линий в одну полоску. */
  var lo = 0, hi = 0;
  out.forEach(function(v){ if (v < lo) lo = v; if (v > hi) hi = v; });
  return { zero: zero, min: min, minDay: minDay, s: out, lo: lo, hi: hi };
}
function fcVerdict(r){
  var inc = FC.scen.income;
  if (r.zero === null){
    return { tone: 'positive',
      text: '<b>Хватает на весь горизонт.</b> Самый низкий остаток — ' + fcC(r.min) + ' ' +
            fcDayLabel(r.minDay) + (inc && r.minDay + 1 === inc.day ? ', накануне поступления.' : '.') };
  }
  if (!inc){
    return { tone: 'negative',
      text: '<b>Деньги кончатся ' + fcDayLabel(r.zero) + '</b> — поступлений в горизонте нет.' };
  }
  var gap = inc.day - r.zero;
  if (gap <= 0){
    return { tone: 'warning',
      text: '<b>' + esc(inc.name) + ' ' + fcDayLabel(inc.day) + ' приходит вовремя</b>, но следующий разрыв — ' +
            fcDayLabel(r.zero) + '.' };
  }
  if (gap <= 2){
    return { tone: 'warning',
      text: '<b>До поступления не хватает ' + fcGDays(gap) + '.</b> ' + fcDayLabel(r.zero) + ' на счетах ' +
            fcC(r.s[r.zero]) + ' — разрыв закрывается кредиткой или копилкой.' };
  }
  return { tone: 'negative',
    text: '<b>До поступления ' + fcDayLabel(inc.day) + ' не дотянуть:</b> разрыв ' + fcGDays(gap) +
          ', к ' + fcDayLabel(inc.day - 1) + ' на счетах ' + fcC(r.s[inc.day - 1]) + '.' };
}
function fcScenCards(){
  var s = FC.scen;
  return FC_SCEN.map(function(sc){
    var r = fcRunway(Number(s.rates[sc.id])), v = fcVerdict(r);
    var big = r.zero === null ? 'Хватит до ' + fcDayLabel(s.horizon) : 'Кончатся ' + fcDayLabel(r.zero);
    var sub = r.zero === null ? 'весь горизонт, ' + nDays(s.horizon) : 'через ' + nDays(r.zero);
    var on = sc.id === fcScen;
    return '<button type="button" class="scn' + (on ? ' is-active' : '') + '" data-scen="' + sc.id + '">' +
      '<div class="scn-top">' +
        '<span class="scn-name">' + sc.name + '</span><span class="spacer"></span>' +
        (on ? '<span class="badge badge--forecast">текущий</span>' : '') +
        '<span class="scn-rate">' + money0(s.rates[sc.id]) + '/день</span>' +
      '</div>' +
      '<div class="scn-def">' + sc.def + '</div>' +
      '<div class="scn-when">' +
        '<span class="big" style="color:' + fcTone(v.tone) + '">' + big + '</span>' +
        '<span class="sub">' + sub + '</span>' +
      '</div>' +
      '<div class="scn-chart"><svg aria-hidden="true"></svg></div>' +
      '<div class="scn-scale"><span>сегодня</span><span>' + fcDayLabel(s.horizon) + '</span></div>' +
      '<div class="scn-verdict"><span class="dot" style="background:' + fcTone(v.tone) + '"></span>' +
        '<span>' + v.text + '</span></div>' +
    '</button>';
  }).join('');
}
function fcScenSection(d){
  var a = money(d.scen.avail);
  /* В макете у заголовка отступ снизу убран в ноль — чтобы он читался
     вместе с карточками. Подзаголовок при этом ложился прямо на линию
     сетки. 16 пикселей — тот же зазор, что у остальных заголовков. */
  return '<section class="sec" style="border-top:none;padding-bottom:16px">' +
      fcHead('На сколько хватит денег',
        'Считается от ' + a + ' на платёжных счетах. Копилка, инвестиции и лимит кредитной карты не ' +
        'учитываются. В каждый сценарий добавлены известные поступления и обязательные платежи горизонта',
        '<p class="sec-sub">Три темпа трат от одних и тех же ' + a + ' на платёжных счетах. На графиках — ' +
        'остаток на счетах по дням, у каждого сценария своя шкала · нажмите карточку, чтобы закрепить ' +
        'сценарий</p>', '', 'margin-bottom:0') +
    '</section>' +
    '<section class="grid grid--3" id="fcScen">' + fcScenCards() + '</section>';
}
/* Закрепить сценарий: отметка и бейдж «текущий» переходят на карточку. */
function fcPinScen(id){
  fcScen = id;
  try { localStorage.setItem('fc.scen', id); } catch (e) { /* не запомнится — не беда */ }
  var cards = document.querySelectorAll('#fcScen .scn');
  for (var i = 0; i < cards.length; i++){
    var on = cards[i].getAttribute('data-scen') === id;
    cards[i].classList.toggle('is-active', on);
    var b = cards[i].querySelector('.badge--forecast');
    if (on && !b) cards[i].querySelector('.scn-rate')
      .insertAdjacentHTML('beforebegin', '<span class="badge badge--forecast">текущий</span>');
    if (!on && b) b.remove();
  }
}

/* ---------- 2. каким выйдет месяц ---------- */
function fcMonthSection(d){
  var m = d.month;
  var spend = m.mid[m.mid.length - 1];
  var lo = m.lo[m.lo.length - 1], hi = m.hi[m.hi.length - 1];
  var cf = String(BigInt(m.income) - BigInt(spend));
  var reg = String(BigInt(m.regular) - BigInt(spend));
  var perDay = String(Math.round(Number(spend) / m.days));

  var inc = [];
  if (BigInt(m.incomeFact) > 0n) inc.push(money0(m.incomeFact) + ' уже пришло');
  m.expected.forEach(function(e){
    inc.push((inc.length ? fcLower(esc(e.name)) : esc(e.name)) + ' ' + money0(e.sum) + ' ждём ' + humanDate(e.day));
  });
  var incSub = inc.length ? fcCap(inc.join(', ')) : 'Поступлений в этом месяце не ждём';

  var spendSub = money0(perDay) + ' в день';
  if (m.prev && Number(m.prev.avgDay) > 0){
    var ch = (Number(perDay) - Number(m.prev.avgDay)) / Number(m.prev.avgDay) * 100;
    spendSub += ' против ' + money0(m.prev.avgDay) + ' в ' + m.prev.monthPre + ' — на ' +
      Math.abs(ch).toFixed(1).replace('.', ',') + '% ' + (ch <= 0 ? 'меньше' : 'больше');
  }
  var cfPos = cf.charAt(0) !== '-', regPos = reg.charAt(0) !== '-';
  var hint = 'Расход = факт ' + (m.today > 1 ? 'по ' + (m.today - 1) + NBSP + MONTHS[Number(d.today.slice(5, 7)) - 1]
      : 'текущего месяца') + ' плюс обычный темп ' + money0(m.rate) + '/день на оставшиеся ' + nDays(m.remaining) +
    ' плюс известные обязательные платежи. Коридор построен по 25-му и 75-му процентилю дневного расхода с начала учёта';

  return '<section class="sec">' +
    fcHead('Каким выйдет ' + m.name, hint,
      '<p class="sec-sub"><span class="badge badge--forecast">прогноз</span> Накопленный расход месяца против ' +
      'ожидаемого дохода. Сплошная линия — факт, пунктир — прогноз</p>',
      '<div class="legend">' +
        '<span class="legend-item"><span class="legend-line" style="background:var(--cat-3)"></span>расход</span>' +
        '<span class="legend-item"><span class="legend-line" style="background:var(--cat-3);opacity:.3"></span>коридор</span>' +
        '<span class="legend-item"><span class="legend-line" style="background:var(--positive)"></span>доход за месяц</span>' +
      '</div>') +
    '<div class="mf-vals">' +
      '<div class="mf-val"><div class="k">Доход</div><div class="v">' + money0(m.income) + '</div>' +
        '<div class="s">' + incSub + '</div></div>' +
      '<div class="mf-val"><div class="k">Расход</div><div class="v">' + money0(spend) + '</div>' +
        '<div class="s">' + spendSub + '</div>' +
        '<div class="r">коридор ' + fcR(lo) + ' – ' + money0(hi) + '</div></div>' +
      '<div class="mf-val"><div class="k">Кэшфлоу</div>' +
        '<div class="v ' + (cfPos ? 'c-pos' : 'c-neg') + '">' + fcSigned0(cf) + '</div>' +
        '<div class="s">' + (m.prev ? 'Против ' + fcSigned0(m.prev.cashflow) + ' в ' + m.prev.monthPre
                                    : 'Доход минус расход за месяц') + '</div>' +
        '<div class="r">коридор ' + fcSignedR(String(BigInt(m.income) - BigInt(lo))) + ' … ' +
          fcSigned0(String(BigInt(m.income) - BigInt(hi))) + '</div></div>' +
      '<div class="mf-val mf-val--ghost"><div class="k">Без разовых<i class="info" title="Тот же расчёт, но в доходе ' +
        'только регулярные поступления из расписания — без разовых">i</i></div>' +
        '<div class="v ' + (regPos ? 'c-pos' : 'c-neg') + '">' + fcSigned0(reg) + '</div>' +
        '<div class="s">Месячный кэшфлоу на одних регулярных поступлениях</div></div>' +
    '</div>' +
    '<div class="chart-wrap" id="fcMonthWrap">' +
      '<svg id="fcMonthSvg" role="img" aria-label="Накопленный расход месяца: факт и прогноз до конца месяца"></svg>' +
    '</div>' +
    (cfPos && !regPos
      ? '<div class="note-warn" style="margin-top:16px"><span class="dot"></span><span><b>' + fcCap(m.name) +
        ' выглядит хорошо только за счёт разовых поступлений.</b> Без них месяц закрылся бы с ' + fcSigned0(reg) +
        '. Не считайте этот плюс свободными деньгами.</span></div>'
      : '') +
  '</section>';
}

/* ---------- 3. погашение кредита ---------- */
function fcLoanCol(d){
  var l = d.loan;
  if (!l){
    return '<div style="display:flex;flex-direction:column">' +
      fcHead('Погашение кредита', '', '<p class="sec-sub">Кредитов нет</p>') + '</div>';
  }
  return '<div style="display:flex;flex-direction:column">' +
    fcHead('Погашение кредита',
      'Аннуитет пересчитан от текущего остатка долга по ставке ' + fcRate(l.rateBp) +
      ' годовых. Досрочные платежи уменьшают срок, а не размер платежа',
      '<p class="sec-sub"><span class="badge badge--forecast">прогноз</span> ' + esc(l.creditor) + ' · ' +
        fcRate(l.rateBp) + ' · платёж ' + money(l.payment) + ' ' + l.day + ' числа</p>') +
    '<div class="chart-wrap" id="fcLoanWrap">' +
      '<svg id="fcLoanSvg" role="img" aria-label="Остаток долга по кредиту по месяцам до закрытия"></svg>' +
    '</div>' +
    '<div class="mini-note" style="margin-top:14px" id="fcLoanNext"></div>' +
    '<div class="trio">' +
      '<div><div class="k">Осталось платежей</div><div class="v" id="fcLoanCount"></div>' +
        '<div class="s" id="fcLoanCountSub"></div></div>' +
      '<div><div class="k">Сумма платежей</div><div class="v" id="fcLoanSum"></div>' +
        '<div class="s">при остатке долга ' + money(l.balance) + '</div></div>' +
      '<div><div class="k">Переплата процентами</div><div class="v c-warn" id="fcLoanInt"></div>' +
        '<div class="s">за оставшийся срок</div></div>' +
    '</div>' +
    '<div class="whatif">' +
      '<div class="whatif-row">' +
        '<label for="fcExtra">Платить сверх платежа</label>' +
        '<span class="whatif-in"><input type="number" id="fcExtra" min="0" max="100000" step="500" value="' +
          fcExtra + '" inputmode="numeric" aria-label="Дополнительная сумма в месяц, рублей">' +
          '<span class="cur">₽/мес.</span></span>' +
        '<span class="spacer"></span>' +
        '<div class="seg" id="fcExtraSeg">' + FC_EXTRA.map(function(v){
          return '<button type="button" data-extra="' + v + '"' + (v === fcExtra ? ' class="is-active"' : '') + '>' +
                 (v ? '+' + fmtR(v) : '0') + '</button>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="whatif-out" id="fcWhatifOut"></div>' +
    '</div>' +
  '</div>';
}
function fcSetExtraSeg(v){
  var bs = document.querySelectorAll('#fcExtraSeg button');
  for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('is-active', Number(bs[i].getAttribute('data-extra')) === v);
}
/* Базовые числа кредита. Доплата их не меняет: она показывается второй
   линией и строкой выигрыша. */
function fcLoanBase(){
  var l = FC.loan, b = l && l.base;
  if (!b) return;
  document.getElementById('fcLoanCount').textContent = b.n;
  document.getElementById('fcLoanCountSub').textContent =
    b.full === b.n ? 'все полные' : b.full + ' полных и остаток ' + money(b.last);
  document.getElementById('fcLoanSum').textContent = money(b.total);
  document.getElementById('fcLoanInt').textContent = money(b.interest);
  document.getElementById('fcLoanNext').innerHTML =
    '<span>Ближайший платёж — <b>' + fcDmy(l.next) + '</b>, ' + money(l.payment) + '. Из них проценты ' +
    money(b.firstInt) + ', тело долга ' + money(b.firstPrin) + ' — долг уменьшится до ' + money(b.pts[1]) + '.</span>';
}
/* «А если платить больше». Пересчёт делает главный процесс — тем же
   графиком, что «Капитал»; пока ответ в пути, человек мог набрать
   другую сумму, поэтому устаревший ответ отбрасывается. */
function fcApplyWhatIf(extra, animate){
  fcExtra = extra;
  var out = document.getElementById('fcWhatifOut');
  if (!out || !FC.loan) return;
  var tok = ++fcAltTok;
  if (!extra || extra <= 0){
    fcAlt = null;
    fcRenderLoan();
    out.className = 'whatif-out';
    out.textContent = 'Добавьте сумму — на графике появится вторая линия, а здесь расчёт выигрыша.';
    return;
  }
  window.api.loanPlan(extra).then(function(alt){
    if (tok !== fcAltTok || current !== 'forecast' || !alt) return;
    fcAlt = alt;
    fcRenderLoan();
    var b = FC.loan.base;
    var o = document.getElementById('fcWhatifOut');
    var saveM = b.n - alt.n;
    var pay = String(BigInt(FC.loan.payment) + BigInt(extra) * 100n);
    o.className = 'whatif-out is-on';
    o.innerHTML = 'При платеже <b class="num">' + money(pay) + '</b> кредит закроется <b>' +
      fcDmy(alt.dates[alt.n - 1]) + '</b> — ' + (saveM > 0 ? 'раньше на ' + fcMonths(saveM) : 'в тот же месяц') +
      '. Экономия на процентах <b class="num c-pos">' + money(String(BigInt(b.interest) - BigInt(alt.interest))) +
      '</b>. Всего заплатите <span class="num">' + money(alt.total) + '</span> вместо <span class="num">' +
      money(b.total) + '</span>.';
    /* Нажали готовую сумму — расчёт выигрыша появляется целиком. При
       наборе с клавиатуры этого не делаем: строка меняется на каждый
       знак, и появление превратилось бы в мигание. */
    if (animate) appear(o);
  });
}

/* ---------- 4. грейс кредитки ---------- */
function fcGraceHit(){
  var g = FC.grace, need = Number(g.need), c = 0;
  if (!(need > 0)) return null;
  for (var i = 0; i < g.ops.length; i++){
    c += Number(g.ops[i].sum);
    if (c >= need) return g.ops[i];
  }
  return null;
}
function fcGraceCol(d){
  var g = d.grace;
  if (!g){
    return '<div style="display:flex;flex-direction:column">' +
      fcHead('Грейс кредитки', '', '<p class="sec-sub">Кредитной карты нет</p>') + '</div>';
  }
  var need = BigInt(g.need), paid = BigInt(g.paid);
  var done = paid >= need;
  /* Откуда взялась сумма к грейсу — так и сказано. */
  var how = g.source === 'manual'
      ? 'Сумма к грейсу — как вы указали на ' + humanDate(g.start) + '; внесённое с этого дня вычитается'
    : g.source === 'statement'
      ? 'Выписка ' + g.statementDay + ' числа, грейс до ' + g.graceDay + ' числа: до него нужно внести долг на день выписки'
      : 'Цикл идёт с ' + (g.graceDay + 1) + ' числа по ' + g.graceDay + ' число следующего месяца: до его конца нужно ' +
        'внести долг на начало цикла. День выписки уточняет расчёт — его можно указать в «Настройках»';
  var hit = fcGraceHit();
  var nOpsTxt = nOps(g.ops.length);
  return '<div style="display:flex;flex-direction:column">' +
    fcHead('Грейс кредитки', how,
      '<p class="sec-sub"><span class="badge badge--fact">факт</span> ' + (g.bank ? esc(g.bank) + ' · ' : '') +
        'цикл ' + humanDate(g.start) + ' – ' + humanDate(g.due) + '</p>',
      done ? '<span class="badge badge--ok">условие выполнено</span>'
           : '<span class="badge badge--warn">условие не выполнено</span>') +
    '<div class="gr-hero">' +
      '<div style="min-width:0">' +
        '<div class="gr-sum ' + (done ? 'c-pos' : 'c-warn') + '">' + money(g.paid) + '</div>' +
        '<div class="gr-of">' + (need > 0n
          ? 'внесено из ' + money0(g.need) + ' — ' + (done ? 'условие выполнено'
              : 'осталось ' + money0(g.left) + ', это ' + Math.round(Number(g.paid) / Number(g.need) * 100) + '% от нужного')
          : 'внесено — к этому грейсу вносить нечего') + '</div>' +
      '</div>' +
      '<span class="spacer"></span>' +
      '<div class="gr-count"><div class="d">' + g.daysLeft + '</div>' +
        '<div class="l">' + plural(g.daysLeft, 'день', 'дня', 'дней') + ' до ' + humanDate(g.due) + '</div></div>' +
    '</div>' +
    '<div class="chart-wrap" id="fcGraceWrap" style="margin-top:16px">' +
      '<svg id="fcGraceSvg" role="img" aria-label="Накопленные пополнения кредитной карты за цикл"></svg>' +
    '</div>' +
    '<div class="note" style="margin-top:10px">' + (hit
      ? 'Условие закрыто <b>' + hit.date + '</b>, за ' + fcGDays(g.len - hit.day) + ' до конца цикла — на ' +
        hit.day + '-й день из ' + g.len + '. Всё, что внесено после, идёт сверх нормы.'
      : '') + '</div>' +
    '<div class="gr-ops-head">' +
      '<span class="lbl">Пополнения карты в этом цикле</span><span class="spacer"></span>' +
      (g.ops.length
        ? '<button class="btn-link" id="fcGraceToggle" aria-expanded="false" aria-controls="fcGraceOps">' +
          nOpsTxt + ' · показать</button>'
        : '<span class="lbl">не было</span>') +
    '</div>' +
    '<div class="gr-ops" id="fcGraceOps">' + g.ops.map(function(o){
      return '<div class="gr-op"><span class="dt">' + o.date + '</span><span class="ds">' + esc(o.desc) + '</span>' +
             '<span class="am c-pos">+' + money(o.sum) + '</span></div>';
    }).join('') + '</div>' +
    '<div class="gr-rule"><b>Правило банка:</b> до ' + g.graceDay + ' числа на карту должна быть внесена сумма ' +
      (g.statementDay ? 'по выписке ' + g.statementDay + ' числа' : 'долга на начало цикла') + '. Вносить можно частями — ' +
      'важна сумма внесений, а покупки после выписки уходят в следующий цикл.</div>' +
    (g.stuck
      ? '<div class="note-warn" style="margin-top:14px"><span class="dot"></span><span><b>Долг при этом не ' +
        'уменьшается: ' + money(g.debt) + (g.limit ? ' при лимите ' + money0(g.limit) : '') + '.</b> Каждое ' +
        'пополнение почти сразу тратится новой покупкой по карте.' + (need > 0n && done
          ? ' Условие «внесено ' + money0(g.need) + ' за цикл» выполнено, а условие «долг обнулился» — нет. ' +
            'Стоит уточнить в банке, какая формулировка действует: от этого зависит, начислятся ли проценты.'
          : '') + '</span></div>'
      : '') +
    '<div class="gr-foot">' +
      '<button class="btn btn-sm" data-goto-settings="calc">Уточнить правило банка</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-sm--acc" data-form="cardtopup">Пополнить карту</button>' +
    '</div>' +
  '</div>';
}

/* ---------- 5. цели по накоплениям ---------- */
function fcSpark(series, color){
  var W = 240, H = 44, T = 5, B = 5;
  var v = series.map(Number);
  var mn = Math.min.apply(null, v), mx = Math.max.apply(null, v);
  var pad = (mx - mn) * 0.12 || 1;
  mn -= pad; mx += pad;
  var X = function(i){ return v.length > 1 ? i / (v.length - 1) * W : W / 2; };
  var Y = function(x){ return T + (H - T - B) - (x - mn) / (mx - mn) * (H - T - B); };
  var pts = v.map(function(x, i){ return X(i).toFixed(1) + ' ' + Y(x).toFixed(1); });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
    '" preserveAspectRatio="none" aria-hidden="true">' +
    '<path d="M 0 ' + H + ' L ' + pts.join(' L ') + ' L ' + W + ' ' + H + ' Z" fill="' + color + '" fill-opacity="0.12"/>' +
    '<path d="M ' + pts.join(' L ') + '" fill="none" stroke="' + color + '" stroke-width="1.8" ' +
    'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
    '<circle cx="' + X(v.length - 1).toFixed(1) + '" cy="' + Y(v[v.length - 1]).toFixed(1) +
    '" r="2.6" fill="' + color + '"/></svg>';
}
function fcGoal(g){
  var badge, body, meta, note, action;
  if (g.kind === 'target'){
    var past = g.left !== null && g.left < 0;
    badge = past ? ['срок прошёл', 'badge--warn'] : g.warn ? ['решение', 'badge--warn'] : ['в процессе', 'badge--forecast'];
    var pct = Number(g.target) ? Number(g.cur) / Number(g.target) * 100 : 0;
    /* Пустая цель показывает пунктирный жёлоб, а не нулевую заливку:
       иначе «0%» читается как «полоса просто не видна». */
    body = '<div class="goal-amt"><b>' + money0(g.cur) + '</b><span>из ' + money0(g.target) + '</span></div>' +
      (pct > 0 ? '<div class="goal-track"><i style="width:' + Math.min(pct, 100).toFixed(1) + '%"></i></div>'
               : '<div class="goal-track is-empty"></div>');
    meta = [['Срок', g.deadline ? humanDate(g.deadline) : 'не задан'],
            ['Осталось', g.left === null ? '—' : past ? 'срок прошёл' : nDays(g.left)],
            ['Нужно отложить', money0(g.need)]];
    note = Number(g.cur) === 0 ? 'Ещё не начато — под цель пока ничего не отложено.'
      : 'Отложено ' + Math.round(pct) + '%' + (g.left > 0 ? ' — до срока ' + nDays(g.left) + '.' : '.');
    action = 'Отложить сейчас';
  } else {
    var stale = g.staleDays > 0;
    badge = !g.reconciledAt ? ['факт', 'badge--fact']
      : stale ? ['сверено ' + fcDdmm(g.reconciledAt), 'badge--stale']
              : ['факт · сверено ' + fcDdmm(g.reconciledAt), 'badge--fact'];
    body = '<div class="goal-amt"><b>' + money(g.cur) + '</b></div>' +
           '<div class="goal-spark">' + fcSpark(g.series, g.color) + '</div>';
    meta = [['Прирост за ' + nDays(g.days), fcSigned0(g.growth)],
            g.charge ? ['Списание ' + fcDdmm(g.charge.day), money(g.charge.sum)] : ['Взнос в месяц', 'не задан']];
    if (g.charge && g.charge.short){
      note = 'С этого счёта уходит ' + fcLower(esc(g.charge.name)) + '. ' + humanDate(g.charge.day) + ' спишется ' +
        money(g.charge.sum) + ' — останется ' + money(g.charge.rest) + ', на следующий платёж уже не хватит.';
      action = 'Пополнить';
    } else {
      note = stale ? 'Остаток не сверялся ' + nDays(g.staleDays) + '. Цель и срок не заданы, поэтому прогресс не ' +
                     'считается — видна только динамика.'
                   : 'Накопление без цели и срока — отслеживается только динамика остатка.';
      action = 'Задать цель';
    }
  }
  return '<div class="goal' + (g.warn ? ' is-warn' : '') + '">' +
    '<div class="goal-top"><span class="nm">' + esc(g.name) + '</span><span class="spacer"></span>' +
      '<span class="badge ' + badge[1] + '">' + badge[0] + '</span></div>' +
    body +
    '<div class="goal-meta">' + meta.map(function(m){
      /* Моноширинный набор нужен числам; словесные значения в нём разъезжаются. */
      return '<div><div class="k">' + m[0] + '</div><div class="' + (/\d/.test(m[1]) ? 'v' : 'v is-text') + '">' +
             m[1] + '</div></div>';
    }).join('') + '</div>' +
    '<div class="goal-note">' + note + '</div>' +
    '<div class="goal-foot"><span class="spacer"></span>' +
      /* «Задать цель» открывает цель на правку, «Отложить» и «Пополнить» —
         перевод на счёт цели с пометкой «под цель». */
      (action === 'Задать цель'
        ? '<button class="btn-link" data-form="goal" data-id="' + g.id + '">' + action + '</button>'
        : '<button class="btn-link" data-form="goaltopup" data-id="' + g.id + '" data-to="' + esc(g.accountId || '') +
          '" data-goal="' + esc(g.name) + '">' + action + '</button>') + '</div>' +
  '</div>';
}
function fcGoalsSection(d){
  var f = d.goalsFoot;
  var plan = Number(f.plan), avail = Number(f.avail);
  var warn = '';
  if (plan > 0 && f.toIncome){
    var left = avail - plan, perDay = left / f.toIncome;
    if (perDay < Number(f.usual)){
      warn = '<div class="note-warn" style="margin-top:14px"><span class="dot"></span><span><b>Плановые взносы ' +
        'больше, чем позволяет остаток.</b> На платёжных счетах ' + money(f.avail) + ', до поступления ' +
        fcGDays(f.toIncome) + '. Если отложить все ' + money0(f.plan) + ' сейчас, останется ' + fcC(left) + ' на ' +
        nDays(f.toIncome) + ' — это ' + fcC(perDay) + ' в день при обычном темпе ' + money0(f.usual) + '.</span></div>';
    }
  }
  return '<section class="sec">' +
    fcHead('Цели по накоплениям', 'Остатки счетов — факт. Прогресс и сроки считаются только там, где заданы цель и дата',
      '<p class="sec-sub">Остатки — факт по сверке, прогресс и сроки — расчёт</p>',
      '<button class="btn btn-sm" data-form="goal"><svg width="12" height="12" viewBox="0 0 12 12" ' +
        'fill="none" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.6" ' +
        'stroke-linecap="round"/></svg>Новая цель</button>') +
    (d.goals.length ? '<div class="goals">' + d.goals.map(fcGoal).join('') + '</div>'
                    : '<p class="sec-sub">Целей пока нет</p>') +
    '<div class="goals-foot">' +
      '<div><div class="k">Накоплено всего</div><div class="v">' + money(f.saved) + '</div></div>' +
      '<div><div class="k">Плановый взнос в месяц</div><div class="v">' + money(f.plan) + '</div></div>' +
      '<div><div class="k">Свободно на платёжных счетах</div>' +
        '<div class="v' + (avail < plan ? ' c-warn' : '') + '">' + money(f.avail) + '</div></div>' +
      '<span class="spacer"></span>' +
    '</div>' +
    warn +
  '</section>';
}

/* ============================================================
   ГРАФИКИ
   ============================================================ */
function fcDrawScenChart(wrap, r, tone){
  var svg = wrap.querySelector('svg');
  var H = 88, PT = 14, PB = 6;
  var W = fcSize(svg, wrap, 180, H);
  var PH = H - PT - PB, N = FC.scen.horizon;
  var span = (r.hi - r.lo) || 1;
  var X = function(d){ return d / N * W; };
  var Y = function(v){ return PT + (r.hi - v) / span * PH; };
  var color = fcTone(tone), y0 = Y(0);

  var area = ['M ' + X(0).toFixed(1) + ' ' + y0.toFixed(1)];
  r.s.forEach(function(v, i){ area.push('L ' + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)); });
  area.push('L ' + X(N).toFixed(1) + ' ' + y0.toFixed(1) + ' Z');
  svg.appendChild(svgEl('path', { d: area.join(' '), fill: color, 'fill-opacity': .12 }));

  svg.appendChild(svgEl('line', { x1: 0, y1: y0, x2: W, y2: y0, stroke: 'var(--border-strong)', 'stroke-width': 1 }));
  fcText(svg, 1, y0 - 5, '0' + RUB, { anchor: 'start', size: 9 });

  /* Ближайшее поступление — пунктиром, как аванс в макете. */
  var inc = FC.scen.income;
  if (inc){
    var lbl = inc.name.length <= 12 ? fcLower(inc.name) : 'доход';
    svg.appendChild(svgEl('line', { x1: X(inc.day), y1: PT, x2: X(inc.day), y2: PT + PH,
      stroke: 'var(--warning)', 'stroke-width': 1, 'stroke-dasharray': '2 3', 'stroke-opacity': .7 }));
    fcText(svg, X(inc.day), PT - 5, lbl, { anchor: 'middle', size: 9, font: FONT_SANS, fill: 'var(--warning)' });
  }

  svg.appendChild(svgEl('path', {
    d: r.s.map(function(v, i){ return (i ? 'L ' : 'M ') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' '),
    fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
  }));
  if (r.zero !== null){
    svg.appendChild(svgEl('circle', { cx: X(r.zero), cy: Y(r.s[r.zero]), r: 3.2, fill: 'var(--danger)' }));
  }
  svg.appendChild(svgEl('circle', { cx: X(0), cy: Y(r.s[0]), r: 2.6, fill: color }));
}
function fcRenderScen(){
  var cards = document.querySelectorAll('#fcScen .scn');
  for (var i = 0; i < cards.length; i++){
    var r = fcRunway(Number(FC.scen.rates[cards[i].getAttribute('data-scen')]));
    fcDrawScenChart(cards[i].querySelector('.scn-chart'), r, fcVerdict(r).tone);
  }
}

function fcRenderMonth(){
  var wrap = document.getElementById('fcMonthWrap'), svg = document.getElementById('fcMonthSvg');
  if (!wrap || !svg) return;
  var m = FC.month;
  var H = 250, W = fcSize(svg, wrap, 420, H);
  var PL = 58, PR = 14, PT = 14, PB = 28, PW = W - PL - PR, PH = H - PT - PB;
  var toR = function(a){ return a.map(function(x){ return Number(x) / 100; }); };
  var fact = toR(m.fact), mid = toR(m.mid), lo = toR(m.lo), hi = toR(m.hi);
  var inc = Number(m.income) / 100, k0 = m.today - 1, D = m.days;
  var ax = fcAxis(Math.max(hi[hi.length - 1], inc));
  /* Ось — прошедшие дни: 0 — начало месяца, D — его конец. */
  var X = function(k){ return PL + k / D * PW; };
  var Y = function(v){ return PT + (ax.hi - v) / ax.hi * PH; };

  for (var g = 0; g <= ax.hi + 1; g += ax.step){
    var zero = g === 0;
    svg.appendChild(svgEl('line', { x1: PL, y1: Y(g), x2: PL + PW, y2: Y(g),
      stroke: zero ? 'var(--border-strong)' : 'var(--border)', 'stroke-width': 1,
      'stroke-dasharray': zero ? 'none' : '3 3' }));
    fcText(svg, PL - 10, Y(g) + 3.5, zero ? '0' + RUB : fcShort(g), { anchor: 'end' });
  }

  /* коридор неопределённости */
  var band = ['M ' + X(k0).toFixed(1) + ' ' + Y(fact[k0]).toFixed(1)];
  for (var i = 0; i < hi.length; i++) band.push('L ' + X(m.today + i).toFixed(1) + ' ' + Y(hi[i]).toFixed(1));
  for (var j = lo.length - 1; j >= 0; j--) band.push('L ' + X(m.today + j).toFixed(1) + ' ' + Y(lo[j]).toFixed(1));
  band.push('Z');
  svg.appendChild(svgEl('path', { d: band.join(' '), fill: 'var(--cat-3)', 'fill-opacity': .13 }));

  /* ожидаемый доход за месяц */
  svg.appendChild(svgEl('line', { x1: PL, y1: Y(inc), x2: PL + PW, y2: Y(inc),
    stroke: 'var(--positive)', 'stroke-width': 1.4, 'stroke-dasharray': '5 4' }));
  fcText(svg, PL + 6, Y(inc) - 7, 'доход за месяц ' + money0(m.income),
    { anchor: 'start', size: 11, weight: 600, fill: 'var(--positive)' });

  /* граница «сегодня» */
  svg.appendChild(svgEl('line', { x1: X(k0), y1: PT, x2: X(k0), y2: PT + PH,
    stroke: 'var(--border-strong)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
  fcText(svg, X(k0) + 6, PT + 10, 'сегодня', { anchor: 'start', size: 10, font: FONT_SANS });

  /* прогноз */
  var fl = ['M ' + X(k0).toFixed(1) + ' ' + Y(fact[k0]).toFixed(1)];
  for (var k = 0; k < mid.length; k++) fl.push('L ' + X(m.today + k).toFixed(1) + ' ' + Y(mid[k]).toFixed(1));
  svg.appendChild(svgEl('path', { d: fl.join(' '), fill: 'none', stroke: 'var(--cat-3)',
    'stroke-width': 2, 'stroke-dasharray': '6 4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'stroke-opacity': .8 }));

  /* факт */
  if (k0 > 0){
    svg.appendChild(svgEl('path', { d: fact.map(function(v, q){
        return (q ? 'L ' : 'M ') + X(q).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' '),
      fill: 'none', stroke: 'var(--cat-3)', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  svg.appendChild(svgEl('circle', { cx: X(k0), cy: Y(fact[k0]), r: 3.4, fill: 'var(--cat-3)' }));

  /* конец прогноза */
  var last = mid[mid.length - 1];
  svg.appendChild(svgEl('circle', { cx: X(D), cy: Y(last), r: 3.4, fill: 'var(--cat-3)' }));
  fcText(svg, PL + PW, Y(last) + 20, money0(m.mid[m.mid.length - 1]),
    { anchor: 'end', size: 11, weight: 600, fill: 'var(--cat-3)' });

  [1, 5, 10, 15, 20, 25, D].forEach(function(dd){
    fcText(svg, X(dd), H - 9, dd + (dd === D ? NBSP + m.monthShort : ''),
      { anchor: dd === 1 ? 'start' : (dd === D ? 'end' : 'middle') });
  });
}

function fcRenderLoan(){
  var wrap = document.getElementById('fcLoanWrap'), svg = document.getElementById('fcLoanSvg');
  if (!wrap || !svg || !FC.loan) return;
  var l = FC.loan, base = l.base, alt = fcAlt;
  var H = 216, W = fcSize(svg, wrap, 320, H);
  var PL = 52, PR = 12, PT = 22, PB = 26, PW = W - PL - PR, PH = H - PT - PB;
  var N = Math.max(1, base.n);
  var top = Number(l.balance) / 100;
  var ax = fcAxis(top);
  var X = function(i){ return PL + i / N * PW; };
  var Y = function(v){ return PT + (ax.hi - v) / ax.hi * PH; };

  for (var g = 0; g <= ax.hi + 1; g += ax.step){
    var zero = g === 0;
    svg.appendChild(svgEl('line', { x1: PL, y1: Y(g), x2: PL + PW, y2: Y(g),
      stroke: zero ? 'var(--border-strong)' : 'var(--border)', 'stroke-width': 1,
      'stroke-dasharray': zero ? 'none' : '3 3' }));
    fcText(svg, PL - 10, Y(g) + 3.5, zero ? '0' + RUB : fcShort(g), { anchor: 'end' });
  }
  /* Ступени, а не прямая: долг падает раз в месяц в день платежа. */
  var stepPath = function(pts){
    var v = pts.map(function(x){ return Number(x) / 100; }), d = [];
    for (var i = 0; i < v.length; i++){
      if (i === 0) d.push('M ' + X(0).toFixed(1) + ' ' + Y(v[0]).toFixed(1));
      else {
        d.push('L ' + X(i).toFixed(1) + ' ' + Y(v[i - 1]).toFixed(1));
        d.push('L ' + X(i).toFixed(1) + ' ' + Y(v[i]).toFixed(1));
      }
    }
    return d.join(' ');
  };
  if (alt){
    svg.appendChild(svgEl('path', { d: stepPath(alt.pts), fill: 'none', stroke: 'var(--positive)',
      'stroke-width': 1.8, 'stroke-dasharray': '6 4', 'stroke-linejoin': 'round' }));
    svg.appendChild(svgEl('circle', { cx: X(alt.n), cy: Y(0), r: 3.4, fill: 'var(--positive)' }));
    fcText(svg, X(alt.n), Y(0) - 9, fcDmy(alt.dates[alt.n - 1]).slice(3),
      { anchor: alt.n > N * 0.8 ? 'end' : 'middle', size: 10, weight: 600, fill: 'var(--positive)' });
  }
  svg.appendChild(svgEl('path', { d: stepPath(base.pts), fill: 'none', stroke: 'var(--cat-3)',
    'stroke-width': 2, 'stroke-linejoin': 'round' }));
  svg.appendChild(svgEl('circle', { cx: X(0), cy: Y(top), r: 3.4, fill: 'var(--cat-3)' }));
  fcText(svg, PL, Y(top) - 9, 'сегодня ' + money0(l.balance),
    { anchor: 'start', size: 11, weight: 600, fill: 'var(--text)' });
  svg.appendChild(svgEl('circle', { cx: X(N), cy: Y(0), r: 3.4, fill: 'var(--cat-3)' }));
  fcText(svg, PL + PW, PT + 10, 'закрытие ' + fcDmy(base.dates[base.n - 1]),
    { anchor: 'end', size: 11, weight: 600, fill: 'var(--cat-3)' });

  /* Подписи месяцев прореживаем по ширине колонки. */
  var stepI = PW / N < 34 ? 4 : 2;
  for (var i = 0; i <= N; i += stepI){
    var iso = i === 0 ? FC.today : base.dates[i - 1];
    var lbl = MON_SHORT[Number(iso.slice(5, 7)) - 1] + NBSP + iso.slice(2, 4);
    fcText(svg, X(i), H - 8, lbl, { anchor: i === 0 ? 'start' : (i + stepI > N ? 'end' : 'middle') });
  }
}

function fcRenderGrace(){
  var wrap = document.getElementById('fcGraceWrap'), svg = document.getElementById('fcGraceSvg');
  if (!wrap || !svg || !FC.grace) return;
  var g = FC.grace;
  var H = 118, W = fcSize(svg, wrap, 280, H);
  var PL = 10, PR = 10, PT = 16, PB = 20, PW = W - PL - PR, PH = H - PT - PB;
  var need = Number(g.need) / 100, total = Number(g.paid) / 100;
  var top = Math.max(total, need, 1) * 1.1;
  var len = Math.max(1, g.len);
  var X = function(d){ return PL + d / len * PW; };
  var Y = function(v){ return PT + (top - v) / top * PH; };

  /* Ступенчатое накопление: между пополнениями сумма не растёт. */
  var d = ['M ' + X(0).toFixed(1) + ' ' + Y(0).toFixed(1)], prev = 0;
  g.ops.forEach(function(o){
    var v = prev + Number(o.sum) / 100;
    d.push('L ' + X(o.day).toFixed(1) + ' ' + Y(prev).toFixed(1));
    d.push('L ' + X(o.day).toFixed(1) + ' ' + Y(v).toFixed(1));
    prev = v;
  });
  d.push('L ' + X(g.todayIdx).toFixed(1) + ' ' + Y(prev).toFixed(1));
  svg.appendChild(svgEl('path', { d: d.concat(['L ' + X(g.todayIdx).toFixed(1) + ' ' + Y(0).toFixed(1), 'Z']).join(' '),
    fill: 'var(--positive)', 'fill-opacity': .12 }));

  svg.appendChild(svgEl('line', { x1: PL, y1: Y(0), x2: PL + PW, y2: Y(0), stroke: 'var(--border-strong)', 'stroke-width': 1 }));
  if (need > 0){
    svg.appendChild(svgEl('line', { x1: PL, y1: Y(need), x2: PL + PW, y2: Y(need),
      stroke: 'var(--warning)', 'stroke-width': 1.2, 'stroke-dasharray': '5 4' }));
    fcText(svg, PL + PW, Y(need) - 6, 'условие ' + money0(g.need),
      { anchor: 'end', size: 10, weight: 600, fill: 'var(--warning)' });
  }
  svg.appendChild(svgEl('path', { d: d.join(' '), fill: 'none', stroke: 'var(--positive)',
    'stroke-width': 2, 'stroke-linejoin': 'round' }));

  var hit = fcGraceHit();
  if (hit){
    var cum = 0;
    for (var i = 0; i < g.ops.length; i++){ cum += Number(g.ops[i].sum) / 100; if (g.ops[i] === hit) break; }
    svg.appendChild(svgEl('circle', { cx: X(hit.day), cy: Y(cum), r: 3.4, fill: 'var(--positive)' }));
  }
  svg.appendChild(svgEl('line', { x1: X(g.todayIdx), y1: PT, x2: X(g.todayIdx), y2: PT + PH,
    stroke: 'var(--border-strong)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
  fcText(svg, X(g.todayIdx), PT - 5, money0(g.paid),
    { anchor: g.todayIdx / len < 0.15 ? 'start' : 'end', size: 11, weight: 600, fill: 'var(--positive)' });

  var short = function(iso){ return Number(iso.slice(8, 10)) + NBSP + MON_SHORT[Number(iso.slice(5, 7)) - 1]; };
  fcText(svg, PL, H - 6, short(g.start), { anchor: 'start' });
  /* «сегодня» не подписываем у самых краёв — там уже стоят даты цикла. */
  if (g.todayIdx / len > 0.15 && g.todayIdx / len < 0.85){
    fcText(svg, X(g.todayIdx), H - 6, 'сегодня', { anchor: 'middle', size: 10, font: FONT_SANS });
  }
  fcText(svg, PL + PW, H - 6, short(g.due), { anchor: 'end' });
}

/* ============================================================
   СБОРКА ЭКРАНА
   ============================================================ */
function drawForecast(){
  if (!FC || FC.empty || FC.error) return;
  redrawForecastWidth();
  fcLoanBase();
  fcApplyWhatIf(fcExtra, false);
  if (document.fonts && document.fonts.status !== 'loaded' && document.fonts.ready){
    document.fonts.ready.then(function(){ if (current === 'forecast') redrawForecastWidth(); });
  }
}
/* Все графики экрана зависят от фактической ширины колонки. */
function redrawForecastWidth(){
  if (!FC || FC.empty || FC.error) return;
  fcRenderScen();
  fcRenderMonth();
  fcRenderLoan();
  fcRenderGrace();
}
