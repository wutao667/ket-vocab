#!/usr/bin/env node
/** Phase 3 真实浏览器验收：CDP 驱动 Chrome 验证 A-Z 虚拟网格与选择交互。 */
const CDP_PORT = 9222;
const BASE = 'http://127.0.0.1:4173';
const URL = `${BASE}/#/select`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findTarget() {
  for (let index = 0; index < 60; index += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Chrome is still starting. */ }
    await sleep(250);
  }
  throw new Error('找不到 CDP page target');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.exceptions = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(ws);
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') cdp.exceptions.push(message.params.exceptionDetails.text);
      if (message.id && cdp.pending.has(message.id)) {
        const { resolve, reject } = cdp.pending.get(message.id);
        cdp.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
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
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'eval error');
    return result.result.value;
  }
  async goto(url, wait = 1800) { await this.send('Page.navigate', { url }); await sleep(wait); }
  async mouse(type, x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: 1, pointerType: 'mouse',
    });
  }
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  — ${detail}`}`);
}

async function selectedCount(cdp) {
  const text = await cdp.eval(`document.querySelector('[data-selected-count]')?.textContent || ''`);
  return Number(/已选\s*(\d+)/.exec(text)?.[1] ?? -1);
}

async function setRange(cdp, value) {
  await cdp.eval(`(() => {
    const input = document.querySelector('input[inputmode="numeric"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(120);
}

async function clickButton(cdp, text) {
  await cdp.eval(`[...document.querySelectorAll('button')].find((button) => button.textContent.trim().includes(${JSON.stringify(text)}))?.click()`);
  await sleep(350);
}

async function visibleCellRects(cdp, count) {
  return JSON.parse(await cdp.eval(`JSON.stringify([...document.querySelectorAll('[data-word-index]')]
    .sort((a,b) => Number(a.dataset.wordIndex) - Number(b.dataset.wordIndex))
    .slice(0, ${count}).map((cell) => { const rect = cell.getBoundingClientRect(); return { index: Number(cell.dataset.wordIndex), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }))`));
}

async function dragCells(cdp, cells) {
  await cdp.mouse('mousePressed', cells[0].x, cells[0].y);
  await sleep(50);
  for (const cell of cells.slice(1)) { await cdp.mouse('mouseMoved', cell.x, cell.y); await sleep(35); }
  await cdp.mouse('mouseReleased', cells.at(-1).x, cells.at(-1).y);
  await sleep(400);
}

async function main() {
  const cdp = await Cdp.connect(await findTarget());
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.goto(URL);

  await cdp.eval(`(async () => {
    localStorage.clear();
    const request = indexedDB.open('ket-vocab');
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    if (db.objectStoreNames.contains('selections')) {
      const tx = db.transaction(['selections'], 'readwrite'); tx.objectStore('selections').clear();
      await new Promise((resolve) => { tx.oncomplete = resolve; tx.onerror = resolve; });
    }
    db.close();
  })()`);
  await cdp.send('Page.reload');
  await sleep(1800);

  // 1. 数据、虚拟网格与纯词面
  const basic = await cdp.eval(`(() => {
    const cells = [...document.querySelectorAll('[data-word-index]')];
    const first = document.querySelector('[data-word-index="0"]');
    const row = document.querySelector('[data-vocab-row="0"]');
    const style = row ? getComputedStyle(row) : null;
    return {
      totalText: document.body.innerText.includes('共 1723 词'),
      rendered: cells.length,
      first: first?.textContent,
      firstChildren: first?.children.length,
      columns: style?.gridTemplateColumns.split(' ').length,
      rowHeight: row?.getBoundingClientRect().height,
      switchOff: document.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
      touchAction: getComputedStyle(document.querySelector('[data-vocab-scroll]')).touchAction,
    };
  })()`);
  check('显示全部 1723 词的数据范围', basic.totalText && basic.first === 'a/an', JSON.stringify(basic));
  check('虚拟滚动只挂载可视词格', basic.rendered > 0 && basic.rendered < 1723, `${basic.rendered}/1723`);
  check('每个完整网格行恰好 10 列', basic.columns === 10, `${basic.columns} 列`);
  check('单元格只渲染单词文本', basic.first === 'a/an' && basic.firstChildren === 0, JSON.stringify({ text: basic.first, children: basic.firstChildren }));
  check('词格触控高度不小于 32px', basic.rowHeight >= 32, `${basic.rowHeight}px`);
  check('批量模式默认关闭且允许纵向滚动', basic.switchOff === 'false' && basic.touchAction === 'pan-y', JSON.stringify(basic));

  // 2. 分割线：直接滚动到相应虚拟位置
  await cdp.eval(`document.querySelector('[data-vocab-scroll]').scrollTop = 150`); await sleep(300);
  const minor = await cdp.eval(`(() => { const item = document.querySelector('[data-divider-after="50"]'); return item && { major: item.dataset.dividerMajor, text: item.textContent }; })()`);
  check('第 50 词后是 51–100 小分割', minor?.major === 'false' && minor.text.includes('51–100'), JSON.stringify(minor));
  await cdp.eval(`document.querySelector('[data-vocab-scroll]').scrollTop = 330`); await sleep(300);
  const major = await cdp.eval(`(() => { const item = document.querySelector('[data-divider-after="100"]'); return item && { major: item.dataset.dividerMajor, text: item.textContent }; })()`);
  check('第 100 词后是 101–200 大分割', major?.major === 'true' && major.text.includes('101–200'), JSON.stringify(major));

  // 3. 最长词在手机宽度下截断、不换行、有 title
  await cdp.eval(`document.querySelector('[data-vocab-scroll]').scrollTop = 5910`); await sleep(450);
  const longWord = await cdp.eval(`(() => {
    const cell = document.querySelector('[data-word-index="1567"]'); if (!cell) return null;
    const style = getComputedStyle(cell); return { text: cell.textContent, title: cell.title, overflow: style.overflow, whiteSpace: style.whiteSpace, textOverflow: style.textOverflow, clipped: cell.scrollWidth > cell.clientWidth };
  })()`);
  check('最长词单行省略且不会撑破网格', longWord?.text === 'training (transitive and intransitive)' && longWord.title === longWord.text && longWord.overflow === 'hidden' && longWord.whiteSpace === 'nowrap' && longWord.textOverflow === 'ellipsis' && longWord.clipped, JSON.stringify(longWord));

  // 4. 单击选择
  await cdp.eval(`document.querySelector('[data-vocab-scroll]').scrollTop = 0`); await sleep(350);
  await cdp.eval(`document.querySelector('[data-word-index="0"]')?.click()`); await sleep(300);
  check('关闭批量模式时单击切换单词', await selectedCount(cdp) === 1, `选中 ${await selectedCount(cdp)}`);
  await cdp.eval(`document.querySelector('[data-word-index="0"]')?.click()`); await sleep(300);
  check('再次单击取消单词', await selectedCount(cdp) === 0, `选中 ${await selectedCount(cdp)}`);

  // 5. 显式批量模式、20 格、去重、撤销、反向取消
  await clickButton(cdp, '批量选择');
  const batchState = await cdp.eval(`(() => ({ checked: document.querySelector('[role="switch"]').getAttribute('aria-checked'), touchAction: getComputedStyle(document.querySelector('[data-vocab-scroll]')).touchAction }))()`);
  check('开启批量模式后禁用手势滚动', batchState.checked === 'true' && batchState.touchAction === 'none', JSON.stringify(batchState));
  const cells = await visibleCellRects(cdp, 20);
  if (cells.length < 20) throw new Error(`可见词格不足 20 个：${cells.length}`);
  await dragCells(cdp, cells);
  const afterDrag = await selectedCount(cdp);
  check('拖过 20 格后全部为同一选中状态', afterDrag === 20, `选中 ${afterDrag}`);
  check('手势内重复命中不翻转', (await cdp.eval(`document.querySelectorAll('[data-word-index][aria-pressed="true"]').length`)) === 20, '20 格均为选中');
  const toast = await cdp.eval(`document.querySelector('[role="status"]')?.textContent || ''`);
  check('松手显示 3 秒撤销提示', toast.includes('已选择 20 个') && toast.includes('撤销'), JSON.stringify(toast));
  await clickButton(cdp, '撤销');
  check('撤销恢复手势前快照', await selectedCount(cdp) === 0, `选中 ${await selectedCount(cdp)}`);
  await dragCells(cdp, cells);
  await dragCells(cdp, [...cells.slice(0, 10), cells[4], cells[3], ...cells.slice(10)]);
  check('从已选格起手批量取消且重复经过不计数', await selectedCount(cdp) === 0, `选中 ${await selectedCount(cdp)}`);
  const remainsOn = await cdp.eval(`document.querySelector('[role="switch"]').getAttribute('aria-checked')`);
  check('松手后批量开关保持开启', remainsOn === 'true', remainsOn);

  // 6. 全局范围输入
  await setRange(cdp, '1-20'); await clickButton(cdp, '连续选中');
  check('范围 1-20 选中 20 个', await selectedCount(cdp) === 20, `选中 ${await selectedCount(cdp)}`);
  await setRange(cdp, '20-1'); await clickButton(cdp, '连续选中');
  const rangeError = await cdp.eval(`document.querySelector('[role="alert"]')?.textContent || ''`);
  check('反向范围显示具体错误', rangeError.includes('不能大于'), JSON.stringify(rangeError));
  await setRange(cdp, '1-20'); await clickButton(cdp, '连续选中');
  await setRange(cdp, '1700-1723'); await clickButton(cdp, '连续选中');
  check('范围 1700-1723 追加后选中 24 个', await selectedCount(cdp) === 24, `选中 ${await selectedCount(cdp)}`);

  // 7. 滚至末尾，确认最后词与不足 10 格的末行
  await cdp.eval(`document.querySelector('[data-vocab-scroll]').scrollTop = document.querySelector('[data-vocab-scroll]').scrollHeight`); await sleep(450);
  const tail = await cdp.eval(`(() => ({ last: document.querySelector('[data-word-index="1722"]')?.textContent, tailCount: document.querySelector('[data-vocab-row="172"]')?.querySelectorAll('[data-word-index]').length }))()`);
  check('最后一词为 zoo 且末行仅 3 格', tail.last === 'zoo' && tail.tailCount === 3, JSON.stringify(tail));

  // 8. 创建列表、默认名及刷新持久化
  await clickButton(cdp, '创建背诵列表');
  const defaultName = await cdp.eval(`document.querySelector('[role="dialog"] input')?.value || ''`);
  check('默认列表名为日期加 KET 词表', /^\d{4}-\d{2}-\d{2} KET 词表$/.test(defaultName), defaultName);
  await clickButton(cdp, '确认创建'); await sleep(900);
  const detail = await cdp.eval(`({ hash: location.hash, count: document.querySelectorAll('ol li').length })`);
  check('创建后详情页显示正确词数', detail.hash.includes('/lists/') && detail.count === 24, JSON.stringify(detail));
  await cdp.send('Page.reload'); await sleep(1700);
  const persisted = await cdp.eval(`document.querySelectorAll('ol li').length`);
  check('创建列表刷新后仍保留', persisted === 24, `${persisted} 个`);

  // 9. 稳定 ID 滚动锚点与恢复误差
  await cdp.goto(URL); await cdp.eval(`document.querySelector('[data-vocab-scroll]').scrollTop = 1000`); await sleep(850);
  const before = await cdp.eval(`(() => ({ scrollTop: document.querySelector('[data-vocab-scroll]').scrollTop, anchor: localStorage.getItem('ket-scroll-anchor:all-words') }))()`);
  check('滚动停止 500ms 后保存稳定词条 ID', /^ket-\d{4}$/.test(before.anchor), JSON.stringify(before));
  await cdp.goto(`${BASE}/#/`); await cdp.goto(URL); await sleep(500);
  const restored = await cdp.eval(`document.querySelector('[data-vocab-scroll]').scrollTop`);
  check('重进选词页恢复到一行误差内', Math.abs(restored - before.scrollTop) <= 34, `before=${before.scrollTop}, restored=${restored}`);

  check('运行期无未捕获异常', cdp.exceptions.length === 0, cdp.exceptions.slice(0, 3).join(' | ') || '无');
  const failed = results.filter((result) => !result.pass);
  console.log(`\n===== 汇总: ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) for (const failure of failed) console.log(`  - ${failure.name}: ${failure.detail}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error('E2E ERROR:', error.message); process.exit(2); });
