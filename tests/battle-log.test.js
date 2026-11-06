/* 对局记录模块 · 单元测试 */
const assert = require('assert');
const Log = require('../js/battle-log.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed += 1; console.log('  ✓ ' + name); }
  catch (e) { failures.push({ name, e }); console.log('  ✗ ' + name); }
}

console.log('\n【对局记录】');

test('开局写入基本信息与第 1 回合', () => {
  Log.reset();
  Log.begin({
    title: '对局记录',
    mode: '经典模式',
    players: [{ name: '甲', isAi: false }, { name: '乙', isAi: true, difficulty: 'hard' }],
  });
  const t = Log.toText();
  assert.ok(t.includes('经典模式'));
  assert.ok(t.includes('甲（玩家）'));
  assert.ok(t.includes('乙（AI·hard）'));
  assert.ok(t.includes('第 1 回合'));
});

test('回合切分与事件归位', () => {
  Log.reset();
  Log.begin({ players: [] });
  Log.add('第 1 回合的事');
  Log.round(2);
  Log.add('第 2 回合的事');
  const t = Log.toText();
  const i1 = t.indexOf('第 1 回合');
  const i2 = t.indexOf('第 2 回合');
  const e1 = t.indexOf('第 1 回合的事');
  const e2 = t.indexOf('第 2 回合的事');
  assert.ok(i1 < e1 && e1 < i2 && i2 < e2, '事件应落在正确的回合里');
});

test('只保留最近 10 个回合', () => {
  Log.reset();
  Log.begin({ players: [] });
  for (let n = 2; n <= 15; n++) Log.round(n);
  assert.strictEqual(Log.snapshot().rounds.length, Log.KEEP_ROUNDS);
  assert.ok(!Log.toText().includes('第 1 回合'));
  assert.ok(Log.toText().includes('第 15 回合'));
});

test('终局结语放在最后', () => {
  Log.reset();
  Log.begin({ players: [] });
  Log.add('一');
  Log.finish('终局排名：1. 甲');
  const t = Log.toText();
  assert.ok(t.trim().endsWith('终局排名：1. 甲'));
});

test('重复切到同一回合不会插空块', () => {
  Log.reset();
  Log.begin({ players: [] });
  Log.round(1);
  Log.round(1);
  assert.strictEqual(Log.snapshot().rounds.length, 1);
});

console.log('\n通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  failures.forEach((f) => console.log('\n[' + f.name + ']\n' + f.e.stack));
  process.exit(1);
}
