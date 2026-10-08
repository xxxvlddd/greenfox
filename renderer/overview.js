'use strict';
/* ============================================================
   ЭКРАН «ОБЗОР»
   ============================================================
   Разметка повторяет макет 01-obzor.html блок в блок. Ни одного
   числа здесь нет: всё приходит из базы через мост.
   Порядок блоков — как в макете: предупреждения, доступно на счетах,
   ряд метрик, графики, ближайшие две недели.
   ============================================================ */
function renderOverview(d){
  if (d.error) return stateHTML('is-error', 'Расчёт не удался', d.error);
  if (d.empty) return stateHTML('', 'Здесь пока пусто',
    'Обзор показывает, сколько денег доступно и на сколько их хватит. Он заполнится, когда появятся первые операции.', stAdd(d));
  return alertsHTML(d) + heroHTML(d) + metricsHTML(d) + chartsHTML() + upcomingHTML(d);
}

/* Предупреждения. Разметка макета: точка, жирное начало, кнопка
   «Закрыть» справа. Устаревшие данные — такое же предупреждение, а не
   отдельная плашка своего вида. */
function alertsHTML(d){
  var items = [];
  if (d.staleDays && d.staleDays >= 2){
    items.push(['var(--warning)', 'Данные не свежие.',
      'Последняя запись ' + humanDate(d.lastDay) + ' — ' + nDays(d.staleDays) +
      ' назад. Числа ниже посчитаны так, будто с тех пор вы ничего не тратили']);
  }
  (d.alerts || []).forEach(function(a){
    items.push(['var(--' + a.tone + ')', a.lead, a.text]);
  });
  (d.problems || []).forEach(function(p){
    items.push(['var(--danger)', 'Расчёт разошёлся с подтверждённым остатком.', p]);
  });
  if (!items.length) return '';
  return '<div class="alerts" id="alerts">' + items.map(function(a){
    return '<div class="alert"><span class="d" style="background:' + a[0] + '"></span>' +
      '<p class="tx"><b>' + esc(a[1]) + '</b> ' + esc(a[2]) + '</p>' +
      '<button class="x" aria-label="Закрыть предупреждение">Закрыть</button></div>';
  }).join('') + '</div>';
}

/* ---------- доступно на счетах ---------- */
function heroHTML(d){
  var payment = d.accounts.filter(function(a){ return a.isPayment; });
  var card = d.accounts.filter(function(a){ return a.type === 'кредитная карта'; })[0];

  var side = '';
  if (card){
    var debt = -Number(card.balance);                  /* долг положительным числом, копейки */
    var limit = card.creditLimit === null ? null : Number(card.creditLimit);
    var pct = limit ? Math.max(0, Math.min(100, debt / limit * 100)) : 0;
    side = '<div class="hero-side">' +
      '<div class="k"><span class="lbl">Кредитная карта</span>' +
        '<span class="badge badge--muted">не считается доступным</span></div>' +
      '<div class="credit-name">' + esc(card.bank || card.name) + ' · ' +
        esc(String(card.type).replace(/ карта$/, '')) + '</div>' +
      '<div class="credit-sum num">' + money(card.balance) + '</div>' +
      (limit
        ? '<div class="credit-note">Свободно ' + money(String(limit - debt)) + ' из лимита ' +
            money0(String(limit)) + ' — выбрано ' + pct.toFixed(1).replace('.', ',') + '%</div>' +
          '<div class="credit-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>'
        : '<div class="credit-note">Лимит не задан — долю выбранного посчитать не из чего</div>') +
    '</div>';
  }

  return '<section class="hero"><div class="hero-main">' +
    '<div class="hero-label"><span class="lbl">Доступно на счетах</span>' +
      '<i class="info" title="Только платёжные счета. Не включает копилку, инвестиции, криптокошелёк и свободный лимит кредитной карты">i</i>' +
      (d.reconciledAt ? '<span class="badge badge--recon">сверено ' + humanDate(d.reconciledAt) + '</span>' : '') +
    '</div>' +
    '<div class="hero-sum"><span class="v num">' + moneyBare(d.available) + '</span>' +
      '<span class="c">₽</span></div>' +
    '<p class="hero-note">Без копилки, инвестиций и кредитного лимита · ' +
      'движение по счетам ' + humanDate(d.lastDay) + '</p>' +
    '<button class="acc-toggle" id="accToggle" aria-expanded="false" aria-controls="accList">' +
      '<span id="accToggleText">' + nAcc(payment.length) + '</span>' +
      '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
      '<path d="M2 4.5l4 3 4-3" stroke="currentColor" stroke-width="1.4" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '</button>' +
    '<div class="acc-list" id="accList">' + payment.map(accItem).join('') + '</div>' +
  '</div>' + side + '</section>';
}
/* Валютный счёт — остаток в его валюте, под ним — в рублях по курсу:
   в «Доступно на счетах» он входит рублями. */
