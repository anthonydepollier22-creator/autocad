/*
 * house-worker.js — Génère une maison type hors du fil principal (le solveur
 * de mobilier prend jusqu'à une seconde) : la page reste fluide pendant ce temps.
 */
importScripts('symbols.js', 'netlist.js', 'plan.js', 'houses.js');

self.onmessage = (e) => {
  const { id, key } = e.data;
  try {
    self.postMessage({ id, doc: buildHouse(key) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
