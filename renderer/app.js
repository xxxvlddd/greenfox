'use strict';
/* ============================================================
   СБОРКА ОКНА
   ============================================================ */
/* Значки меню перенесены из макета без изменений. */
var ICONS = {
  overview: '<rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/><rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/><rect x="10" y="10" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.4"/>',
  expenses: '<path d="M3 14V9M7 14V6M11 14V10.5M15 14V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  capital:  '<circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 5.2v7.6M7.1 7.1h3.5M7.1 10.9h3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  forecast: '<path d="M2 13.5 6.5 9l3 2.5L16 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 8.2V4.5h-3.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  plans:    '<rect x="2" y="3" width="4.5" height="4.5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="10.5" width="4.5" height="4.5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M9.5 5.2H16M9.5 12.8H16" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  calendar: '<rect x="2" y="3.5" width="14" height="12.5" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M2 7.4h14" stroke="currentColor" stroke-width="1.4"/><path d="M6 2v3M12 2v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  payments: '<circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 5.4V9l2.6 1.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
};
var SCREENS = [
  { id:'overview', name:'Обзор', ready:true },
  { id:'expenses', name:'Расходы', ready:true,
    sub:'Детальный разбор трат за период' },
  { id:'capital',  name:'Капитал и долги', ready:true },
  { id:'forecast', name:'Прогнозы', ready:true },
  { id:'plans',    name:'Планы', ready:true },
  { id:'calendar', name:'Календарь', ready:true },
  { id:'payments', name:'Обязательные платежи', ready:true,
    title:'Обязательные и повторяющиеся платежи' }
];
var current = 'overview';

function renderNav(counts){
  var c = counts || {};
  document.getElementById('nav').innerHTML = SCREENS.map(function(s){
    /* Счётчик показывает то же, что и на экране: у «Обзора» — сколько
       предупреждений, у «Капитала» — сколько счетов разошлись с банком
       или давно не сверялись. */
    var n = s.id === 'overview' ? c.overview : (s.id === 'capital' ? c.capital : 0);
    var badge = n ? '<span class="nav-count' + (s.id === 'capital' ? ' is-warn' : '') + '">' + n + '</span>' : '';
    return '<button type="button" class="nav-item' + (s.id === current ? ' is-active' : '') +
      '" data-screen="' + s.id + '"' + (s.ready ? '' : ' disabled') + '>' +
      '<span class="ic"><svg width="18" height="18" viewBox="0 0 18 18" fill="none">' +
        ICONS[s.id] + '</svg></span>' + s.name + badge + '</button>';
  }).join('');
}

/* Кнопки, за которыми экрана пока нет, честно об этом говорят, а не
   молчат в ответ на нажатие. */