function accItem(a){
  var fx = a.cur && a.cur !== 'RUB';
  var neg = String(fx ? a.native : a.balance).charAt(0) === '-';
  return '<div class="acc-item">' +
    '<div class="n">' + esc(a.name) + (a.bank ? ' · ' + esc(a.bank) : '') + ', ' +
      esc(String(a.type).replace(/ карта$/, '')) + '</div>' +
    '<div class="v"><span class="num' + (neg ? ' c-neg' : '') + '">' + (fx ? moneyIn(a.native, a.cur) : money(a.balance)) + '</span>' +
      (fx ? '<span class="acc-fx">≈ ' + money0(a.balance) + '</span>' : '') + '</div>' +
  '</div>';
}

/* ---------- ряд метрик ---------- */
function metricsHTML(d){
  var known = d.dayLimit !== null;
  var limit = known ? rub(d.dayLimit) : null;
  var spentY = rub(d.spentYesterday);
  var spentT = rub(d.spentToday);

  /* Вчерашняя трата сама по себе ничего не говорит — говорит её
     отношение к лимиту. */
  var vsLimit = '';
  if (known && limit > 0){
    if (spentY === 0){
      /* «На 100% ниже лимита» — арифметически верно и читается глупо. */
      vsLimit = 'Трат не было · дневной лимит ' + fmtR(limit) + RUB;
    } else {
      var pct = Math.round(Math.abs(spentY - limit) / limit * 100);
      vsLimit = spentY > limit
        ? '<span class="tri tri--up"></span> на ' + pct + '% выше дневного лимита — ' + fmtR(limit) + RUB
        : '<span class="tri tri--down"></span> на ' + pct + '% ниже дневного лимита — ' + fmtR(limit) + RUB;
    }
  }

  var used = known && limit > 0 ? Math.min(100, spentT / limit * 100) : 0;
  var left = known ? limit - spentT : null;

  /* Темп недели выше лимита втрое — это предупреждение, а не мелочь. */
  var rate7 = rub(d.rate7);
  var warn = '';
  if (known && limit > 0 && rate7 > limit * 1.5){
    warn = '<p class="metric-sub c-warn" style="display:flex;align-items:baseline;gap:7px">' +
      '<span style="width:6px;height:6px;border-radius:50%;background:var(--warning);flex:none"></span>' +
      'Последние 7 дней темп ' + fmtR(rate7) + (RUB + ' в день — в ') +
      (rate7 / limit).toFixed(1).replace('.', ',') + ' раза выше лимита</p>';
  }

  return '<section class="metrics">' +
    /* 1 */
    '<div class="metric">' +
      '<div class="metric-head"><span class="lbl">Потрачено вчера</span>' +
        '<i class="info" title="Сумма расходов за вчера без переводов между своими счетами">i</i>' +
        '<span class="spacer"></span><span class="badge badge--fact">факт</span></div>' +
      '<div class="metric-val num">' + money(d.spentYesterday) + '</div>' +
      '<p class="metric-sub">' + (vsLimit || 'сравнить не с чем — лимит не посчитан') + '</p>' +
      '<div class="metric-foot"><p class="metric-sub">' +
        (d.opsYesterday
          ? nOps(d.opsYesterday) + (d.catsYesterday.length ? ': ' + d.catsYesterday.map(esc).join(', ').toLowerCase() : '')
          : 'операций не было') +
      '</p></div>' +
    '</div>' +
    /* 2 */
    '<div class="metric">' +
      '<div class="metric-head"><span class="lbl">Можно потратить сегодня</span>' +
        '<i class="info" title="Свободные средства ÷ число дней до ближайшего поступления. Свободные = доступно на счетах − обязательные платежи до поступления − неснижаемый резерв">i</i>' +
        '<span class="spacer"></span><span class="badge badge--est">оценка</span></div>' +
      '<div class="metric-val num">' + (known ? money0(d.dayLimit) : '—') + '</div>' +
      '<p class="metric-sub">' + (known
        ? money0(d.free) + ' свободных на ' + nDays(d.limitDays) +
          (d.limitHorizon && d.limitHorizon !== 'income' ? ' — горизонт из настроек' : ' до ' + humanDate(d.nextIncome))
        : 'нет ни одного будущего поступления — делить не на что') + '</p>' +
      '<div class="metric-foot">' +
        '<div class="track"><i style="width:' + used.toFixed(1) + '%"></i></div>' +
        '<p class="metric-sub" style="margin-top:7px">' +
          (d.opsToday
            ? 'Сегодня потрачено ' + money(d.spentToday) + ' · осталось ' +
              (left > 0 ? money0(String(Math.round(left * 100))) : 'лимит выбран')
            : 'Сегодня трат ещё не записано' + (known ? ' · доступно ' + money0(d.dayLimit) : '')) +
        '</p>' +
      '</div>' +
    '</div>' +
    /* 3 */
    '<div class="metric">' +
      '<div class="metric-head"><span class="lbl">Можно потратить завтра</span>' +
        '<i class="info" title="(Свободные средства − фактические траты сегодня) ÷ оставшиеся дни горизонта">i</i>' +
        '<span class="spacer"></span><span class="badge badge--forecast">прогноз</span></div>' +
      '<div class="metric-val num">' + (d.tomorrowLimit !== null ? money0(d.tomorrowLimit) : '—') + '</div>' +
      '<p class="metric-sub">' + (d.tomorrowLimit === null
        ? 'до поступления остался один день или меньше'
        : (d.opsToday
            ? 'С учётом того, что уже потрачено сегодня'
            : 'Выше сегодняшнего, потому что сегодня трат пока нет')) + '</p>' +
      '<div class="metric-foot">' + (warn || '<p class="metric-sub">Темп последних 7 дней — ' +
        fmtR(rate7) + (RUB + ' в день</p>')) + '</div>' +
    '</div>' +
  '</section>';
}

