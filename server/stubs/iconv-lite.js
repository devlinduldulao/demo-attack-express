/**
 * Minimal iconv-lite stub for Cloudflare Workers bundling.
 *
 * Real iconv-lite breaks under Wrangler (`require_streams is not a function`).
 * Express pulls it in via body-parser even when we don't call express.json().
 * UTF-8 only is enough for this demo API.
 */

function decode(buffer, encoding, options) {
  if (typeof buffer === "string") return buffer;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return buf.toString("utf8");
}

function encode(content, encoding, options) {
  return Buffer.from(String(content), "utf8");
}

function encodingExists(encoding) {
  const e = String(encoding || "").toLowerCase();
  return e === "utf8" || e === "utf-8" || e === "ascii" || e === "binary" || e === "base64";
}

const api = { decode, encode, encodingExists };
export default api;
export { decode, encode, encodingExists };
