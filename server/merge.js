/**
 * Intentionally unsafe deep-merge (classic prototype-pollution footgun).
 *
 * The kind of helper you write to get PATCH semantics: merge the client's JSON
 * into the stored object, recursing into nested objects. It walks
 * attacker-controlled keys with no denylist, so `__proto__` — an ordinary own
 * key on anything from `JSON.parse` — walks straight onto `Object.prototype`.
 *
 * A safe version rejects `__proto__` / `constructor` / `prototype` before
 * recursing, or uses a null-prototype target. This one does neither, on purpose.
 */

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recursively merge `source` into `target` without key filtering.
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 * @returns {Record<string, unknown>}
 */
export function unsafeDeepMerge(target, source) {
  if (!isPlainObject(source)) return target;
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    if (isPlainObject(srcVal)) {
      if (!isPlainObject(target[key])) {
        target[key] = {};
      }
      unsafeDeepMerge(target[key], srcVal);
    } else {
      target[key] = srcVal;
    }
  }
  return target;
}
