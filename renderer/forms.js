'use strict';
/* ============================================================
   ОКНА ВВОДА
   ============================================================
   Перенесено из макета Main App/screens/08-formy.html: меню «Добавить»
   в шапке, окна операций, справочников и сверки, тост с отменой и
   горячие клавиши. В макете окна только показывали тост — здесь они
   пишут в базу через главный процесс, а «Отменить» действительно
   отменяет записанное.

   Окно пересобирается на каждый ввод — так в макете, и так предпросмотр
   всегда честен. Поле с курсором после пересборки возвращается на место.
   Имена начинаются с fm.
   ============================================================ */
var FD = null;                  /* данные для форм */
var fmKind = null;              /* открытое окно */
var fmSt = null;                /* его состояние */
var fmToastTimer = null;
var fmUndoToken = null;
var fmLastUndo = null;       /* последняя запись — для ⌘Z, пока её можно отменить */
var fmBusy = false;
var fmLoanTok = 0, fmReconTok = 0;

var FM_TITLES = { expense: 'Расход', income: 'Доход', transfer: 'Перевод между своими',
  plan: 'Плановая покупка', recur: 'Регулярный платёж', goal: 'Цель накопления', account: 'Счёт',
  loan: 'Кредит или долг', recon: 'Сверка балансов', cat: 'Категория', merge: 'Объединение категорий',
  'export': 'Выгрузка таблиц', 'import': 'Загрузка операций', integrity: 'Проверка целостности',
  changelog: 'Журнал изменений', models: 'Выбор модели', keys: 'Горячие клавиши',
  plansave: 'Отложить под покупку', question: 'Новый вопрос' };
/* Окна настроек: справочник категорий и отчёты. */
var FM_MISC = ['cat', 'merge', 'export', 'import', 'integrity', 'changelog', 'models', 'keys', 'plansave', 'question'];
var FM_TABLES = [['transactions', 'Журнал операций'], ['accounts', 'Счета'], ['categories', 'Категории'],
  ['recurring', 'Регулярные платежи'], ['liabilities', 'Кредиты и долги'], ['planned', 'Планы покупок'],
  ['savings_goals', 'Цели накоплений'], ['balances_history', 'Снимки балансов']];
var FM_OPS = ['expense', 'income', 'transfer'];
var FM_QUADS = {
  'need|hot':  ['Купить сейчас',    'Нужно и горит'],
  'want|hot':  ['Осознанная трата', 'Хочется, но срок поджимает'],
  'need|cold': ['Запланировать',    'Нужно, но не срочно'],
  'want|cold': ['Подождать',        'Хочется и не горит']
};
var FM_PERIODS = [['w', 'неделя'], ['m', 'месяц'], ['q', 'квартал'], ['y', 'год']];
var FM_MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь',
  'декабрь'].map(function(m, i){ return [String(i + 1), m]; });
var FM_WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
var FM_PAY_TYPES = ['обязательный', 'добровольный', 'доход'];
var FM_ACC_TYPES = [['debit', 'дебетовая карта'], ['credit', 'кредитная карта'], ['current', 'текущий счёт'],
                    ['cash', 'наличные'], ['savings', 'копилка или накопления'], ['broker', 'брокерский счёт'], ['crypto', 'криптокошелёк']];
var FM_LOAN_TYPES = ['потребительский кредит', 'автокредит', 'ипотека', 'долг человеку'];
var FM_BASE_TAGS = ['спонтанная', 'по плану', 'регулярный'];
var FM_X = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
  '<path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
var FM_TICK = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
  '<path pathLength="1" d="M2 6.2 4.6 8.6 10 2.8" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ============================================================
   СУММА С АРИФМЕТИКОЙ
   ============================================================
   Поле понимает «450+120» и «1200-300». Без eval: строка разбирается
   на числа и знаки вручную, в целых копейках. Больше двух знаков после
   запятой — не угадываем, а говорим, что не поняли.               */
function fmParse(raw){
  var s = String(raw === null || raw === undefined ? '' : raw).replace(/[\s ]/g, '').replace(/,/g, '.');
  if (!s) return { ok: true, cents: 0, expr: false, empty: true };
  if (!/^[0-9.+\-]+$/.test(s)) return { ok: false };
  var parts = (s.match(/[+\-]?[0-9]*\.?[0-9]*/g) || []).filter(function(x){ return x && x !== '+' && x !== '-'; });
  if (parts.join('') !== s) return { ok: false };
  var total = 0;
  for (var i = 0; i < parts.length; i++){
    var m = /^([+\-]?)(\d*)(?:\.(\d{0,2}))?$/.exec(parts[i]);
    if (!m || (i > 0 && !m[1]) || (m[2] === '' && !m[3])) return { ok: false };
    var c = Number(m[2] || '0') * 100 + Number(((m[3] || '') + '00').slice(0, 2));
    total += m[1] === '-' ? -c : c;
  }
  return { ok: true, cents: total, expr: /[+\-]/.test(s.slice(1)) };
}
function fmC(cents){ return money(String(Math.round(cents))); }
function fmC0(cents){ return money0(String(Math.round(cents))); }
function fmRaw(cents){
  var c = Math.round(Number(cents)), sign = c < 0 ? '-' : '';
  c = Math.abs(c);
  return sign + Math.floor(c / 100) + (c % 100 ? ',' + ('0' + c % 100).slice(-2) : '');
}
/* Категория из подсказки — только если она есть в закрытом списке. */
function fmCatOr(name, list, fallback){
  var names = list.map(function(c){ return c.name; });
  return names.indexOf(name) >= 0 ? name : (fallback === undefined ? names[0] || '' : fallback);
}
function fmAcc(id){ return FD.accounts.filter(function(a){ return a.id === id; })[0] || null; }
function fmPay(){ return FD.accounts.filter(function(a){ return a.isPayment; })[0] || FD.accounts[0] || {}; }
function fmCard(){ return FD.accounts.filter(function(a){ return a.isCredit; })[0] || null; }

/* ---------- валюты ----------
   Счёт бывает в рублях, долларах или евро. Сумма в окне — в валюте
   счёта; пересчёт в рубли и между валютами — по курсу ЦБ на дату, из
   курсов, пришедших вместе с данными окна. Запись проверяет и считает
   главный процесс — здесь только подсказки. */
var FM_CURS = [['RUB', 'Рубли — ₽'], ['USD', 'Доллары — $'], ['EUR', 'Евро — €']];
var FM_CUR_IN = { RUB: 'рублях', USD: 'долларах', EUR: 'евро' };
function fmSym(cur){ return cur === 'USD' ? '$' : cur === 'EUR' ? '€' : '₽'; }
function fmCurOf(id){ var a = fmAcc(id); return (a && a.cur) || 'RUB'; }
/* «500,00 $», целыми — «500 $». */
function fmIn(cents, cur, whole){
  var s = whole ? fmC0(cents) : fmC(cents);
  return cur && cur !== 'RUB' ? s.replace(/₽$/, fmSym(cur)) : s;
}
/* Остаток счёта в его валюте. */
function fmNat(a){ return Number(a.native !== undefined ? a.native : a.balance); }
/* Курс на день: последний не позже дня, раньше первого — первый. 0 — нет. */
function fmRate(cur, day){
  if (!cur || cur === 'RUB') return 10000;
  var l = FD.fx && FD.fx[cur];
  if (!l || !l.length) return 0;
  var r = l[0][1];
  for (var i = 0; i < l.length && l[i][0] <= (day || FD.today); i++) r = l[i][1];
  return Number(r);
}
function fmConv(cents, from, to, day){
  if (from === to) return cents;
  var a = fmRate(from, day), b = fmRate(to, day);
  if (!a || !b) return null;
  var rub = from === 'RUB' ? cents : Math.round(cents * a / 10000);
  return to === 'RUB' ? rub : Math.round(rub * 10000 / b);
}
/* «1 $ = 84,91 ₽» — для подписи к пересчёту. */
function fmEnsureRate(cur){
  window.api.fxEnsure(cur).then(function(t){
    if (!t || t.error || !FD) return;
    FD.fx = t;
    if (fmKind) fmRender();
  });
}
function fmRateNote(curs, day){
  return curs.filter(function(c, i){ return c !== 'RUB' && curs.indexOf(c) === i; }).map(function(c){
    var r = fmRate(c, day);
    return r ? '1' + NBSP + fmSym(c) + ' = ' + (r / 10000).toFixed(2).replace('.', ',') + NBSP + '₽' : '';
  }).filter(Boolean).join(', ');
}
/* Суммы операции: введённая (v, в валюте cur), в валюте счёта (nat), у
   перевода в другую валюту — пришедшая (natTo) и по ЦБ (auto), в рублях
   (rub). null — без курса не пересчитать. */
function fmOpSums(st){
  var a = fmParse(st.raw), v = a.ok ? a.cents : 0;
  if (st.kind === 'transfer'){
    var cf = fmCurOf(st.from), ct = fmCurOf(st.to), auto = null, to = v;
    if (cf !== ct){
      auto = fmConv(v, cf, ct, st.date);
      var t = fmParse(st.rawTo);
      to = st.rawTo && t.ok && !t.empty ? t.cents : auto;
    }
    return { v: v, cur: cf, nat: v, accCur: cf, toCur: ct, natTo: to, auto: auto, cross: cf !== ct,
             rub: cf === 'RUB' ? v : ct === 'RUB' ? to : fmConv(v, cf, 'RUB', st.date) };
  }
  var c = fmCurOf(st.kind === 'income' ? st.to : st.from), tc = st.cur || c;
  var nat = tc === c ? v : fmConv(v, tc, c, st.date);
  return { v: v, cur: tc, nat: nat, accCur: c, rub: nat === null ? null : c === 'RUB' ? nat : fmConv(nat, c, 'RUB', st.date) };
}
function fmDaysAgo(iso){
  var a = FD.today.split('-').map(Number), b = iso.split('-').map(Number);
  return Math.round((new Date(a[0], a[1] - 1, a[2]) - new Date(b[0], b[1] - 1, b[2])) / 86400000);
}
function fmShift(iso, days){ return exShift(iso, days); }

/* ============================================================
   СОСТОЯНИЕ ОКОН
   ============================================================ */
function fmNewOp(kind, pre){
  pre = pre || {};
  var pay = fmPay(), card = fmCard();
  var other = FD.accounts.filter(function(a){ return a.id !== pay.id; })[0] || pay;
  var st = {
    kind: kind, raw: pre.amount ? fmRaw(pre.amount) : '',
    date: pre.date && pre.date <= FD.today ? pre.date : FD.today,
    from: pre.from || pay.id,
    to: pre.to || (kind === 'transfer' ? (card ? card.id : other.id) : pay.id),
    cat: kind === 'income' ? fmCatOr(pre.category, FD.cats.inc) : fmCatOr(pre.category, FD.cats.exp, ''),
    catQuery: '', desc: pre.desc || '', tags: {}, once: false, goal: pre.goal || '',
    showCur: false, dismissed: {}, newCat: null, err: '', planId: pre.planId || null,
    /* cur — валюта ввода, пусто — валюта счёта; rawTo — сколько пришло у
       перевода в другую валюту. */
    cur: pre.cur || '', rawTo: pre.amountTo ? fmRaw(pre.amountTo) : ''
  };
  if (st.cur) st.showCur = true;
  st.dateTxt = exRuDate(st.date);
  (pre.tags || []).forEach(function(t){ st.tags[t] = true; });
  return st;
}
function fmNewRef(kind, pre){
  pre = pre || {};
  var pay = fmPay(), today = FD.today;
  if (kind === 'plan'){
    var p = pre.id ? FD.plans.filter(function(x){ return x.id === Number(pre.id); })[0] : null;
    return p ? { kind: kind, id: p.id, name: p.name, cat: fmCatOr(p.cat, FD.cats.exp), min: fmRaw(p.min),
                 max: p.max !== p.min ? fmRaw(p.max) : '', need: p.need, urg: p.urg, repl: p.repl,
                 own: Number(p.own) ? fmRaw(p.own) : '', deadlineTxt: p.deadline ? exRuDate(p.deadline) : '',
                 note: p.note || '', err: '' }
             : { kind: kind, name: '', cat: fmCatOr('Одежда и быт', FD.cats.exp), min: '', max: '', need: 'need',
                 urg: 'cold', repl: false, own: '', deadlineTxt: pre.deadline ? exRuDate(pre.deadline) : '', note: '',
                 err: '' };
  }
  if (kind === 'recur'){
    var r = pre.id ? FD.recurring.filter(function(x){ return x.id === Number(pre.id); })[0] : null;
    if (r){
      var every = { month: 'm', week: 'w', quarter: 'q', year: 'y' }[r.period] || 'm';
      return { kind: kind, id: r.id, name: r.name,
               cat: fmCatOr(r.cat, r.dir === 'доход' ? FD.cats.inc : FD.cats.exp), fixed: r.amountTo === null,
               amount: fmRaw(r.amount), amountTo: r.amountTo === null ? '' : fmRaw(r.amountTo), every: every,
               day: String(r.day || ''), wday: String(r.wday || 1), month: String(r.month || (Number(FD.today.slice(5, 7)))),
               accId: r.accId || pay.id,
               type: r.dir === 'доход' ? 'доход' : r.obligatory ? 'обязательный' : 'добровольный',
               untilTxt: r.until ? exRuDate(r.until) : '', note: r.note || '', err: '' };
    }
    return { kind: kind, name: '', cat: fmCatOr('Подписки и связь', FD.cats.exp), fixed: true, amount: '',
             amountTo: '', every: 'm', month: String(Number(FD.today.slice(5, 7))),
             day: '', wday: '1', accId: pay.id, type: 'обязательный', untilTxt: '', note: pre.note || '', err: '' };
  }
  if (kind === 'goal'){
    var g = pre.id ? FD.goals.filter(function(x){ return x.id === Number(pre.id); })[0] : null;
    return g ? { kind: kind, id: g.id, name: g.name, accId: g.accountId || pay.id,
                 target: g.target ? fmRaw(g.target) : '', deadlineTxt: g.deadline ? exRuDate(g.deadline) : '',
                 monthly: g.monthly ? fmRaw(g.monthly) : '', err: '' }
             : { kind: kind, name: '', accId: (FD.accounts.filter(function(a){ return !a.isPayment && !a.isCredit; })[0]
                                               || pay).id, target: '', deadlineTxt: '', monthly: '', err: '' };
  }
  if (kind === 'account'){
    /* Правка счёта: тип и остаток не меняются — остаток считается по
       операциям, поправить его можно сверкой. */
    var acc = pre.id ? fmAcc(pre.id) : null;
    if (acc){
      return { kind: kind, id: acc.id, name: acc.name, bank: acc.bank || '—', typeText: acc.type, isCredit: acc.isCredit,
               balance: acc.balance, native: fmNat(acc), cur: acc.cur || 'RUB', wasCur: acc.cur || 'RUB', ops: acc.ops || 0,
               isPay: acc.isPayment, wasPay: acc.isPayment,
               limit: acc.limit === null ? '' : fmRaw(acc.limit), graceDay: String(acc.graceDay || ''),
               statementDay: acc.statementDay ? String(acc.statementDay) : '', graceLeft: acc.graceLeft ? fmRaw(acc.graceLeft) : '',
               graceRule: acc.graceNote || '', err: '' };
    }
    return { kind: kind, name: '', bank: FD.banks[0], type: 'debit', cur: 'RUB', bal: '', balDateTxt: exRuDate(today),
             isPay: true, limit: '', avail: '', graceDay: '21', statementDay: '', graceLeft: '', graceRule: '', err: '' };
  }
  /* Кредит открывается заполненным: форма служит и для правки. */
  var l = FD.loan;
  if (l){
    var initial = l.initial ? Number(l.initial) : null;
    return { kind: kind, existing: true, creditor: l.creditor, type: l.type,
             initial: initial ? fmRaw(initial) : '', rest: fmRaw(l.rest),
             rate: l.rateBp === null ? '' : String(l.rateBp / 100).replace('.', ','),
             pay: l.pay ? fmRaw(l.pay) : '', day: String(l.day || ''), closeTxt: l.close ? exRuDate(l.close) : '',
             paid: initial ? fmRaw(initial - Number(l.rest)) : '', inOblig: l.inOblig, focus: pre.focus || '',
             preview: null, err: '' };
  }
  return { kind: kind, existing: false, creditor: '', type: 'потребительский кредит', initial: '', rest: '', rate: '',
           pay: '', day: '', closeTxt: '', paid: '', inOblig: true, preview: null, err: '' };
}
function fmNewRecon(){
  return { kind: 'recon', date: FD.today, dateTxt: exRuDate(FD.today), vals: {}, skip: {}, calc: null,
           matched: {}, err: '' };
}

