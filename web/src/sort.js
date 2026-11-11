import { useState } from 'react';
import { intlLocale } from './i18n/index.js';

/**
 * Sorting for the file and folder lists. Each list ("feature") remembers its last sort
 * in this browser: localStorage hbui.sort.<feature> = { key, dir } (dir 1 = ascending, -1 = descending).
 */

const storeKey = (feature) => `hbui.sort.${feature}`;

function read(feature, keys, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(feature)));
    if (v && keys.includes(v.key) && (v.dir === 1 || v.dir === -1)) return { key: v.key, dir: v.dir };
  } catch {
    // nothing stored, or storage blocked
  }
  return fallback;
}

/** [sort, setSort] for one list, remembered across visits. keys: the sorts that list offers. */
export function useRememberedSort(feature, keys, fallback = { key: 'name', dir: 1 }) {
  const [sort, setSortState] = useState(() => read(feature, keys, fallback));
  const setSort = (next) => {
    setSortState((cur) => {
      const v = typeof next === 'function' ? next(cur) : next;
      try {
        localStorage.setItem(storeKey(feature), JSON.stringify(v));
      } catch {
        // private window: not remembered
      }
      return v;
    });
  };
  return [sort, setSort];
}

/** Natural, case-insensitive name order ("Ep 2" before "Ep 10"). */
export const compareNames = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), intlLocale(), { numeric: true, sensitivity: 'base' });

const baseName = (p) => String(p ?? '').split(/[\\/]/).pop();
/** The file type: its extension, lower case ('' for folders and names without one). */
export const fileType = (name) => {
  const m = /\.([^.]+)$/.exec(baseName(name));
  return m ? m[1].toLowerCase() : '';
};

/**
 * Sorts a copy of items by sort = { key: 'name'|'date'|'type'|'size', dir }.
 * get(item) -> { name, mtime, size, dir } reads the fields (dir: true for a folder).
 * Folders stay above files whatever the order; ties fall back to the name, A to Z.
 */
export function sortList(items, sort, get = (x) => x) {
  const field = {
    name: () => 0,
    date: (x) => x.mtime ?? 0,
    size: (x) => x.size ?? 0,
  };
  const byKey = (a, b) => {
    if (sort.key === 'name') return compareNames(a.name, b.name);
    if (sort.key === 'type') return compareNames(fileType(a.name), fileType(b.name));
    const f = field[sort.key] ?? field.name;
    return f(a) - f(b);
  };
  return items
    .map((item) => ({ item, v: get(item) }))
    .sort((x, y) => {
      const a = x.v;
      const b = y.v;
      if (!!a.dir !== !!b.dir) return a.dir ? -1 : 1;
      return byKey(a, b) * sort.dir || compareNames(a.name, b.name);
    })
    .map((x) => x.item);
}
