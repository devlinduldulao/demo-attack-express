import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createApp } from "../server/app.js";
import db from "../server/db.js";

async function runDemo(options = {}) {
    db.reset();
    const { app } = createApp({ jwtSecret: options.secret || "supersecret123" });
    const requests = [];
    const server = createServer((request, response) => {
        requests.push({ method: request.method, url: request.url });
        const url = new URL(request.url, "http://localhost");
        if (options.standin && url.pathname.startsWith("/latest/meta-data/")) {
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ AccessKeyId: "DEMO-FAKE", SecretAccessKey: "DEMO-FAKE", Token: "DEMO-FAKE" }));
            return;
        }
        if (options.standin && url.pathname === "/redirect") {
            response.writeHead(302, { Location: url.searchParams.get("to") });
            response.end();
            return;
        }
        if (options.ambiguousResponses && url.pathname === "/api/auth/login") {
            response.writeHead(400, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: `Unexpected error ${requests.length}` }));
            return;
        }
        if (url.pathname === "/api/proxy" && url.searchParams.get("url")?.includes("169.254.169.254")) {
            response.writeHead(502, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: "Upstream fetch failed", detail: "fixture: no metadata" }));
            return;
        }
        if (url.pathname === "/api/debug/config" && options.hideDebug) {
            response.writeHead(404, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: "Not found" }));
            return;
        }
        if (url.pathname === "/api/auth/login" && options.loginFallback) {
            let body = "";
            request.on("data", (chunk) => { body += chunk; });
            request.on("end", () => {
                const payload = JSON.parse(body);
                const blocked = options.loginFallback === "admin"
                    ? payload.email !== "admin@vaultpay.demo"
                    : payload.email === "alice@example.com" && payload.password === "password123";
                if (blocked) {
                    response.writeHead(401, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ error: "Fixture denies this login" }));
                } else {
                    request.body = payload;
                    request.headers["content-type"] = "application/x-fixture-parsed";
                    app(request, response);
                }
            });
            return;
        }
        app(request, response);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const child = spawn(process.execPath, [
            fileURLToPath(new URL("../attack/attack.mjs", import.meta.url)),
            base, "--json", "--quiet", "--skip-slow",
            ...(options.standin ? [`--internal=${base}`] : []),
        ], { env: { ...process.env, DEMO_GATE_TOKEN: "", INTERNAL_SERVICE_URL: "", DEMO_DRAMA: "" } });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        const timer = setTimeout(() => child.kill("SIGTERM"), 30_000);
        const [code] = await once(child, "close");
        clearTimeout(timer);
        assert.equal(code, 0, stderr || stdout);
        const reportStart = stdout.lastIndexOf('\n{\n  "target":');
        assert.notEqual(reportStart, -1, "JSON report missing");
        return { report: JSON.parse(stdout.slice(reportStart)), stdout, requests };
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
}

test("demo findings use accurate categories and confirmed evidence", async () => {
    const { report, stdout, requests } = await runDemo();
    const find = (title) => report.findings.find((finding) => finding.title.includes(title));
    assert.equal(report.owaspEdition, 2023);
    assert.equal(report.counting, "finding-records-not-unique-root-causes");
    assert.equal(find("Path traversal").cwe, "CWE-22");
    assert.equal(find("Path traversal").owasp, null);
    assert.equal(find("Open redirect").cwe, "CWE-601");
    assert.equal(find("HTML echo").cwe, "CWE-79");
    assert.equal(find("Unauthenticated user dump").owasp, "API5");
    assert.equal(find("settings write").owasp, "API5");
    assert.equal(find("authentication throttling").owasp, "API2");
    assert.equal(find("cross-origin").severity, "INFO");
    assert.equal(find("stack trace").owasp, "API8");
    assert.equal(find("Mass assignment privilege").owasp, "API3");
    assert.equal(find("Cross-user").owasp, "API1");
    assert.equal(find("Admin route").owasp, "API5");
    assert.equal(report.forgedAdmin, true);
    assert.equal(report.escalated, true);
    assert.ok(!report.findings.some((finding) => /metadata|egress unrestricted/i.test(finding.title)));
    assert.match(stdout, /scoreboard \(cumulative finding records\)/);
    assert.match(stdout, /not OWASP scores or CVSS/);
    const adminIndex = requests.findIndex((request) => request.url === "/api/admin/stats");
    const firstWrite = requests.findIndex((request) => request.method === "PUT" && request.url.startsWith("/api/users/"));
    assert.ok(adminIndex < firstWrite, "Admin access must be checked before any user mutation");
    assert.equal(requests[firstWrite].url, "/api/users/2");
});

test("Bob fallback targets Alice, not Bob's own record", async () => {
    const { report, requests } = await runDemo({ loginFallback: "bob" });
    const firstWrite = requests.find((request) => request.method === "PUT" && request.url.startsWith("/api/users/"));
    assert.equal(firstWrite.url, "/api/users/1");
    assert.ok(report.findings.some((finding) => finding.title === "Cross-user write without ownership check"));
});

test("admin fallback does not claim BFLA (Broken Function Level Authorization) or privilege escalation", async () => {
    const { report } = await runDemo({ loginFallback: "admin" });
    assert.equal(report.escalated, false);
    assert.ok(!report.findings.some((finding) => /Admin route|Mass assignment|Cross-user|BOLA (Broken Object Level Authorization) on/.test(finding.title)));
});

test("a stale virtual backup key is not reported as an accepted admin forgery", async () => {
    const { report } = await runDemo({ secret: "different-active-signing-key", hideDebug: true });
    assert.equal(report.jwtSecret, true);
    assert.equal(report.forgedAdmin, false);
    assert.ok(!report.findings.some((finding) => finding.title.includes("Forged JWTs accepted")));
});

test("local stand-in and redirect evidence do not claim internal-only access or bypass", async () => {
    const { report, stdout } = await runDemo({ standin: true });
    const pivot = report.findings.find((finding) => finding.title === "SSRF fetches metadata stand-in credentials");
    assert.equal(pivot.severity, "HIGH");
    assert.match(pivot.detail, /Fabricated credentials/);
    assert.match(pivot.detail, /Direct client fetch also succeeded/);
    assert.match(stdout, /no new finding or allowlist bypass counted/);
    assert.ok(!report.findings.some((finding) => /internal-only|redirect-hop bypass/.test(finding.title)));
});

test("unexpected login responses do not confirm body parsing, throttling, or enumeration", async () => {
    const { report } = await runDemo({ ambiguousResponses: true });
    assert.ok(!report.findings.some((finding) => /1.5 MiB|authentication throttling|account enumeration/.test(finding.title)));
});