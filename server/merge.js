/**
 * Intentionally unsafe deep-merge (classic prototype-pollution footgun).
 *
 * DaloyJS strips `__proto__` / `constructor` / `prototype` in parsers via
 * `isForbiddenObjectKey` + `safeJsonParse`. This helper does the opposite:
 * it walks attacker-controlled keys with no denylist.
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