/* ---------- ряд графиков ---------- */
function chartsHTML(){
  return '<section class="charts">' +
    '<div class="chart-pane">' +
      '<div class="sec-head"><div style="min-width:0">' +
        '<div class="title-row"><h2 class="sec-title">На сколько хватит денег</h2>' +
        '<i class="info" title="Прогноз остатка на платёжных счетах при трёх темпах расходования. Зарплата, аренда, кредит и подписки разложены по своим числам на весь горизонт">i</i></div>' +
        '<p class="sec-sub"><span class="badge badge--forecast">прогноз</span> ' +
        'Остаток на платёжных счетах, если не менять поведение</p>' +
      '</div><span class="spacer"></span>' +
      '<div class="pane-tools">' +
        '<div class="seg" id="segRunway">' +
          '<button class="is-active" data-days="30">30д</button>' +
          '<button data-days="60">60д</button>' +
          '<button data-days="90">90д</button>' +
        '</div>' +
        '<div class="legend" id="runwayLegend"></div>' +
      '</div></div>' +
      '<div class="chart-ribbon" id="runwayRibbon"></div>' +
      '<div class="chart-wrap" id="runwayWrap">' +
        '<svg id="runwaySvg" role="img" aria-label="Прогноз остатка на счетах по трём сценариям трат"></svg>' +
      '</div>' +
      '<div class="rates" id="runwayRates"></div>' +
    '</div>' +

    '<div class="chart-pane">' +
      '<div class="sec-head"><div style="min-width:0">' +
        '<div class="title-row"><h2 class="sec-title">Траты по дням</h2>' +
        '<i class="info" title="Сумма расходов за день без переводов между своими счетами">i</i></div>' +
        '<p class="sec-sub"><span class="badge badge--fact">факт</span> <span id="barsPeriod"></span></p>' +
      '</div><span class="spacer"></span>' +
      '<div class="pane-tools"><div class="seg" id="segDays">' +
        '<button class="is-active" data-days="14">14д</button>' +
        '<button data-days="30">30д</button>' +
        '<button data-days="60">60д</button>' +
      '</div></div></div>' +
      '<div id="barsHost"></div>' +
      '<div class="legend legend--under">' +
        '<span class="legend-static"><span class="legend-sq"></span>Будни</span>' +
        '<span class="legend-static"><span class="legend-sq" style="opacity:.32"></span>Выходные</span>' +
        '<span class="legend-static"><span class="legend-sq" style="background:var(--danger);opacity:.8"></span>Самый дорогой день</span>' +
        '<span class="legend-static"><span class="legend-dash"></span>Средний день</span>' +
      '</div>' +
      '<p class="note" id="barsNote"></p>' +
    '</div>' +
  '</section>';
}

