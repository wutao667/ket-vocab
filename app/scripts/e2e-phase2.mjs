#!/usr/bin/env node
/**
 * Phase 4 真实浏览器验收：CDP 驱动本机 Chrome。
 * 重点验证：答案未揭晓时不得出现在 DOM、双向切换、进度、返回保留揭晓、
 * 星标持久化、生词本、TTS 真实接口。
 */
const CDP_PORT = 9222;
const BASE = 'http://127.0.0.1:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error('找不到 CDP page target');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.exceptions = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const cdp = new Cdp(ws);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') cdp.exceptions.push(msg.params.exceptionDetails.text);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); }
      }, 25000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const desc = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval error';
      throw new Error(`${desc.split('\n')[0]} :: ${expression.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
    return r.result.value;
  }
  async goto(url, wait = 1800) {
    await this.send('Page.navigate', { url });
    await sleep(wait);
  }
  async key(key, code, keyCode) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
    await sleep(300);
  }
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  — ${detail}` : ''}`);
}

async function main() {
  const cdp = await Cdp.connect(await findTarget());
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // 准备：造一个 8 词的列表。
  // 注意：不能用 indexedDB.deleteDatabase() —— 应用持有打开连接时它会无限阻塞。
  // 改为直接写入独立测试列表，并清空 favorites / selections 两个 store。
  await cdp.goto(`${BASE}/#/`, 1800);
  const listId = await cdp.eval(`(async () => {
    const req = indexedDB.open('ket-vocab');
    const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    if (!db.objectStoreNames.contains('lists')) { db.close(); return null; }
    const ids = ['ket-0001','ket-0002','ket-0003','ket-0004','ket-0005','ket-0006','ket-0007','ket-0008'];
    const list = { id: 'e2e-list', profileId: 'default', name: 'E2E 测试列表', vocabIds: ids, createdAt: Date.now(), updatedAt: Date.now() };
    const tx = db.transaction(['lists','favorites','selections'], 'readwrite');
    tx.objectStore('lists').put(list);
    tx.objectStore('favorites').clear();
    tx.objectStore('selections').clear();
    await new Promise((res) => { tx.oncomplete = res; tx.onerror = () => res(); });
    db.close();
    return list.id;
  })()`);
  check('准备测试列表', listId === 'e2e-list', listId);

  // ---------- 需求 5：学习模式
  await cdp.goto(`${BASE}/#/lists/${listId}/learn`, 2000);
  const learn = await cdp.eval(`(() => {
    const items = [...document.querySelectorAll('ol li')];
    const first = items[0]?.innerText || '';
    return {
      count: items.length,
      hasWord: /a\\/an|a few|able/.test(first),
      hasIpa: /\\//.test(first),
      hasZh: /限\\.|形\\.|动\\./.test(first),
      hasExample: first.split('\\n').length >= 5,
      speakButtons: document.querySelectorAll('ol li button').length,
    };
  })()`);
  check('学习模式显示全部词条', learn.count === 8, `${learn.count} 条`);
  check('学习模式六字段齐全', learn.hasWord && learn.hasIpa && learn.hasZh && learn.hasExample, JSON.stringify(learn));
  check('学习模式每条有朗读按钮', learn.speakButtons >= 16, `${learn.speakButtons} 个按钮`);

  // ---------- 需求 6：背诵模式·看英猜中
  await cdp.goto(`${BASE}/#/lists/${listId}/recall`, 1800);
  // 选方向并开始
  await cdp.eval(`[...document.querySelectorAll('input[type=radio]')][0].click()`);
  await sleep(200);
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('开始本轮'))?.click()`);
  await sleep(800);

  const firstCard = await cdp.eval(`(() => {
    const article = document.querySelector('article');
    const word = article?.querySelector('[data-recall-word]');
    const answer = article?.querySelector('[data-recall-answer]');
    return {
      text: article?.innerText || '',
      word: word?.textContent || '',
      wordTop: word?.getBoundingClientRect().top || 0,
      hasEye: !!answer?.querySelector('.lucide-eye'),
      hasExample: !!article?.querySelector('[data-recall-prompt] p.text-lg.leading-relaxed'),
      speakInsidePrompt: !!article?.querySelector('[data-recall-prompt] button[aria-label="朗读英文"]'),
    };
  })()`);
  check('看英猜中：初始显示英文', firstCard.word.length > 0, firstCard.word);
  const chineseAnswers = ['限. 一个、一件','限. 几个、少数、一些','形. 能干的、能够的','副. 大约、四处、在附近；介. 在…周围、大约、有关','副. 在上面；介. 在上方、超出','名. 意外事件、机遇、事故','名. 膳宿、预订铺位、适应性调节','副. 交叉、到另一边、在对面；介. 越过、穿过、与…相交叉'];
  const chineseExamples = ['请给我一杯茶。','我邀请了几个朋友。','没有一个学生能回答这个问题。','来杯冷饮怎么样？','最重要的是，我想再见到他。','我们卷入了一起交通事故。','这家酒店可供一百人住宿。','花店就在街对面。'];
  check('看英猜中：未揭晓 DOM 不含任一中文答案', ![...chineseAnswers, ...chineseExamples].some(v => firstCard.text.includes(v)), '释义和例句均未泄漏');
  check('看英猜中：英文例句前置', firstCard.hasExample, '提示区已显示');
  check('看英猜中：眼睛图标可见', firstCard.hasEye, 'Eye');
  check('看英猜中：朗读按钮位于英文区', firstCard.speakInsidePrompt, 'ok');

  const progress = await cdp.eval(`document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')`);
  check('进度条初始为 1/8 = 13%', Number(progress) === 13, `${progress}%`);
  const counter = await cdp.eval(`document.querySelector('header strong')?.textContent || ''`);
  check('计数显示 1 / 8', counter.replace(/\s/g, '') === '1/8', counter);

  // 点击英文区不能揭晓；只有答案区负责卡片内揭晓。
  await cdp.eval(`document.querySelector('[data-recall-word]')?.click()`);
  await sleep(300);
  const afterPromptClick = await cdp.eval(`document.querySelector('[data-recall-answer]')?.querySelector('.lucide-eye') !== null`);
  check('看英猜中：点击英文区不揭晓', afterPromptClick, '眼睛仍可见');
  await cdp.eval(`document.querySelector('[data-recall-answer]')?.click()`);
  await sleep(500);
  const afterReveal = await cdp.eval(`(() => ({
    text: document.querySelector('article')?.innerText || '',
    wordTop: document.querySelector('[data-recall-word]')?.getBoundingClientRect().top || 0,
    hasEye: !!document.querySelector('[data-recall-answer] .lucide-eye'),
  }))()`);
  check('看英猜中：点击答案区揭晓', !afterReveal.hasEye && afterReveal.text.length > firstCard.text.length, afterReveal.text.slice(0, 70).replace(/\n/g, ' '));
  const topDelta = Math.abs(afterReveal.wordTop - firstCard.wordTop);
  check('看英猜中：揭晓前后英文位置稳定', topDelta <= 2, `差值 ${topDelta.toFixed(2)}px`);

  // 下一个 + 返回保留揭晓
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('下一个'))?.click()`);
  await sleep(500);
  const secondWord = await cdp.eval(`document.querySelector('[data-recall-word]')?.textContent || ''`);
  const secondHasEye = await cdp.eval(`!!document.querySelector('[data-recall-answer] .lucide-eye')`);
  check('下一词默认隐藏答案', secondHasEye, secondWord);
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('上一个'))?.click()`);
  await sleep(500);
  const backReveal = await cdp.eval(`(() => ({ word: document.querySelector('[data-recall-word]')?.textContent || '', hasEye: !!document.querySelector('[data-recall-answer] .lucide-eye') }))()`);
  check('返回上一词保留揭晓状态', backReveal.word === firstCard.word && !backReveal.hasEye, JSON.stringify(backReveal));

  // 依次前进验证随机快照中的 1/8…8/8 与最后一词 100%。
  const firstOrder = [firstCard.word];
  const progressSequence = ['1/8'];
  for (let position = 1; position < 8; position += 1) {
    await cdp.key('ArrowRight', 'ArrowRight', 39);
    firstOrder.push(await cdp.eval(`document.querySelector('[data-recall-word]')?.textContent || ''`));
    progressSequence.push((await cdp.eval(`document.querySelector('header strong')?.textContent || ''`)).replace(/\s/g, ''));
  }
  const finalProgress = Number(await cdp.eval(`document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')`));
  check('随机不破坏进度序列', progressSequence.join(',') === '1/8,2/8,3/8,4/8,5/8,6/8,7/8,8/8', progressSequence.join(' → '));
  check('最后一词进度为 100%', finalProgress === 100, `${finalProgress}%`);
  await cdp.key('ArrowRight', 'ArrowRight', 39);
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('再来一轮'))?.click()`);
  await sleep(800);
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('开始本轮'))?.click()`);
  await sleep(500);
  const secondOrder = [];
  for (let position = 0; position < 8; position += 1) {
    secondOrder.push(await cdp.eval(`document.querySelector('[data-recall-word]')?.textContent || ''`));
    if (position < 7) await cdp.key('ArrowRight', 'ArrowRight', 39);
  }
  check('连续两轮随机顺序不同', firstOrder.join('|') !== secondOrder.join('|'), `${firstOrder.join(', ')} / ${secondOrder.join(', ')}`);

  // ---------- 需求 6：看中猜英
  // 注意：直接 navigate 到相同 hash 不会让 React 重新挂载，必须先从别的路由进入
  await cdp.goto(`${BASE}/#/`, 1200);
  await cdp.goto(`${BASE}/#/lists/${listId}/recall`, 2000);
  await cdp.eval(`[...document.querySelectorAll('input[type=radio]')][1].click()`);
  await sleep(200);
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('开始本轮'))?.click()`);
  await sleep(800);
  const zhCard = await cdp.eval(`(() => {
    const article = document.querySelector('article');
    const pos = article?.querySelector('[data-recall-pos]');
    const meaning = article?.querySelector('[data-recall-meaning]');
    return {
      text: article?.innerText || '',
      posText: pos?.textContent || '', meaningText: meaning?.textContent || '',
      separate: !!pos && !!meaning && pos !== meaning,
      posSize: pos ? getComputedStyle(pos).fontSize : '', meaningSize: meaning ? getComputedStyle(meaning).fontSize : '',
      posColor: pos ? getComputedStyle(pos).color : '', meaningColor: meaning ? getComputedStyle(meaning).color : '',
      speakButtons: article?.querySelectorAll('button[aria-label*="朗读"]').length || 0,
    };
  })()`);
  check('看中猜英：初始显示中文', zhCard.meaningText.length > 0, zhCard.meaningText);
  check('看中猜英：词性独立且样式不同', zhCard.separate && zhCard.posSize !== zhCard.meaningSize && zhCard.posColor !== zhCard.meaningColor, JSON.stringify(zhCard));
  const allEnglishAnswers = ['a/an','a few','able','about','above','accident','accommodation','across'];
  const allIpas = ['/ə/, /ən/','/ə ˈfjuː/','/ˈeɪbəl/','/əˈbaʊt/','/əˈbʌv/','/ˈæksɪdənt/','/əˌkɒməˈdeɪʃən/','/əˈkrɒs/'];
  const allEnglishExamples = ['I would like a cup of tea, please.','I invited a few of my friends.','No student was able to answer the question.','What about a cold drink?','Above all, I want to see him again.','We got involved in a traffic accident.','The hotel has accommodation for one hundred.','The flower shop is just across the street.'];
  check('看中猜英：未揭晓 DOM 不含英文答案', ![...allEnglishAnswers, ...allIpas, ...allEnglishExamples].some(v => zhCard.text.includes(v)), '单词、音标和例句均未泄漏');

  // 防泄漏朗读
  check('看中猜英未揭晓时英文朗读不可用', zhCard.speakButtons === 0, `${zhCard.speakButtons} 个朗读按钮`);
  await cdp.eval(`document.querySelector('[data-recall-answer]')?.click()`);
  await sleep(300);
  const zhRevealed = await cdp.eval(`(() => ({ text: document.querySelector('article')?.innerText || '', speak: !!document.querySelector('article button[aria-label="朗读英文"]') }))()`);
  check('看中猜英揭晓后显示英文、例句和朗读', zhRevealed.speak && allEnglishAnswers.some(v => zhRevealed.text.split('\n').includes(v)), zhRevealed.text.slice(0, 70).replace(/\n/g, ' '));
  const speechSettings = await cdp.eval(`(() => {
    const select = document.querySelector('header select');
    return { engines: select ? [...select.options].map(o => o.value) : [], actual: document.querySelector('header')?.innerText.includes('实际：') || false };
  })()`);
  check('TTS 引擎选择与实际引擎字段仍可用', ['edge','tencent','minimax','glm','local'].every(v => speechSettings.engines.includes(v)) && speechSettings.actual, JSON.stringify(speechSettings));

  // ---------- 需求 7：星标
  const starredWord = await cdp.eval(`document.querySelector('[data-recall-word]')?.textContent || ''`);
  await cdp.eval(`document.querySelector('article button[aria-pressed]')?.click()`);
  await sleep(600);
  const starred = await cdp.eval(`document.querySelector('article button[aria-pressed]')?.getAttribute('aria-pressed')`);
  check('点击星标后状态变为已收藏', starred === 'true', `aria-pressed=${starred}`);

  // 刷新后保持
  await cdp.send('Page.reload');
  await sleep(2200);
  const hasRadios = await cdp.eval(`document.querySelectorAll('input[type=radio]').length`);
  check('刷新后回到方向选择页', hasRadios === 2, `${hasRadios} 个单选框`);
  await cdp.eval(`[...document.querySelectorAll('input[type=radio]')][1]?.click()`);
  await sleep(200);
  await cdp.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('开始本轮'))?.click()`);
  await sleep(800);
  let starredAfterReload = false;
  for (let position = 0; position < 8; position += 1) {
    await cdp.eval(`document.querySelector('[data-recall-answer]')?.click()`);
    await sleep(100);
    const current = await cdp.eval(`(() => ({ word: document.querySelector('[data-recall-word]')?.textContent || '', favorite: document.querySelector('article button[aria-pressed]')?.getAttribute('aria-pressed') }))()`);
    if (current.word === starredWord) { starredAfterReload = current.favorite === 'true'; break; }
    if (position < 7) await cdp.key('ArrowRight', 'ArrowRight', 39);
  }
  check('刷新后星标保持', starredAfterReload, starredWord);

  // ---------- 需求 7：只背本列表生词
  // 同样要先离开背诵路由，否则 query 变化不会触发 React 重新挂载
  await cdp.goto(`${BASE}/#/lists/${listId}`, 1400);
  await cdp.goto(`${BASE}/#/lists/${listId}/recall?favorites=1`, 2000);
  const favScope = await cdp.eval(`document.body.innerText`);
  check('只背生词范围仅 1 个词', /1 个词/.test(favScope), (favScope.match(/\d+ 个词/) || [''])[0]);

  // ---------- 需求 8：生词本
  await cdp.goto(`${BASE}/#/favorites`, 1800);
  const favPage = await cdp.eval(`(() => ({
    count: document.querySelectorAll('ul li').length,
    title: document.querySelector('h1')?.innerText || '',
    hasLearn: !!document.querySelector('a[href="#/favorites/learn"]'),
    hasRecall: !!document.querySelector('a[href="#/favorites/recall"]'),
    source: document.querySelector('ul li')?.innerText.includes('首次来源') || false,
  }))()`);
  check('生词本显示 1 条收藏', favPage.count === 1, `${favPage.count} 条`);
  check('生词本标题含去重计数', /1/.test(favPage.title), favPage.title.replace(/\n/g, ' '));
  check('生词本可进入学习/背诵', favPage.hasLearn && favPage.hasRecall, JSON.stringify({ l: favPage.hasLearn, r: favPage.hasRecall }));
  check('生词本显示首次来源', favPage.source === true, 'ok');

  // 生词本学习模式
  await cdp.goto(`${BASE}/#/favorites/learn`, 1800);
  const favLearn = await cdp.eval(`document.querySelectorAll('ol li').length`);
  check('生词本学习模式可用', favLearn === 1, `${favLearn} 条`);

  // ---------- TTS 真实接口
  const tts = await cdp.eval(`(async () => {
    try {
      const r = await fetch('http://127.0.0.1:3115/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'look after', engine: 'edge', voice: 'en-GB-SoniaNeural', speed: 0.85 }),
        signal: AbortSignal.timeout(3000)
      });
      const blob = await r.blob();
      return { status: r.status, type: r.headers.get('content-type'), size: blob.size };
    } catch (e) { return { error: String(e) }; }
  })()`);
  check('TTS 接口返回音频', tts.status === 200 && /audio/.test(tts.type || '') && tts.size > 1000, JSON.stringify(tts));

  // ---------- 回归：第一阶段功能未破坏
  await cdp.goto(`${BASE}/#/select`, 2000);
  const selectOk = await cdp.eval(`(() => ({
    total: document.body.innerText.includes('共 1723 词'),
    cells: document.querySelectorAll('[data-word-index]').length,
    columns: getComputedStyle(document.querySelector('[data-vocab-row]')).gridTemplateColumns.split(' ').length,
    batchSwitch: !!document.querySelector('[role=switch][aria-checked=false]'),
  }))()`);
  check('回归：选词页展示 1723 词入口', selectOk.total === true, JSON.stringify(selectOk));
  check('回归：A-Z 虚拟网格为 10 列', selectOk.cells > 0 && selectOk.cells < 1723 && selectOk.columns === 10, JSON.stringify(selectOk));
  check('回归：批量选择默认关闭', selectOk.batchSwitch === true, JSON.stringify(selectOk));

  await cdp.goto(`${BASE}/#/`, 1500);
  const homeOk = await cdp.eval(`document.body.innerText.includes('E2E 测试列表')`);
  check('回归：首页列表仍在', homeOk === true, 'ok');

  // ---------- 运行期异常
  check('运行期无未捕获异常', cdp.exceptions.length === 0, cdp.exceptions.slice(0, 2).join(' | ') || '无');

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== 汇总: ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    console.log('失败项:');
    for (const f of failed) console.log(`  - ${f.name} (${f.detail})`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(2); });