var toastTimer = null;
function toast(text){
  var t = document.getElementById('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.hidden = true; }, 2600);
}

/* Графики рисуются после того, как разметка оказалась в документе:
   им нужна фактическая ширина колонки, а не предполагаемая. */
function drawCharts(){
  if (!DATA) return;
  drawRunway();
  drawBars();
  drawUpcoming();
}

/* Шапка принадлежит окну, а не экрану, поэтому заголовок меняем здесь. */
function headFor(id){
  for (var i = 0; i < SCREENS.length; i++) if (SCREENS[i].id === id) return SCREENS[i];
  return SCREENS[0];
}

/* Номер отрисовки: пока считался один экран, человек мог уйти на
   другой — запоздавший ответ прежнего экрана не рисуется. */
var drawSeq = 0;
/* Заглушка загрузки — по макету состояний: только если пересчёт дольше
   0,3 секунды, без мерцания; шапка и меню всё это время работают. */
var SKELETON = '<div class="skel" aria-busy="true" aria-label="Экран считается">' +
  '<div class="sk sk-line" style="width:220px"></div><div class="sk sk-line" style="width:140px;height:9px"></div>' +
  '<div class="sk-row"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>' +
  '<div class="sk sk-wide"></div></div>';
async function draw(){
  var seq = ++drawSeq;
  renderNav(DATA ? DATA.navCounts : null);
  var host = document.getElementById('screen');
  var load = function(p){
    var t = setTimeout(function(){ if (seq === drawSeq) host.innerHTML = SKELETON; }, 300);
    return Promise.resolve(p).then(function(v){ clearTimeout(t); return v; }, function(e){ clearTimeout(t); throw e; });
  };
  var gone = function(){ return seq !== drawSeq; };
  var scr = current === 'settings' ? { name: 'Настройки' } : headFor(current);
  /* Заголовок шапки бывает длиннее пункта меню — как в макете платежей. */
  document.getElementById('headTitle').textContent = scr.title || scr.name;
  /* У «Настроек» в шапке по макету только переключатель темы, а кнопка
     настроек в подвале меню отмечена как открытая. */
  var onSettings = current === 'settings';
  document.querySelector('.sb-user').setAttribute('aria-current', onSettings ? 'page' : 'false');
  /* Ассистента в шапке календаря по макету нет. */
  document.getElementById('asstWrap').hidden = onSettings || current === 'calendar';
  document.querySelector('.head .dd-wrap').hidden = onSettings;
  var extra = document.getElementById('headExtra');
  extra.hidden = true; extra.innerHTML = '';
  /* Главная кнопка шапки называет то, что добавляют на этом экране:
     на «Планах» — позицию, на остальных — операцию. */
  var primary = current === 'plans' ? 'Добавить позицию'
              : current === 'payments' ? 'Добавить платёж' : 'Добавить операцию';
  /* Переключатели «Календаря» стоят в шапке окна, вне экрана: шапка на
     это время получает область экрана, иначе их оформление до неё не
     дойдёт. Ассистента в шапке календаря по макету нет. */
  document.querySelector('.head').classList.toggle('scr-calendar', current === 'calendar');
  document.querySelector('.head').classList.toggle('scr-payments', current === 'payments');
  if (onSettings){
    var sd = await load(window.api.settings());
    if (gone()) return;
    host.innerHTML = renderSettings(sd);
    document.getElementById('headSub').textContent = sd.error ? '—' : sgSecName(sgSec);
    booted = true;
    return;
  }
  document.getElementById('headPrimaryText').textContent = primary;
  if (current === 'expenses'){
    var ed = await load(window.api.expenses({ unit: exUnit, offset: exOffset, custom: exCustom }));
    if (gone()) return;
    host.innerHTML = renderExpenses(ed);
    cmMount('expenses');
    document.getElementById('headSub').textContent = scr.sub;
    drawExpenses();
    booted = true;
    return;
  }
  if (current === 'capital'){
    var cd = await load(window.api.capital());
    if (gone()) return;
    host.innerHTML = renderCapital(cd);
    document.getElementById('headSub').textContent = cd.headLabel || '—';
    drawCapital();
    booted = true;
    return;
  }
  if (current === 'forecast'){
    var fd = await load(window.api.forecast());
    if (gone()) return;
    host.innerHTML = renderForecast(fd);
    cmMount('forecast');
    document.getElementById('headSub').textContent = fd.headLabel || '—';
    if (!fd.empty && !fd.error){ extra.innerHTML = FC_HEAD_BADGE; extra.hidden = false; }
    drawForecast();
    booted = true;
    return;
  }
  if (current === 'plans'){
    var pd = await load(window.api.plans());
    if (gone()) return;
    host.innerHTML = renderPlans(pd);
    cmMount('plans');
    document.getElementById('headSub').textContent = pd.empty || pd.error ? '—' : plHeadLabel(pd);
    drawPlans();
    booted = true;
    return;
  }
  if (current === 'calendar'){
    var cld = await load(window.api.calendar(clMonth));
    if (gone()) return;
    host.innerHTML = renderCalendar(cld);
    document.getElementById('headSub').textContent = cld.headLabel || '—';
    if (!cld.empty && !cld.error){ extra.innerHTML = clHeadControls(); extra.hidden = false; }
    drawCalendar();
    booted = true;
    return;
  }
  if (current === 'payments'){
    var pmd = await load(window.api.payments());
    if (gone()) return;
    host.innerHTML = renderPayments(pmd);
    document.getElementById('headSub').textContent = pmd.headLabel || '—';
    if (!pmd.empty && !pmd.error){ extra.innerHTML = pmHeadControls(); extra.hidden = false; }
    drawPayments();
    booted = true;
    return;
  }
  if (current !== 'overview'){
    host.innerHTML = stateHTML('', 'Экран ещё не собран',
      'Он есть в макетах, но на живые данные пока не переведён.');
    return;
  }
  var d = await load(window.api.overview());
  if (gone()) return;
  DATA = d;
  renderNav(d.navCounts);
  host.innerHTML = renderOverview(d);
  if (!d.empty && !d.error) cmMount('overview');
  if (!d.empty && !d.error) drawCharts();

  document.getElementById('headSub').textContent = d.empty || d.error ? '—' : d.todayLabel;
  var st = document.getElementById('sbStatus');
  if (d.problems && d.problems.length){
    st.innerHTML = '<span class="sb-dot" style="background:var(--danger)"></span> Сверка не сошлась';
  } else if (d.warnings && d.warnings.length){
    st.innerHTML = '<span class="sb-dot"></span> Есть предупреждение';
  } else if (d.staleRecon){
    st.innerHTML = '<span class="sb-dot"></span> Требуется сверка';
  } else {
    st.innerHTML = '<span class="sb-dot" style="background:var(--positive)"></span> Учёт сходится';
  }

  /* Экран собран — дальше изменения происходят по воле человека,
     и движение получает право говорить. */
  booted = true;
}

/* ---------- переключатели внутри экрана ---------- */
/* Выпадающие панели «Расходов»: выбор периода и фильтры списка.
   Разбираются первыми — клик внутри панели не должен доходить до
   остальных обработчиков и закрывать её. */
function closePops(except){
  var all = document.querySelectorAll('.scr-expenses .pop');
  for (var i = 0; i < all.length; i++) if (all[i] !== except) all[i].hidden = true;
}
function toggleList(list, value){
  var i = list.indexOf(value);
  if (i < 0) list.push(value); else list.splice(i, 1);
  return list;
}

document.addEventListener('click', function(e){
  var t = e.target.closest ? e.target : null;
  if (!t) return;
  /* Окна ввода разбирают свои нажатия сами. */
  if (t.closest('#fmLayer')) return;

  /* ---------- «Настройки» и переходы из них ---------- */
  if (current === 'settings' && sgClick(t)) return;
  var go = t.closest('[data-goto]');
  if (go){ goTo(go.getAttribute('data-goto')); return; }
  if (t.closest('#asstGo')){ sgSec = 'asst'; goTo('settings'); return; }
  if (t.closest('#headAssistant')){ openAssistant(); return; }

  /* ---------- меню «Добавить» и кнопки, открывающие окна ---------- */
  if (t.closest('#headPrimary')){ fmMenuToggle(); return; }
  var openItem = t.closest('#addMenu [data-open]');
  if (openItem){ fmOpen(openItem.getAttribute('data-open')); return; }
  if (!t.closest('#addMenu')) fmMenu(false);
  /* Ошибка расчёта на экране — проверка целостности данных. */
  if (t.closest('[data-state-act="integrity"]')){ sgIntegrity(); return; }
  var formBtn = t.closest('[data-form]');
  if (formBtn){ fmFromButton(formBtn); return; }
  var actBtn = t.closest('[data-act]');
  if (actBtn){ fmAct(actBtn); return; }
  var noteBtn = t.closest('[data-note]:not([data-form])');
  if (noteBtn){ toast(noteBtn.getAttribute('data-note')); return; }

  /* ---------- панели и фильтры «Расходов» ---------- */
  var clear = t.closest('[data-clear]');
  if (clear){
    var ck = clear.getAttribute('data-clear');
    if (ck === 'sum'){
      exFlt.min = exFlt.max = null;
      var mn = document.getElementById('exMin'), mx = document.getElementById('exMax');
      if (mn) mn.value = ''; if (mx) mx.value = '';
    } else { exFlt[ck] = []; }
    exRenderOps();
    return;
  }
  var popBtn = t.closest('[data-pop]');
  if (popBtn){
    /* Панель ищется соседкой по обёртке, а не по собранному из имени
       идентификатору: на этом уже разъехался регистр букв. */
    var host = popBtn.closest('.pop-host');
    var pop = host && host.querySelector('.pop');
    var open = pop && pop.hidden;
    closePops(pop);
    if (pop) pop.hidden = !open;
    return;
  }
  if (t.closest('[data-pop-close]')){ closePops(); return; }
  var opt = t.closest('.pop-opt');
  if (opt){
    toggleList(exFlt[opt.getAttribute('data-opt')], opt.getAttribute('data-val'));
    exRenderOps();
    return;
  }
  var dirChip = t.closest('[data-dir]');
  if (dirChip){
    toggleList(exFlt.dirs, dirChip.getAttribute('data-dir'));
    exRenderOps();
    return;
  }
  var preset = t.closest('[data-preset]');
  if (preset){
    var pair = EX_PRESETS[Number(preset.getAttribute('data-preset'))][1](EXP.today);
    exCustom = { from: pair[0], to: pair[1] };
    exUnit = 'custom'; exOffset = 0;
    closePops();
    draw();
    return;
  }
  if (t.closest('#exRangeApply')){
    var a = exParseDate(document.getElementById('exFrom').value);
    var b = exParseDate(document.getElementById('exTo').value);
    if (!a || !b) { toast('Дата не понята — ждём 01.09.2026'); return; }
    if (a > b) { var sw = a; a = b; b = sw; }   /* даты наоборот — молча меняем местами */
    exCustom = { from: a, to: b };
    exUnit = 'custom'; exOffset = 0;
    closePops();
    draw();
    return;
  }
  if (!t.closest('.pop')) closePops();

  var soon = t.closest('[data-soon]');
  if (soon){ toast(soon.getAttribute('data-soon') + ' — экран ещё не собран'); return; }

  var nav = t.closest('[data-screen]');
  if (nav && !nav.disabled){
    goTo(nav.getAttribute('data-screen'));
    return;
  }

  /* ---------- «Обязательные платежи» ---------- */
  var pmScopeBtn = t.closest('#pmScopeSeg button');
  if (pmScopeBtn){
    pmScope = pmScopeBtn.getAttribute('data-scope');
    setActive('#pmScopeSeg', pmScopeBtn);
    pmRenderGroups();
    return;
  }
  var pmGrp = t.closest('.scr-payments .grp-head');
  if (pmGrp){ pmToggleGroup(pmGrp.parentNode); return; }
  if (t.closest('#pmToggleAll')){
    var anyOpen = PM.groups.some(function(g){ return pmOpen[g.id] && pmVisible(g.id).length; });
    PM.groups.forEach(function(g){ pmOpen[g.id] = !anyOpen; });
    pmRenderGroups();
    return;
  }
  var pmQ = t.closest('.scr-payments [data-q]');
  if (pmQ){ pmResolve(pmQ.getAttribute('data-q')); return; }

  /* ---------- «Календарь» ---------- */
  var clMon = t.closest('#clPrev, #clNext');
  if (clMon){
    if (clMon.disabled) return;
    var mm = CL.month + (clMon.id === 'clPrev' ? -1 : 1);
    clMonth = { year: CL.year + Math.floor(mm / 12), month: (mm % 12 + 12) % 12 };
    clSel = null;
    draw();
    return;
  }
  var clModeBtn = t.closest('#clModeSeg button');
  if (clModeBtn){
    clMode = clModeBtn.getAttribute('data-mode');
    setActive('#clModeSeg', clModeBtn);
    clRenderGrid();
    return;
  }
  var clCell = t.closest('.scr-calendar .cal-day[data-key]');
  if (clCell){ clSelect(clCell.getAttribute('data-key'), true); return; }

  /* ---------- «Планы» ---------- */
  var plTag = t.closest('.scr-plans .tsw button');
  if (plTag){
    var sw = plTag.parentNode;
    plSetTag(Number(sw.getAttribute('data-id')), sw.getAttribute('data-axis'), plTag.getAttribute('data-val'));
    return;
  }
  var plSortBtn = t.closest('#plSortSeg button');
  if (plSortBtn){
    plSort = plSortBtn.getAttribute('data-sort');
    setActive('#plSortSeg', plSortBtn);
    plRenderQueue(); plRenderTry(); plRecalc();
    return;
  }
  var plSrcBtn = t.closest('#plSrcSeg button');
  if (plSrcBtn){
    plSrc = plSrcBtn.getAttribute('data-src');
    setActive('#plSrcSeg', plSrcBtn);
    /* Из копилки платить — дни до нуля не меняются, значит и подписи на
       кнопках примерочной должны пересчитаться, а не только итог. */
    plRenderTry(); plRecalc();
    return;
  }
  if (t.closest('#plImpAll')){
    var allOn = PL.queue.every(function(p){ return plChecked[p.id]; });
    PL.queue.forEach(function(p){ plChecked[p.id] = !allOn; });
    plRenderTry(); plRecalc();
    return;
  }
  var tryBtn = t.closest('.scr-plans .try-btn');
  if (tryBtn){
    var tid = Number(tryBtn.getAttribute('data-id'));
    plChecked[tid] = !plChecked[tid];
    tryBtn.classList.toggle('is-on', !!plChecked[tid]);
    tryBtn.setAttribute('aria-pressed', plChecked[tid] ? 'true' : 'false');
    var every = PL.queue.every(function(p){ return plChecked[p.id]; });
    document.getElementById('plImpAll').textContent = every ? 'Снять все' : 'Отметить все';
    plRecalc();
    return;
  }

  /* ---------- «Прогнозы» ---------- */
  var fcCard = t.closest('#fcScen .scn');
  if (fcCard){ fcPinScen(fcCard.getAttribute('data-scen')); return; }
  var fcSeg = t.closest('#fcExtraSeg button');
  if (fcSeg){
    var ev = Number(fcSeg.getAttribute('data-extra'));
    document.getElementById('fcExtra').value = ev;
    fcSetExtraSeg(ev);
    fcApplyWhatIf(ev, true);
    return;
  }
  var fcGt = t.closest('#fcGraceToggle');
  if (fcGt){
    var box = document.getElementById('fcGraceOps');
    var isOpen = box.classList.toggle('is-open');
    fcGt.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    fcGt.textContent = nOps(FC.grace.ops.length) + ' · ' + (isOpen ? 'свернуть' : 'показать');
    /* Список раскрыли — строки выходят по очереди. */
    if (isOpen) stagger(box, '.gr-op');
    return;
  }

  /* ---------- «Капитал и долги» ---------- */
  var cpSeg = t.closest('#cpSegMode button');
  if (cpSeg){
    cpMode = cpSeg.getAttribute('data-mode');
    setActive('#cpSegMode', cpSeg);
    cpRenderMain(true);
    return;
  }
  var cpHist = t.closest('#cpHistToggle');
  if (cpHist){
    var hp = document.getElementById('cpHist');
    var opening = hp.hidden;
    hp.hidden = !opening;
    cpHist.textContent = opening ? 'Скрыть' : 'Показать';
    /* Историю раскрыли — строки выходят по очереди. */
    if (opening) stagger(hp.querySelector('tbody'), 'tr');
    return;
  }

  /* ---------- «Расходы» ---------- */
  var exStep = t.closest('#exPrev, #exNext');
  if (exStep){
    if (exStep.disabled) return;
    exOffset += (exStep.id === 'exPrev' ? -1 : 1);
    if (exOffset > 0) exOffset = 0;
    draw();
    return;
  }
  var exUnitBtn = t.closest('#exSegPeriod button[data-unit]');
  if (exUnitBtn){
    exUnit = exUnitBtn.getAttribute('data-unit');
    exCustom = null;
    /* Сменили единицу — возвращаемся к текущему периоду: «прошлый
       месяц» и «прошлый год» отсчитываются от разного. */
    exOffset = 0;
    draw();
    return;
  }
  var exCat = t.closest('#exSegCatType button');
  if (exCat){
    exCatFilter = exCat.getAttribute('data-type') || null;
    setActive('#exSegCatType', exCat);
    exRenderCats();
    /* Список пересобрался по фильтру — строки выходят по очереди. */
    stagger(document.querySelector('#exCatTable tbody'), 'tr');
    return;
  }
  var exDaysBtn = t.closest('#exSegDays button');
  if (exDaysBtn){
    exBarsDays = parseInt(exDaysBtn.getAttribute('data-days'), 10) || 0;
    setActive('#exSegDays', exDaysBtn);
    exRenderDaily();
    appear(document.getElementById('exBarsHost'));
    return;
  }
  var exAvg = t.closest('#exAvgToggle');
  if (exAvg){
    exAvgFull = !exAvgFull;
    /* Убрали разовые траты — средний день пересчитался. Докрутка
       показывает размер скидки, а не подменяет число молча. */
    var avgEl = document.getElementById('exAvgVal');
    countUp(avgEl, rub(exAvgFull ? EXP.avgDay : EXP.avgDayNet),
            function(v){ return fmtK(v) + '\u00A0₽'; });
    bump(avgEl);
    document.getElementById('exAvgNote').textContent = exAvgFull
      ? nDays(EXP.trackedDays) + ' с учётом, ' + nDays(EXP.daysWithOps) + ' с операциями'
      : 'Без ' + nOps(EXP.oneOff.count) + ' дороже ' + money(EXP.oneOff.from, 0);
    exAvg.textContent = exAvgFull ? 'Без разовых трат' : 'Со всеми тратами';
    return;
  }
  var exOps = t.closest('#exOpsToggle');
  if (exOps){
    var panel = document.getElementById('exOpsPanel');
    var hidden = panel.hidden;
    panel.hidden = !hidden;
    exOps.textContent = hidden ? 'Свернуть' : 'Развернуть';
    /* Список раскрыли — первые строки выходят по очереди. */
    if (hidden) stagger(document.getElementById('exOpsBody'), 'tr');
    return;
  }

  /* Свернуть и развернуть список счетов */
  var accT = t.closest('#accToggle');
  if (accT){
    var open = accT.getAttribute('aria-expanded') === 'true';
    accT.setAttribute('aria-expanded', open ? 'false' : 'true');
    var list = document.getElementById('accList');
    list.classList.toggle('is-open', !open);
    /* Раскрыли список счетов — строки выходят по очереди. */
    if (!open) stagger(list, '.acc-item');
    document.getElementById('accToggleText').textContent = open
      ? nAcc(DATA.accounts.filter(function(a){ return a.isPayment; }).length)
      : 'Скрыть счета';
    return;
  }
  /* Закрыть предупреждение */
  var ax = t.closest('.alert .x');
  if (ax){
    ax.closest('.alert').remove();
    var box = document.getElementById('alerts');
    if (box && !box.querySelector('.alert')) box.remove();
    return;
  }

  /* Горизонт прогноза */
  var seg = t.closest('#segRunway button');
  if (seg){
    horizonDays = parseInt(seg.getAttribute('data-days'), 10);
    setActive('#segRunway', seg);
    drawRunway();
    /* Сменили горизонт — на том же месте другой график. Без появления
       подмена читается как мигание одной и той же картинки. */
    appear(document.getElementById('runwayWrap'));
    return;
  }
  /* Период столбцов */
  var seg2 = t.closest('#segDays button');
  if (seg2){
    barsDays = parseInt(seg2.getAttribute('data-days'), 10);
    setActive('#segDays', seg2);
    drawBars();
    appear(document.getElementById('barsHost'));
    return;
  }
  /* Сценарий на легенде. Последнюю включённую линию гасить не даём —
     иначе график остаётся пустым и непонятно, что произошло. */
  var lg = t.closest('.legend-btn');
  if (lg){
    var key = lg.getAttribute('data-sc');
    var on = 0;
    for (var k in activeScenarios) if (activeScenarios[k]) on++;
    if (activeScenarios[key] && on === 1) return;
    activeScenarios[key] = !activeScenarios[key];
    drawRunway();
    return;
  }
});
/* Поиск по списку операций. Пока человек печатает, числа не
   докручиваются — на каждое нажатие клавиши это была бы рябь. */
document.addEventListener('input', function(e){
  if (!e.target) return;
  if (current === 'settings' && e.target.closest && e.target.closest('#sgBody') && sgInput(e.target)) return;
  if (e.target.id === 'exOpsSearch'){ exSearch = e.target.value; exRenderOps(); return; }
  /* Точки в дате расставляются сами: набирать их руками утомительно. */
  if (e.target.id === 'exFrom' || e.target.id === 'exTo'){
    var raw = e.target.value.replace(/\D/g, '').slice(0, 8);
    var out = raw.slice(0, 2);
    if (raw.length > 2) out += '.' + raw.slice(2, 4);
    if (raw.length > 4) out += '.' + raw.slice(4, 8);
    if (out !== e.target.value) e.target.value = out;
    return;
  }
  if (e.target.id === 'clNote'){ clNoteInput(e.target); return; }
  /* Доплата по кредиту пересчитывается на каждый знак, без появления:
     иначе строка выигрыша мигала бы при наборе. */
  if (e.target.id === 'fcExtra'){
    var xv = Math.max(0, Number(e.target.value) || 0);
    fcSetExtraSeg(xv);
    fcApplyWhatIf(xv, false);
    return;
  }
  /* Границы суммы применяются сразу: пустое поле значит «без предела». */
  if (e.target.id === 'exMin' || e.target.id === 'exMax'){
    var v = e.target.value === '' ? null : Number(e.target.value);
    exFlt[e.target.id === 'exMin' ? 'min' : 'max'] = (v === null || isNaN(v)) ? null : v;
    exRenderOps();
  }
});

/* Поля «Настроек» сохраняются, когда из них уходят или нажимают Enter. */
document.addEventListener('change', function(e){
  if (current === 'settings' && e.target && e.target.closest && e.target.closest('#sgBody')) sgChange(e.target);
});
document.addEventListener('keydown', function(e){
  if (current === 'settings' && !fmKind && sgKeydown(e)) return;
});
/* Порядок счетов — перетаскиванием за ручку. */
document.addEventListener('pointerdown', function(e){
  var grip = current === 'settings' && e.button === 0 && e.target.closest ? e.target.closest('#sgAccList [data-grip]') : null;
  if (grip) sgDragStart(e, grip);
});

/* Календарь: стрелки ходят по дням. Пока человек печатает заметку,
   стрелки принадлежат тексту. */
document.addEventListener('keydown', function(e){
  if (current !== 'calendar' || !CL || CL.empty || CL.error) return;
  /* Открыто окно или меню — стрелки принадлежат им. */
  if (fmKind || fmMenuOpen()) return;
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (step === undefined) return;
  if (clStep(step)) e.preventDefault();
});

function setActive(sel, btn){
  var all = document.querySelectorAll(sel + ' button');
  for (var i = 0; i < all.length; i++) all[i].classList.remove('is-active');
  btn.classList.add('is-active');
}

/* Графики рисуются в реальных пикселях, поэтому при изменении размера
   окна их надо пересчитать, а не растянуть. */
var resizeTimer = null;
window.addEventListener('resize', function(){
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function(){
    if (current === 'overview' && DATA) drawCharts();
    if (current === 'expenses') redrawExpensesWidth();
    if (current === 'capital') redrawCapitalWidth();
    if (current === 'forecast') redrawForecastWidth();
    if (current === 'payments') redrawPaymentsWidth();
  }, 120);
});