/* ---------- ближайшие две недели ---------- */
function upcomingHTML(d){
  return '<section class="tbl-sec">' +
    '<div class="tbl-head"><h2 class="sec-title">Ближайшие ' + nDays(d.tableDays) + '</h2>' +
      '<i class="info" title="Регулярные поступления и обязательные платежи по расписанию">i</i>' +
      '<span class="spacer"></span>' +
      '<span class="sec-sub" style="margin:0">' + humanDate(d.today) + ' — ' +
        humanDate(shiftIso(d.today, d.tableDays)) + ' · ' +
        d.table.length + ' ' + plural(d.table.length, 'событие', 'события', 'событий') + '</span>' +
    '</div>' +
    '<div class="tbl-scroll"><table class="tbl"><thead><tr>' +
      '<th style="width:110px">Дата</th>' +
      '<th>Событие</th>' +
      '<th style="width:220px">Счёт</th>' +
      '<th class="col-sum" style="width:150px">Сумма</th>' +
      '<th class="col-bal" style="width:200px">Остаток после ' +
        '<i class="info" title="Остаток на платёжных счетах после этого события при обычном темпе трат. Та же модель, что на графике «На сколько хватит денег»">i</i>' +
      '</th>' +
    '</tr></thead><tbody id="upcomingBody"></tbody></table></div>' +
    '<div class="tbl-foot" id="upcomingFoot"></div>' +
  '</section>';
}
function shiftIso(iso, days){
  var p = iso.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2] + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
}

/* Пустой экран и ошибка — по макету состояний: что это, почему так и одно
   действие. Ошибка — факт и действие, без извинений: вместо неверного
   числа — проверка целостности. act — [подпись, атрибуты кнопки]. */
var ST_ADD = ['Добавить операцию', 'data-form="expense"'];
/* Пока нет ни одного счёта, операцию записать некуда — сначала счёт. */
function stAdd(d){ return d && d.noAccounts ? ['Добавить счёт', 'data-form="account"'] : ST_ADD; }
var ST_CHECK = ['Проверить целостность данных', 'data-state-act="integrity"'];
function stateHTML(cls, title, text, act){
  if (act === undefined && cls === 'is-error') act = ST_CHECK;
  return '<div class="state ' + cls + '"><h2>' + esc(title) + '</h2><p>' + esc(text) + '</p>' +
    (act ? '<button type="button" class="btn btn-sm btn-sm--acc" ' + act[1] + '>' + esc(act[0]) + '</button>' : '') + '</div>';
}
