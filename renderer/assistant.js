'use strict';
/* ============================================================
   ПАНЕЛЬ АССИСТЕНТА
   ============================================================
   Перенесено из макета Main App/screens/09-assistent.html: шторка 380px
   поверх любого экрана, вызов ⌘J. Над полем ввода — кнопки-шаблоны,
   в ленте — разговор. Ответ — блоками: вывод текстом с выделениями,
   ключевые числа справкой, риски и шаги. Оценка, а не расчёт, помечена
   бейджем «решение».

   Разобранные операции приходят карточками с полями, которые можно
   поправить; в учёт они попадают только по кнопке — и с отменой.
   Имена начинаются с as.
   ============================================================ */
var AS = null;               /* ключ, модель, справочники, кнопки-шаблоны */
var asIsOpen = false;
var asFeedList = [];         /* реплики: { who, text, decision, cards, cardsState, saved, cost } */
var asBusy = false;
var asMode = null;           /* 'input' — следующий текст разбирается в операции */
var asState = null;          /* { kind: error | offline | limit | stopped, … } */
var asLastQ = null;          /* для «Повторить» */
var asSteps = [];            /* ход работы: { text, kind } — последний идёт сейчас */
var asStarted = 0, asTick = null;
var AS_MON = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь',
              'ноябрь', 'декабрь'];
var AS_SCREEN = { overview: 'Обзор', expenses: 'Расходы', capital: 'Капитал и долги', forecast: 'Прогнозы',
  plans: 'Планы', calendar: 'Календарь', payments: 'Обязательные платежи', settings: 'Настройки' };
var AS_KIND = { expense: 'расход', income: 'доход', transfer: 'перевод' };

/* ---------- текст ответа ----------
   Модель может выделять: **жирный**, *курсив*, ==акцент==. Всё прочее —
   текст: сначала экранируем, потом размечаем, так что разметка из ответа
   не исполняется. */
function asInline(s){
  return nbsp(esc(s))
    .replace(/\*\*(?!\s)([^*\n]{1,200}?)\*\*/g, '<b>$1</b>')
    .replace(/==(?!\s)([^=\n]{1,200}?)==/g, '<mark class="asst-acc">$1</mark>')
    .replace(/(^|[\s(«—])\*(?![\s*])([^*\n]{1,200}?)\*(?=$|[\s.,;:!?)»—])/g, '$1<i>$2</i>');
}
/* Абзацы и списки «- » / «1. ». Заголовков и таблиц в ответе нет —
   приложение превращает заголовок в жирную строку ещё до панели. */
