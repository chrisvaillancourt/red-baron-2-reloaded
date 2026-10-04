// A deliberately small serializable boundary. Advanced IPC preserves every number;
// CLI JSON tags special numbers instead of collapsing NaN/Infinity/-0.
export function validateValue(value, path = '$', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value !== 'object') throw new Error(`${path}: ${typeof value} is not lossless JSON`);
  if (ancestors.has(value)) throw new Error(`${path}: cyclic observation`);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array && prototype !== Array.prototype) throw new Error(`${path}: return a plain array, not an Array subclass`);
  if (!array && prototype !== Object.prototype && prototype !== null) throw new Error(`${path}: return a plain object, not a class instance`);
  ancestors.add(value);
  if (array) {
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !('value' in descriptor)) throw new Error(`${path}[${i}]: sparse/accessor arrays are not lossless JSON`);
      validateValue(descriptor.value, `${path}[${i}]`, ancestors);
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (array && (key === 'length' || (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length))) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (key === '$number') throw new Error(`${path}: $number is reserved for lossless CLI number encoding`);
    if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor) || array) throw new Error(`${path}: symbol, hidden, accessor or extra array properties are not lossless JSON`);
    validateValue(descriptor.value, `${path}[${JSON.stringify(key)}]`, ancestors);
  }
  ancestors.delete(value);
}

export function firstDifference(a, b, path = '$') {
  if (Object.is(a, b)) return null;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
    return { path, baseline: a, candidate: b };
  }
  if (Array.isArray(a) && a.length !== b.length) return { path: `${path}.length`, baseline: a.length, candidate: b.length };
  const keys = Array.isArray(a) ? Object.keys(a) : [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const key of keys) {
    const child = Array.isArray(a) ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`;
    if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) {
      return { path: child, baselinePresent: Object.hasOwn(a, key), candidatePresent: Object.hasOwn(b, key), baseline: a[key] ?? null, candidate: b[key] ?? null };
    }
    const difference = firstDifference(a[key], b[key], child);
    if (difference) return difference;
  }
  return null;
}

export function numberReplacer(_key, value) {
  if (typeof value !== 'number') return value;
  if (Object.is(value, -0)) return { $number: '-0' };
  if (!Number.isFinite(value)) return { $number: String(value) };
  return value;
}
