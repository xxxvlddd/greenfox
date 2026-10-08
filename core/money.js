'use strict';
/* ============================================================
   ДЕНЬГИ
   ============================================================
   Всё хранится и считается в целых копейках типа BigInt. Числа с
   плавающей точкой здесь недопустимы: 0.1 + 0.2 в них не равно 0.3, и
   на сотне операций накапливается расхождение, из-за которого сверка
   с банком перестаёт сходиться.

   Округление — «банковское» (к ближайшему чётному при ровной половине).
   Это не прихоть: действующее ядро на Python считает через Decimal, у
   которого такое округление стоит по умолчанию. Возьми мы привычное
   «половина вверх» — проценты по кредиту разошлись бы с нынешним
   дашбордом на копейки, и сверить одно с другим стало бы невозможно.
   ============================================================ */

/* Разбор суммы из строки. Принимает и минус, и типографский знак «−»,
   и запятую вместо точки, и пробелы-разделители разрядов. */
function parseAmount(raw) {
  if (raw === null || raw === undefined) return 0n;
  let s = String(raw).trim()
    .replace(/[\s ]/g, '')
    .replace(/−/g, '-')
    .replace(/,/g, '.');
  if (!s) return 0n;
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error('не сумма: ' + raw);
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = m[2] || '0';
  /* Больше двух знаков после точки в деньгах не бывает: если пришло —
     это ошибка данных, а не повод молча округлить. */
  const frac = m[3] || '';
  if (frac.length > 2) throw new Error('в сумме больше двух знаков после точки: ' + raw);
  const cents = BigInt(whole) * 100n + BigInt((frac + '00').slice(0, 2));
  return sign * cents;
}

/* Копейки обратно в строку с двумя знаками — ровно так же, как их
   печатает Python (f'{v:.2f}'), чтобы эталон и расчёт сравнивались
   посимвольно. */
function fmt(cents) {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return (neg ? '-' : '') + whole.toString() + '.' + frac;
}

/* Деление BigInt с банковским округлением. Делитель строго больше нуля. */
function divHalfEven(n, d) {
  if (d <= 0n) throw new Error('делитель должен быть больше нуля');
  const neg = n < 0n;
  const a = neg ? -n : n;
  let q = a / d;
  const rem = a % d;
  const twice = rem * 2n;
  if (twice > d) q += 1n;
  else if (twice === d && q % 2n === 1n) q += 1n;   /* ровно половина — к чётному */
  return neg ? -q : q;
}

/* Умножение суммы на ставку, заданную дробью числитель/знаменатель.
   Ставка приходит именно дробью, а не числом с точкой: 0.0120833333 в
   двоичной плавающей точке непредставимо точно. */
function mulRate(cents, num, den) {
  return divHalfEven(cents * num, den);
}

module.exports = { parseAmount, fmt, divHalfEven, mulRate };

/* Сумма для текста, который читает человек: с разрядами, запятой и
   знаком рубля. Внутри расчётов не используется — только в сообщениях. */
function say(cents, noKop) {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  let whole = (abs / 100n).toString();
  const kop = (abs % 100n).toString().padStart(2, '0');
  whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const tail = (noKop && kop === '00') ? '' : ',' + kop;
  return (neg ? '−' : '') + whole + tail + ' ₽';
}
module.exports.say = say;