function asFormat(text, cls){
  var out = '', list = [], para = [], c = 'asst-text' + (cls ? ' ' + cls : '');
  var flushPara = function(){ if (para.length){ out += '<div class="' + c + '">' + para.map(asInline).join('<br>') + '</div>'; para = []; } };
  var flushList = function(){ if (list.length){ out += '<ul class="asst-list">' + list.map(function(l){ return '<li>' + asInline(l) + '</li>'; }).join('') + '</ul>'; list = []; } };
  String(text || '').replace(/\r/g, '').split('\n').forEach(function(line){
    var l = line.trim();
    var item = /^[-•*]\s+(.*)$/.exec(l) || /^\d+[.)]\s+(.*)$/.exec(l);
    if (item){ flushPara(); list.push(item[1]); return; }
    if (!l){ flushPara(); flushList(); return; }
    flushList();
    para.push(l.replace(/^#+\s*/, ''));
  });
  flushPara(); flushList();
  return out;
}

/* ---------- ответ блоками ----------
   Ответ приходит данными: главный вывод, ключевые числа, пояснения,
   риски, шаги. Числа — справка: что это, сколько и на какую дату или за
   какой срок. Никуда не ведут. */
function asFactValue(f){
  if (f.unit === 'pct') return String(Math.round(f.value * 10) / 10).replace('.', ',') + NBSP + '%';
  if (f.unit === 'days') return nDays(Math.round(f.value));
  if (f.unit === 'count') return String(Math.round(f.value)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  var c = Math.round(f.value * 100);
  return c % 100 ? money(String(c)) : money0(String(c));
}
function asAnswerHTML(a){
  var h = asFormat(a.text, a.plain ? '' : 'asst-lead');
  if (a.facts && a.facts.length){
    h += '<div class="asst-facts' + (a.facts.length === 1 ? ' is-one' : '') + '">' + a.facts.map(function(f){
      return '<div class="asst-fact' + (f.unit === 'rub' && f.value < 0 ? ' is-neg' : '') + '"><span class="k">' + esc(f.label) + '</span>' +
        '<span class="v">' + asFactValue(f) + '</span>' + (f.note ? '<span class="n">' + nbsp(esc(f.note)) + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  }
  if (a.points && a.points.length){
    h += '<ul class="asst-list">' + a.points.map(function(p){ return '<li>' + asInline(p) + '</li>'; }).join('') + '</ul>';
  }
  if (a.risks && a.risks.length){
    h += '<div class="asst-sec"><div class="asst-sec-t">Риски</div>' + a.risks.map(function(r){
      return '<div class="asst-risk"><span class="dot"></span><span>' + asInline(r) + '</span></div>'; }).join('') + '</div>';
  }
  if (a.actions && a.actions.length){
    h += '<div class="asst-sec"><div class="asst-sec-t">Что сделать</div><ol class="asst-do">' + a.actions.map(function(x){
      return '<li><span>' + asInline(x) + '</span></li>'; }).join('') + '</ol></div>';
  }
  return h || '<div class="asst-text">—</div>';
}

/* ---------- ход работы ----------
   Одна строка: спиннер, что ассистент делает сейчас, секунды и
   «Остановить». Новый статус сменяет прежний на том же месте — старый
   уходит вверх, новый поднимается снизу; лента не растёт. По тексту
   бежит блик, его фаза считается от начала запроса — смена статуса не
   сбивает движение. */
var AS_SHINE = 2.4;           /* период блика, секунды — как в assistant.css */
function asNowHTML(text, enter){
  var phase = ((Date.now() - asStarted) / 1000) % AS_SHINE;
  return '<span class="t' + (enter ? ' is-enter' : '') + '"><span class="x" style="animation-delay:-' + phase.toFixed(2) + 's">' +
    esc(text) + '</span></span>';
}
function asWorkHTML(){
  var cur = asSteps.length ? asSteps[asSteps.length - 1].text : 'Отправляю вопрос';
  return '<div class="asst-work"><span class="spin"></span><span class="asst-now" id="asNow">' + asNowHTML(cur, false) + '</span>' +
    '<span id="asElapsed">' + Math.max(0, Math.round((Date.now() - asStarted) / 1000)) + NBSP + 'с</span>' +
    '<button type="button" class="btn btn-sm" data-asact="stop">Остановить</button></div>';
}
function asOnStep(st){
  if (!asBusy) return;
  var prev = asSteps[asSteps.length - 1];
  if (prev && prev.text === st.text) return;
  asSteps.push(st);
  var box = document.getElementById('asNow');
  if (!box){ asRender(false); return; }
  var old = box.querySelector('.t:not(.is-out)');
  var motion = booted && !REDUCED && old;
  box.insertAdjacentHTML('beforeend', asNowHTML(st.text, motion));
  if (!old) return;
  if (!motion){ old.remove(); return; }
  old.classList.add('is-out');
  setTimeout(function(){ if (old.parentNode) old.remove(); }, 400);
}

/* ---------- карточки разбора ---------- */
function asCardHTML(c, mi, ci, locked){
  var cats = AS.categories.filter(function(x){ return c.kind === 'income' ? x.type === 'доход' : x.type !== 'доход'; });
  var sel = function(k, val, opts){
    return '<select class="inp" data-m="' + mi + '" data-c="' + ci + '" data-k="' + k + '"' + (locked ? ' disabled' : '') + '>' +
      (val ? '' : '<option value="">выберите</option>') + opts.map(function(o){
        return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
  };
  var accs = AS.accounts.map(function(a){ return [a.id, a.name]; });
  /* Сумма — в той валюте, что назвал человек (по умолчанию — валюта счёта);
     у перевода в другую валюту — ещё и пришедшая. */
  var curOf = function(id){ var a = AS.accounts.filter(function(x){ return x.id === id; })[0]; return (a && a.cur) || 'RUB'; };
  var cur = c.cur || curOf(c.kind === 'income' ? c.to : c.from);
  var curIn = { USD: 'долларах', EUR: 'евро' }[cur];
  var inp = function(k, val, extra){
    return '<input class="inp" type="text" data-m="' + mi + '" data-c="' + ci + '" data-k="' + k + '" value="' + esc(val) + '"' +
      (locked ? ' disabled' : '') + (extra || '') + '>';
  };
  var accField = c.kind === 'transfer'
    ? '<div class="parse-f"><div class="k">Откуда</div>' + sel('from', c.from, accs) + '</div>' +
      '<div class="parse-f"><div class="k">Куда</div>' + sel('to', c.to, accs) + '</div>'
    : '<div class="parse-f"><div class="k">Категория</div>' + sel('category', c.category, cats.map(function(x){ return [x.name, x.name]; })) + '</div>' +
      '<div class="parse-f"><div class="k">' + (c.kind === 'income' ? 'Счёт зачисления' : 'Счёт') + '</div>' +
        sel(c.kind === 'income' ? 'to' : 'from', c.kind === 'income' ? c.to : c.from, accs) + '</div>';
  return '<div class="parse' + (c.on === false ? ' is-off' : '') + '">' +
    '<div class="parse-top">' +
      '<input type="checkbox" data-m="' + mi + '" data-c="' + ci + '" data-k="on" style="accent-color:var(--accent);margin:0"' +
        (c.on === false ? '' : ' checked') + (locked ? ' disabled' : '') + '>' +
      '<span class="parse-sum">' + (c.amount ? moneyIn(c.amount, cur) : '—') +
        (c.kind === 'transfer' && c.amountTo ? ' → ' + moneyIn(c.amountTo, curOf(c.to)) : '') + '</span>' +
      '<span class="parse-kind">' + AS_KIND[c.kind] + '</span><span class="spacer"></span>' +
      (locked ? '<span class="badge badge--recon">записано</span>'
              : c.error ? '<span class="badge badge--warn">поправьте</span>' : '<span class="badge badge--forecast">разобрано</span>') +
    '</div>' +
    '<div class="parse-grid">' +
      '<div class="parse-f"><div class="k">Дата</div>' + inp('date', exRuDate(c.date), ' inputmode="numeric" placeholder="дд.мм.гггг"') + '</div>' +
      '<div class="parse-f"><div class="k">Сумма' + (curIn ? ' в ' + curIn : '') + '</div>' +
        inp('amount', c.amount ? fmRaw(c.amount) : '', ' inputmode="decimal"') + '</div>' +
      accField +
    '</div>' +
    '<div class="parse-f" style="margin-top:8px"><div class="k">Описание</div>' + inp('desc', c.desc || '') + '</div>' +
    (c.error && !locked ? '<div class="parse-err">' + esc(c.error) + '</div>' : '') +
  '</div>';
}
function asCardsHTML(m, mi){
  if (!m.cards || !m.cards.length) return '';
  var locked = m.cardsState === 'saved' || m.cardsState === 'cancelled' || !!(m.saved && m.saved.ok);
  if (m.cardsState === 'cancelled') return '<div class="asst-text asst-note">Разбор отменён — в учёт ничего не записано.</div>';
  var on = m.cards.filter(function(c){ return c.on !== false; }).length;
  var acts = locked
    ? '<div class="asst-text asst-note">' + (m.saved && m.saved.ok ? 'Записано сразу: ' + m.saved.added + NBSP +
        plural(m.saved.added, 'операция', 'операции', 'операций') + '.' : 'Записано в учёт.') +
      (m.undo ? ' <button type="button" class="link-btn" data-asact="undo" data-m="' + mi + '">Отменить</button>' : '') + '</div>'
    : '<div class="parse-acts">' +
        (m.cards.length > 1 ? '<button type="button" class="btn btn-sm btn-sm--acc" data-asact="save-all" data-m="' + mi + '">Сохранить все</button>' : '') +
        '<button type="button" class="btn btn-sm' + (m.cards.length > 1 ? '' : ' btn-sm--acc') + '" data-asact="save-sel" data-m="' + mi + '"' +
          (on ? '' : ' disabled') + '>' + (m.cards.length > 1 ? 'Сохранить выбранные' + (on ? ' (' + on + ')' : '') : 'Сохранить') + '</button>' +
        '<button type="button" class="btn btn-sm" data-asact="cancel" data-m="' + mi + '">Отмена</button>' +
      '</div>';
  return m.cards.map(function(c, ci){ return asCardHTML(c, mi, ci, locked); }).join('') + acts;
}

/* ---------- лента ---------- */
function asUsd(n){ return '$' + (Math.round(Number(n) * 1000) / 1000).toFixed(n < 0.1 ? 3 : 2).replace('.', ','); }
function asStateHTML(){
  if (asBusy) return asWorkHTML();
  var s = asState;
  if (!s) return '';
  if (s.kind === 'limit'){
    var r = s.reset ? s.reset.split('-').map(Number) : null;
    return '<div class="asst-state asst-state--warn"><span class="dot" style="background:var(--warning);margin-top:5px"></span>' +
      '<div style="flex:1"><b>Месячный лимит расходов исчерпан</b>Израсходовано ' + asUsd(s.spent) + ' из ' + asUsd(s.limit) +
      (r ? '. Лимит сбросится ' + r[2] + NBSP + MONTHS[r[1] - 1] + '.' : '.') +
      '<div class="acts"><button type="button" class="btn btn-sm" data-asact="settings">Поднять лимит</button></div></div></div>';
  }
  if (s.kind === 'offline'){
    return '<div class="asst-state asst-state--warn"><span class="dot" style="background:var(--warning);margin-top:5px"></span>' +
      '<div style="flex:1"><b>Ассистент недоступен без сети</b>' + esc(s.error || '') + '. Проверки при вводе операций ' +
      'продолжают работать: дубли, превышение обычной суммы и условие грейса считаются на месте и интернета не требуют.' +
      '<div class="acts"><button type="button" class="btn btn-sm btn-sm--acc" data-asact="retry">Повторить</button></div></div></div>';
  }
  if (s.kind === 'stopped'){
    return '<div class="asst-state asst-state--wait"><div style="flex:1"><b>Остановлено</b>Ответ не дождались — можно ' +
      'спросить заново.<div class="acts"><button type="button" class="btn btn-sm" data-asact="retry">Повторить</button></div></div></div>';
  }
  return '<div class="asst-state asst-state--err"><span class="dot" style="background:var(--danger);margin-top:5px"></span>' +
    '<div style="flex:1"><b>' + (s.auth ? 'Ключ отклонён' : 'Не получилось') + '</b>' + esc(s.error || 'Провайдер вернул ошибку') + '.' +
    '<div class="acts"><button type="button" class="btn btn-sm btn-sm--acc" data-asact="retry">Повторить</button>' +
    '<button type="button" class="btn btn-sm" data-asact="settings">Проверить настройки</button></div></div></div>';
}
function asMsgHTML(m, mi){
  if (m.who === 'me'){
    return '<div class="asst-msg asst-msg--me"><div class="asst-who">Вы</div><div class="asst-text">' +
      esc(m.text).replace(/\n/g, '<br>') + '</div></div>';
  }
  return '<div class="asst-msg"><div class="asst-who">Ассистент' +
      (m.decision ? ' <span class="badge badge--decision">решение</span>' : '') + '</div>' +
    (m.title ? '<div class="asst-text asst-title">' + esc(m.title) + '</div>' : '') +
    (m.answer ? asAnswerHTML(m.answer) : asFormat(m.text) || '<div class="asst-text">—</div>') + asCardsHTML(m, mi) +
    (m.cost !== undefined ? '<div class="asst-cost">' + (m.cost > 0 ? asUsd(m.cost) : 'бесплатно') + '</div>' : '') +
  '</div>';
}
function asRender(rise){
  var feed = document.getElementById('asFeed');
  if (!feed) return;
  if (AS && !AS.hasKey){
    feed.innerHTML = '<div class="asst-state asst-state--empty"><div><b>Ассистент не настроен</b>Добавьте ключ OpenRouter ' +
      'в настройках — и он сможет разбирать записи и отвечать по вашим данным.</div>' +
      '<button type="button" class="btn btn-sm btn-sm--acc" data-asact="settings">Настроить</button></div>';
    return;
  }
  var body = asFeedList.map(asMsgHTML).join('');
  if (!asFeedList.length && !asBusy && !asState){
    body = '<div class="asst-state asst-state--empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="4" width="20" height="14" rx="3"/>' +
      '<path d="M6 18v3l4-3" stroke-linejoin="round"/></svg><div><b>Спросите о деньгах или продиктуйте операцию</b>' +
      'Например: «сколько ушло на кафе в сентябре» или «вчера 1200 пятёрочка и 340 кофе».</div></div>';
  }
  feed.innerHTML = body + asStateHTML();
  /* Новый ответ собирается на глазах: блоки выходят по очереди. */
  if (rise){
    var last = feed.querySelector('.asst-msg:last-of-type');
    if (last) stagger(last, ':scope > *');
  }
  feed.scrollTop = feed.scrollHeight;
}
function asQuickHTML(){
  if (!AS) return '';
  return AS.modes.map(function(m){
    return '<button type="button" class="chip' + (m.id === 'input' && asMode === 'input' ? ' is-on' : '') + '" data-asmode="' + m.id + '"' +
      (asBusy && m.id !== 'input' ? ' disabled' : '') + '>' + esc(m.label) + '</button>';
  }).join('');
}
function asHead(){
  if (!AS) return;
  var name = String(AS.modelName || AS.model || 'модель не выбрана').replace(/^[^:]{1,30}:\s*/, '');
  document.getElementById('asModelName').textContent = name;
  /* Длинное имя в шапке обрезается — полностью оно в подсказке. */
  document.getElementById('asModel').title = name + ' — сменить в настройках';
  document.getElementById('asQuick').innerHTML = asQuickHTML();
  document.getElementById('asQuick').hidden = !AS.hasKey;
  document.querySelector('#asPanel .asst-foot').hidden = !AS.hasKey;
  var t = AS.today.split('-').map(Number);
  document.getElementById('asCtx').textContent = 'контекст: ' + (AS_SCREEN[current] || 'Обзор') + ' · ' + AS_MON[t[1] - 1] + ' ' +
    t[0] + ' · ' + AS.accounts.length + NBSP + plural(AS.accounts.length, 'счёт', 'счёта', 'счетов');
  /* Сколько ассистент стоил в этом месяце — рядом, чтобы не было сюрпризов. */
  var usd2 = function(n){ return '$' + (Math.round(Number(n) * 100) / 100).toFixed(2).replace('.', ','); };
  document.getElementById('asSpent').textContent = AS.limit > 0 ? usd2(AS.spent) + ' из ' + usd2(AS.limit) : usd2(AS.spent);
  document.getElementById('asReset').hidden = !asFeedList.length;
  var inp = document.getElementById('asInput');
  inp.placeholder = asMode === 'input' ? 'вчера 1200 пятёрочка и 340 кофе' : 'Спросите или продиктуйте операцию';
  document.getElementById('asSend').disabled = asBusy;
}

/* ---------- открыть, спросить, сохранить ---------- */
function asToggle(on){
  asIsOpen = on;
  document.getElementById('asPanel').classList.toggle('is-on', on);
  document.getElementById('asDim').classList.toggle('is-on', on);
  document.getElementById('asPanel').setAttribute('aria-hidden', on ? 'false' : 'true');
  if (!on) return Promise.resolve();
  return window.api.assistantMeta().then(function(m){
    if (m && !m.error) AS = m;
    asHead();
    asRender(false);
    var inp = document.getElementById('asInput');
    if (inp && AS && AS.hasKey) inp.focus();
    return asLoadReports();
  });
}
/* Авто-отчёты, которых человек ещё не видел, — в ленту, с заголовком
   периода. Прочитанный отчёт попадает в память разговора: можно сразу
   спросить «почему так много». */
function asLoadReports(){
  return window.api.reports().then(function(list){
    if (!Array.isArray(list) || !list.length) return;
    list.forEach(function(r){
      asFeedList.push({ who: 'bot', title: r.title, answer: r.answer, text: r.answer.text, decision: r.answer.judgment,
                        cost: r.answer.cost, report: true });
    });
    asRender(true);
    return window.api.reportsRead(list.map(function(r){ return r.period; })).then(function(){
      document.getElementById('headAssistant').classList.remove('has-news');
      return window.api.assistantMeta().then(function(m){ if (m && !m.error) AS = m; asHead(); });
    });
  });
}
function asAsk(q){
  if (asBusy || !AS || !AS.hasKey) return;
  var mode = AS.modes.filter(function(m){ return m.id === q.mode; })[0];
  asFeedList.push({ who: 'me', text: q.mode && q.mode !== 'input' ? mode.label + (q.text ? ' — ' + q.text : '') : q.text });
  asLastQ = q;
  asBusy = true; asState = null; asSteps = []; asStarted = Date.now();
  clearInterval(asTick);
  asTick = setInterval(function(){
    var el = document.getElementById('asElapsed');
    if (el) el.textContent = Math.round((Date.now() - asStarted) / 1000) + NBSP + 'с';
  }, 1000);
  asHead(); asRender(true);
  q.screen = current;
  q.view = asView();
  window.api.assistantAsk(q).then(function(r){
    asBusy = false;
    clearInterval(asTick);
    if (!r || !r.ok){
      asState = { kind: r && r.state === 'limit' ? 'limit' : r && r.state === 'offline' ? 'offline'
                       : r && r.state === 'stopped' ? 'stopped' : 'error',
                  error: r && r.error, auth: r && r.auth, spent: r && r.spent, limit: r && r.limit, reset: r && r.reset };
    } else {
      asFeedList.push({ who: 'bot', text: r.text, answer: r.answer, decision: r.decision, cost: r.cost,
        cards: (r.cards || []).map(function(c){ c.on = !c.error; return c; }),
        saved: r.saved, undo: r.saved && r.saved.ok ? r.saved.undo : null });
      if (r.saved && r.saved.ok) draw();
    }
    window.api.assistantMeta().then(function(m){ if (m && !m.error) AS = m; asHead(); });
    asRender(true);
  });
}
/* Что выбрано на экране: ассистент получает данные того же периода и
   дня, что видит человек. */
function asView(){
  if (current === 'expenses') return { unit: exUnit, offset: exOffset, custom: exCustom, cats: exFlt.cats.slice(0, 3) };
  if (current === 'calendar'){
    var t = AS ? AS.today.split('-').map(Number) : null;
    var mo = clMonth ? clMonth.year + '-' + String(clMonth.month + 1).padStart(2, '0')
                     : t ? t[0] + '-' + String(t[1]).padStart(2, '0') : null;
    return { month: mo, day: clSel || null };
  }
  return null;
}
function asSend(){
  var inp = document.getElementById('asInput');
  var text = inp.value.trim();
  if (!text || asBusy) return;
  inp.value = ''; asGrow(inp);
  asAsk({ text: text, mode: asMode === 'input' ? 'input' : null });
}
function asSave(mi, all){
  var m = asFeedList[mi];
  var list = m.cards.filter(function(c){ return all || c.on !== false; });
  if (!list.length) return;
  window.api.assistantSave(list).then(function(r){
    if (!r || !r.ok){
      /* Ошибка называет номер операции — показываем её на карточке. */
      var n = /^Операция (\d+):\s*(.*)$/.exec((r && r.error) || '');
      if (n) list[Number(n[1]) - 1].error = n[2];
      else toast('Не сохранилось: ' + ((r && r.error) || 'ошибка базы'));
      asRender(false);
      return;
    }
    m.cardsState = 'saved'; m.undo = r.undo;
    fmToast('Записано операций: ' + r.added, r.undo);
    asRender(false);
    draw();
  });
}
/* Поле с датой и суммой в карточке — тем же разбором, что окна ввода. */
function asCardInput(el){
  var m = asFeedList[Number(el.getAttribute('data-m'))], c = m.cards[Number(el.getAttribute('data-c'))];
  var k = el.getAttribute('data-k');
  c.error = '';
  if (k === 'on'){ c.on = el.checked; asRender(false); return; }
  if (k === 'date'){ var d = exParseDate(el.value); if (d) c.date = d; else c.error = 'Дата: ждём 01.10.2026'; }
  else if (k === 'amount'){ var p = fmParse(el.value); if (p.ok && p.cents > 0) c.amount = String(p.cents); else c.error = 'Сумма: не число'; }
  else c[k] = el.value;
}
function asGrow(el){ el.style.height = 'auto'; el.style.height = Math.min(120, Math.max(38, el.scrollHeight)) + 'px'; }

function asInit(){
  var layer = document.getElementById('asLayer');
  if (window.api.onAssistantStep) window.api.onAssistantStep(asOnStep);
  /* Готов авто-отчёт: точка на кнопке, а если панель открыта — сразу в ленту. */
  window.api.onReport(function(s){
    document.getElementById('headAssistant').classList.toggle('has-news', !!(s && s.unread > 0) && hasAiKey);
    if (asIsOpen && !asBusy) asLoadReports();
  });
  layer.addEventListener('click', function(e){
    var t = e.target.closest ? e.target : null;
    if (!t) return;
    if (t.id === 'asDim' || t.closest('#asClose')){ asToggle(false); return; }
    if (t.closest('#asModel')){ asToggle(false); sgSec = 'asst'; goTo('settings'); return; }
    if (t.closest('#asSend')){ asSend(); return; }
    if (t.closest('#asReset')){
      window.api.assistantReset().then(function(){ asFeedList = []; asState = null; asHead(); asRender(false); });
      return;
    }
    var chip = t.closest('[data-asmode]');
    if (chip){
      var id = chip.getAttribute('data-asmode');
      if (id === 'input'){ asMode = asMode === 'input' ? null : 'input'; asHead(); document.getElementById('asInput').focus(); return; }
      var extra = document.getElementById('asInput').value.trim();
      document.getElementById('asInput').value = '';
      asAsk({ mode: id, text: extra });
      return;
    }
    var act = t.closest('[data-asact]');
    if (!act) return;
    var a = act.getAttribute('data-asact'), mi = Number(act.getAttribute('data-m'));
    if (a === 'stop') window.api.assistantStop();
    else if (a === 'retry'){ if (asLastQ){ asFeedList.pop(); asAsk(asLastQ); } }
    else if (a === 'settings'){ asToggle(false); sgSec = 'asst'; goTo('settings'); }
    else if (a === 'save-all') asSave(mi, true);
    else if (a === 'save-sel') asSave(mi, false);
    else if (a === 'cancel'){ asFeedList[mi].cardsState = 'cancelled'; asRender(false); }
    else if (a === 'undo'){
      var tok = asFeedList[mi].undo;
      asFeedList[mi].undo = null;
      window.api.undo(tok).then(function(r){
        fmToast(r && r.ok ? 'Отменено' : 'Не отменилось: ' + ((r && r.error) || 'прошло больше минуты'), null);
        if (r && r.ok){ asFeedList[mi].cardsState = 'cancelled'; asFeedList[mi].saved = null; }
        asRender(false);
        draw();
      });
    }
  });
  layer.addEventListener('change', function(e){
    if (e.target.getAttribute && e.target.getAttribute('data-c') !== null){ asCardInput(e.target); asRender(false); }
  });
  layer.addEventListener('input', function(e){
    if (e.target.id === 'asInput') asGrow(e.target);
  });
  layer.addEventListener('keydown', function(e){
    /* Enter отправляет, Shift+Enter — новая строка. */
    if (e.target.id === 'asInput' && e.key === 'Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); asSend(); }
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && asIsOpen && !fmKind){ e.preventDefault(); asToggle(false); }
  });
}
