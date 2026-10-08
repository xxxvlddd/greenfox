'use strict';
/* ============================================================
   OPENROUTER
   ============================================================
   Единственный провайдер ассистента: у большинства людей есть ключ
   OpenRouter, а через него доступны модели разных компаний, в том
   числе Anthropic. Обращения идут только из главного процесса — ключ
   в окно приложения не попадает.

   Сеть подменяется в проверках через useFetch(): настоящие запросы в
   тестах не уходят и денег не тратят.
   ============================================================ */
const BASE = 'https://openrouter.ai/api/v1';
const TIMEOUT_MS = 20000;

let fetchImpl = (...a) => fetch(...a);
function useFetch(f) { fetchImpl = f; }

/* Ответ провайдера — в слова для человека. */
function explain(status) {
  if (status === 401 || status === 403) return 'Ключ не принят OpenRouter — проверьте, что он скопирован целиком';
  if (status === 402) return 'На счёте OpenRouter закончились деньги — пополните баланс на сайте';
  if (status === 429) return 'Слишком много запросов подряд — подождите минуту';
  if (status >= 500) return 'OpenRouter сейчас не отвечает — попробуйте позже';
  return 'OpenRouter ответил ошибкой ' + status;
}

async function request(path, key, opts) {
  const ctl = new AbortController();
  const timeout = (opts && opts.timeout) || TIMEOUT_MS;
  const timer = setTimeout(() => ctl.abort(), timeout);
  /* «Остановить» в панели ассистента обрывает запрос снаружи. */
  let stopped = false;
  if (opts && opts.signal) {
    if (opts.signal.aborted) { stopped = true; ctl.abort(); }
    else opts.signal.addEventListener('abort', () => { stopped = true; ctl.abort(); }, { once: true });
  }
  let res;
  try {
    /* Заголовки — только латиницей: кириллица в заголовке запроса
       недопустима и роняет запрос ещё до отправки. */
    const headers = { 'X-Title': 'GREENFOX (home accounting)', 'HTTP-Referer': 'https://greenfox.local' };
    if (key) headers.Authorization = 'Bearer ' + key;
    if (opts && opts.body) headers['Content-Type'] = 'application/json';
    res = await fetchImpl(BASE + path, {
      method: (opts && opts.method) || 'GET', headers, signal: ctl.signal,
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    if (stopped) return { ok: false, stopped: true, error: 'Остановлено' };
    return { ok: false, offline: !(e && e.name === 'AbortError'),
             error: e && e.name === 'AbortError' ? 'OpenRouter не ответил за ' + Math.round(timeout / 1000) + ' секунд'
                                                 : 'Нет сети или OpenRouter недоступен' };
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try { json = await res.json(); } catch (e) { /* пустой или не JSON */ }
  if (!res.ok) {
    /* Сообщение провайдера — к нашему пояснению: в нём бывает причина,
       например «модель недоступна в вашем регионе». */
    const said = json && json.error && json.error.message ? String(json.error.message).slice(0, 200) : '';
    return { ok: false, status: res.status, error: explain(res.status) + (said && res.status !== 401 ? ' (' + said + ')' : '') };
  }
  /* Ошибка бывает и внутри ответа 200 — например, когда модель упала у
     поставщика. */
  if (json && json.error && !json.choices) {
    return { ok: false, status: json.error.code || 0, error: 'Модель вернула ошибку: ' + String(json.error.message || '').slice(0, 200) };
  }
  return { ok: true, json };
}

/* Проверка ключа: принят ли он и сколько на нём осталось. */
async function keyInfo(key) {
  let r = await request('/key', key);
  if (!r.ok && r.status === 404) r = await request('/auth/key', key);
  if (!r.ok) return r;
  const d = (r.json && r.json.data) || {};
  return { ok: true, label: d.label || '', usage: Number(d.usage) || 0,
           limit: d.limit === null || d.limit === undefined ? null : Number(d.limit),
           free: !!d.is_free_tier };
}

/* Модели, которые умеют вызывать функции приложения: без этого
   ассистент не сможет спросить у учёта точные числа. Цены — в долларах
   за миллион токенов. */
async function models() {
  const r = await request('/models', null);
  if (!r.ok) return r;
  const list = ((r.json && r.json.data) || [])
    .filter(m => m && m.id && Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'))
    /* Пакетный режим (:batch) отвечает с задержкой в минуты — для разговора
       не годится; «~…-latest» — переадресация на меняющуюся модель. */
    .filter(m => !/:batch$/.test(m.id) && !/^~/.test(m.id))
    /* Маршрутизаторы (openrouter/auto и подобные) сами выбирают модель —
       цена у них плавает и приходит как −1. */
    .filter(m => !(Number((m.pricing || {}).prompt) < 0 || Number((m.pricing || {}).completion) < 0))
    .map(m => ({
      id: m.id, name: m.name || m.id,
      in: Math.round(Number((m.pricing || {}).prompt || 0) * 1e6 * 100) / 100,
      out: Math.round(Number((m.pricing || {}).completion || 0) * 1e6 * 100) / 100,
      ctx: Number(m.context_length) || 0,
      free: /:free$/.test(m.id),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return { ok: true, list };
}

/* Модель по умолчанию — свежая Sonnet от Anthropic, если она есть в
   списке; иначе Haiku, иначе первая из списка. */
function suggest(list) {
  const ver = id => Number((/(\d+(?:\.\d+)?)$/.exec(id) || [0, 0])[1]);
  for (const re of [/^anthropic\/claude-sonnet-[\d.]+$/, /^anthropic\/claude-haiku-[\d.]+$/, /^anthropic\//]) {
    const hit = list.filter(m => re.test(m.id)).sort((a, b) => ver(b.id) - ver(a.id))[0];
    if (hit) return hit.id;
  }
  return list.length ? list[0].id : '';
}

/* Разговор: OpenAI-совместимый запрос с функциями. Стоимость просим
   вернуть в ответе — по ней считается месячный лимит. */
function chat(key, body, signal) {
  return request('/chat/completions', key, { method: 'POST', signal, timeout: 90000,
    body: Object.assign({ usage: { include: true } }, body) });
}

module.exports = { BASE, useFetch, request, keyInfo, models, suggest, explain, chat };
