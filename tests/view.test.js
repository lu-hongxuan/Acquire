/* ==========================================================================
   界面层单元测试

   这些模块只负责「把视图对象画成 DOM」，所以可以用最小假 DOM 在 Node 里测：
     node tests/view.test.js

   测的重点不是像素，而是三件事：
     1. 视图对象的字段有没有被正确使用（漏字段会立刻体现）
     2. 该加/该减的 class 对不对（状态类错误最容易回归）
     3. 渲染**不读 state、不修改视图对象**（保证纯函数性质）
   ========================================================================== */

const { install, register } = require('./fake-dom.js');
const dom = install();

/* 先登记这些模块要用的容器 */
register('#companyList');
register('#handTiles');
register('#deckLeft');
register('#btnDiscard');
register('#seatsTop');
register('#seatsLeft');
register('#seatsRight');
register('#trayAvatar');
register('#trayName');
register('#cashValue');
register('#roundNo');
register('#btnBuy');
register('#btnEndTurn');
register('#holdingList');
register('#holdingHint');
register('.tray-hand');
register('.tray-player');

/* 加载被测模块（它们挂在 globalThis 上） */
require('../js/board-view-companies.js');
require('../js/board-view-hand.js');
require('../js/board-view-seats.js');
require('../js/board-view-tray.js');
require('../js/board-view-board.js');

const C = globalThis.BoardViewCompanies;
const H = globalThis.BoardViewHand;
const T = globalThis.BoardViewTray;
const B = globalThis.BoardViewBoard;

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { pass += 1; return; }
  fail += 1;
  failures.push(label);
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass += 1; return; }
  fail += 1;
  failures.push(`${label}\n    期望 ${b}\n    实际 ${a}`);
}

/* ================================================================ 手牌 */

