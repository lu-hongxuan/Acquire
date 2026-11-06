/* ==========================================================================
   并购状态机测试
   直接 require merger.js，不需要浏览器。
   ========================================================================== */

const path = require('path');
require(path.join(__dirname, '..', 'js', 'merger.js'));
const Merger = globalThis.Merger;

let pass = 0;
let fail = 0;

function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '  期望 ' + e + ' 实际 ' + a); }
}

console.log('\n=== 并购状态机 ===\n');

/* ---------------- 1. 两家，规模不同 ---------------- */
console.log('1. 两家公司，规模不同（7 vs 2）');
{
  Merger.abort();
  Merger.begin({
    survivors: ['A', 'B'],
    survivorId: 'A',
    sizes: { A: 7, B: 2 },
  });
  eq(Merger.survivorId(), 'A', '存活方是规模大的 A');
  eq(Merger.currentLoser(), 'B', '当前被吞并方是 B');
  eq(Merger.completeLoser(), null, '处理完 B 之后没有下一个 → 结束');
  ok(!Merger.active, '状态机已归零');
}

/* ---------------- 2. 三家，规模不同 ---------------- */
console.log('\n2. 三家公司，规模 7 / 5 / 3');
{
  Merger.abort();
  Merger.begin({
    survivors: ['A', 'B', 'C'],
    survivorId: 'A',
    sizes: { A: 7, B: 5, C: 3 },
  });
  eq(Merger.currentLoser(), 'B', '先处理较大的被吞并方 B');
  eq(Merger.completeLoser(), 'C', '然后是较小的 C');
  eq(Merger.completeLoser(), null, '两个都处理完 → 结束');
}

/* ---------------- 3. 并列第一 ---------------- */
console.log('\n3. 两家并列第一（规模 4 / 4）');
{
  Merger.abort();
  Merger.begin({
    survivors: ['A', 'B'],
    survivorId: null,
    sizes: { A: 4, B: 4 },
  });
  eq(Merger.state.stage, 'choosing', '进入「等待裁决存活方」阶段');
  eq(Merger.survivorId(), null, '还没定存活方');

  Merger.chooseSurvivor('B');
  eq(Merger.survivorId(), 'B', '裁决后存活方是 B');
  eq(Merger.currentLoser(), 'A', '被吞并方是 A');
  eq(Merger.completeLoser(), null, '处理完就结束');
}

/* ---------------- 4. 幂等：重复 completeLoser 不会越界 ---------------- */
console.log('\n4. 重复推进不会越界');
{
  Merger.abort();
  Merger.begin({
    survivors: ['A', 'B', 'C'],
    survivorId: 'A',
    sizes: { A: 7, B: 5, C: 3 },
  });
  Merger.completeLoser();
  Merger.completeLoser();
  const after = Merger.completeLoser();
  eq(after, null, '再多调一次仍然返回 null');
  ok(!Merger.active, '不会抛错，状态安全');
}

/* ---------------- 5. 幂等令牌：分红只发一次 ---------------- */
console.log('\n5. claim 令牌');
{
  Merger.abort();
  Merger.begin({ survivors: ['A', 'B'], survivorId: 'A', sizes: { A: 7, B: 2 } });
  ok(Merger.claim('div:B') === true, '第一次领取成功');
  ok(Merger.claim('div:B') === false, '第二次领取被拒绝（不会重复发钱）');
  ok(Merger.claimed('div:B'), 'claimed 返回 true');
}

/* ---------------- 6. 四家 ---------------- */
console.log('\n6. 四家公司，规模 9 / 6 / 4 / 2');
{
  Merger.abort();
  Merger.begin({
    survivors: ['A', 'B', 'C', 'D'],
    survivorId: 'A',
    sizes: { A: 9, B: 6, C: 4, D: 2 },
  });
  const order = [];
  let cur = Merger.currentLoser();
  while (cur) { order.push(cur); cur = Merger.completeLoser(); }
  eq(order, ['B', 'C', 'D'], '按规模从大到小依次被吞并');
}

/* ---------------- 7. onFinish 只触发一次 ---------------- */
console.log('\n7. onFinish 只触发一次');
{
  Merger.abort();
  let fired = 0;
  Merger.begin({
    survivors: ['A', 'B'],
    survivorId: 'A',
    sizes: { A: 5, B: 3 },
    handlers: { onFinish: function () { fired++; } },
  });
  Merger.completeLoser();
  Merger.completeLoser();
  eq(fired, 1, 'onFinish 恰好触发 1 次');
}

/* ---------------- 8. 安全公司：两个安全公司不该出现并购 ---------------- */
console.log('\n8. begin 收到空队列不崩');
{
  Merger.abort();
  Merger.begin({ survivors: ['A'], survivorId: 'A', sizes: { A: 11 } });
  eq(Merger.currentLoser(), null, '没有被吞并方');
  eq(Merger.completeLoser(), null, '推进返回 null');
}

console.log('\n==============================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('==============================================\n');

process.exit(fail ? 1 : 0);
