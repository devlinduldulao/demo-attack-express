/**
 * Intentionally unsafe deep-merge (mass-assignment / PATCH-style helper).
 *
 * Walks attacker-controlled keys with no denylist or field allowlist — used by
 * PUT /api/users/:id and PUT /api/settings so the demo can show raw JSON
 * overwriting privileged fields (role, balance, feature flags, …).
 *
 * Also a classic prototype-pollution footgun if `__proto__` keys are present;
 * this demo does not drive that attack path in the terminal script.
 */

function isPlainObject(value) {
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