/* ============================================================
   ПРОВЕРКА АНОМАЛИЙ
   ============================================================
   Предупреждения не блокируют сохранение — они требуют, чтобы человек
   их увидел и нажал кнопку осознанно.                               */
function fmAnomalies(st){
  var out = [], a = fmParse(st.raw);
  if (!a.ok || !(a.cents > 0) || !st.date) return out;
  /* Медиана и дубли — в рублях, как в учёте; минус — в валюте счёта. */
  var S = fmOpSums(st), v = S.rub === null ? a.cents : S.rub;
  if (st.kind === 'expense'){
    var med = Number(FD.median[st.cat] || 0);
    if (med && v > med * 3){
      out.push({ id: 'median', text: '<b>Для «' + esc(st.cat) + '» это в ' + (v / med).toFixed(1).replace('.', ',') +
        ' раза больше обычного.</b> Медиана по категории — ' + fmC0(med) + '.' });
    }
    var dup = (FD.dayOps[st.date] || []).filter(function(o){
      return o.dir === 'расход' && st.desc.trim() && o.desc.toLowerCase() === st.desc.trim().toLowerCase() &&
             Math.abs(Number(o.sum) - v) <= Math.max(100, v * 0.1);
    })[0];
    if (dup){
      out.push({ id: 'dup', act: 'Это дубль, отменить',
        text: '<b>Похожая операция уже есть за этот день:</b> ' + esc(dup.desc) + ' · ' + money(dup.sum) +
              (dup.acc ? ' · ' + esc(dup.acc) : '') + '.' });
    }
  }
  var src = st.kind === 'income' ? null : fmAcc(st.from);
  if (src && !src.isCredit && S.nat !== null && fmNat(src) - S.nat < 0){
    out.push({ id: 'neg', neg: true, text: '<b>Операция уводит счёт в минус:</b> на «' + esc(src.name) + '» ' +
      fmIn(fmNat(src), src.cur) + ', после операции ' + fmIn(fmNat(src) - S.nat, src.cur) + '.' });
  }
  var ago = fmDaysAgo(st.date);
  if (ago > 7){
    out.push({ id: 'late', act: 'Пометить «поздняя запись»',
      text: '<b>Дата более чем на неделю в прошлом</b> — ' + plGDays(ago) + ' назад.' });
  }
  return out.filter(function(w){ return !st.dismissed[w.id]; });
}

/* ============================================================
   ПРЕДПРОСМОТР ВЛИЯНИЯ
   ============================================================ */
function fmPreview(st){
  var S = fmOpSums(st), v = S.nat || 0, rows = [];
  /* Остатки — в валюте счёта, лимит на сегодня — в рублях. */
  var row = function(k, acc, was, now, cur){
    return '<div class="prev-row"><span class="k">' + k + (acc ? ' · ' + esc(acc) : '') + '</span>' +
      '<span class="spacer"></span><span class="v was">' + fmIn(was, cur, true) + '</span><span class="k">→</span>' +
      '<span class="v' + (now < 0 ? ' c-neg' : '') + '">' + fmIn(now, cur, true) + '</span></div>';
  };
  if (st.kind === 'expense'){
    var s = fmAcc(st.from);
    if (s){
      rows.push(row('Счёт', s.name, fmNat(s), fmNat(s) - v, s.cur));
      /* Лимит — тот же, что «Можно потратить сегодня» на «Обзоре»; если
         сегодня уже тратили, строка показывает, сколько от него осталось. */
      if (s.isPayment && st.date === FD.today && FD.dayLimit !== null){
        var spent = Number(FD.spentToday || 0), left = Number(FD.dayLimit) - spent;
        rows.push(row(spent ? 'Осталось на сегодня' : 'Лимит на сегодня', null, left, left - (S.rub || 0)));
      }
    }
  } else if (st.kind === 'income'){
    var t = fmAcc(st.to);
    if (t) rows.push(row('Счёт', t.name, fmNat(t), fmNat(t) + v, t.cur));
  } else {
    var f = fmAcc(st.from), g = fmAcc(st.to), vt = S.natTo || 0;
    if (f) rows.push(row('Откуда', f.name, fmNat(f), fmNat(f) - v, f.cur));
    if (g) rows.push(row('Куда', g.name, fmNat(g), fmNat(g) + vt, g.cur));
    v = vt;           /* дальше — пополнение кредитки: она рублёвая, считаем пришедшее */
    /* Перевод на кредитку засчитывается в условие грейса — это и есть
       смысл операции, поэтому пояснение показывается всегда. */
    if (g && g.isCredit && FD.grace && FD.grace.cardId === g.id){
      var gr = FD.grace, paid = Number(gr.paid), need = Number(gr.need);
      rows.push('<div class="prev-note"><b>Это пополнение кредитки.</b> Зачтётся в условие грейса: ' +
        (need > 0 ? 'внести ' + fmC0(need) + ' за цикл до ' + humanDate(gr.due) + '. '
                  : 'на начало цикла долга не было, закрыть нужно то, что потрачено до ' + humanDate(gr.due) + '. ') +
        'В этом цикле уже внесено ' + fmC(paid) + (v ? ', станет ' + fmC(paid + v) : '') +
        (need > 0 ? (paid + v >= need ? ' — условие выполнено.' : ' — до условия не хватает ' +
          fmC(need - paid - v) + '.') : '.') + '</div>');
    }
  }
  return rows.join('');
}

/* ============================================================
   ОКНО ОПЕРАЦИИ
   ============================================================ */
