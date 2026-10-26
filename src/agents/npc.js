// NPCs: identity, traits and needs. Every random draw goes through the injected rng.
import { createNeeds } from './needs.js';

// Spanish names with a prehistoric sound. Repeats across NPCs are allowed; repeated ids are not.
export const NOMBRES = [
  'Ulla', 'Kora', 'Brun', 'Tavo', 'Nesa', 'Ardo', 'Keli', 'Morga', 'Teo', 'Suna',
  'Oru', 'Lira', 'Gaspe', 'Itza', 'Brena', 'Ovo', 'Taru', 'Sima', 'Dano', 'Renka',
  'Yaro', 'Halu', 'Mira', 'Kesa', 'Tomo', 'Bena', 'Rudo', 'Zira', 'Piko', 'Anka',
  'Lumo', 'Cora', 'Nuna', 'Tuma', 'Xaro', 'Irma', 'Velo', 'Ceno', 'Dara', 'Hiko',
  'Ruma', 'Sana', 'Aruk', 'Nodo', 'Ibar', 'Yuna', 'Goro', 'Elka',
];

// Id counters are kept per rng instance, so each game's band starts from its own seed
// and no state leaks between games in one page session.
const counters = new WeakMap();

function nextId(rng) {
  let n = counters.get(rng);
  if (n === undefined) n = rng.int(1000, 999999);
  counters.set(rng, n + 1);
  return `npc-${n}`;
}

const round2 = (value) => Math.round(value * 100) / 100;

export function createNpc(rng, opts = {}) {
  const id = nextId(rng);
  const nombre = rng.pick(NOMBRES);
  const age = opts.age ?? rng.int(0, 60);
  const traits = {
    cautela: round2(rng.next()),
    audacia: round2(rng.next()),
    sabiduria: round2(rng.next()),
  };
  return {
    id,
    nombre,
    age,
    traits,
    needs: createNeeds(),
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    action: null,
    alive: true,
  };
}

export const isElder = (npc) => npc.age >= 45;
export const isAdult = (npc) => npc.age >= 15;
