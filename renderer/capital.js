'use strict';
/* ============================================================
   ЭКРАН «КАПИТАЛ И ДОЛГИ»
   ============================================================
   Разметка, порядок блоков и графики перенесены из макета
   Main App/screens/03-kapital.html. В макете ряды и списки были
   вписаны руками под 10 сентября — здесь всё приходит из прогона
   операций. Имена начинаются с cp: скрипты окна живут в одной
   области видимости с «Обзором» и «Расходами».
   ============================================================ */
var CAP = null;                 /* данные экрана */
var cpMode = 'nw';              /* режим графика динамики */

var CP_MODES = [['nw', 'Чистый капитал'], ['ad', 'Активы и долги'], ['acc', 'Балансы по счетам']];
var CP_ICON_INFO = '<svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="7.5" cy="7.5" r="6.3"/><path d="M7.5 4.2v4M7.5 10.4h.01" stroke-linecap="round"/></svg>';
/* Числительное словом: в начале фразы цифра читается хуже. */
var CP_NUM_NEUT = ['', 'Одно', 'Два', 'Три', 'Четыре'];
var CP_NUM_MASC = ['', 'Один', 'Два', 'Три', 'Четыре'];

/* ---------- мелкие помощники ---------- */
function cpDdmm(iso){ return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : ''; }
function cpDdmmyyyy(iso){ return iso ? cpDdmm(iso) + '.' + iso.slice(0, 4) : ''; }
/* Знак у изменения обязателен: «+9 408,17 ₽», а не «9 408,17 ₽». */
function cpSigned(cents){ var s = String(cents); return (s.charAt(0) === '-' ? '' : '+') + money(s); }
/* «129к ₽» — подписи осей и маленького графика. */
function cpShort(v){
  var a = Math.abs(v), sign = v < 0 ? '−' : '';
  return sign + (a >= 1000 ? Math.round(a / 1000) + 'к' : Math.round(a)) + RUB;
}
/* Доля строки: до 10% — с одним знаком, дальше целыми. */
function cpPct(part, whole){
  var v = whole ? part / whole * 100 : 0;
  return (v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v)) + '%';
}
function cpOne(v){ return v.toFixed(1).replace('.', ','); }
/* 1450 сотых процента → «14,5%», 1200 → «12%». */
function cpRate(bp){ return (bp / 100).toFixed(2).replace('.', ',').replace(/,?0+$/, '') + '%'; }
/* «через 23 дня», «завтра», «сегодня». */
function cpIn(n){ return n === 0 ? 'сегодня' : n === 1 ? 'завтра' : 'через ' + nDays(n); }
function cpJoin(list){
  return list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' и ' + list[list.length - 1];
}
/* Строчная первая буква, если это не сокращение вроде «БКС». */
function cpLower(s){
  return s && s.charAt(1) !== s.charAt(1).toUpperCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
function cpText(p, x, y, str, o){
  o = o || {};
  var t = svgEl('text', { x: x, y: y, 'text-anchor': o.anchor || 'middle',
    fill: o.fill || 'var(--text-3)', 'font-size': o.size || 10, 'font-family': o.font || FONT_MONO });
  if (o.weight) t.setAttribute('font-weight', o.weight);
  t.textContent = str;
  p.appendChild(t);
  return t;
}
/* grow — подпись под заголовком переносится сама, а не выталкивает
   переключатель справа на следующую строку. В макете подпись была
   короче и помещалась; на настоящих данных она длиннее. */
function cpHead(title, hint, sub, right, grow){
  return '<div class="sec-head"><div style="min-width:0' + (grow ? ';flex:1 1 320px' : '') + '">' +
    '<div class="title-row"><h2 class="sec-title">' + title + '</h2>' +
      (hint ? '<i class="info" title="' + esc(hint) + '">i</i>' : '') + '</div>' +
    (sub || '') +
  '</div>' + (right ? '<span class="spacer"></span>' + right : '') + '</div>';
}
function cpReconBadge(iso){
  return iso ? '<span class="badge badge--recon">сверено ' + cpDdmm(iso) + '</span>'
             : '<span class="badge badge--fact">факт</span>';
}

/* ============================================================
   РАЗМЕТКА
   ============================================================ */
function renderCapital(d){
  CAP = d;
  if (d.error) return stateHTML('is-error', 'Не получилось собрать экран', d.error);
  if (d.empty) return stateHTML('', 'Здесь пока пусто',
    'Капитал появится, как только будет внесена первая операция.', stAdd(d));
  /* Расчёт разошёлся с банком — блок сверки поднимается наверх экрана:
     числа ниже пока нельзя принимать на веру (макет состояний). */
  var off = d.recon && d.recon.offCount > 0;
  return '<div class="scr-capital">' + (off ? cpRecon(d) : '') +
    cpTop(d) + cpDyn(d) + cpLists(d) + cpLiab(d) + (off ? '' : cpRecon(d)) +
  '</div>';
}

/* ---------- чистый капитал и запас прочности ---------- */
function cpTop(d){
  var up = String(d.delta).charAt(0) !== '-';
  var KIND = { 'наличные': 'наличные', 'брокерский': 'инвестиции', 'крипто': 'крипту' };
  var DEBT = { loan: 'кредит', card: 'кредитная карта' };
  var assetsNote = nAcc(d.assetsCount) + (d.assetKinds.length
    ? ', включая ' + cpJoin(d.assetKinds.map(function(k){ return KIND[k]; })) : '');
  var debtsNote = d.debtKinds.length
    ? cpJoin(d.debtKinds.map(function(k){ return DEBT[k]; })) : 'долгов нет';
  return '<section class="grid grid--2" style="border-top:none">' +
    '<div>' +
      cpHead('Чистый капитал',
        'Активы минус долги. Балансы счетов не хранятся, а пересчитываются от стартового снимка ' +
        cpDdmmyyyy(d.firstDay) + ' по всем внесённым операциям', '', cpReconBadge(d.lastRecon)) +
      '<div class="nw-main">' +
        '<div class="nw-left">' +
          '<div class="nw-value" id="cpNw">' + money(d.nw) + '</div>' +
          '<div class="nw-delta">' +
            '<span class="tri tri--' + (up ? 'up' : 'down') + '"></span>' +
            '<span class="v ' + (up ? 'c-pos' : 'c-neg') + '">' + cpSigned(d.delta) + '</span>' +
            '<span>с начала учёта, ' + humanDate(d.firstDay) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="nw-spark">' +
          '<svg id="cpSpark" viewBox="0 0 420 92" width="420" height="92" role="img" ' +
            'aria-label="Динамика чистого капитала с начала учёта"></svg>' +
        '</div>' +
      '</div>' +
      '<div class="nw-parts">' +
        '<div class="nw-part"><div class="k">Активы</div><div class="v">' + money(d.assets) + '</div>' +
          '<div class="s">' + assetsNote + '</div></div>' +
        '<div class="nw-part"><div class="k">Долги</div><div class="v c-neg">' + money(d.debts) + '</div>' +
          '<div class="s">' + debtsNote + '</div></div>' +
      '</div>' +
    '</div>' +
    '<div>' + cpSafety(d.safety) + '</div>' +
  '</section>';
}

/* Запас прочности: ликвидное, делённое на средний расход прошлого
   полного месяца — того же, что показывают «Расходы». */
function cpSafety(s){
  var monthly = rub(s.monthly), liquid = rub(s.liquid);
  var months = monthly > 0 ? liquid / monthly : null;
  var net = rub(s.avgDayNet) * 30;
  var monthsNet = net > 0 ? liquid / net : null;
  setZones(s.zones);
  var mCls = months === null ? '' : (months < ZONES[0] ? 'c-neg' : months < ZONES[1] ? 'c-warn' : 'c-pos');
  var dCls = s.daysLeft === null ? '' : (s.daysLeft < 7 ? 'c-neg' : s.daysLeft < 30 ? 'c-warn' : 'c-pos');

  var note1 = months === null
    ? 'Трат за прошлый месяц нет — оценивать не по чему.'
    : 'При текущем среднем расходе ' + money0(s.monthly) + ' в месяц, если доходов не будет.';
  if (months !== null && s.oneOffCount > 0 && monthsNet !== null){
    var one = s.oneOffCount % 10 === 1 && s.oneOffCount % 100 !== 11;
    note1 += ' ' + s.month.charAt(0).toUpperCase() + s.month.slice(1) + ' искажён ' +
      s.oneOffCount + NBSP + plural(s.oneOffCount, 'крупной покупкой', 'крупными покупками', 'крупными покупками') +
      ' — без ' + (one ? 'неё' : 'них') + ' запаса хватит на ' + cpOne(monthsNet) + NBSP + 'месяца';
  }
  var note2 = 'Без кредитки и без учёта будущих поступлений.';
  if (s.income && s.zeroDate){
    var lag = s.income.lag;
    note2 += ' ' + esc(s.income.name) + ' придёт ' + humanDate(s.income.day) + ' — ' +
      (lag > 0 ? 'на ' + nDays(lag) + ' позже' : lag < 0 ? 'на ' + nDays(-lag) + ' раньше' : 'в тот же день');
  }
  var mark = months === null ? 0 : Math.max(0.5, Math.min(zonePct(months), 99.5));

  return cpHead('Запас прочности',
      'Сколько вы протянете без новых доходов. Считается по ликвидным активам — платёжным счетам и копилке. Кредитный лимит не учитывается',
      '', '<span class="badge badge--est">оценка</span>') +
    '<div class="safety">' +
      '<div class="safety-item">' +
        '<div class="k">Месяцев жизни на сбережениях</div>' +
        '<div class="v"><b class="' + mCls + '" id="cpMonths">' +
          (months === null ? '—' : '≈' + NBSP + cpOne(months) + NBSP + 'мес.') + '</b>' +
          '<span>' + money0(s.liquid) + ' ликвидных</span></div>' +
        '<div class="s">' + note1 + '</div>' +
      '</div>' +
      '<div class="safety-item">' +
        '<div class="k">Дней до нуля на платёжных счетах</div>' +
        '<div class="v"><b class="' + dCls + '">' +
          (s.daysLeft === null ? '—' : '≈' + NBSP + s.daysLeft + NBSP + 'дн.') + '</b>' +
          '<span>' + (s.zeroDate ? 'кончатся ' + humanDate(s.zeroDate) : '') + '</span></div>' +
        '<div class="s">' + note2 + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="zones">' +
      '<div class="zone-bar">' + zoneBarFill() +
        (months === null ? '' : '<span class="zone-mark" style="left:' + mark.toFixed(1) + '%"></span>') +
      '</div>' +
      '<div class="zone-labels"><span>критично</span><span>тонко</span><span>комфортно</span></div>' +
    '</div>';
}

/* ---------- динамика ---------- */
function cpDyn(d){
  return '<section class="sec">' +
    cpHead('Динамика с начала учёта',
      'Пересчёт по всем операциям от стартового снимка ' + humanDate(d.firstDay) + ' ' +
        d.firstDay.slice(0, 4) + ' года',
      '<p class="sec-sub" id="cpChartSub">—</p>',
      '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px">' +
        '<div class="seg" id="cpSegMode">' + CP_MODES.map(function(m){
          return '<button data-mode="' + m[0] + '"' + (m[0] === cpMode ? ' class="is-active"' : '') + '>' +
                 m[1] + '</button>';
        }).join('') + '</div>' +
        '<div class="legend" id="cpLegend"></div>' +
      '</div>', true) +
    '<div class="chart-ribbon" id="cpRibbon"></div>' +
    '<div class="chart-wrap" id="cpChartWrap">' +
      '<svg id="cpMainSvg" role="img" aria-label="Динамика капитала по дням"></svg>' +
    '</div>' +
  '</section>';
}

/* ---------- активы и долги ---------- */
function cpTag(t){
  if (t.kind === 'payment') return '<span class="badge badge--muted">не платёжный</span>';
  if (t.kind === 'stale') return '<span class="badge badge--stale">сверен ' + nDays(t.days) + ' назад</span>';
  if (t.kind === 'grace') return '<span class="badge badge--stale">грейс ' + cpIn(t.days) + '</span>';
  return '';
}
/* sub приходит готовой разметкой: у долгов в ней суммы с неразрывными
   пробелами, у активов — экранированное название банка. */
function cpList(items, total, negative, empty){
  if (!items.length){
    return '<div class="ad-row"><div class="ad-main"><div class="ad-sub">' + empty + '</div></div></div>';
  }
  var t = rub(total);
  return items.map(function(it){
    var v = rub(it.sum);
    return '<div class="ad-row">' +
      '<div class="ad-main">' +
        '<div class="ad-name"><span class="dot" style="background:' + it.color + '"></span>' +
          '<span>' + esc(it.name) + '</span></div>' +
        '<div class="ad-sub"><span>' + it.sub + '</span>' + it.tags.map(cpTag).join('') + '</div>' +
      '</div>' +
      '<div class="ad-right">' +
        '<div class="ad-amt' + (negative ? ' c-neg' : '') + '">' + money(it.sum) + '</div>' +
        '<div class="ad-share"><i style="width:' + (t ? v / t * 100 : 0).toFixed(2) + '%;background:' +
          it.color + '"></i></div>' +
        '<div class="ad-pct">' + cpPct(v, t) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}
function cpLists(d){
  var assets = d.assetsList.map(function(a){
    /* Валютный счёт: в сумме и доле — рубли по курсу, в подписи — сколько в валюте. */
    return { name: a.name, sub: esc(a.sub) + (a.cur && a.cur !== 'RUB' ? ' · ' + moneyIn(a.native, a.cur) + ' по курсу ЦБ' : ''),
             sum: a.sum, color: a.color, tags: a.tags };
  });
  var debts = d.debtsList.map(function(x){
    var sub = x.kind === 'loan'
      ? [esc(x.creditor || ''), x.rateBp === null ? '' : cpRate(x.rateBp),
         x.close ? 'до ' + cpDdmmyyyy(x.close) : '']
      : [x.limit ? 'Лимит ' + money0(x.limit) : '', x.graceDay ? 'грейс до ' + x.graceDay + ' числа' : ''];
    return { name: x.name, sub: sub.filter(Boolean).join(' · '), sum: x.sum, color: x.color, tags: x.tags };
  });
  return '<section class="grid grid--2">' +
    '<div>' +
      cpHead('Активы',
        'Все счета с положительным балансом. Счета, не участвующие в «Доступно на счетах», помечены отдельно',
        '', '<span class="badge badge--fact">факт</span>') +
      '<div class="ad-list" id="cpAssets">' +
        cpList(assets, d.assets, false, 'Счетов с положительным балансом нет') + '</div>' +
      '<div class="ad-total"><span class="k">Итого активов</span><span class="spacer"></span>' +
        '<span class="v">' + money(d.assets) + '</span></div>' +
    '</div>' +
    '<div>' +
      cpHead('Долги', 'Остаток по кредиту и текущий долг по кредитной карте',
        '', '<span class="badge badge--fact">факт</span>') +
      '<div class="ad-list" id="cpDebts">' + cpList(debts, d.debts, true, 'Долгов нет') + '</div>' +
      '<div class="ad-total"><span class="k">Итого долгов</span><span class="spacer"></span>' +
        '<span class="v c-neg">' + money(d.debts) + '</span></div>' +
    '</div>' +
  '</section>';
}

/* ---------- кредиты и кредитные карты ---------- */
function cpLoanCard(l){
  var terms = [];
  if (l.rateBp !== null) terms.push('Ставка ' + cpRate(l.rateBp));
  if (l.payment) terms.push('платёж ' + money(l.payment));
  if (l.day) terms.push(l.day + ' числа каждого месяца');
  return '<div class="liab-card">' +
    '<div class="liab-head">' +
      '<span class="nm">' + esc(l.name) + '</span>' +
      (l.creditor ? '<span class="badge badge--muted">' + esc(l.creditor) + '</span>' : '') +
      '<span class="spacer"></span>' + cpReconBadge(l.reconciledAt) +
    '</div>' +
    '<div class="liab-terms">' + terms.join(' · ') + '</div>' +
    '<div class="liab-grid">' +
      '<div><div class="k">Остаток долга</div><div class="v">' + money(l.balance) + '</div>' +
        '<div class="s">на ' + humanDate(CAP.today) + '</div></div>' +
      '<div><div class="k">Платежей осталось</div>' +
        '<div class="v">' + (l.paymentsLeft === null ? '—' : l.paymentsLeft) + '</div>' +
        '<div class="s">' + (l.lastDate ? 'до ' + cpDdmmyyyy(l.lastDate) : 'по условиям не посчитать') + '</div></div>' +
      '<div><div class="k">Переплата вперёд</div>' +
        '<div class="v">' + (l.interest === null ? '—' : money(l.interest)) + '</div>' +
        '<div class="s">проценты за оставшийся срок</div></div>' +
    '</div>' +
    cpLoanProg(l) +
    '<div class="liab-foot">' +
      '<span class="cap">' + (l.daysToNext === null ? '' : 'Следующий платёж ' + cpIn(l.daysToNext)) + '</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-form="loan">Изменить условия</button>' +
      '<button class="btn btn-sm btn-sm--acc" data-form="loanpay">Внести платёж</button>' +
    '</div>' +
  '</div>';
}

/* Прогресс погашения — из изначальной суммы и сегодняшнего остатка.
   Пока изначальной суммы нет, блок честно говорит, чего не хватает. */
function cpLoanProg(l){
  var init = l.initial ? rub(l.initial) : 0;
  if (!(init > 0)){
    return '<div class="liab-empty">' + CP_ICON_INFO +
      '<span>Изначальная сумма кредита не указана — прогресс погашения показать не из чего</span>' +
      '<span class="spacer"></span><button class="btn-link" data-form="loan" data-focus="initial">Указать</button>' +
    '</div>';
  }
  var paid = Math.max(0, init - rub(l.balance)), pct = Math.min(paid / init, 1) * 100;
  return '<div class="liab-prog">' +
    '<div class="liab-track"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
    '<div class="cap"><b>Погашено ' + cpOne(pct) + '% тела кредита.</b> Из ' + money0(l.initial) + ' в счёт долга ' +
      'внесено ' + money0(String(Math.round(paid * 100))) + '</div>' +
  '</div>';
}

function cpCardCard(c){
  var cy = c.cycle;
  var used = c.limit && rub(c.limit) > 0 ? rub(c.debt) / rub(c.limit) * 100 : null;
  var terms = [];
  if (c.limit) terms.push('Лимит ' + money0(c.limit));
  if (c.graceDay) terms.push('грейс-период до ' + c.graceDay + ' числа');

  var paidCell = '<div></div>', prog = '';
  if (cy){
    var need = rub(cy.debtStart), paid = rub(cy.paid);
    var rest = String(BigInt(cy.debtStart) - BigInt(cy.paid));
    paidCell = '<div><div class="k">Внесено в цикле</div><div class="v">' + money(cy.paid) + '</div>' +
      '<div class="s">' + (need > 0
        ? 'из ' + money0(cy.debtStart) + ' · ' + (paid >= need ? 'выполнено' : 'осталось ' + money0(rest))
        : 'долга на начало цикла не было') + '</div></div>';
    var pct = need > 0 ? Math.min(paid / need, 1) * 100 : 100;
    var lead = cy.daysLeft === 0 ? 'Сегодня последний день цикла.'
      : 'Осталось ' + nDays(cy.daysLeft) + ' до ' + humanDate(cy.due) + '.';
    var one = cy.count % 10 === 1 && cy.count % 100 !== 11;
    var tops = cy.count === 0
      ? 'Пополнений с ' + humanDate(cy.start) + ' не было'
      : cy.count + NBSP + plural(cy.count, 'пополнение', 'пополнения', 'пополнений') + ' с ' +
        humanDate(cy.start) + ' ' + (one ? 'дало' : 'дали') + ' ' + money(cy.paid);
    prog = '<div class="liab-prog">' +
      '<div class="liab-track"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="cap"><b>' + lead + '</b> Условие цикла — внести за него всю сумму долга, можно частями. ' +
        tops + '</div>' +
    '</div>';
  }

  var foot;
  if (cy && cy.stuck){
    foot = '<span class="cap c-warn">Долг не уменьшается: каждое пополнение тратится новой покупкой по карте</span>';
  } else if (rub(c.debt) === 0){
    foot = '<span class="cap">Долга нет — лимит свободен</span>';
  } else if (cy){
    var ch = String(cy.change);
    foot = '<span class="cap">' + (ch === '0' ? 'С начала цикла долг не изменился'
      : ch.charAt(0) === '-' ? 'С начала цикла долг уменьшился на ' + money0(ch.slice(1))
      : 'С начала цикла долг вырос на ' + money0(ch)) + '</span>';
  } else {
    foot = '<span class="cap"></span>';
  }

  return '<div class="liab-card' + (c.alert ? ' is-alert' : '') + '">' +
    '<div class="liab-head">' +
      '<span class="nm">' + esc(c.name) + '</span>' +
      (c.bank ? '<span class="badge badge--muted">' + esc(c.bank) + '</span>' : '') +
      '<span class="spacer"></span>' + cpReconBadge(c.reconciledAt) +
    '</div>' +
    '<div class="liab-terms">' + terms.join(' · ') + '</div>' +
    '<div class="liab-grid">' +
      '<div><div class="k">Долг</div><div class="v">' + money(c.debt) + '</div>' +
        '<div class="s">' + (used === null ? '' : cpOne(used) + '% лимита') + '</div></div>' +
      '<div><div class="k">Свободно</div><div class="v">' + (c.free === null ? '—' : money(c.free)) + '</div>' +
        '<div class="s">это заёмные деньги</div></div>' +
      paidCell +
    '</div>' +
    prog +
    '<div class="liab-foot">' + foot + '<span class="spacer"></span>' +
      '<button class="btn btn-sm btn-sm--acc" data-form="cardtopup">Пополнить карту</button>' +
    '</div>' +
  '</div>';
}

function cpLiab(d){
  var cards = [];
  if (d.loan && rub(d.loan.balance) > 0) cards.push(cpLoanCard(d.loan));
  if (d.card) cards.push(cpCardCard(d.card));
  var n = cards.length;
  var sub = !n ? 'Действующих обязательств нет'
    : n < 5 ? CP_NUM_NEUT[n] + ' ' +
              plural(n, 'действующее обязательство', 'действующих обязательства', 'действующих обязательств')
    : n + NBSP + 'действующих обязательств';
  return '<section class="sec">' +
    cpHead('Кредиты и кредитные карты', 'Условия обязательств и ход их погашения',
      '<p class="sec-sub">' + sub + '</p>',
      /* Расчёт ведёт один кредит: второй платёж в той же категории
         уменьшал бы остаток первого. Пока кредит есть, кнопка говорит
         это прямо, а не открывает правку существующего. */
      (d.loan ? '<button class="btn btn-sm" data-note="Приложение пока ведёт один кредит. Кредитную карту ' +
                'можно добавить через «Добавить» → «Счёт»">Добавить обязательство</button>'
              : '<button class="btn btn-sm" data-form="loan">Добавить обязательство</button>')) +
    /* Одна карточка занимает всю ширину: во второй колонке иначе
       осталась бы серая подложка сетки. */
    (n ? '<div class="liab"' + (n === 1 ? ' style="grid-template-columns:minmax(0,1fr)"' : '') + '>' +
         cards.join('') + '</div>' : '') +
  '</section>';
}

/* ---------- сверка ---------- */
function cpRecon(d){
  var r = d.recon;
  var warn = '';
  if (r.stale.length){
    var n = r.stale.length;
    var lead = (n < 5
      ? CP_NUM_MASC[n] + ' ' + plural(n, 'счёт не сверялся', 'счёта не сверялись', 'счетов не сверялись')
      : n + NBSP + 'счетов не сверялись') + ' больше двух недель.';
    var staleOff = r.rows.some(function(x){ return x.stale && x.off; });
    warn = '<div class="note-warn" style="margin-bottom:16px"><span class="dot"></span><span><b>' + lead + '</b> ' +
      r.stale.map(function(s){ return esc(s.name) + ' — ' + nDays(s.days) + ' назад'; }).join(', ') + '. ' +
      (staleOff ? 'Расхождения по ним — в таблице ниже.'
                : 'Расхождений по ним пока нет, но с банком они сверены только на дату последней сверки, а не на сегодня.') +
      '</span></div>';
  }

  var rows = r.rows.map(function(x){
    return '<tr>' +
      '<td><span class="acc-cell"><span>' + esc(x.name) + '</span>' +
        (x.stale ? '<span class="badge badge--stale">просрочена</span>' : '') + '</span></td>' +
      '<td class="r num">' + moneyIn(x.calc, x.cur) + '</td>' +
      '<td class="r num">' + moneyIn(x.fact, x.cur) + '</td>' +
      (x.off ? '<td class="r num c-neg">' + (x.cur && x.cur !== 'RUB' ? cpSigned(x.diff).replace(/₽$/, CUR_SYM[x.cur]) : cpSigned(x.diff)) + '</td>'
             : '<td class="r" style="color:var(--text-3)">—</td>') +
      '<td class="r num" style="color:var(--text-2)">' + cpDdmm(x.date) + '</td>' +
    '</tr>';
  }).join('');

  var nh = r.history.length;
  var histLine = nh
    ? 'История сверок — ' + nh + NBSP + plural(nh, 'снимок', 'снимка', 'снимков') + ' с ' +
      humanDate(r.history[nh - 1].date)
    : 'Сверок ещё не было';
  var hist = '<div class="recon-hist" id="cpHist" hidden><table class="tbl">' +
    '<thead><tr><th>Дата сверки</th><th class="r">Счетов</th><th class="r">Итог</th></tr></thead><tbody>' +
    r.history.map(function(h){
      return '<tr><td class="num">' + cpDdmmyyyy(h.date) + '</td><td class="r num">' + h.accounts + '</td>' +
        (h.off
          ? '<td class="r c-neg">расхождение по ' + h.off + NBSP + plural(h.off, 'счёту', 'счетам', 'счетам') + '</td>'
          : '<td class="r" style="color:var(--text-3)">всё сошлось</td>') + '</tr>';
    }).join('') + '</tbody></table></div>';

  return '<section class="sec">' +
    cpHead('Сверка балансов',
      'Сравнение расчётного баланса с фактическим остатком в банке. Расчётный получается пересчётом всех операций',
      '<p class="sec-sub">' + (r.last ? 'Последняя сверка — ' + humanDate(r.last) + ' ' + r.last.slice(0, 4)
                                      : 'Сверок ещё не было') + '</p>',
      '<button class="btn btn-sm btn-sm--acc" data-form="recon">Сверить сейчас</button>') +
    warn +
    '<table class="tbl">' +
      '<thead><tr><th>Счёт</th><th class="r">Расчётный баланс</th><th class="r">Фактический баланс</th>' +
        '<th class="r">Расхождение</th><th class="r">Дата снимка</th></tr></thead>' +
      '<tbody id="cpReconBody">' + rows + '</tbody>' +
    '</table>' +
    '<div class="recon-foot">' +
      '<span>' + histLine + '</span>' +
      (nh ? '<button class="btn-link" id="cpHistToggle">Показать</button>' : '') +
      '<span class="spacer"></span>' +
      (r.offCount
        ? '<span class="c-neg">Расхождение по ' + r.offCount + NBSP +
          plural(r.offCount, 'счёту', 'счетам', 'счетам') + '. Учёт с фактом не сходится</span>'
        : '<span>Все расхождения нулевые. Учёт сходится с фактом</span>') +
    '</div>' +
    hist +
  '</section>';
}

/* ============================================================
   ГРАФИКИ
   ============================================================ */
/* Спарклайн в плашке капитала. Рисуется в viewBox и растягивается
   вместе с колонкой — подписей осей у него нет, плыть нечему. */
function cpRenderSpark(){
  var svg = document.getElementById('cpSpark');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  var NW = CAP.series.nw.map(rub);
  var W = 420, H = 92, PADX = 6, PADY = 16;
  var lo = Math.min.apply(null, NW), hi = Math.max.apply(null, NW);
  var X = function(i){ return PADX + (NW.length > 1 ? i / (NW.length - 1) : 0.5) * (W - PADX * 2); };
  var Y = function(v){ return hi === lo ? H / 2 : PADY + (hi - v) / (hi - lo) * (H - PADY * 2); };

  var line = NW.map(function(v, i){ return (i ? 'L ' : 'M ') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
  svg.appendChild(svgEl('path', {
    d: line + ' L ' + X(NW.length - 1).toFixed(1) + ' ' + (H - 2) + ' L ' + X(0).toFixed(1) + ' ' + (H - 2) + ' Z',
    fill: 'var(--accent)', opacity: .1
  }));
  svg.appendChild(svgEl('path', {
    d: line, fill: 'none', stroke: 'var(--accent)',
    'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
  }));
  var loI = NW.indexOf(lo), hiI = NW.indexOf(hi), lastI = NW.length - 1;
  svg.appendChild(svgEl('circle', { cx: X(lastI), cy: Y(NW[lastI]), r: 3.5, fill: 'var(--accent)' }));
  /* Подпись у края прижимается внутрь, иначе половина уходит за рамку. */
  var anchorAt = function(i){ return i < 6 ? 'start' : (i > NW.length - 6 ? 'end' : 'middle'); };
  cpText(svg, X(loI), Y(lo) + 14, cpShort(lo), { anchor: anchorAt(loI) });
  if (hiI !== loI) cpText(svg, X(hiI), Y(hi) - 6, cpShort(hi), { anchor: anchorAt(hiI) });
}

function cpNiceStep(v){
  if (v <= 0) return 1;
  var mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
  var mult = [1, 2, 2.5, 5, 10];
  for (var i = 0; i < mult.length; i++) if (mag * mult[i] >= v) return mag * mult[i];
  return mag * 10;
}
/* Шаг шкалы круглый, потолок подгоняется под него — как в макете.
   Шкала макета начинается с нуля; если ряд уходит в минус (долги
   больше активов), она опускается ниже нуля, а не обрезает линию. */
function cpAxis(minV, maxV){
  var lo0 = Math.min(0, minV);
  var step = cpNiceStep((Math.max(maxV, 0) - lo0) * 1.05 / 5);
  var hi = Math.ceil(Math.max(maxV, 0) * 1.05 / step) * step;
  var lo = lo0 < 0 ? Math.floor(lo0 * 1.05 / step) * step : 0;
  if (hi === lo) hi = lo + step;
  return { step: step, hi: hi, lo: lo };
}

function cpModeCfg(mode){
  var s = CAP.series;
  if (mode === 'ad') return {
    sub: 'Активы и долги по отдельности. Долг по кредитке растёт вместе с тратами, ' +
         'кредит уменьшается ступенькой в день платежа',
    series: [
      { name: 'Активы', color: 'var(--positive)', data: s.assets.map(rub) },
      { name: 'Долги',  color: 'var(--danger)',   data: s.debts.map(rub) }
    ]
  };
  if (mode === 'acc') return {
    sub: 'Остаток каждого счёта на конец дня. Переводы между своими счетами капитал не меняют — ' +
         'они только перекладывают деньги',
    series: s.accounts.map(function(a){ return { name: a.name, color: a.color, data: a.data.map(rub) }; })
  };
  /* Подпись к капиталу называет провал и скачок по данным, а не по
     заготовке: самые большие изменения за день. */
  var parts = [];
  if (CAP.drop) parts.push('провал ' + humanDate(CAP.drop.day) + ' — ' + cpLower(CAP.drop.name));
  if (CAP.jump) parts.push('скачок ' + humanDate(CAP.jump.day) + ' — ' + cpLower(CAP.jump.name));
  var tail = parts.join(', ');
  return {
    sub: 'Активы минус долги на конец каждого дня.' +
         (tail ? ' ' + tail.charAt(0).toUpperCase() + tail.slice(1) : ''),
    series: [{ name: 'Чистый капитал', color: 'var(--accent)', data: s.nw.map(rub) }]
  };
}

/* Основной график. Рисуем в реальных пикселях и перерисовываем при
   изменении размера окна: при масштабировании viewBox подписи осей
   плыли бы вместе с рисунком. */
function cpRenderMain(animate){
  var wrap = document.getElementById('cpChartWrap');
  var svg = document.getElementById('cpMainSvg');
  var ribbon = document.getElementById('cpRibbon');
  if (!wrap || !svg || !CAP) return;
  var cfg = cpModeCfg(cpMode);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  ribbon.innerHTML = '';

  var W = Math.max(420, wrap.clientWidth || 900);
  var H = 268;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);

  var PL = 56, PR = 12, PT = 10, PH = 218;
  var PWD = W - PL - PR;
  var N = CAP.series.labels.length;

  var minV = Infinity, maxV = -Infinity;
  cfg.series.forEach(function(s){
    s.data.forEach(function(v){ if (v > maxV) maxV = v; if (v < minV) minV = v; });
  });
  var ax = cpAxis(minV, maxV);
  var X = function(i){ return PL + (N > 1 ? i / (N - 1) : 0.5) * PWD; };
  var Y = function(v){ return PT + (ax.hi - v) / (ax.hi - ax.lo) * PH; };

  for (var k = 0; ax.lo + k * ax.step <= ax.hi + 1e-6; k++){
    var g = ax.lo + k * ax.step, y = Y(g), zero = Math.abs(g) < 1e-6;
    svg.appendChild(svgEl('line', { x1: PL, y1: y, x2: PL + PWD, y2: y,
      stroke: zero ? 'var(--border-strong)' : 'var(--border)', 'stroke-width': 1,
      'stroke-dasharray': zero ? 'none' : '3 3' }));
    cpText(svg, PL - 10, y + 3.5, zero ? '0' + RUB : cpShort(g), { anchor: 'end' });
  }

  var events = CAP.events.filter(function(e){ return e.i >= 1 && e.i < N; });
  var tone = function(e){ return e.amount.charAt(0) === '-' ? 'var(--warning)' : 'var(--positive)'; };
  events.forEach(function(e){
    var x = X(e.i);
    svg.appendChild(svgEl('line', { x1: x, y1: PT, x2: x, y2: PT + PH,
      stroke: tone(e), 'stroke-width': 1, 'stroke-dasharray': '2 4', 'stroke-opacity': .5 }));
  });

  cfg.series.forEach(function(s){
    svg.appendChild(svgEl('path', {
      d: s.data.map(function(v, i){ return (i ? 'L ' : 'M ') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' '),
      fill: 'none', stroke: s.color, 'stroke-width': 1.8,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round'
    }));
    var last = s.data.length - 1;
    svg.appendChild(svgEl('circle', { cx: X(last), cy: Y(s.data[last]), r: 3.5, fill: s.color }));
  });

  /* Подписи дат прореживаем по ширине: на узком окне каждая пятая дата
     ещё наезжает на соседнюю. На длинной истории — не теснее 56 точек. */
  var stepI = W < 700 ? 8 : (W < 1000 ? 6 : 5);
  stepI = Math.max(stepI, Math.ceil(56 * (N - 1) / PWD));
  for (var i = 1; i < N; i += stepI){
    var anchor = i === 1 ? 'start' : (i + stepI >= N ? 'end' : 'middle');
    cpText(svg, X(i), PT + PH + 20, CAP.series.labels[i], { anchor: anchor });
  }

  /* Подписи событий над графиком. Сначала встают самые крупные; каждая
     занимает первый ряд, где не задевает соседей, а не влезшая ни в
     один ряд не показывается — линия на графике остаётся. */
  var RW = ribbon.clientWidth || W;
  var rowsTaken = [[], []], used = 0;
  events.slice().sort(function(a, b){ return Math.abs(rub(b.amount)) - Math.abs(rub(a.amount)); })
    .forEach(function(e){
      var color = tone(e);
      var chip = document.createElement('div');
      chip.className = 'evt-chip';
      chip.innerHTML = '<span class="dot" style="background:' + color + ';width:5px;height:5px"></span>' +
        '<span class="n">' + e.date + ' · ' + esc(e.name) + '</span>' +
        '<span class="s" style="color:' + color + '">' + (e.amount.charAt(0) === '-' ? '−' : '+') +
          fmtR(Math.abs(rub(e.amount))) + RUB + '</span>';
      ribbon.appendChild(chip);
      var w = chip.offsetWidth;
      var left = Math.max(0, Math.min(X(e.i) / W * RW - w / 2, RW - w));
      var row = -1;
      for (var r = 0; r < rowsTaken.length && row < 0; r++){
        var free = true;
        for (var q = 0; q < rowsTaken[r].length; q++){
          if (!(left + w + 8 <= rowsTaken[r][q][0] || left >= rowsTaken[r][q][1] + 8)){ free = false; break; }
        }
        if (free) row = r;
      }
      if (row < 0){ ribbon.removeChild(chip); return; }
      rowsTaken[row].push([left, left + w]);
      used = Math.max(used, row + 1);
      chip.style.top = (row * 22) + 'px';
      chip.style.left = left + 'px';
    });
  ribbon.style.height = (used ? used * 22 + 4 : 4) + 'px';

  document.getElementById('cpChartSub').textContent = cfg.sub;
  document.getElementById('cpLegend').innerHTML = cfg.series.length < 2 ? '' :
    cfg.series.map(function(s){
      return '<span class="legend-item"><span class="legend-line" style="background:' + s.color + '"></span>' +
             esc(s.name) + '</span>';
    }).join('');
  /* Сменили режим — на том же месте рисуется другой график. Без появления
     подмена читается как мигание одного и того же. */
  if (animate) appear(wrap);
}

/* ============================================================
   СБОРКА ЭКРАНА
   ============================================================ */
function drawCapital(){
  if (!CAP || CAP.empty || CAP.error) return;
  cpRenderSpark();
  cpRenderMain(false);
  /* Шрифты могут прийти позже разметки — тогда ширина подписей над
     графиком посчитана по запасному шрифту. Перекладываем, когда придут. */
  if (document.fonts && document.fonts.status !== 'loaded' && document.fonts.ready){
    document.fonts.ready.then(function(){ if (current === 'capital') cpRenderMain(false); });
  }
}
/* Основной график зависит от фактической ширины колонки. */
function redrawCapitalWidth(){
  if (!CAP || CAP.empty || CAP.error) return;
  cpRenderMain(false);
}