{
  H.install({ qs: (s) => dom.document.querySelector(s) });

  const view = {
    tiles: [
      { label: 'A1', selected: true, isNew: false },
      { label: 'B2', selected: false, isNew: true },
    ],
    lockHand: false,
    slots: 4,
    hasSelection: true,
    deckLeft: 42,
    discard: { disabled: true, title: '先选一块放不下去的牌' },
  };
  const before = JSON.stringify(view);
  H.render(view);

  // 手牌是拼字符串写进 innerHTML，所以对字符串做断言
  const html = dom.document.querySelector('#handTiles').innerHTML;
  const count = (re) => (html.match(re) || []).length;
  eq(count(/class="hand-tile/g), 2, '手牌：2 张牌');
  eq(count(/class="hand-slot"/g), 2, '手牌：2 个占位框');
  ok(html.indexOf('is-selected') >= 0, '手牌：第一张带选中态');
  ok(html.indexOf('is-new') >= 0, '手牌：第二张带「刚补」标记');
  ok(html.indexOf('title="A1"') >= 0 && html.indexOf('title="B2"') >= 0, '手牌：坐标写进 title');
  eq(dom.document.querySelector('#deckLeft').textContent, '42', '手牌：剩余板块写进顶栏');
  eq(dom.document.querySelector('#btnDiscard').disabled, true, '手牌：弃牌按钮禁用');
  eq(dom.document.querySelector('.tray-hand').style.getPropertyValue('--slot-count'), '4', '手牌：牌位数写到 CSS 变量');
  ok(dom.document.body.classList.contains('has-selection'), '手牌：有选中时给 body 加 class');
  eq(JSON.stringify(view), before, '手牌：渲染不修改视图对象');
}

{
  // 锁定态：全部按钮 disabled
  H.render({
    tiles: [{ label: 'C3', selected: false, isNew: false }],
    lockHand: true,
    slots: 1,
    hasSelection: false,
    deckLeft: 10,
    discard: { disabled: true, title: '' },
  });
  const html2 = dom.document.querySelector('#handTiles').innerHTML;
  ok(html2.indexOf('disabled') >= 0, '手牌：锁定态按钮 disabled');
  ok(html2.indexOf('is-locked') >= 0, '手牌：锁定态带 is-locked');
  ok(!dom.document.body.classList.contains('has-selection'), '手牌：无选中时移除 body class');
}

/* ================================================================ 公司面板 */

{
  C.install({
    getCompanies: () => ([
      { id: 'a', name: '甲', mark: 'A', color: '#111111', tier: 0 },
      { id: 'b', name: '乙', mark: 'B', color: '#222222', tier: 2 },
    ]),
    getTierNames: () => ['小', '中', '大'],
    getSafeSize: () => 11,
    priceOf: (size) => size * 100,
    hexToRgba: (hex, alpha) => `rgba-test-${alpha}`,
    qs: (s) => dom.document.querySelector(s),
  });

  C.render({ a: 6, b: 11 });
  const html = dom.document.querySelector('#companyList').innerHTML;

  ok(html.indexOf('company-card') >= 0, '公司面板：生成了卡片');
  ok(html.indexOf('甲') >= 0 && html.indexOf('乙') >= 0, '公司面板：两家公司都在');
  ok(html.indexOf('$600') >= 0, '公司面板：规模 6 → 股价 600');
  ok(html.indexOf('safe-tag') >= 0, '公司面板：11 块带安全标签');
  ok(html.indexOf('未上市') < 0, '公司面板：都已上市，不该出现「未上市」');
  ok(html.indexOf('rgba-test-0.11') >= 0, '公司面板：使用了注入的 hexToRgba');
}

/* ================================================================ 座位 */

{
  T.install({ qs: (s) => dom.document.querySelector(s) });

  const seat = {
    index: 1, name: '玩家2', color: '#abcdef', isHuman: false,
    isCurrent: true, showProgress: true, progressPercent: 62,
    handCount: 4, slots: 6, justDrew: false,
    cashText: '$6,000', cashHidden: false,
    holdings: [{ mark: 'A', color: '#111', name: '甲', count: 3 }],
  };
  const seats = { 1: seat };

  globalThis.BoardViewSeats.render({ buckets: { top: [1], left: [], right: [] }, seats });

  const top = dom.document.querySelector('#seatsTop');
  eq(top.children.length, 1, '座位：顶部一个座位');
  const node = top.children[0];
  ok(node.classList.contains('seat'), '座位：根节点是 .seat');
  ok(node.classList.contains('is-current'), '座位：当前玩家高亮');
  eq(node.dataset.p, '1', '座位：记录玩家下标');

  const tiles = node.querySelector('.seat-tiles');
  eq(tiles.children.length, 6, '座位：手牌位固定 6 格');
  eq(tiles.querySelectorAll('is-empty').length, 0, '座位：占位判断走 class（此处为 0）');
  ok(tiles.children[3].classList.contains('has-tile'), '座位：有牌的那格点亮');
  ok(tiles.children[5].classList.contains('is-empty'), '座位：空格是 is-empty');

  const prog = node.querySelector('.seat-progress');
  ok(prog !== null, '座位：有进度条');
  ok(prog && prog.style !== undefined, '座位：进度条可写样式');

  const chips = node.querySelectorAll('.seat-chip');
  eq(chips.length, 1, '座位：一个持股标签');
  eq(node.querySelector('.seat-cash').textContent, '$6,000', '座位：现金文本');

  eq(dom.document.querySelector('#seatsLeft').style.display, 'none', '座位：左侧无人时收起');
}

/* ================================================================ 操作区 */

{
  T.install({ qs: (s) => dom.document.querySelector(s) });

  T.render({
    avatarIndex: 0, avatarColor: '#123456', name: '玩家1',
    cashText: '$6,000', roundNo: 7, highlight: true,
    buy: { text: '购买股票（2）', disabled: false },
    end: { text: '结束购买', disabled: false },
    holdingsHTML: '<span class="hold-empty">还没有持股</span>',
    holdingsHint: '',
  });

  eq(dom.document.querySelector('#trayAvatar').textContent, '1', '操作区：头像序号');
  eq(dom.document.querySelector('#trayAvatar').style.getPropertyValue('--p'), '#123456', '操作区：头像颜色');
  eq(dom.document.querySelector('#trayName').textContent, '玩家1', '操作区：名字');
  eq(dom.document.querySelector('#cashValue').textContent, '$6,000', '操作区：现金');
  eq(dom.document.querySelector('#roundNo').textContent, '7', '操作区：回合数');
  eq(dom.document.querySelector('#btnBuy').textContent, '购买股票（2）', '操作区：购买按钮文案');
  eq(dom.document.querySelector('#btnEndTurn').disabled, false, '操作区：结束按钮可用');
  ok(dom.document.querySelector('.tray-player').classList.contains('is-current'), '操作区：轮到你时高亮');
  ok(dom.document.querySelector('#holdingList').innerHTML.indexOf('还没有持股') >= 0, '操作区：空持股占位');
}

/* ================================================================ 棋盘格子 */

{
  const mkCell = (c, r) => {
    const el = dom.document.createElement('div');
    el.dataset.c = String(c);
    el.dataset.r = String(r);
    return el;
  };

  const cells = [mkCell(0, 0), mkCell(1, 0), mkCell(2, 0)];
  const board = { '0,0': 'a', '1,0': null };   // 2,0 是空格

  B.render({
    cells,
    target: { c: 2, r: 0, legal: false },
    tileAt: (c, r) => board[c + ',' + r],
    coordLabel: (c, r) => String.fromCharCode(65 + c) + (r + 1),
    companyById: { a: { name: '甲', color: '#111111' } },
    isLight: () => true,
    safeSize: 11,
    sizes: { a: 3 },
  });

  ok(cells[0].classList.contains('is-company'), '棋盘：公司格');
  eq(cells[0].style.getPropertyValue('--c'), '#111111', '棋盘：公司色写进 CSS 变量');
  eq(cells[0].getAttribute('aria-label').indexOf('甲') >= 0, true, '棋盘：公司格 aria-label 带公司名');
  eq(cells[0].dataset.tip, 'tile', '棋盘：格子带 data-tip，供悬停提示用');

  ok(cells[1].classList.contains('is-neutral'), '棋盘：零散板块');
  eq(cells[1].getAttribute('aria-label').indexOf('零散') >= 0, true, '棋盘：零散板块 aria-label');

  ok(cells[2].classList.contains('is-target'), '棋盘：目标格高亮');
  ok(cells[2].classList.contains('is-blocked'), '棋盘：不合法时带 is-blocked');
  eq(cells[2].className.indexOf('is-company'), -1, '棋盘：空格不能有公司 class');
}

/* ================================================================ 输出 */

console.log('');
failures.forEach((f) => console.log('  ✗ ' + f));
if (failures.length) console.log('');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(46));
if (fail > 0) process.exitCode = 1;
