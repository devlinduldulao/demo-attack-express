/**
 * API base URL.
 *
 * - Local dev with Vite proxy: leave VITE_API_URL unset → relative /api/*
 * - GitHub Pages → Azure: set VITE_API_URL=https://your-app.azurewebsites.net
 *   at build time so the static SPA talks to the live Express backend.
 */
const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

function url(path) {
  return `${API_BASE}${path}`;
}

export function getStoredToken() {
  return localStorage.getItem("vaultpay_token");
}

export function setStoredToken(token) {
  if (token) localStorage.setItem("vaultpay_token", token);
  else localStorage.removeItem("vaultpay_token");
}

export function getStoredUser() {
  const raw = localStorage.getItem("vaultpay_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) localStorage.setItem("vaultpay_user", JSON.stringify(user));
  else localStorage.removeItem("vaultpay_user");
}

export async function login(email, password) {
  const res = await fetch(url("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Login failed (${res.status})`);
  return data;
}

export async function fetchMe(token) {
  const res = await fetch(url("/api/me"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Session expired (${res.status})`);
  return data;
}

export async function fetchMyOrders(token) {
  // The SPA calls the "protected" orders endpoint and trusts the server
  // to scope results to the current user. The server does not.
  const res = await fetch(url("/api/orders"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Orders failed (${res.status})`);
  return data;
}

export function apiBaseLabel() {
  return API_BASE || "(same origin / Vite proxy)";
}