function fmAccOptions(sel){
  return FD.accounts.map(function(a){
    return '<option value="' + esc(a.id) + '"' + (a.id === sel ? ' selected' : '') + '>' + esc(a.name) + ' — ' +
           fmIn(fmNat(a), a.cur, true) + '</option>';
  }).join('');
}
function fmCombo(st){
  var list = st.kind === 'income' ? FD.cats.inc : FD.cats.exp;
  var q = st.catQuery.trim().toLowerCase();
  var found = list.filter(function(c){ return !q || c.name.toLowerCase().indexOf(q) !== -1; });
  var opts = found.map(function(c){
    return '<button type="button" class="combo-opt' + (c.name === st.cat ? ' is-on' : '') + '" data-cat="' +
      esc(c.name) + '">' + esc(c.name) + '<span class="type">' + c.type + '</span></button>';
  }).join('') || '<div class="combo-opt" style="color:var(--text-3);cursor:default">Ничего не найдено</div>';
  var recent = st.kind === 'expense' && !q ? FD.recentExp : [];
  var types = st.kind === 'income' ? ['доход'] : FD.catTypes.filter(function(t){ return t !== 'доход'; });
  return '<div class="combo">' +
    '<input class="inp" type="text" data-f="catQuery" placeholder="Начните вводить название" value="' +
      esc(st.catQuery) + '" autocomplete="off">' +
    (recent.length ? '<div class="combo-recent">' + recent.map(function(c){
      return '<button type="button" class="chip' + (c === st.cat ? ' is-on' : '') + '" data-cat="' + esc(c) + '">' +
             esc(c) + '</button>'; }).join('') + '</div>' : '') +
    '<div class="combo-list">' + opts +
      '<button type="button" class="combo-opt combo-new" data-newcat="1">Добавить категорию…</button></div>' +
    /* Новая категория — только с типом: закрытый список не пополняется
       опечаткой, а только осознанным подтверждением. */
    (st.newCat ? '<div class="newcat"><div class="f-row">' +
      '<div class="f"><div class="f-lbl">Новая категория</div><input class="inp" type="text" data-f="newCatName" ' +
        'value="' + esc(st.newCat.name) + '" placeholder="Название"></div>' +
      '<div class="f"><div class="f-lbl">Тип — обязательно</div><select class="inp" data-f="newCatType">' +
        '<option value="">выберите</option>' + types.map(function(t){
          return '<option' + (st.newCat.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
      '</select></div></div>' +
      '<div class="quick"><button type="button" class="btn btn-sm btn-sm--acc" data-newcat-save="1">Добавить</button>' +
        '<button type="button" class="btn btn-sm" data-newcat-cancel="1">Отмена</button></div></div>' : '') +
  '</div>';
}
/* Подпись под суммой: во что она превратится. Сумма в другой валюте —
   сколько спишется со счёта по курсу ЦБ; сумма валютного счёта — во
   сколько рублей она войдёт в траты. */
function fmCurHint(st, S){
  var dd = humanDate(st.date || FD.today), warn = function(t){ return '<div class="f-hint" style="color:var(--warning)">' + t + '</div>'; };
  if (!S.v) return '';
  if (st.kind === 'transfer') return '';
  if (S.cur !== S.accCur){
    if (S.nat === null) return warn('Курса на ' + dd + ' нет — обновите курсы в «Настройках» → «Расчёты» или впишите сумму в ' +
      FM_CUR_IN[S.accCur] + '.');
    return '<div class="f-hint">= <b>' + fmIn(S.nat, S.accCur) + '</b> ' + (st.kind === 'income' ? 'придёт на счёт' : 'спишется со счёта') +
      ' по курсу ЦБ на ' + dd + ' (' + fmRateNote([S.cur, S.accCur], st.date) + '). Банк считает по своему курсу — если знаете ' +
      'точную сумму, впишите её в ' + FM_CUR_IN[S.accCur] + '.</div>';
  }
  if (S.accCur !== 'RUB'){
    if (S.rub === null) return warn('Курса на ' + dd + ' нет — в рублёвых суммах операция не посчитается, пока его нет.');
    return '<div class="f-hint">В ' + (st.kind === 'income' ? 'доходах' : 'тратах') + ' — ' + fmIn(S.rub, 'RUB') +
      ' по курсу ЦБ на ' + dd + ' (' + fmRateNote([S.accCur], st.date) + ').</div>';
  }
  return '';
}
function fmOpHTML(st){
  var k = st.kind, a = fmParse(st.raw), descs = FD.descs[st.cat] || [], body = '';
  var S = fmOpSums(st);

  /* Сумма — первое поле: с неё начинается воспоминание об операции. В
     валюте счёта; «Другая валюта» — у расхода и дохода: у перевода в
     другую валюту вторая сумма своя. */
  body += '<div class="f"><div class="f-lbl">' + (S.cross ? 'Ушло со счёта' : 'Сумма') + (S.cur !== 'RUB' || S.cross ? ' в ' + FM_CUR_IN[S.cur] : '') +
      '<span class="spacer"></span>' +
      (st.showCur || k === 'transfer' ? '' : '<button type="button" class="link-btn" data-f="showCur">Другая валюта</button>') + '</div>' +
    '<input class="inp inp--amt" type="text" inputmode="decimal" data-f="raw" autocomplete="off" placeholder="0" value="' +
      esc(st.raw) + '">' +
    (st.raw && !a.ok ? '<div class="f-hint" style="color:var(--warning)">Не удалось разобрать: можно вводить число или ' +
      'сумму вида 450+120</div>' : '') +
    (a.ok && a.expr ? '<div class="f-hint">= <b>' + fmIn(a.cents, S.cur) + '</b></div>' : '') +
    (st.showCur && k !== 'transfer' ? '<div style="margin-top:8px"><select class="inp" data-f="cur" aria-label="Валюта суммы">' +
      FM_CURS.map(function(o){ return '<option value="' + o[0] + '"' + (o[0] === S.cur ? ' selected' : '') + '>' + o[1] +
        (o[0] === S.accCur ? ' — валюта счёта' : '') + '</option>'; }).join('') + '</select></div>' : '') +
    fmCurHint(st, S) +
  '</div>';

  body += '<div class="f"><div class="f-lbl">Дата</div>' +
    '<input class="inp" type="text" inputmode="numeric" data-f="dateTxt" placeholder="дд.мм.гггг" value="' +
      esc(st.dateTxt) + '" autocomplete="off">' +
    (!st.date ? '<div class="f-hint" style="color:var(--warning)">Дата не понята — ждём 01.10.2026</div>'
      : st.date > FD.today ? '<div class="f-hint" style="color:var(--warning)">Дата в будущем: будущие платежи ' +
        'заводятся в регулярных</div>' : '') +
    '<div class="quick">' + ['Сегодня', 'Вчера', 'Позавчера'].map(function(t, i){
      var d = fmShift(FD.today, -i);
      return '<button type="button" class="chip' + (st.date === d ? ' is-on' : '') + '" data-date="' + d + '">' + t + '</button>';
    }).join('') + '</div></div>';

  if (k === 'transfer'){
    body += '<div class="f-row" style="margin-bottom:15px">' +
      '<div class="f"><div class="f-lbl">Счёт-источник</div><select class="inp" data-f="from">' + fmAccOptions(st.from) + '</select></div>' +
      '<div class="f"><div class="f-lbl">Счёт-получатель</div><select class="inp" data-f="to">' + fmAccOptions(st.to) + '</select></div>' +
    '</div>';
    /* Покупка или продажа валюты: банк меняет по своему курсу, поэтому
       пришедшее вписывают; пусто — по курсу ЦБ. */
    if (S.cross){
      var dst = fmAcc(st.to), rubSide = S.cur === 'RUB' ? S.v : S.toCur === 'RUB' ? S.natTo : null;
      var fxSide = S.cur === 'RUB' ? S.natTo : S.toCur === 'RUB' ? S.v : null, fxCur = S.cur === 'RUB' ? S.toCur : S.cur;
      body += '<div class="f"><div class="f-lbl">Пришло на «' + esc(dst ? dst.name : '') + '» в ' + FM_CUR_IN[S.toCur] + '</div>' +
        '<input class="inp" type="text" inputmode="decimal" data-f="rawTo" autocomplete="off" placeholder="' +
          (S.auto === null || !S.v ? '0' : fmRaw(S.auto)) + '" value="' + esc(st.rawTo) + '">' +
        '<div class="f-hint">' + (S.auto === null
          ? 'Курса ЦБ на эту дату нет — впишите, сколько пришло.'
          : 'Обмен идёт по курсу банка — впишите, сколько пришло. Пусто — по курсу ЦБ' + (S.v ? ': ' + fmIn(S.auto, S.toCur) : '') + '.') +
          (st.rawTo && rubSide && fxSide ? ' Курс обмена — <b>' + (rubSide / fxSide).toFixed(2).replace('.', ',') + NBSP + '₽</b> за ' +
            fmSym(fxCur) + (fmRate(fxCur, st.date) ? ', у ЦБ — ' + (fmRate(fxCur, st.date) / 10000).toFixed(2).replace('.', ',') +
            NBSP + '₽' : '') + '.' : '') + '</div></div>';
    }
  } else if (k === 'income'){
    body += '<div class="f"><div class="f-lbl">Счёт зачисления</div><select class="inp" data-f="to">' + fmAccOptions(st.to) + '</select></div>';
  } else {
    body += '<div class="f"><div class="f-lbl">Счёт списания</div><select class="inp" data-f="from">' + fmAccOptions(st.from) + '</select></div>';
  }

  if (k === 'transfer'){
    body += '<div class="f"><div class="f-lbl">Категория</div><input class="inp" type="text" value="Переводы между своими" ' +
      'disabled style="color:var(--text-3);background:var(--surface)"><div class="f-hint">Категория зафиксирована: ' +
      'перевод между своими счетами не считается расходом и не попадает в статистику трат.</div></div>';
  } else {
    body += '<div class="f"><div class="f-lbl">Категория' +
      (st.cat ? '<span class="spacer"></span><span style="color:var(--text-2)">' + esc(st.cat) + '</span>' : '') +
      '</div>' + fmCombo(st) + '</div>';
  }

  body += '<div class="f"><div class="f-lbl">Описание</div>' +
    '<input class="inp" type="text" data-f="desc" list="fmDl" autocomplete="off" placeholder="' +
      esc(descs[0] || 'Например, Пятёрочка') + '" value="' + esc(st.desc) + '">' +
    '<datalist id="fmDl">' + descs.map(function(d){ return '<option value="' + esc(d) + '">'; }).join('') + '</datalist>' +
    (descs.length ? '<div class="f-hint">Подсказки по прошлым описаниям категории «' + esc(st.cat) + '»</div>' : '') +
  '</div>';

  if (k !== 'transfer'){
    var tagList = FM_BASE_TAGS.concat(Object.keys(st.tags).filter(function(t){ return FM_BASE_TAGS.indexOf(t) < 0; }));
    body += '<div class="f"><div class="f-lbl">Теги</div><div class="quick">' + tagList.map(function(t){
      return '<button type="button" class="chip' + (st.tags[t] ? ' is-on' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('') + '</div></div>';
  }
  if (k === 'income'){
    body += '<div class="f"><label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer">' +
      '<input type="checkbox" data-f="once" style="margin:2px 0 0;accent-color:var(--accent)"' + (st.once ? ' checked' : '') + '>' +
      '<span><span style="font-size:13px">Это разовое поступление</span><div class="f-hint" style="margin-top:3px">' +
      'Разовые доходы не экстраполируются в прогнозы: отпускные или подарок не должны выглядеть как новый ежемесячный ' +
      'доход.</div></span></label></div>';
  }
  if (k === 'transfer'){
    body += '<div class="f"><div class="f-lbl">Под цель<span class="spacer"></span><span style="color:var(--text-3)">' +
      'необязательно</span></div><select class="inp" data-f="goal"><option value="">Не привязывать</option>' +
      FD.goals.map(function(g){ return '<option' + (st.goal === g.name ? ' selected' : '') + '>' + esc(g.name) + '</option>'; }).join('') +
      '</select></div>';
  }

  var warns = fmAnomalies(st).map(function(w){
    return '<div class="warn' + (w.neg ? ' is-neg' : '') + '"><span class="dot"></span><span>' + w.text + '</span>' +
      (w.act ? '<span class="acts"><button type="button" class="btn btn-sm" data-dismiss="' + w.id + '">' + w.act +
               '</button></span>' : '') + '</div>';
  }).join('');
  var canSave = a.ok && a.cents > 0 && st.date && st.date <= FD.today &&
                (k === 'transfer' || !!st.cat) && !fmBusy && S.nat !== null && S.rub !== null &&
                (!S.cross || (S.natTo !== null && S.natTo > 0));
  return '<div class="mod" data-k="' + k + '">' +
    fmModHead(FM_TITLES[k]) +
    '<div class="mod-body">' + body + '<div class="prev">' + fmPreview(st) + '</div>' + warns + fmErr(st) + '</div>' +
    '<div class="mod-foot">' +
      '<button type="button" class="btn btn-primary" data-save="1"' + (canSave ? '' : ' disabled') + '>Сохранить ' +
        '<span class="kbd" style="margin-left:4px">⌘↵</span></button>' +
      '<button type="button" class="btn btn-quiet" data-save="more"' + (canSave ? '' : ' disabled') + '>' +
        'Сохранить и добавить ещё</button>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn-quiet" data-close="1">Отмена <span class="kbd" style="margin-left:4px">Esc</span></button>' +
    '</div></div>';
}
function fmModHead(title){
  return '<div class="mod-head"><h2 id="fmTitle">' + title + '</h2><span class="spacer"></span>' +
    '<button type="button" class="mod-x" data-close="1" aria-label="Закрыть">' + FM_X + '</button></div>';
}
function fmErr(st){
  return st.err ? '<div class="warn is-neg is-err"><span class="dot"></span><span><b>Не сохранено.</b> ' + esc(st.err) +
                  '</span></div>' : '';
}

/* ============================================================
   ОКНА СПРАВОЧНИКОВ
   ============================================================ */
/* Условия кредитки. Новая карта: долг, лимит и «доступно» — любые два,
   третье посчитается. День выписки и «осталось внести до грейса» —
   по желанию: из них грейс считается точно (main/grace.js). */
function fmCardTerms(st, isNew){
  return '<div class="f-row" style="margin-bottom:15px"><div class="f"><div class="f-lbl">Кредитный лимит</div>' +
      fmInp('limit', st, isNew ? 'или «доступно»' : '100 000') + '</div>' +
      (isNew ? '<div class="f"><div class="f-lbl">Доступно сейчас</div>' + fmInp('avail', st, 'лимит − долг') + '</div>'
             : '<div class="f"><div class="f-lbl">Доступно сейчас</div><input class="inp" type="text" readonly value="' +
               (st.limit ? money(String(fmParse(st.limit).cents + Number(st.native || st.balance || 0))) : '—') + '"></div>') +
    '</div>' +
    '<div class="f-row" style="margin-bottom:15px"><div class="f"><div class="f-lbl">День выписки</div>' +
      fmInp('statementDay', st, 'не обязательно', ' inputmode="numeric"') + '</div>' +
      '<div class="f"><div class="f-lbl">Грейс до … числа</div>' + fmInp('graceDay', st, '21', ' inputmode="numeric"') + '</div></div>' +
    fmFld('Осталось внести до грейса', fmInp('graceLeft', st, 'не обязательно'),
      'Из приложения банка: сколько внести до конца льготного периода, чтобы не начислялись проценты' +
      (isNew ? ' — на дату баланса' : ' — на сегодня') + '. Пусто — приложение посчитает само: по дню выписки, если он указан.');
}
function fmFld(label, inner, hint, note){
  return '<div class="f"><div class="f-lbl">' + label +
    (note ? '<span class="spacer"></span><span style="color:var(--text-3)">' + note + '</span>' : '') + '</div>' +
    inner + (hint ? '<div class="f-hint">' + hint + '</div>' : '') + '</div>';
}
function fmInp(f, st, ph, extra){
  return '<input class="inp" type="text" data-f="' + f + '" autocomplete="off" placeholder="' + (ph || '') + '" value="' +
    esc(st[f] === null || st[f] === undefined ? '' : st[f]) + '"' + (extra || '') + '>';
}
function fmDateInp(f, st){
  return fmInp(f, st, 'дд.мм.гггг', ' inputmode="numeric"') +
    (st[f] && !exParseDate(st[f]) ? '<div class="f-hint" style="color:var(--warning)">Дата не понята — ждём 01.10.2026</div>' : '');
}
function fmSel(f, st, opts){
  return '<select class="inp" data-f="' + f + '">' + opts.map(function(o){
    var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
    return '<option value="' + esc(v) + '"' + (String(st[f]) === String(v) ? ' selected' : '') + '>' + esc(t) + '</option>';
  }).join('') + '</select>';
}
function fmCheck(f, st, label, hint){
  return '<div class="f"><label style="display:flex;align-items:flex-start;gap:9px;cursor:pointer">' +
    '<input type="checkbox" data-f="' + f + '" style="margin:2px 0 0;accent-color:var(--accent)"' + (st[f] ? ' checked' : '') + '>' +
    '<span><span style="font-size:13px">' + label + '</span>' +
    (hint ? '<div class="f-hint" style="margin-top:3px">' + hint + '</div>' : '') + '</span></label></div>';
}
function fmToggle(f, st, opts){
  return '<div class="quick">' + opts.map(function(o){
    return '<button type="button" class="chip' + (String(st[f]) === String(o[0]) ? ' is-on' : '') + '" data-set="' +
      f + ':' + o[0] + '">' + o[1] + '</button>';
  }).join('') + '</div>';
}
function fmAccList(){
  return FD.accounts.map(function(a){ return [a.id, a.name + ' — ' + fmIn(fmNat(a), a.cur, true)]; });
}
function fmNum(v){ var r = fmParse(v); return r.ok ? r.cents : 0; }
/* Сколько уже лежит под цель: на отдельном счёте — его остаток, на
   платёжном — ничего, как на «Прогнозах». */
function fmGoalCur(accId){
  var a = fmAcc(accId);
  return a && !a.isPayment && !a.isCredit && Number(a.balance) > 0 ? Number(a.balance) : 0;
}

/* Три ближайших срока регулярного платежа — от сегодня. */
function fmNextDates(st){
  var out = [], p = FD.today.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
  if (st.every === 'w'){
    var want = Number(st.wday) - 1, cur = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() + ((want - cur + 7) % 7));
    for (var i = 0; i < 3; i++){ out.push(new Date(d)); d.setDate(d.getDate() + 7); }
    return out;
  }
  var step = st.every === 'm' ? 1 : (st.every === 'q' ? 3 : 12);
  var day = Math.min(31, Math.max(1, parseInt(st.day, 10) || 1));
  var probe = new Date(p[0], p[1] - 1, day);
  if (probe < d) probe = new Date(p[0], p[1] - 1 + step, day);
  for (var j = 0; j < 3; j++){
    out.push(new Date(probe));
    probe = new Date(probe.getFullYear(), probe.getMonth() + step, day);
  }
  return out;
}
function fmDm(dt){ return ('0' + dt.getDate()).slice(-2) + '.' + ('0' + (dt.getMonth() + 1)).slice(-2); }

function fmRefPreview(st){
  var note = function(html){ return '<div class="prev-note" style="border-top:none;margin-top:0;padding-top:0">' + html + '</div>'; };
  var monthly = Number(FD.monthly);
  if (st.kind === 'plan'){
    var q = FM_QUADS[st.need + '|' + st.urg], lo = fmNum(st.min), hi = fmNum(st.max) || lo, own = fmNum(st.own);
    return note('<b>Попадёт в группу «' + q[0] + '».</b> ' + q[1] + '.' +
      (hi ? ' Цена ' + (lo && lo !== hi ? fmC0(lo) + ' – ' + fmC0(hi) : fmC0(hi)) +
        (monthly ? ' — это ' + (hi / monthly * 30.44).toFixed(1).replace('.', ',') + ' дня запаса прочности.' : '.') : '') +
      (own ? ' Плюс ' + fmC0(own) + ' в месяц на владение — за год ' + fmC0(own * 12) + '.' : '') +
      (st.repl ? ' Помечено «есть чем заменить» — в очереди будет видно отдельной меткой.' : ''));
  }
  if (st.kind === 'recur'){
    var a = fmNum(st.amount), b = fmNum(st.amountTo) || a;
    if (!a) return note('Заполните сумму — здесь появятся три ближайших списания и стоимость за квартал.');
    var ds = fmNextDates(st).map(fmDm).join(', '), rc = fmCurOf(st.accId);
    var perQ = st.every === 'w' ? b * 13 : st.every === 'm' ? b * 3 : st.every === 'q' ? b : b / 4;
    var perY = st.every === 'w' ? b * 52 : st.every === 'm' ? b * 12 : st.every === 'q' ? b * 4 : b;
    /* Платёж в валюте: в рублях он меняется вместе с курсом. */
    var rubM = rc !== 'RUB' ? fmConv(perY / 12, rc, 'RUB', FD.today) : null;
    return note('<b>Следующие 3 ' + (st.type === 'доход' ? 'поступления' : 'списания') + ': ' + ds + '.</b> ' +
      (st.fixed ? '' : 'По верхней границе: ') + fmIn(perQ, rc, true) + ' за квартал, ' + fmIn(perY, rc, true) + ' за год.' +
      (st.type === 'доход' ? ' Тип «доход» — попадёт в поступления, а не в нагрузку.'
        : st.type === 'добровольный' ? ' Добровольный — в обязательную нагрузку не войдёт.'
        : ' Войдёт в обязательную нагрузку: ' + fmIn(perY / 12, rc, true) + ' в месяц' +
          (rubM !== null ? ' — сейчас это ' + fmC0(rubM) + ', рублёвая сумма зависит от курса' : '') + '.'));
  }
  if (st.kind === 'goal'){
    var cur = fmGoalCur(st.accId), tgt = fmNum(st.target), mth = fmNum(st.monthly);
    var dl = exParseDate(st.deadlineTxt);
    if (!tgt || !dl){
      return note('<b>Цель и срок не заданы.</b> Приложение будет показывать только текущий остаток и динамику — ' +
        'без прогресс-бара и без статуса «в графике». Это честнее, чем прогресс от нуля до неизвестной цели.');
    }
    var left = Math.max(0, tgt - cur), days = -fmDaysAgo(dl);
    var need = days > 0 ? left / (days / 30.44) : left;
    return note('<b>' + fmC0(cur) + ' из ' + fmC0(tgt) + ' — ' + Math.round(cur / tgt * 100) + '%.</b> До срока ' +
      nDays(Math.max(0, days)) + ', осталось накопить ' + fmC0(left) +
      (days < 45 ? ' — это ' + fmC0(days > 0 ? left / days : left) + ' в день.' : ' — это ' + fmC0(need) + ' в месяц.') +
      (mth ? (mth >= need ? ' Планового взноса ' + fmC0(mth) + ' в месяц хватает.'
                          : ' Планового взноса ' + fmC0(mth) + ' в месяц не хватает: нужно ' + fmC0(need) + '.') : ''));
  }
  if (st.kind === 'account' && st.id){
    var avail = Number(FD.available), own = Math.max(0, Number(st.balance));
    if (st.isCredit) return note('<b>Лимит и день грейса</b> меняют условие цикла на «Обзоре», «Капитале» и «Прогнозах»: ' +
      'сколько и до какого числа внести.');
    if (st.isPay === st.wasPay) return note('Остаток ' + fmIn(st.native, st.wasCur) + (st.isPay
      ? ' входит в «Доступно на счетах».' : ' виден в капитале, но в «Доступно на счетах» не входит.'));
    return note(st.isPay
      ? '<b>Счёт войдёт в «Доступно на счетах»:</b> было ' + fmC0(avail) + ', станет ' + fmC0(avail + own) + '. Дневной лимит ' +
        'и дни до нуля пересчитаются.'
      : '<b>Счёт уйдёт из «Доступно на счетах»:</b> было ' + fmC0(avail) + ', станет ' + fmC0(avail - own) + '. Дневной лимит ' +
        'и дни до нуля пересчитаются.');
  }
  if (st.kind === 'account'){
    var bal = fmNum(st.bal), pay = st.isPay && st.type !== 'credit';
    var fxNoRate = st.cur && st.cur !== 'RUB' && st.type !== 'credit' && bal && fmConv(bal, st.cur, 'RUB', FD.today) === null;
    if (st.cur && st.cur !== 'RUB' && st.type !== 'credit') bal = fmConv(bal, st.cur, 'RUB', FD.today) || 0;
    if (fxNoRate && pay) return note('<b>Счёт будет учитываться в «Доступно на счетах»</b> — в рублях по курсу ЦБ. Курса ' +
      st.cur + ' пока нет: он подтянется с сайта ЦБ, когда будет связь, или его можно вписать в «Настройках» → «Расчёты».');
    return note((pay
        ? '<b>Счёт будет учитываться в «Доступно на счетах».</b> Сейчас там ' + money(FD.available) + ', станет ' +
          fmC0(Number(FD.available) + Math.max(0, bal)) + '. Он попадёт в расчёт дневного лимита и дней до нуля.'
        : '<b>Счёт не войдёт в «Доступно на счетах».</b> Остаток будет виден в капитале, но в дневной лимит и в дни ' +
          'до нуля не попадёт — как копилка и брокерский счёт.') +
      (st.type === 'credit' ? ' Для кредитной карты остаток задаётся со знаком минус, а лимит и день грейса нужны, ' +
        'чтобы считать условие цикла.' : ''));
  }
  /* Кредит — расчёт из главного процесса, тем же графиком, что на «Капитале». */
  var pv = st.preview;
  if (!pv) return note('Заполните ' + (st.existing ? '' : 'остаток, ') + 'ставку и платёж — здесь появится срок и переплата.');
  if (pv.never) return note('<b>Платёж не покрывает проценты.</b> При такой ставке долг не уменьшится — проверьте суммы.');
  var init = fmNum(st.initial), paid = fmNum(st.paid);
  return note('<b>Осталось ' + pv.n + ' ' + plural(pv.n, 'платёж', 'платежа', 'платежей') + ', закрытие ' +
    exRuDate(pv.last) + '.</b> Переплата за оставшийся срок ' + money(pv.interest) + ', всего к выплате ' +
    money(pv.total) + '.' + (init && paid ? ' Внесено ' + fmC0(paid) + ' из ' + fmC0(init) + ' — ' +
    Math.round(paid / init * 100) + '% тела долга.' : '') +
    (st.inOblig ? ' Платёж войдёт в обязательные расходы.' : ' Платёж в обязательные расходы не войдёт.'));
}

function fmRefHTML(st){
  var k = st.kind, b = '';
  if (k === 'plan'){
    b += fmFld('Название', fmInp('name', st, 'Например, куртка'));
    b += fmFld('Категория', fmSel('cat', st, FD.cats.exp.map(function(c){ return c.name; })));
    b += '<div class="f-row" style="margin-bottom:15px"><div class="f"><div class="f-lbl">Цена от</div>' +
      fmInp('min', st, '10 000') + '</div><div class="f"><div class="f-lbl">Цена до</div>' + fmInp('max', st, '15 000') +
      '</div></div>';
    b += fmFld('Нужность', fmToggle('need', st, [['need', 'Нужно'], ['want', 'Хочется']]));
    b += fmFld('Срочность', fmToggle('urg', st, [['hot', 'Горит'], ['cold', 'Не горит']]));
    b += fmCheck('repl', st, 'Есть чем заменить',
      'Не влияет на группу — показывается меткой на карточке, чтобы решение принималось с открытыми глазами.');
    b += fmFld('Стоимость владения', fmInp('own', st, '0'), 'Сколько вещь будет стоить каждый месяц после покупки — ' +
      'подписка, обслуживание, корм. Если ничего, оставьте пустым.', 'необязательно');
    b += fmFld('Дедлайн', fmDateInp('deadlineTxt', st), '', 'необязательно');
    b += fmFld('Заметка', '<textarea class="inp" data-f="note" rows="2" placeholder="Например: марка не выбрана">' +
      esc(st.note) + '</textarea>');
  }
  if (k === 'recur'){
    b += fmFld('Название', fmInp('name', st, 'Например, VPS-сервер'));
    b += fmFld('Категория', fmSel('cat', st, (st.type === 'доход' ? FD.cats.inc : FD.cats.exp).map(function(c){ return c.name; })));
    b += fmFld('Сумма' + (fmCurOf(st.accId) !== 'RUB' ? ' в ' + FM_CUR_IN[fmCurOf(st.accId)] + ' — валюте счёта' : ''),
      fmToggle('fixed', st, [[true, 'Фиксированная'], [false, 'Плавающая']]) +
      '<div style="margin-top:8px">' + (st.fixed ? fmInp('amount', st, '600')
        : '<div class="f-row"><div class="f">' + fmInp('amount', st, 'от 1 500') + '</div><div class="f">' +
          fmInp('amountTo', st, 'до 3 000') + '</div></div>') + '</div>',
      st.fixed ? '' : 'Плавающая сумма выводится вилкой, а в нагрузку считается по верхней границе.');
    b += '<div class="f-row" style="margin-bottom:15px"><div class="f"><div class="f-lbl">Периодичность</div>' +
      fmSel('every', st, FM_PERIODS) + '</div><div class="f"><div class="f-lbl">' +
      (st.every === 'w' ? 'День недели' : 'Число месяца') + '</div>' +
      (st.every === 'w' ? fmSel('wday', st, FM_WEEKDAYS.map(function(w, i){ return [String(i + 1), w]; }))
                        : fmInp('day', st, '25', ' inputmode="numeric"')) + '</div></div>';
    /* Раз в год или в квартал — в каком месяце: страховку в марте заводят
       и в октябре. У квартального — месяц первого платежа. */
    if (st.every === 'y' || st.every === 'q'){
      b += fmFld(st.every === 'y' ? 'Месяц' : 'Месяц первого платежа', fmSel('month', st, FM_MONTHS));
    }
    b += fmFld('Счёт', fmSel('accId', st, fmAccList()));
    b += fmFld('Тип', fmToggle('type', st, FM_PAY_TYPES.map(function(t){ return [t, t]; })));
    b += fmFld('Дата окончания', fmDateInp('untilTxt', st), 'Например, последний платёж по кредиту. Пусто — платёж бессрочный.',
      'необязательно');
    b += fmFld('Заметка', '<textarea class="inp" data-f="note" rows="2" placeholder="Например: сумма зависит от курса">' +
      esc(st.note) + '</textarea>');
  }
  if (k === 'goal'){
    b += fmFld('Название', fmInp('name', st, 'Например, резерв'));
    b += fmFld('Счёт хранения', fmSel('accId', st, fmAccList()), 'Остаток берётся со счёта, вручную его вести не нужно.');
    var ga = fmAcc(st.accId);
    b += fmFld('Текущая сумма', '<input class="inp" type="text" readonly value="' + esc(fmC(fmGoalCur(st.accId)) +
        (ga && ga.cur !== 'RUB' && fmGoalCur(st.accId) ? ' — это ' + fmIn(fmNat(ga), ga.cur) + ' по курсу ЦБ' : '')) + '">',
      fmAcc(st.accId) && fmAcc(st.accId).isPayment ? 'На платёжном счёте отложенное от текущих денег не отделить — ' +
        'считается с нуля.' : '');
    b += fmFld('Целевая сумма', fmInp('target', st, ''), '', 'необязательно');
    b += fmFld('Срок', fmDateInp('deadlineTxt', st), '', 'необязательно');
    b += fmFld('Плановый взнос в месяц', fmInp('monthly', st, ''), '', 'необязательно');
    b += '<div class="f-hint" style="margin:-6px 0 14px">Если не указать цель и срок, приложение будет показывать только ' +
      'динамику остатка, без прогресса.</div>';
  }
  if (k === 'account' && st.id){
    b += fmFld('Название', fmInp('name', st, ''));
    b += '<div class="f-row" style="margin-bottom:15px"><div class="f"><div class="f-lbl">Банк</div>' +
      fmSel('bank', st, FD.banks.indexOf(st.bank) >= 0 ? FD.banks : [st.bank].concat(FD.banks)) + '</div>' +
      '<div class="f"><div class="f-lbl">Тип</div><input class="inp" type="text" readonly value="' + esc(st.typeText) + '">' +
      '</div></div>';
    b += fmFld('Остаток сейчас', '<input class="inp" type="text" readonly value="' + esc(fmIn(st.native, st.wasCur) +
        (st.wasCur !== 'RUB' ? ' ≈ ' + fmC0(Number(st.balance)) : '')) + '">',
      'Считается по операциям. Если он разошёлся с банком — поправьте сверкой: появится корректирующая операция, а ' +
      'история останется как была.' + (st.wasCur !== 'RUB' ? ' В рублях — по курсу ЦБ на сегодня.' : ''));
    /* Валюту меняют, пока по счёту нет операций: их суммы записаны в ней. */
    if (!st.isCredit){
      b += st.ops
        ? fmFld('Валюта', '<input class="inp" type="text" readonly value="' + esc(FM_CURS.filter(function(o){
            return o[0] === st.wasCur; })[0][1]) + '">', 'По счёту уже есть операции — валюта не меняется. Нужна другая — ' +
            'заведите новый счёт и переведите остаток.')
        : fmFld('Валюта', fmSel('cur', st, FM_CURS), st.cur !== st.wasCur ? 'Остаток станет ' + fmIn(st.native, st.cur) +
            ' — то же число в новой валюте. Если сумма другая, поправьте её сверкой.' : '');
    }
    if (!st.isCredit){
      b += fmCheck('isPay', st, 'Платёжный счёт — учитывать в «Доступно на счетах»',
        'Снимите для копилки, брокерского счёта и криптокошелька: их остаток виден в капитале, но тратить его каждый ' +
        'день не планируется.');
    } else {
      b += fmCardTerms(st, false);
      b += fmFld('Правило грейса', '<textarea class="inp" data-f="graceRule" rows="2">' + esc(st.graceRule) + '</textarea>',
        'Текстом, как формулирует банк.');
    }
  }
  if (k === 'account' && !st.id){
    b += fmFld('Название', fmInp('name', st, 'Например, второй счёт МТС'));
    b += '<div class="f-row" style="margin-bottom:15px"><div class="f"><div class="f-lbl">Банк</div>' +
      fmSel('bank', st, FD.banks) + '</div><div class="f"><div class="f-lbl">Тип</div>' + fmSel('type', st, FM_ACC_TYPES) +
      '</div></div>';
    /* Кредитка — только в рублях: долг и грейс считаются в рублях. */
    b += '<div class="f-row" style="margin-bottom:15px"><div class="f"><div class="f-lbl">Валюта</div>' +
      (st.type === 'credit' ? '<input class="inp" type="text" readonly value="Рубли — ₽">' : fmSel('cur', st, FM_CURS)) +
      '</div><div class="f"><div class="f-lbl">' + (st.type === 'credit' ? 'Долг по карте'
        : 'Начальный баланс' + (st.cur !== 'RUB' ? ' в ' + FM_CUR_IN[st.cur] : '')) + '</div>' +
      fmInp('bal', st, st.type === 'credit' ? 'или лимит и «доступно»' : '0') + '</div></div>';
    if (st.cur !== 'RUB' && st.type !== 'credit'){
      b += '<div class="f-hint" style="margin:-6px 0 14px">Остаток и операции этого счёта — в ' + FM_CUR_IN[st.cur] +
        '. В «Доступно на счетах», капитале и тратах он считается в рублях по курсу ЦБ' +
        (fmRate(st.cur, FD.today) ? ' — сейчас ' + fmRateNote([st.cur], FD.today) : '') + '.</div>';
    }
    b += fmFld('Дата этого баланса', fmDateInp('balDateTxt', st), 'От неё считаются все последующие операции. Если выписки ' +
      'раньше нет — ставьте дату первой известной.');
    if (st.type !== 'credit'){
      b += fmCheck('isPay', st, 'Платёжный счёт — учитывать в «Доступно на счетах»',
        'Снимите для копилки, брокерского счёта и криптокошелька: их остаток виден в капитале, но тратить его каждый ' +
        'день не планируется.');
    } else {
      b += fmCardTerms(st, true);
      b += fmFld('Правило грейса', '<textarea class="inp" data-f="graceRule" rows="2" placeholder="Например: до 21 числа ' +
        'внести всю сумму долга, можно частями">' + esc(st.graceRule) + '</textarea>',
        'Текстом, как формулирует банк. От формулировки зависит, считать условие по сумме внесений или по обнулению долга.');
    }
  }
  if (k === 'loan'){
    b += '<div class="f-row" style="margin-bottom:15px"><div class="f"><div class="f-lbl">Кредитор</div>' +
      fmInp('creditor', st, 'Сбербанк') + '</div><div class="f"><div class="f-lbl">Тип</div>' +
      fmSel('type', st, FM_LOAN_TYPES) + '</div></div>';
    b += '<div class="f-row" style="margin-bottom:15px"><div class="f"><div class="f-lbl">Изначальная сумма</div>' +
      fmInp('initial', st, '') + '</div><div class="f"><div class="f-lbl">Текущий остаток</div>' +
      (st.existing ? '<input class="inp" type="text" readonly value="' + esc(st.rest) + '">' : fmInp('rest', st, '')) +
      '</div></div>';
    if (st.existing){
      b += '<div class="f-hint" style="margin:-8px 0 14px">Остаток считается по истории платежей — его не нужно ' +
        'вести вручную.</div>';
    }
    b += '<div class="f-row" style="margin-bottom:15px"><div class="f"><div class="f-lbl">Ставка, % годовых</div>' +
      fmInp('rate', st, '14,5') + '</div><div class="f"><div class="f-lbl">Ежемесячный платёж</div>' +
      fmInp('pay', st, '') + '</div></div>';
    b += '<div class="f-row" style="margin-bottom:15px"><div class="f"><div class="f-lbl">День платежа</div>' +
      fmInp('day', st, '24', ' inputmode="numeric"') + '</div><div class="f"><div class="f-lbl">Дата закрытия</div>' +
      fmDateInp('closeTxt', st) + '</div></div>';
    b += fmFld('Сумма уже внесённого', fmInp('paid', st, ''),
      'Вместе с изначальной суммой даёт прогресс погашения: одно считается из другого и текущего остатка.');
    b += fmCheck('inOblig', st, 'Учитывать платёж в обязательных расходах', 'Влияет на «обязательные в месяц» и на годовую нагрузку.');
  }
  return '<div class="mod" data-k="' + k + '">' + fmModHead(FM_TITLES[k] + (st.id ? ' · правка' : '')) +
    '<div class="mod-body">' + b + '<div class="prev">' + fmRefPreview(st) + '</div>' + fmErr(st) + '</div>' +
    '<div class="mod-foot">' +
      '<button type="button" class="btn btn-primary" data-save="1"' + (fmBusy ? ' disabled' : '') + '>Сохранить ' +
        '<span class="kbd" style="margin-left:4px">⌘↵</span></button>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn btn-quiet" data-close="1">Отмена <span class="kbd" style="margin-left:4px">Esc</span></button>' +
    '</div></div>';
}

/* ============================================================
   СВЕРКА БАЛАНСОВ
   ============================================================
   Расчётный баланс приложение знает само — он получается прогоном
   всех операций. Человек вводит фактический, расхождение считается
   на лету.                                                          */
function fmReconRows(st){
  return FD.accounts.map(function(a){
    var skipped = !!st.skip[a.id], raw = st.vals[a.id] || '';
    var has = !skipped && String(raw).trim() !== '';
    var p = has ? fmParse(raw) : null;
    var fact = p && p.ok ? p.cents : null;
    var calc = st.calc ? Number(st.calc[a.id] || 0) : null;
    return { a: a, skipped: skipped, raw: raw, bad: has && (!p || !p.ok), fact: fact, calc: calc,
             diff: fact === null || calc === null ? null : fact - calc };
  });
}
function fmReconCell(st, r){
  if (r.bad){ st.matched[r.a.id] = false; return '<span style="color:var(--warning)">не число</span>'; }
  if (r.diff === null){ st.matched[r.a.id] = false; return '<span style="color:var(--text-3)">—</span>'; }
  if (r.diff === 0){
    /* Галочка рисуется в тот кадр, когда счёт сошёлся, а не постоянно. */
    var fresh = !st.matched[r.a.id];
    st.matched[r.a.id] = true;
    return '<span class="c-pos ok-mark' + (fresh && booted && !REDUCED ? ' is-draw' : '') + '">' + FM_TICK + 'сходится</span>';
  }
  st.matched[r.a.id] = false;
  return '<span class="' + (r.diff > 0 ? 'c-pos' : 'c-neg') + '">' + (r.diff > 0 ? '+' : '') + fmIn(r.diff, r.a.cur) + '</span>';
}
function fmReconHTML(st){
  var rows = fmReconRows(st);
  var filled = rows.filter(function(r){ return r.skipped || r.diff !== null; }).length;
  var some = rows.some(function(r){ return !r.skipped; });
  var ready = filled === rows.length && some && !!st.date && !!st.calc;
  var diffs = rows.filter(function(r){ return r.diff !== null && r.diff !== 0; });
  /* Расхождения в разных валютах складываются в рублях по курсу дня сверки. */
  var fxDiff = diffs.some(function(r){ return r.a.cur !== 'RUB'; });
  var total = diffs.reduce(function(s, r){ return s + (fmConv(r.diff, r.a.cur, 'RUB', st.date) || 0); }, 0);
  var body = '<div class="f" style="max-width:220px"><div class="f-lbl">Дата сверки</div>' +
    '<input class="inp" type="text" inputmode="numeric" data-f="dateTxt" placeholder="дд.мм.гггг" value="' +
      esc(st.dateTxt) + '" autocomplete="off">' +
    (!st.date ? '<div class="f-hint" style="color:var(--warning)">Дата не понята — ждём 01.10.2026</div>' : '') + '</div>' +
    '<table class="tbl recon"><thead><tr><th>Счёт</th><th class="r">Расчётный баланс</th><th class="r">Фактический баланс</th>' +
      '<th class="r">Расхождение</th><th class="r">Не сверял</th></tr></thead><tbody>' +
    rows.map(function(r){
      var stale = FD.stale[r.a.id];
      return '<tr' + (r.skipped ? ' style="opacity:.5"' : '') + '>' +
        '<td><div class="pm-name">' + esc(r.a.name) + '</div>' +
          (r.a.cur !== 'RUB' ? '<div class="pm-sub">в ' + FM_CUR_IN[r.a.cur] + '</div>' : '') +
          (stale ? '<div class="pm-sub" style="color:var(--warning)">не сверялся ' + nDays(stale) + ' — порог 14</div>' : '') + '</td>' +
        '<td class="r num" style="color:var(--text-2)">' + (r.calc === null ? '…' : fmIn(r.calc, r.a.cur)) + '</td>' +
        '<td class="r"><input class="inp" type="text" inputmode="decimal" style="text-align:right;max-width:150px" ' +
          'data-recon="' + esc(r.a.id) + '" placeholder="—" value="' + esc(r.raw) + '"' + (r.skipped ? ' disabled' : '') + '></td>' +
        '<td class="r num">' + fmReconCell(st, r) + '</td>' +
        '<td class="r"><input type="checkbox" data-skip="' + esc(r.a.id) + '" style="accent-color:var(--accent)"' +
          (r.skipped ? ' checked' : '') + '></td>' +
      '</tr>';
    }).join('') + '</tbody></table>';
  var note = ready
    ? (diffs.length
        ? '<b>Расхождения по ' + diffs.length + NBSP + plural(diffs.length, 'счёту', 'счетам', 'счетам') + ' на ' +
          (fxDiff ? '≈ ' : '') + fmC(total) +
          '.</b> После фиксации приложение добавит корректирующие операции на эти суммы — расчётный баланс сойдётся ' +
          'с фактическим, а история останется как была.'
        : '<b>Все счета сошлись.</b> Корректировки не понадобятся — приложение просто запишет дату сверки.')
    : 'Заполните фактический баланс по каждому счёту или отметьте «не сверял». Осталось ' +
      (rows.length - filled) + ' из ' + rows.length + '.';
  return '<div class="mod mod--wide" data-k="recon">' + fmModHead(FM_TITLES.recon) +
    '<div class="mod-body">' + body + '<div class="prev"><div class="prev-note" style="border-top:none;margin-top:0;' +
      'padding-top:0">' + note + '</div></div>' + fmErr(st) + '</div>' +
    '<div class="mod-foot"><button type="button" class="btn btn-primary" data-save="1"' +
      (ready && !fmBusy ? '' : ' disabled') + '>Зафиксировать сверку</button><span class="spacer"></span>' +
      '<button type="button" class="btn btn-quiet" data-close="1">Отмена <span class="kbd" style="margin-left:4px">Esc</span></button>' +
    '</div></div>';
}

/* ============================================================
   ОКНА НАСТРОЕК: КАТЕГОРИИ И ОТЧЁТЫ
   ============================================================ */
function fmNewMisc(kind, pre){
  /* Отложить под позицию очереди: деньги помечаются, а не переводятся. */
  if (kind === 'plansave'){
    var pl = FD.plans.filter(function(x){ return x.id === Number(pre.id); })[0];
    return { kind: kind, plan: pl || null, amount: '', err: pl ? '' : 'Позиция уже не в очереди' };
  }
  if (kind === 'question') return { kind: kind, text: '', rec: '', err: '' };
  if (kind === 'cat'){
    var c = pre.cat;
    return c ? { kind: kind, orig: c.name, name: c.name, type: c.type, note: c.note || '', system: c.system, ops: c.ops,
                 active: c.active, err: '' }
             : { kind: kind, orig: null, name: '', type: '', note: '', system: false, ops: 0, active: true, err: '' };
  }
  if (kind === 'merge'){
    var from = pre.cat, inc = from.type === 'доход';
    var cands = (pre.cats || []).filter(function(x){
      return x.active && x.name !== from.name && (x.type === 'доход') === inc;
    });
    return { kind: kind, from: from, cands: cands, to: cands.length ? cands[0].name : '', err: '' };
  }
  if (kind === 'export'){
    var st = { kind: kind, err: '' };
    FM_TABLES.forEach(function(t){ st['t_' + t[0]] = true; });
    return st;
  }
  if (kind === 'import') return { kind: kind, report: pre.report, withDups: false, err: '' };
  if (kind === 'models') return { kind: kind, list: pre.list || [], cur: pre.cur || '', q: '', sort: 'price', err: '' };
  if (kind === 'integrity') return { kind: kind, report: pre.report, err: '' };
  return { kind: kind, text: pre.text || '', err: '' };
}
function fmMiscFoot(primary, extra){
  return '<div class="mod-foot">' + (primary || '') + (extra || '') + '<span class="spacer"></span>' +
    '<button type="button" class="btn btn-quiet" data-close="1">' + (primary ? 'Отмена' : 'Закрыть') +
    ' <span class="kbd" style="margin-left:4px">Esc</span></button></div>';
}
function fmMiscSave(text, on){
  return '<button type="button" class="btn btn-primary" data-save="1"' + (on && !fmBusy ? '' : ' disabled') + '>' + text + '</button>';
}
function fmPlainNote(html){ return '<div class="prev"><div class="prev-note" style="border-top:none;margin-top:0;padding-top:0">' + html + '</div></div>'; }
/* Журнал изменений — простая разметка: «## версия» и строки «- что нового». */
function fmChangelogHTML(text){
  var out = '', list = false;
  String(text).split('\n').forEach(function(line){
    var l = line.trim();
    if (/^- /.test(l)){ if (!list){ out += '<ul>'; list = true; } out += '<li>' + esc(l.slice(2)) + '</li>'; return; }
    if (list){ out += '</ul>'; list = false; }
    if (/^#{1,3} /.test(l)) out += '<h3>' + esc(l.replace(/^#+ /, '')) + '</h3>';
    else if (l) out += '<p>' + esc(l) + '</p>';
  });
  return (list ? out + '</ul>' : out) || '<p>Журнал пока пуст.</p>';
}
function fmMiscHTML(st){
  var k = st.kind, b = '', foot = '';
  if (k === 'plansave'){
    var P = st.plan;
    if (!P){
      return '<div class="mod" data-k="plansave">' + fmModHead(FM_TITLES.plansave) + '<div class="mod-body">' + fmErr(st) + '</div>' +
        fmMiscFoot('') + '</div>';
    }
    var add = fmParse(st.amount), saved = Number(P.saved), max = Number(P.max);
    var after = add.ok && !add.empty ? saved + add.cents : saved;
    b += fmPlainNote('<b>' + esc(P.name) + '</b> — отложено ' + money0(P.saved) + ' из ' + money0(P.max) + '.');
    b += fmFld('Сколько отложить', fmInp('amount', st, max > saved ? fmRaw(max - saved) : '0', ' inputmode="decimal"'),
      'Деньги никуда не переводятся: сумма помечается под эту покупку, и на «Планах» растёт её готовность. ' +
      'Со знаком минус — забрать обратно.');
    if (add.ok && !add.empty){
      b += fmPlainNote(after > max ? '<b>Больше цены позиции</b> — хватит ' + money0(String(max - saved)) + '.'
        : after < 0 ? '<b>Забрать можно не больше отложенного</b> — ' + money0(P.saved) + '.'
        : 'Станет отложено <b>' + money0(String(after)) + '</b> — это ' + Math.round(after / max * 100) + '% цены.');
    }
    return '<div class="mod" data-k="plansave">' + fmModHead(FM_TITLES.plansave) + '<div class="mod-body">' + b + fmErr(st) + '</div>' +
      fmMiscFoot(fmMiscSave('Отложить <span class="kbd" style="margin-left:4px">⌘↵</span>',
        add.ok && !add.empty && add.cents !== 0 && after >= 0 && after <= max)) + '</div>';
  }
  if (k === 'question'){
    var recs = [['', 'ни к какому — общий вопрос']].concat(FD.recurring.map(function(r){ return [String(r.id), r.name]; }));
    b += fmFld('Что нужно выяснить', '<textarea class="inp" data-f="text" rows="3" maxlength="300" placeholder="Например: ' +
      'не пора ли отключить подписку, которой не пользуюсь">' + esc(st.text) + '</textarea>');
    b += fmFld('К какому платежу', fmSel('rec', st, recs), 'Вопрос появится в «Заметках и вопросах» и будет висеть, ' +
      'пока вы не отметите его решённым.');
    return '<div class="mod" data-k="question">' + fmModHead(FM_TITLES.question) + '<div class="mod-body">' + b + fmErr(st) + '</div>' +
      fmMiscFoot(fmMiscSave('Добавить <span class="kbd" style="margin-left:4px">⌘↵</span>', !!st.text.trim())) + '</div>';
  }
  if (k === 'cat'){
    var types = FD.catTypes.map(function(t){ return [t, t]; });
    b += fmFld('Название', fmInp('name', st, 'Например, Хобби', st.system ? ' readonly' : ''));
    b += fmFld('Тип', st.system ? '<input class="inp" type="text" readonly value="' + esc(st.type) + '">'
                                : fmSel('type', st, [['', 'выберите']].concat(types)),
      'Тип решает, куда категория попадает в анализе: базовые, обязательные и дискреционные траты считаются отдельно.');
    b += fmFld('Пояснение', '<textarea class="inp" data-f="note" rows="2" placeholder="Что сюда относится">' +
      esc(st.note) + '</textarea>', '', 'необязательно');
    b += fmPlainNote(st.system
      ? '<b>Служебная категория.</b> На её название опирается расчёт, поэтому меняется только пояснение.'
      : st.orig
        ? (st.ops ? 'По категории ' + st.ops + NBSP + plural(st.ops, 'операция', 'операции', 'операций') + '. ' : '') +
          (st.name.trim() && st.name.trim() !== st.orig
            ? '<b>Новое название переедет во все операции, регулярные платежи и планы.</b>' : 'Категория в закрытом списке.')
        : '<b>Категория появится в закрытом списке</b> — в окнах ввода, в разборе ассистента и в отчётах.');
    var canCat = !!st.name.trim() && !!st.type;
    var extra = st.orig && !st.system
      ? '<button type="button" class="btn btn-quiet" data-misc="cat-archive">В архив</button>' +
        (st.ops ? '' : '<button type="button" class="btn btn-quiet" data-misc="cat-delete">Удалить</button>')
      : '';
    foot = fmMiscFoot(fmMiscSave('Сохранить <span class="kbd" style="margin-left:4px">⌘↵</span>', canCat), extra);
    return '<div class="mod" data-k="cat">' + fmModHead(FM_TITLES.cat + (st.orig ? ' · правка' : '')) +
      '<div class="mod-body">' + b + fmErr(st) + '</div>' + foot + '</div>';
  }
  if (k === 'merge'){
    var f = st.from;
    b += fmFld('Объединить «' + esc(f.name) + '» с категорией', st.cands.length
      ? fmSel('to', st, st.cands.map(function(c){ return [c.name, c.name + ' — ' + c.type]; }))
      : '<input class="inp" type="text" readonly value="подходящих категорий нет">');
    b += fmPlainNote(st.to
      ? '<b>' + f.ops + NBSP + plural(f.ops, 'операция', 'операции', 'операций') + ' на ' + money0(f.sum) +
        ' переедут в «' + esc(st.to) + '».</b> Сумма сохранится, регулярные платежи и планы тоже переедут. «' + esc(f.name) +
        '» уйдёт в архив. Передумаете — «Отменить» в плашке после объединения.'
      : 'Объединяют только с категорией той же стороны: доходную — с доходной, расходную — с расходной.');
    return '<div class="mod" data-k="merge">' + fmModHead(FM_TITLES.merge) + '<div class="mod-body">' + b + fmErr(st) + '</div>' +
      fmMiscFoot(fmMiscSave('Объединить', !!st.to)) + '</div>';
  }
  if (k === 'export'){
    var n = FM_TABLES.filter(function(t){ return st['t_' + t[0]]; }).length;
    b += '<div class="f"><div class="f-lbl">Какие таблицы выгрузить</div>' + FM_TABLES.map(function(t){
      return '<label style="display:flex;align-items:center;gap:9px;padding:5px 0;cursor:pointer;font-size:13px">' +
        '<input type="checkbox" data-f="t_' + t[0] + '" style="margin:0;accent-color:var(--accent)"' +
        (st['t_' + t[0]] ? ' checked' : '') + '>' + t[1] + '<span style="color:var(--text-3)">' + t[0] + '.csv</span></label>';
    }).join('') + '</div>';
    b += fmPlainNote('После нажатия выберите папку — таблицы лягут в новую папку внутри неё, ничего не затирая.');
    return '<div class="mod" data-k="export">' + fmModHead(FM_TITLES['export']) + '<div class="mod-body">' + b + fmErr(st) +
      '</div>' + fmMiscFoot(fmMiscSave('Выгрузить ' + n + NBSP + plural(n, 'таблицу', 'таблицы', 'таблиц'), n > 0)) + '</div>';
  }
  if (k === 'import'){
    var r = st.report, add = r.add + (st.withDups ? r.dupCount : 0);
    b += fmPlainNote('<b>Файл «' + esc(r.file) + '»: ' + r.total + NBSP + plural(r.total, 'строка', 'строки', 'строк') + '.</b> ' +
      (r.add ? 'Можно добавить ' + r.add + (r.from ? ' — с ' + exRuDate(r.from) + ' по ' + exRuDate(r.to) : '') +
               ': расходы ' + money(r.sums.exp) + ', доходы ' + money(r.sums.inc) + ', переводы ' + money(r.sums.mov) + '. '
             : 'Новых операций в файле нет. ') +
      (r.errorCount ? 'Отклонено ' + r.errorCount + '. ' : '') +
      (r.dupCount ? 'Похожи на уже внесённые — ' + r.dupCount + '.' : ''));
    if (r.errorCount){
      b += '<div class="f" style="margin-top:14px"><div class="f-lbl">Отклонены' + (r.errorCount > r.errors.length ? ' — первые ' +
        r.errors.length : '') + '</div><div class="qs">' + r.errors.map(function(e){
          return '<div class="q-row"><div class="q-main"><div class="q-text">Строка ' + e.line + ': ' + esc(e.reason) + '</div>' +
            '<div class="q-meta">' + esc(e.raw) + '</div></div></div>';
        }).join('') + '</div></div>';
    }
    if (r.dupCount){
      b += '<div class="f" style="margin-top:14px"><div class="f-lbl">Похожи на уже внесённые</div><div class="qs">' +
        r.dups.map(function(d){
          return '<div class="q-row"><div class="q-main"><div class="q-text">Строка ' + d.line + ': ' + exRuDate(d.date) + ' · ' +
            money(d.amount) + '</div><div class="q-meta">' + esc(d.description || 'без описания') + '</div></div></div>';
        }).join('') + '</div></div>' +
        fmCheck('withDups', st, 'Добавить и их тоже', 'Та же дата, сумма, счёт и описание уже есть в учёте. Обычно это ' +
          'повторная загрузка той же выписки — тогда их лучше пропустить.');
    }
    return '<div class="mod mod--wide" data-k="import">' + fmModHead(FM_TITLES['import']) + '<div class="mod-body">' + b +
      fmErr(st) + '</div>' + fmMiscFoot(fmMiscSave(add ? 'Добавить ' + add + NBSP + plural(add, 'операцию', 'операции', 'операций')
                                                       : 'Добавлять нечего', add > 0)) + '</div>';
  }
  if (k === 'integrity'){
    var rep = st.report;
    b += fmPlainNote('<b>' + (rep.ok && !rep.items.length ? 'Всё сходится.' : rep.ok ? 'Ошибок нет, есть на что посмотреть.'
                                                                            : 'Найдены расхождения.') + '</b> Проверено ' +
      rep.checked.ops + NBSP + plural(rep.checked.ops, 'операция', 'операции', 'операций') + ', ' + rep.checked.accounts + NBSP +
      plural(rep.checked.accounts, 'счёт', 'счёта', 'счетов') + ', ' + rep.checked.cats + NBSP +
      plural(rep.checked.cats, 'категория', 'категории', 'категорий') + '; балансы пересчитаны с нуля.');
    b += rep.items.map(function(it){
      return '<div class="warn' + (it.level === 'error' ? ' is-neg' : '') + '"><span class="dot"></span><span>' + esc(it.text) + '</span></div>';
    }).join('');
    var reconBtn = rep.items.some(function(it){ return it.level === 'error' && /при сверке/.test(it.text); })
      ? '<button type="button" class="btn btn-primary" data-misc="recon">Сверить балансы</button>' : '';
    return '<div class="mod mod--wide" data-k="integrity">' + fmModHead(FM_TITLES.integrity) + '<div class="mod-body">' + b +
      '</div>' + fmMiscFoot('', reconBtn) + '</div>';
  }
  if (k === 'models'){
    /* Все модели OpenRouter, которые умеют обращаться к данным: поиск по
       названию и компании, сортировка по цене вопроса. */
    var q = st.q.trim().toLowerCase();
    var shown = st.list.filter(function(m){ return !q || m.id.toLowerCase().indexOf(q) >= 0 || m.name.toLowerCase().indexOf(q) >= 0; });
    /* Бесплатные — отдельной группой в конце: у них ограничено число
       запросов, и с данными приложения они справляются хуже. */
    var isFree = function(m){ return m.free || (!m.in && !m.out); };
    shown.sort(st.sort === 'price'
      ? function(a, b){ return (isFree(a) - isFree(b)) || sgAskCost(a) - sgAskCost(b) || (a.id < b.id ? -1 : 1); }
      : function(a, b){ return a.id < b.id ? -1 : 1; });
    var firstFree = st.sort === 'price' ? shown.filter(isFree)[0] : null;
    b += '<div class="f" style="margin-bottom:10px"><input class="inp" type="text" data-f="q" autocomplete="off" spellcheck="false" ' +
      'placeholder="Название или компания: claude, gpt, gemini, deepseek…" value="' + esc(st.q) + '"></div>';
    b += '<div class="mdl-bar">' + fmToggle('sort', st, [['price', 'Сначала дешёвые'], ['name', 'По названию']]) +
      '<span class="spacer"></span><span class="mdl-cnt">показано ' + shown.length + ' из ' + st.list.length + '</span></div>';
    b += '<div class="mdl-list">' + (shown.length ? shown.map(function(m){
      return (m === firstFree ? '<div class="mdl-group">Бесплатные — с ограничением числа запросов</div>' : '') +
        '<button type="button" class="mdl' + (m.id === st.cur ? ' is-on' : '') + '" data-model="' + esc(m.id) + '">' +
        '<span class="mdl-main"><span class="nm">' + esc(m.name) + (m.id === st.cur ? ' · выбрана' : '') + '</span>' +
          '<span class="id">' + esc(m.id) + '</span></span>' +
        '<span class="mdl-cost"><span class="ask">' + sgCostText(m.free ? 0 : sgAskCost(m)) + '</span>' +
          '<span class="per">' + (m.free || (!m.in && !m.out) ? 'с ограничениями' : '$' + String(m.in).replace('.', ',') + ' / $' +
          String(m.out).replace('.', ',') + ' за 1 млн') + '</span></span></button>';
    }).join('') : '<p class="f-hint" style="padding:12px 0">Ничего не нашлось.</p>') + '</div>';
    b += fmPlainNote('<b>Цена «за вопрос» — оценка:</b> обращение к данным и ответ на полстраницы. Самые дешёвые модели ' +
      'отвечают проще и чаще ошибаются в разборе записей — если ответы покажутся слабыми, возьмите модель подороже. ' +
      'Бесплатные работают с ограничением числа запросов.');
    return '<div class="mod mod--wide" data-k="models">' + fmModHead(FM_TITLES.models) + '<div class="mod-body">' + b +
      fmErr(st) + '</div>' + fmMiscFoot('') + '</div>';
  }
  if (k === 'keys'){
    return '<div class="mod" data-k="keys">' + fmModHead(FM_TITLES.keys) + '<div class="mod-body">' + keysHTML() + '</div>' +
      fmMiscFoot('') + '</div>';
  }
  return '<div class="mod" data-k="changelog">' + fmModHead(FM_TITLES.changelog) +
    '<div class="mod-body"><div class="cl">' + fmChangelogHTML(st.text) + '</div></div>' + fmMiscFoot('') + '</div>';
}
function fmSaveMisc(k, st){
  if (k === 'export'){
    var t = FM_TABLES.filter(function(x){ return st['t_' + x[0]]; }).map(function(x){ return x[0]; });
    if (t.length) sgExport(t);
    return;
  }
  var call = null, text = '';
  if (k === 'cat'){
    if (!st.name.trim() || !st.type) return;
    call = st.orig ? window.api.editCategory({ name: st.orig, newName: st.name, type: st.type, note: st.note })
                   : window.api.addCategory({ name: st.name, type: st.type, note: st.note });
    text = st.orig ? (st.name.trim() !== st.orig ? 'Категория переименована во всех операциях' : 'Категория сохранена')
                   : 'Категория «' + st.name.trim() + '» добавлена в список';
  } else if (k === 'merge'){
    if (!st.to) return;
    call = window.api.mergeCategory(st.from.name, st.to);
    text = 'Категории объединены';
  } else if (k === 'import'){
    call = window.api.importApply(st.report.token, !!st.withDups);
  } else if (k === 'plansave'){
    var amt = fmParse(st.amount);
    if (!st.plan || !amt.ok || amt.empty || !amt.cents) return;
    call = window.api.setAside(st.plan.id, String(amt.cents));
    text = amt.cents > 0 ? 'Отложено под «' + st.plan.name + '»' : 'Забрано из отложенного под «' + st.plan.name + '»';
  } else if (k === 'question'){
    if (!st.text.trim()) return;
    call = window.api.addQuestion({ text: st.text, recurringId: st.rec ? Number(st.rec) : null });
    text = 'Вопрос добавлен';
  }
  if (!call) return;
  fmBusy = true;
  fmRender();
  call.then(function(r){
    fmBusy = false;
    if (!r || !r.ok){ st.err = (r && r.error) || 'ошибка базы'; if (fmSt === st) fmRender(); return; }
    if (k === 'import') text = 'Добавлено операций: ' + r.added;
    if (k === 'merge') text += ' · перенесено операций: ' + r.moved;
    fmToast(text, r.undo);
    fmClose();
    draw();
  });
}
/* Кнопки окна категории: в архив и удалить — сразу, с отменой в тосте. */
function fmMiscAct(act){
  var st = fmSt;
  if (act === 'recon'){ fmClose(); fmOpen('recon'); return; }
  var call = act === 'cat-archive' ? window.api.archiveCategory(st.orig) : window.api.deleteCategory(st.orig);
  call.then(function(r){
    if (!r || !r.ok){ st.err = (r && r.error) || 'ошибка базы'; fmRender(); return; }
    fmToast(act === 'cat-archive' ? 'Категория отправлена в архив' : 'Категория удалена', r.undo);
    fmClose();
    draw();
  });
}

/* ============================================================
   ОТРИСОВКА, ОТКРЫТИЕ, ЗАКРЫТИЕ
   ============================================================ */
function fmBuild(){
  if (fmKind === 'recon') return fmReconHTML(fmSt);
  if (FM_MISC.indexOf(fmKind) >= 0) return fmMiscHTML(fmSt);
  return FM_OPS.indexOf(fmKind) >= 0 ? fmOpHTML(fmSt) : fmRefHTML(fmSt);
}
/* Поле, в котором стоял курсор, возвращаем после пересборки: без этого
   фокус слетал бы с первой буквы. */
function fmRender(){
  var ov = document.getElementById('fmOv');
  if (!ov || !fmKind) return;
  var act = document.activeElement, inside = act && ov.contains(act);
  var keep = inside && act.getAttribute ? act.getAttribute('data-f') : null;
  var keepRecon = inside && act.getAttribute ? act.getAttribute('data-recon') : null;
  var pos = inside && act.selectionStart !== null && act.selectionStart !== undefined ? act.selectionStart : null;
  ov.innerHTML = fmBuild();
  var back = keepRecon ? ov.querySelector('[data-recon="' + keepRecon + '"]')
           : keep ? ov.querySelector('[data-f="' + keep + '"]') : null;
  if (back && back.focus){
    back.focus();
    if (pos !== null && back.setSelectionRange && back.tagName !== 'SELECT'){
      try { back.setSelectionRange(pos, pos); } catch (e) { /* поле без курсора */ }
    }
  }
}
function fmMenu(open){
  var m = document.getElementById('addMenu'), b = document.getElementById('headPrimary');
  if (!m) return;
  m.classList.toggle('is-open', open);
  b.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function fmMenuOpen(){
  var m = document.getElementById('addMenu');
  return !!m && m.classList.contains('is-open');
}
/* Подпись главной кнопки называет то, что обычно добавляют на открытом
   экране, — этот пункт меню и получает фокус: Enter открывает его сразу. */
var FM_SCREEN_ITEM = { plans: 'plan', payments: 'recur' };
function fmMenuToggle(){
  var open = !fmMenuOpen();
  fmMenu(open);
  if (open){
    var it = document.querySelector('#addMenu [data-open="' + (FM_SCREEN_ITEM[current] || 'expense') + '"]');
    if (it) it.focus();
  }
}
/* Стрелки ходят по пунктам меню, недоступные пропускаются. */
function fmMenuStep(dir){
  var items = Array.prototype.slice.call(document.querySelectorAll('#addMenu .dd-item:not(:disabled)'));
  if (!items.length) return;
  var i = items.indexOf(document.activeElement);
  items[(i + dir + items.length) % items.length].focus();
}
/* Открыть окно. Данные для форм берутся свежими: после сохранения на
   другом окне остатки уже другие. */
function fmOpen(kind, pre, data){
  fmMenu(false);
  return (data ? Promise.resolve(data) : window.api.formData()).then(function(d){
    if (!d || d.error){ toast('Окно не открылось: ' + ((d && d.error) || 'нет данных')); return; }
    FD = d;
    var fresh = !fmKind;
    if (!fmKind) fmReturnTo = document.activeElement;
    fmKind = kind;
    fmCloseTok++;
    fmSt = FM_OPS.indexOf(kind) >= 0 ? fmNewOp(kind, pre) : kind === 'recon' ? fmNewRecon()
         : FM_MISC.indexOf(kind) >= 0 ? fmNewMisc(kind, pre || {}) : fmNewRef(kind, pre);
    fmRender();
    var ov = document.getElementById('fmOv');
    /* Появление — после того как окно собрано и нарисовано: затемнение
       проявляется, окно чуть поднимается. Пока оно собирается — невидимо. */
    if (fresh && !REDUCED && ov.animate){
      ov.style.opacity = '0';
      ov.classList.add('is-open');
      afterPaint(function(){
        ov.style.opacity = '';
        if (fmKind !== kind) return;
        ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, easing: 'ease-out' });
        var m = ov.querySelector('.mod');
        if (m) m.animate([{ opacity: 0, transform: 'translateY(10px) scale(.99)' }, { opacity: 1, transform: 'none' }],
                         { duration: 240, easing: 'cubic-bezier(.16, 1, .3, 1)' });
      });
    } else {
      ov.style.opacity = '';
      ov.classList.add('is-open');
    }
    var first = ov.querySelector(pre && pre.focus ? '[data-f="' + pre.focus + '"]' : '[data-f="raw"], [data-f="name"], ' +
      '[data-f="creditor"], [data-recon]');
    if (first) first.focus();
    if (kind === 'recon') fmReconLoad();
    if (kind === 'loan') fmLoanPreview();
  });
}
/* Закрытое окно возвращает фокус туда, откуда его открыли. */
var fmReturnTo = null;
var fmCloseTok = 0;
function fmClose(){
  if (!fmKind) return;
  var ov = document.getElementById('fmOv'), tok = ++fmCloseTok;
  fmKind = null; fmSt = null;
  /* Уход — короткое затухание; новое окно, открытое тут же, его отменяет. */
  var gone = function(){ if (tok !== fmCloseTok || fmKind) return; ov.classList.remove('is-open'); ov.innerHTML = ''; ov.style.opacity = ''; };
  if (!REDUCED && ov.animate){
    ov.style.pointerEvents = 'none';
    var a = ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 130, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = function(){ ov.style.pointerEvents = ''; a.cancel(); if (tok === fmCloseTok && !fmKind) ov.style.opacity = '0'; gone(); };
  } else gone();
  if (fmReturnTo && fmReturnTo.focus && document.body.contains(fmReturnTo)) fmReturnTo.focus();
  fmReturnTo = null;
}
/* Расчётные остатки на дату сверки — из главного процесса. */
function fmReconLoad(){
  if (!fmSt || fmKind !== 'recon') return;
  var tok = ++fmReconTok, date = fmSt.date;
  if (!date){ fmSt.calc = null; fmRender(); return; }
  window.api.reconCalc(date).then(function(c){
    if (tok !== fmReconTok || !fmSt || fmKind !== 'recon') return;
    fmSt.calc = c && !c.error ? c : null;
    fmRender();
  });
}
/* Предпросмотр кредита — тем же графиком, что на «Капитале». */
function fmLoanPreview(){
  if (!fmSt || fmKind !== 'loan') return;
  var tok = ++fmLoanTok, st = fmSt;
  /* Пустая ставка — не ноль процентов, а незаполненное поле. */
  if (!String(st.rate).trim()){ st.preview = null; fmRender(); return; }
  var q = { rest: String(fmNum(st.rest)), pay: String(fmNum(st.pay)), day: Number(st.day), rate: st.rate };
  window.api.loanPreview(q).then(function(p){
    if (tok !== fmLoanTok || fmSt !== st) return;
    st.preview = p && !p.error ? p : null;
    fmRender();
  });
}

/* ============================================================
   СОХРАНЕНИЕ, ТОСТ И ОТМЕНА
   ============================================================ */
function fmToast(text, token){
  var t = document.getElementById('fmToast');
  document.getElementById('fmToastText').textContent = text;
  fmUndoToken = token || null;
  if (token) fmLastUndo = { token: token, at: Date.now() };
  document.getElementById('fmToastUndo').style.display = token ? '' : 'none';
  t.classList.add('is-on');
  clearTimeout(fmToastTimer);
  /* Четыре секунды по ТЗ: столько живёт возможность отменить. */
  fmToastTimer = setTimeout(function(){ t.classList.remove('is-on'); fmUndoToken = null; }, 4000);
}
function fmUndo(){
  if (!fmUndoToken) return;
  var tok = fmUndoToken;
  fmUndoToken = null;
  fmLastUndo = null;
  document.getElementById('fmToast').classList.remove('is-on');
  window.api.undo(tok).then(function(r){
    fmToast(r && r.ok ? 'Отменено' : 'Не отменилось: ' + ((r && r.error) || 'ошибка базы'), null);
    draw();
  });
}
/* ⌘Z: отменить последнюю запись. Плашка с «Отменить» живёт четыре
   секунды, а сама отмена возможна минуту — столько же работает ⌘Z. */
function fmUndoLast(){
  if (!fmLastUndo || Date.now() - fmLastUndo.at > 60000){
    fmLastUndo = null;
    fmToast('Отменять нечего: последняя запись старше минуты или её не было', null);
    return;
  }
  fmUndoToken = fmLastUndo.token;
  fmUndo();
}
function fmPayload(){
  var st = fmSt, k = fmKind;
  var c = function(v){ var r = fmParse(v); return r.ok && !r.empty ? String(r.cents) : ''; };
  if (FM_OPS.indexOf(k) >= 0){
    var S = fmOpSums(st);
    return { kind: k, amount: String(fmParse(st.raw).cents), date: st.date, from: st.from, to: st.to,
             category: st.cat, desc: st.desc, once: st.once, goal: st.goal, planId: st.planId,
             tags: Object.keys(st.tags).filter(function(t){ return st.tags[t]; }),
             cur: k === 'transfer' ? '' : S.cur, amountTo: S.cross ? c(st.rawTo) : '' };
  }
  if (k === 'plan') return { id: st.id, name: st.name, cat: st.cat, min: c(st.min), max: c(st.max), need: st.need,
    urg: st.urg, repl: st.repl, own: c(st.own), deadline: exParseDate(st.deadlineTxt) || (st.deadlineTxt ? 'x' : ''),
    note: st.note };
  if (k === 'recur') return { id: st.id, name: st.name, cat: st.cat, fixed: st.fixed, amount: c(st.amount),
    amountTo: c(st.amountTo), every: st.every, day: st.day, wday: st.wday,
    month: st.every === 'y' || st.every === 'q' ? st.month : null, accId: st.accId, type: st.type,
    until: exParseDate(st.untilTxt) || (st.untilTxt ? 'x' : ''), note: st.note };
  if (k === 'goal') return { id: st.id, name: st.name, accId: st.accId, target: c(st.target),
    deadline: exParseDate(st.deadlineTxt) || (st.deadlineTxt ? 'x' : ''), monthly: c(st.monthly) };
  if (k === 'account' && st.id) return { id: st.id, name: st.name, bank: st.bank, isPay: st.isPay, limit: c(st.limit),
    graceDay: st.graceDay, graceRule: st.graceRule, cur: st.cur,
    statementDay: st.isCredit ? st.statementDay : undefined, graceLeft: st.isCredit ? c(st.graceLeft) : undefined };
  /* Долг кредитки пишут числом, как в приложении банка, — минус ставим сами. */
  var debtOf = function(v){ var x = c(v); return x && x.charAt(0) !== '-' && x !== '0' ? '-' + x : x; };
  if (k === 'account') return { name: st.name, bank: st.bank, type: st.type, cur: st.cur,
    bal: st.type === 'credit' ? debtOf(st.bal) : c(st.bal),
    balDate: exParseDate(st.balDateTxt) || 'x', isPay: st.isPay, limit: c(st.limit), graceDay: st.graceDay,
    graceRule: st.graceRule, avail: st.type === 'credit' ? c(st.avail) : undefined,
    statementDay: st.type === 'credit' ? st.statementDay : undefined, graceLeft: st.type === 'credit' ? c(st.graceLeft) : undefined };
  if (k === 'loan') return { creditor: st.creditor, type: st.type, rate: st.rate, pay: c(st.pay), day: st.day,
    close: exParseDate(st.closeTxt) || (st.closeTxt ? 'x' : ''), initial: c(st.initial), rest: c(st.rest),
    inOblig: st.inOblig };
  return { date: st.date, rows: fmReconRows(st).map(function(r){
    return r.skipped ? { accId: r.a.id, skip: true } : { accId: r.a.id, fact: String(r.fact) };
  }) };
}
var FM_SAVE = { expense: 'addOperation', income: 'addOperation', transfer: 'addOperation', plan: 'savePlan',
  recur: 'saveRecurring', goal: 'saveGoal', account: 'saveAccount', loan: 'saveLoan', recon: 'saveRecon' };
function fmSave(more){
  if (!fmKind || fmBusy) return;
  var k = fmKind, st = fmSt;
  if (FM_MISC.indexOf(k) >= 0) return fmSaveMisc(k, st);
  if (FM_OPS.indexOf(k) >= 0){
    var a = fmParse(st.raw);
    if (!(a.ok && a.cents > 0) || !st.date) return;
  }
  fmBusy = true;
  fmRender();
  window.api[k === 'account' && st.id ? 'editAccount' : FM_SAVE[k]](fmPayload()).then(function(r){
    fmBusy = false;
    if (!r || !r.ok){
      st.err = (r && r.error) || 'ошибка базы';
      if (fmSt === st) fmRender();
      return;
    }
    var text;
    if (FM_OPS.indexOf(k) >= 0){
      var word = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' }[k];
      text = word + ' ' + fmC(fmParse(st.raw).cents) + ' добавлен' + (st.planId ? ' — позиция отмечена купленной' : '');
    } else if (k === 'recon'){
      text = r.corrections ? 'Сверка зафиксирована · корректировок: ' + r.corrections : 'Сверка зафиксирована · всё сошлось';
    } else {
      text = FM_TITLES[k] + ': ' + (st.id || (k === 'loan' && st.existing) ? 'изменения сохранены' : 'сохранено');
    }
    fmToast(text, r.undo);
    if (more && FM_OPS.indexOf(k) >= 0){
      /* «Сохранить и добавить ещё» чистит сумму и описание, но оставляет
         дату и счёт: обычно подряд вносят операции одного дня. */
      window.api.formData().then(function(d){
        if (d && !d.error) FD = d;
        st.raw = ''; st.desc = ''; st.dismissed = {}; st.err = ''; st.planId = null;
        fmRender();
        var amt = document.querySelector('#fmOv [data-f="raw"]');
        if (amt) amt.focus();
      });
    } else {
      fmClose();
    }
    draw();
  });
}

/* ============================================================
   СОБЫТИЯ ОКНА
   ============================================================ */
/* Подложка закрывает окно, только если на ней и нажали, и отпустили:
   выделение текста в поле, отпущенное за краем окна, не теряет ввод. */
var fmDownOnOv = false;
function fmClick(e){
  var ov = document.getElementById('fmOv');
  if (e.target === ov){ if (fmDownOnOv) fmClose(); return; }
  var b = e.target.closest ? e.target.closest('button') : null;
  if (!b || !fmSt) return;
  var st = fmSt;
  if (b.getAttribute('data-close')){ fmClose(); return; }
  if (b.getAttribute('data-misc')){ fmMiscAct(b.getAttribute('data-misc')); return; }
  if (b.getAttribute('data-model')){
    var mid = b.getAttribute('data-model');
    window.api.setPref('ai.model', mid).then(function(r){
      if (!r || !r.ok){ st.err = (r && r.error) || 'не сохранено'; fmRender(); return; }
      var m = st.list.filter(function(x){ return x.id === mid; })[0];
      fmClose();
      fmToast('Модель: ' + (m ? m.name : mid), null);
      if (current === 'settings') sgReload(false);
    });
    return;
  }
  if (b.getAttribute('data-save')){ fmSave(b.getAttribute('data-save') === 'more'); return; }
  if (b.getAttribute('data-cat') !== null){ st.cat = b.getAttribute('data-cat'); st.catQuery = ''; st.newCat = null; st.err = ''; fmRender(); return; }
  if (b.getAttribute('data-newcat')){ st.newCat = { name: st.catQuery.trim(), type: '' }; fmRender(); return; }
  if (b.getAttribute('data-newcat-cancel')){ st.newCat = null; fmRender(); return; }
  if (b.getAttribute('data-newcat-save')){
    window.api.addCategory({ name: st.newCat.name, type: st.newCat.type }).then(function(r){
      if (!r || !r.ok){ st.err = (r && r.error) || 'ошибка базы'; fmRender(); return; }
      window.api.formData().then(function(d){
        if (d && !d.error) FD = d;
        st.cat = r.name; st.catQuery = ''; st.newCat = null; st.err = '';
        fmRender();
        fmToast('Категория «' + r.name + '» добавлена в список', r.undo);
      });
    });
    return;
  }
  if (b.getAttribute('data-date')){ st.date = b.getAttribute('data-date'); st.dateTxt = exRuDate(st.date); fmRender(); return; }
  if (b.getAttribute('data-tag')){ var t = b.getAttribute('data-tag'); st.tags[t] = !st.tags[t]; fmRender(); return; }
  if (b.getAttribute('data-dismiss')){
    var id = b.getAttribute('data-dismiss');
    st.dismissed[id] = true;
    if (id === 'late') st.tags['поздняя запись'] = true;
    if (id === 'dup'){ st.raw = ''; st.desc = ''; }
    fmRender();
    return;
  }
  if (b.getAttribute('data-f') === 'showCur'){ st.showCur = true; fmRender(); return; }
  var set = b.getAttribute('data-set');
  if (set){
    var i = set.indexOf(':'), f = set.slice(0, i), v = set.slice(i + 1);
    st[f] = v === 'true' ? true : (v === 'false' ? false : v);
    if (f === 'type' && fmKind === 'recur'){
      var list = (v === 'доход' ? FD.cats.inc : FD.cats.exp).map(function(c){ return c.name; });
      if (list.indexOf(st.cat) < 0) st.cat = list[0] || '';
    }
    fmRender();
  }
}
/* Дата набирается цифрами — точки встают сами, как в поле периода
   на «Расходах». */
function fmMaskDate(el){
  var raw = el.value.replace(/\D/g, '').slice(0, 8), out = raw.slice(0, 2);
  if (raw.length > 2) out += '.' + raw.slice(2, 4);
  if (raw.length > 4) out += '.' + raw.slice(4, 8);
  return out;
}
var FM_DATE_FIELDS = { dateTxt: 1, deadlineTxt: 1, untilTxt: 1, balDateTxt: 1, closeTxt: 1 };
function fmInput(e){
  var st = fmSt, el = e.target;
  if (!st || !el.getAttribute) return;
  var rid = el.getAttribute('data-recon');
  if (rid){ st.vals[rid] = el.value; fmRender(); return; }
  var f = el.getAttribute('data-f');
  if (!f) return;
  if (el.type === 'checkbox') return;
  if (FM_DATE_FIELDS[f]){
    var masked = fmMaskDate(el);
    st[f] = masked;
    if (f === 'dateTxt'){
      st.date = exParseDate(masked) || '';
      if (fmKind === 'recon') fmReconLoad();
    }
  } else if (f === 'newCatName'){ st.newCat.name = el.value; return; }
  else st[f] = el.value;
  st.err = '';
  if (fmKind === 'loan' && /^(rest|rate|pay|day)$/.test(f)) fmLoanPreview();
  /* Изначальная сумма и уже внесённое связаны остатком: правите одно —
     второе пересчитывается. */
  if (fmKind === 'loan' && (f === 'initial' || f === 'paid')){
    var rest = fmNum(st.rest);
    if (f === 'initial' && fmNum(st.initial)) st.paid = fmRaw(Math.max(0, fmNum(st.initial) - rest));
    if (f === 'paid' && fmNum(st.paid)) st.initial = fmRaw(rest + fmNum(st.paid));
  }
  fmRender();
}
function fmChange(e){
  var st = fmSt, el = e.target;
  if (!st || !el.getAttribute) return;
  var sk = el.getAttribute('data-skip');
  if (sk){ st.skip[sk] = el.checked; fmRender(); return; }
  var f = el.getAttribute('data-f');
  if (!f) return;
  if (el.type === 'checkbox'){ st[f] = el.checked; fmRender(); return; }
  if (f === 'newCatType'){ st.newCat.type = el.value; return; }
  if (el.tagName === 'SELECT'){
    st[f] = el.value; st.err = '';
    if (fmKind === 'loan') fmLoanPreview();
    /* Другой счёт у перевода — вписанное «пришло» было про прежний. */
    if (fmKind === 'transfer' && (f === 'from' || f === 'to')) st.rawTo = '';
    /* Кредитка — только в рублях. */
    if (fmKind === 'account' && f === 'type' && el.value === 'credit') st.cur = 'RUB';
    /* Валюта, курса которой ещё нет (счетов в ней не было), — подтянуть
       курс ЦБ: подсказки и предпросмотр пересчитаются, когда он придёт. */
    if (f === 'cur' && el.value !== 'RUB' && !fmRate(el.value, FD.today)) fmEnsureRate(el.value);
    fmRender();
  }
}

/* ============================================================
   КНОПКИ НА ЭКРАНАХ
   ============================================================
   Кнопки экранов открывают окна с заполненными полями: «Внести
   платёж» — расход с суммой и категорией кредита, «Купил» — расход по
   позиции плана, «Внести фактом» — то, что ждали по расписанию.     */
function fmFromButton(btn){
  var a = function(n){ return btn.getAttribute('data-' + n); };
  var kind = a('form');
  return window.api.formData().then(function(d){
    if (!d || d.error){ toast('Окно не открылось'); return; }
    FD = d;
    var pay = fmPay(), card = fmCard();
    if (kind === 'loanpay'){
      var rec = FD.recurring.filter(function(r){ return r.cat === 'Платежи по кредитам'; })[0];
      return fmOpen('expense', { category: 'Платежи по кредитам', amount: FD.loan && FD.loan.pay,
        from: rec ? rec.accId : pay.id, desc: rec ? rec.name : 'Платёж по кредиту', tags: ['регулярный'] }, d);
    }
    if (kind === 'cardtopup') return fmOpen('transfer', { to: a('to') || (card && card.id), from: pay.id }, d);
    /* Отложить можно только на отдельный счёт: если цель хранится на
       платёжном, перевод вышел бы на тот же счёт. Тогда открывается
       сама цель — выбрать, где копить. */
    if (kind === 'goaltopup'){
      var gAcc = fmAcc(a('to'));
      if (!gAcc || gAcc.isPayment || gAcc.isCredit) return fmOpen('goal', { id: a('id'), focus: 'accId' }, d);
      return fmOpen('transfer', { to: gAcc.id, from: pay.id, goal: a('goal') || '' }, d);
    }
    if (kind === 'buy'){
      var p = FD.plans.filter(function(x){ return x.id === Number(a('id')); })[0];
      if (!p){ toast('Позиция уже не в очереди'); return; }
      return fmOpen('expense', { category: p.cat, amount: p.max, desc: p.name, tags: ['по плану'], planId: p.id }, d);
    }
    if (kind === 'fact'){
      var sum = Math.abs(Number(a('sum') || 0)), k = a('kind');
      var pre = { amount: sum, desc: a('name') || '', category: a('cat') || '', tags: ['регулярный'] };
      if (k === 'inc') return fmOpen('income', Object.assign(pre, { to: a('acc') || pay.id }), d);
      if (k === 'mov') return fmOpen('transfer', { amount: sum, to: card && card.id, from: a('acc') || pay.id }, d);
      return fmOpen('expense', Object.assign(pre, { from: a('acc') || pay.id }), d);
    }
    if (kind === 'expense') return fmOpen('expense', { date: a('date') || '' }, d);
    return fmOpen(kind, { id: a('id'), note: a('note') || '', focus: a('focus') || '',
                          deadline: a('deadline') || '' }, d);
  });
}
/* Действия без окна: «Убрать» позицию, «На паузу» платёж. Сразу, с
   отменой в тосте. */
function fmAct(btn){
  var act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id');
  var call = act === 'plan-drop' ? window.api.dropPlan(id)
    : act === 'pay-skip' ? window.api.skipPayment(id)
    : window.api.pauseRecurring(id);
  call.then(function(r){
    if (!r || !r.ok){ toast('Не сохранилось: ' + ((r && r.error) || 'ошибка базы')); return; }
    fmToast(act === 'plan-drop' ? 'Позиция убрана из очереди'
      : act === 'pay-skip' ? '«' + (r.name || 'Платёж') + '» пропущен в этом месяце'
      : 'Платёж поставлен на паузу', r.undo);
    draw();
  });
}

/* Слой окон и тост — в конце страницы, поверх любого экрана. */
function fmInit(){
  var layer = document.getElementById('fmLayer');
  layer.innerHTML = '<div class="ov" id="fmOv" role="dialog" aria-modal="true" aria-labelledby="fmTitle"></div>' +
    '<div class="toast" id="fmToast" role="status" aria-live="polite"><span id="fmToastText"></span>' +
    '<button type="button" id="fmToastUndo">Отменить</button></div>';
  var ov = document.getElementById('fmOv');
  ov.addEventListener('mousedown', function(e){ fmDownOnOv = e.target === ov; });
  ov.addEventListener('click', fmClick);
  ov.addEventListener('input', fmInput);
  ov.addEventListener('change', fmChange);
  document.getElementById('fmToastUndo').addEventListener('click', fmUndo);
  document.addEventListener('keydown', function(e){
    /* Пока открыт мастер первого запуска, окна ввода не открываются. */
    if (typeof obIsOpen !== 'undefined' && obIsOpen) return;
    if (e.key === 'Escape'){
      if (fmMenuOpen()){ fmMenu(false); document.getElementById('headPrimary').focus(); return; }
      if (fmKind){ e.preventDefault(); fmClose(); }
      return;
    }
    if (fmMenuOpen() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')){
      e.preventDefault(); fmMenuStep(e.key === 'ArrowDown' ? 1 : -1); return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && fmKind){ e.preventDefault(); fmSave(false); return; }
    /* По коду клавиши, а не по букве: на русской раскладке ⌘E — это ⌘У.
       Буква — запасной путь, если код клавиши не пришёл. */
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey){
      var k = { KeyE: 'expense', KeyI: 'income', KeyT: 'transfer' }[e.code] ||
              { e: 'expense', 'у': 'expense', i: 'income', 'ш': 'income', t: 'transfer', 'е': 'transfer' }
                [String(e.key || '').toLowerCase()];
      if (k){ e.preventDefault(); if (fmKind) fmClose(); fmOpen(k); }
    }
  });
}
