/**
 * In-memory "database" for the VaultPay demo.
 *
 * Deliberately stores sensitive PII the way a junior tutorial app often does:
 * plain-text passwords, full SSNs, card numbers, internal notes.
 * Nothing here is real. Nothing here should ever ship to production.
 *
 * `reset()` re-seeds state so tests and repeated attack runs stay deterministic.
 */

function seedUsers() {
  return [
    {
      id: 1,
      email: "alice@example.com",
      password: "password123",
      name: "Alice Santos",
      role: "user",
      ssn: "123-45-6789",
      phone: "+47 900 11 001",
      address: "Karl Johans gate 1, Oslo",
      balance: 4820.55,
      cardNumber: "4532 1488 9012 3456",
      cardCvv: "123",
      internalNote: "VIP customer — do not cold-call",
    },
    {
      id: 2,
      email: "bob@example.com",
      password: "bobsecret",
      name: "Bob Chen",
      role: "user",
      ssn: "987-65-4321",
      phone: "+47 900 22 002",
      address: "Bogstadveien 45, Oslo",
      balance: 1250.0,
      cardNumber: "5425 2334 1521 9903",
      cardCvv: "456",
      internalNote: "Chargeback risk — monitor",
    },
    {
      id: 3,
      email: "admin@vaultpay.demo",
      password: "admin123",
      name: "VaultPay Admin",
      role: "admin",
      ssn: "000-00-0001",
      phone: "+47 900 00 000",
      address: "HQ — Confidential",
      balance: 999999.99,
      cardNumber: "4111 1111 1111 1111",
      cardCvv: "999",
      internalNote: "ROOT ACCOUNT — full ledger access",
    },
    {
      id: 4,
      email: "carol@example.com",
      password: "carol2024",
      name: "Carol Nguyen",
      role: "user",
      ssn: "555-12-3456",
      phone: "+1 415 555 0199",
      address: "1 Market St, San Francisco",
      balance: 15750.2,
      cardNumber: "3782 822463 10005",
      cardCvv: "789",
      internalNote: "Payroll deposit every 15th",
    },
  ];
}

function seedOrders() {
  return [
    {
      id: 1,
      userId: 1,
      merchant: "Nordic Airlines",
      amount: 890.0,
      status: "completed",
      cardLast4: "3456",
      createdAt: "2026-06-01T10:00:00.000Z",
    },
    {
      id: 2,
      userId: 1,
      merchant: "Oslo Electric",
      amount: 142.3,
      status: "completed",
      cardLast4: "3456",
      createdAt: "2026-06-12T18:22:00.000Z",
    },
    {
      id: 3,
      userId: 2,
      merchant: "Steam",
      amount: 59.99,
      status: "completed",
      cardLast4: "9903",
      createdAt: "2026-06-15T21:00:00.000Z",
    },
    {
      id: 4,
      userId: 3,
      merchant: "Internal transfer — payroll",
      amount: 50000.0,
      status: "completed",
      cardLast4: "1111",
      createdAt: "2026-06-20T09:00:00.000Z",
    },
    {
      id: 5,
      userId: 4,
      merchant: "Apple Store",
      amount: 1299.0,
      status: "pending",
      cardLast4: "0005",
      createdAt: "2026-07-01T14:30:00.000Z",
    },
  ];
}

function seedSettings() {
  return {
    theme: "dark",
    notifications: true,
    featureFlags: {
      betaTransfer: false,
    },
  };
}

export const state = {
  users: seedUsers(),
  orders: seedOrders(),
  settings: seedSettings(),
  nextOrderId: 6,
  nextUserId: 5,
};

export function reset() {
  state.users = seedUsers();
  state.orders = seedOrders();
  state.settings = seedSettings();
  state.nextOrderId = 6;
  state.nextUserId = 5;
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone,
    balance: user.balance,
  };
}

export function fullUser(user) {
  const { password, ...rest } = user;
  return { ...rest, passwordHash: `plain:${password}` };
}

export function dumpUser(user) {
  return { ...user };
}

/** Default export matches the old CJS shape used by app.js and tests. */
const db = {
  state,
  reset,
  publicUser,
  fullUser,
  dumpUser,
  get users() {
    return state.users;
  },
  get orders() {
    return state.orders;
  },
  get settings() {
    return state.settings;
  },
  bumpOrderId() {
    return state.nextOrderId++;
  },
  bumpUserId() {
    return state.nextUserId++;
  },
};

export default db;
