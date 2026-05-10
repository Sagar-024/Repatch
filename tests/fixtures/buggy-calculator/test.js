import { add, subtract, multiply, divide } from './calculator.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assertEquals(actual, expected) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

console.log('\n--- Calculator Tests ---\n');

test('add(2,3) returns 5', () => assertEquals(add(2, 3), 5));
test('subtract(5,3) returns 2', () => assertEquals(subtract(5, 3), 2));
test('multiply(3,4) returns 12', () => assertEquals(multiply(3, 4), 12));
test('divide(6,2) returns 3', () => assertEquals(divide(6, 2), 3));
test('divide(10,2) returns 5', () => assertEquals(divide(10, 2), 5));
test('divide(8,4) returns 2', () => assertEquals(divide(8, 4), 2));

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);

if (failed > 0) {
  process.exit(1);
}