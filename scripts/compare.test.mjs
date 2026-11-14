/**
 * Locks in the before/after table printed by `npm run compare`.
 *
 * Boots the Express build and both DaloyJS modes, runs attack/attackv2.mjs
 * against each (via scripts/compare.mjs --json) and asserts the observed
 * outcome of every probe — including the ones DaloyJS does NOT stop, so the
 * comparison cannot quietly drift into overclaiming.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installed = ["server", "server-daloy"].every((d) => existsSync(path.join(root, d, "node_modules")));

/** probe id → expected state per build */
const EXPECTED = {
  //              Express    DaloyJS defaults  DaloyJS + opt-ins
  "user-dump":   ["open",    "reduced",        "reduced"],
  idor:          ["open",    "reduced",        "reduced"],
  search:        ["open",    "reduced",        "reduced"],
  traversal:     ["open",    "open",           "blocked"],
  ssrf:          ["open",    "open",           "blocked"],
  bola:          ["open",    "open",           "open"],
  admin:         ["open",    "reduced",        "blocked"],
  "cross-write": ["open",    "open",           "open"],
  "mass-assign": ["open",    "blocked",        "blocked"],
  flood:         ["open",    "reduced",        "blocked"],
  forge:         ["open",    "open",           "open"],
};
const BUILDS = ["express", "daloy", "daloyOptIn"];

test("same attack, three builds: every probe outcome matches the published table", { skip: !installed && "run `npm run install:all` first" }, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, "scripts", "compare.mjs"), "--json"], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
  const { reports, weakSecretBoot } = JSON.parse(stdout);

  for (const [probe, states] of Object.entries(EXPECTED)) {
    BUILDS.forEach((build, i) => {
      const got = reports[build].probes.find((p) => p.id === probe);
      assert.equal(got?.state, states[i], `${probe} on ${build}`);
    });
  }

  // No build's responses may print a missing field as loot.
  for (const build of BUILDS) {
    assert.ok(!JSON.stringify(reports[build]).includes("undefined"), `${build} report mentions undefined`);
  }

  // Express: nothing defended. DaloyJS: holes it cannot close stay critical.
  assert.equal(reports.express.blocked.length + reports.express.reduced.length, 0);
  assert.equal(reports.express.stack, "Express 5");
  for (const build of ["daloy", "daloyOptIn"]) {
    const titles = reports[build].findings.filter((f) => f.severity === "CRITICAL").map((f) => f.title);
    assert.ok(titles.includes("BOLA on /api/orders"), `${build} must still report BOLA`);
    assert.ok(titles.includes("Cross-user write without ownership check"), `${build} must still report cross-user write`);
    assert.equal(reports[build].forgedAdmin, true, `${build}: a leaked HS256 key still forges`);
    assert.equal(reports[build].escalated, false, `${build}: mass assignment must not escalate`);
    assert.equal(reports[build].usersStolen, 4, `${build}: the user list is still public`);
  }

  // The tutorial secret boots Express and is refused by DaloyJS in both modes.
  assert.equal(weakSecretBoot.express.starts, true);
  assert.equal(weakSecretBoot.daloy.starts, false);
  assert.equal(weakSecretBoot.daloyOptIn.starts, false);
  assert.match(weakSecretBoot.daloy.reason, /weak_hs_secret/);
});
