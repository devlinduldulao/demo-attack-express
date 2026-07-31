import { useEffect, useState } from "react";
import {
  apiBaseLabel,
  fetchMe,
  fetchMyOrders,
  getStoredToken,
  getStoredUser,
  login,
  setStoredToken,
  setStoredUser,
} from "./api.js";

const DEMO_ACCOUNTS = [
  { email: "alice@example.com", password: "password123", label: "Alice (user)" },
  { email: "bob@example.com", password: "bobsecret", label: "Bob (user)" },
  { email: "admin@vaultpay.demo", password: "admin123", label: "Admin" },
];

function money(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n ?? 0);
}

export default function App() {
  const [email, setEmail] = useState("alice@example.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(() => getStoredUser());
  const [token, setToken] = useState(() => getStoredToken());
  const [orders, setOrders] = useState([]);
  const [bootstrapping, setBootstrapping] = useState(Boolean(getStoredToken()));

  useEffect(() => {
    if (!token) {
      setBootstrapping(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await fetchMe(token);
        if (cancelled) return;
        setUser(me.user);
        setStoredUser(me.user);
        const orderData = await fetchMyOrders(token);
        if (cancelled) return;
        // SPA naively shows "my orders" — server actually returned everyone's.
        const mine = (orderData.orders || []).filter((o) => o.userId === me.user.id);
        setOrders(mine);
      } catch {
        if (cancelled) return;
        logout();
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function logout() {
    setToken(null);
    setUser(null);
    setOrders([]);
    setStoredToken(null);
    setStoredUser(null);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await login(email, password);
      setStoredToken(data.token);
      setStoredUser(data.user);
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(account) {
    setEmail(account.email);
    setPassword(account.password);
    setError("");
  }

  if (bootstrapping) {
    return (
      <div className="shell">
        <div className="card center">
          <div className="spinner" />
          <p className="muted">Restoring secure session…</p>
        </div>
      </div>
    );
  }

  if (user && token) {
    return (
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="logo">◆</span>
            <div>
              <strong>VaultPay</strong>
              <span className="badge">JWT secured</span>
            </div>
          </div>
          <button type="button" className="btn ghost" onClick={logout}>
            Sign out
          </button>
        </header>

        <main className="dashboard">
          <section className="hero-card">
            <p className="eyebrow">Welcome back</p>
            <h1>{user.name}</h1>
            <p className="muted">{user.email}</p>
            <div className="balance">
              <span>Available balance</span>
              <strong>{money(user.balance)}</strong>
            </div>
            <div className="meta-row">
              <span className="pill">{user.role}</span>
              <span className="pill soft">{user.phone || "no phone"}</span>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Your transactions</h2>
              <span className="muted small">{orders.length} items</span>
            </div>
            {orders.length === 0 ? (
              <p className="muted">No transactions yet.</p>
            ) : (
              <ul className="tx-list">
                {orders.map((o) => (
                  <li key={o.id}>
                    <div>
                      <strong>{o.merchant}</strong>
                      <span className="muted small">
                        {new Date(o.createdAt).toLocaleDateString()} · ···· {o.cardLast4}
                      </span>
                    </div>
                    <div className="tx-right">
                      <strong>{money(o.amount)}</strong>
                      <span className={`status ${o.status}`}>{o.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card trust">
            <h2>Why VaultPay is secure</h2>
            <ul>
              <li>Industry-standard JWT authentication on every private route</li>
              <li>Bearer tokens stored only in your browser</li>
              <li>HTTPS in production via Azure App Service</li>
              <li>Modern React SPA on GitHub Pages</li>
            </ul>
            <p className="fineprint">
              Demo build talking to <code>{apiBaseLabel()}</code>. This marketing
              copy is the point of the talk — the API behind it is wide open.
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="shell login-shell">
      <div className="login-grid">
        <section className="pitch">
          <div className="brand big">
            <span className="logo">◆</span>
            <strong>VaultPay</strong>
          </div>
          <h1>Banking that feels like the future.</h1>
          <p>
            Move money, track spend, sleep well. Every session is protected with
            JSON Web Tokens — the same pattern you saw in that fullstack YouTube
            tutorial.
          </p>
          <ul className="checks">
            <li>JWT access tokens</li>
            <li>Protected <code>/api/me</code> route</li>
            <li>Deployed and live on the public internet</li>
          </ul>
        </section>

        <section className="card login-card">
          <h2>Sign in</h2>
          <p className="muted">Use a demo account to open the dashboard.</p>

          <form onSubmit={onSubmit} className="form">
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>

            {error ? <div className="error">{error}</div> : null}

            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? "Signing in…" : "Sign in securely"}
            </button>
          </form>

          <div className="demo-accounts">
            <p className="muted small">Demo accounts (click to fill)</p>
            <div className="demo-row">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  className="chip"
                  onClick={() => fillDemo(a)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