document.getElementById('themeToggle').addEventListener('click', function(){
  var root = document.documentElement;
  var dark = root.getAttribute('data-theme') === 'dark' ||
    (!root.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', dark ? 'light' : 'dark');
  /* Выбор темы запоминается — как в «Настройках». */
  window.api.setPref('ui.theme', dark ? 'light' : 'dark').then(function(){
    if (current === 'settings' && sgSec === 'general') sgReload(false);
  });
  /* Заливки под линиями берут цвет токена на момент отрисовки, поэтому
     после смены темы график перерисовывается, а не перекрашивается. */
  if (current === 'overview' && DATA) drawCharts();
  /* Плитки «Структуры» красятся значением токена на момент отрисовки,
     а цвет подписи считается по контрасту с ним — после смены темы
     их надо пересчитать, а не перекрасить. */
  if (current === 'expenses') drawExpenses();
});

/* ---------- переходы, тема, плотность, ассистент ---------- */
function goTo(screen){
  /* Другой экран открывается с начала, а не с середины прежнего. */
  if (screen !== current) window.scrollTo(0, 0);
  current = screen;
  return draw();
}
/* Тема и плотность — из настроек, до первой отрисовки: иначе экран
   мигнул бы светлым перед тёмным. */
function applyPrefs(p){
  var root = document.documentElement;
  if (p['ui.theme'] === 'light' || p['ui.theme'] === 'dark') root.setAttribute('data-theme', p['ui.theme']);
  else root.removeAttribute('data-theme');
  root.setAttribute('data-density', p['ui.density'] === 'dense' ? 'dense' : 'normal');
}
/* Без ключа кнопка ассистента неактивна: при наведении — подсказка, что
   ключ добавляется в настройках, и кнопка перехода. */
var hasAiKey = false;
function refreshAssistant(){
  return window.api.prefs().then(function(p){
    hasAiKey = !!(p && p.hasKey);
    var wrap = document.getElementById('asstWrap'), btn = document.getElementById('headAssistant');
    wrap.classList.toggle('is-off', !hasAiKey);
    btn.setAttribute('aria-disabled', hasAiKey ? 'false' : 'true');
    /* Готов авто-отчёт — точка на кнопке, пока панель не открыта. */
    btn.classList.toggle('has-news', hasAiKey && p.reportsUnread > 0);
  });
}
var asstHintTimer = null;
function openAssistant(){
  if (!hasAiKey){
    var wrap = document.getElementById('asstWrap');
    wrap.classList.add('is-hint');
    clearTimeout(asstHintTimer);
    asstHintTimer = setTimeout(function(){ wrap.classList.remove('is-hint'); }, 4000);
    return;
  }
  asToggle(!asIsOpen);
}
document.addEventListener('keydown', function(e){
  if (obIsOpen) return;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.code === 'KeyJ' || /^[jо]$/i.test(e.key || ''))){
    e.preventDefault();
    openAssistant();
  }
});

