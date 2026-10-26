import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/core/rng.js';
import { createClock } from '../../src/core/clock.js';

test('createRng es determinista para la misma semilla', () => {
  const a = createRng(12345), b = createRng(12345);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('createRng produce secuencias distintas para semillas distintas', () => {
  assert.notDeepEqual(createRng(1).next(), createRng(2).next());
});

test('next se mantiene en [0,1)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `fuera de rango: ${v}`);
  }
});

test('int respeta los límites inclusivos', () => {
  const rng = createRng(9);
  for (let i = 0; i < 500; i++) {
    const v = rng.int(3, 5);
    assert.ok(v === 3 || v === 4 || v === 5, `fuera de rango: ${v}`);
  }
});

test('fork con la misma etiqueta da la misma subsecuencia', () => {
  const a = createRng(42).fork('mundo'), b = createRng(42).fork('mundo');
  assert.equal(a.next(), b.next());
});

test('fork con etiquetas distintas no comparte secuencia', () => {
  const base = createRng(42);
  assert.notEqual(base.fork('mundo').next(), base.fork('npcs').next());
});

test('advance acumula tiempo parcial hasta completar un tick', () => {
  const clock = createClock();
  assert.equal(clock.advance(200, 1), 0);
  assert.equal(clock.advance(200, 1), 1);
  assert.equal(clock.tick, 1);
});

test('la velocidad multiplica los ticks, no los altera', () => {
  const uno = createClock(), diez = createClock();
  uno.advance(4000, 1);
  diez.advance(400, 10);
  assert.equal(uno.tick, diez.tick);
});

// Review Focus 1
test('advance acota los ticks tras una pausa larga en segundo plano', () => {
  const clock = createClock();
  const ticks = clock.advance(600000, 10);
  assert.equal(ticks, 24, 'debe acotarse a maxTicksPerAdvance');
  assert.equal(clock.tick, 24);
});

test('advance con velocidad 0 no avanza', () => {
  const clock = createClock();
  assert.equal(clock.advance(10000, 0), 0);
  assert.equal(clock.tick, 0);
});

test('day, hour y season derivan del tick', () => {
  const clock = createClock();
  for (let i = 0; i < 744; i++) clock.advance(400, 1);
  assert.equal(clock.day, 31);
  assert.equal(clock.hour, 0);
  assert.equal(clock.season, 'verano');
});

test('tick inicial se respeta y day/season derivan de él', () => {
  const clock = createClock({ tick: 24 * 31 + 5 });
  assert.equal(clock.tick, 749);
  assert.equal(clock.day, 31);
  assert.equal(clock.hour, 5);
  assert.equal(clock.season, 'verano');
});