fmInit();
asInit();
cmInit();
updInit();
/* Пришли новые курсы ЦБ — валютные счета в рублях стали другими:
   перерисовываем открытый экран. Поверх открытого окна ввода или мастера —
   не трогаем: перерисует сохранение. */
window.api.onFx(function(){
  if ((typeof obIsOpen !== 'undefined' && obIsOpen) || fmKind) return;
  if (current === 'settings' && typeof sgReload === 'function') sgReload(false); else draw();
});
keysInit();
obInit();
spStart();
window.api.appInfo().then(function(i){
  /* Песочница видна сразу: здесь не настоящий учёт. */
  document.getElementById('sbVersion').textContent = (i.sandbox ? 'песочница · ' + i.sandbox + ' · ' : '') + 'версия ' + i.version;
  document.getElementById('sbVersion').classList.toggle('is-sandbox', !!i.sandbox);
  if (i.sandbox) document.title = 'GREENFOX — песочница';
});
window.api.prefs().then(function(p){
  if (p && !p.error){
    applyPrefs(p);
    if (p['ui.startScreen']) current = p['ui.startScreen'];
  }
  refreshAssistant();
  /* Первый запуск на чистой базе — мастер настройки поверх всего окна.
     Экран под ним в это время не рисуется: работа за кадром отнимала
     кадры у приветствия. «Обзор» нарисуется, когда мастер закроют. */
  window.api.onboardState().then(function(s){
    /* Чистая база — у мастера своё приветствие, заставка не нужна. */
    if (s && !s.error && s.auto){ spRemove(); obOpen(s); return; }
    /* Комментарии — до первой отрисовки: блок встаёт сразу, без сдвига.
       Экран нарисован — заставка собирает знак и уходит. */
    window.api.comments().then(function(c){ if (c && !c.error) CM = c; }, function(){}).then(draw).then(spReady, spReady);
  }, function(){ Promise.resolve(draw()).then(spReady, spReady); });
});
