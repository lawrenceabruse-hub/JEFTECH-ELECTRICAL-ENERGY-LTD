"use strict";

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const WEBSITE_DIR = [
  path.join(__dirname, "index.html"),
  __dirname
].find((directory) => fs.existsSync(path.join(directory, "index.html"))) || path.join(__dirname, "index.html");
const MAX_BODY_BYTES = 20_000;
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const PASSWORD_RESET_DURATION_MS = 30 * 60 * 1000;
const scrypt = promisify(crypto.scrypt);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000
});
const rateLimits = new Map();

const REQUIRED_ASSETS = [
  "index.html",
  "style.css",
  "jeftech-mark.svg",
  "images/electrical-service-work.jpg",
  "images/distribution-panel-installation.jpg",
  "images/panel-components.jpg",
  "images/panel-breakers.jpg",
  "work.js",
  "site.js",
  "admin.html",
  "admin.css",
  "admin.js"
];

const contentTypes = {
  "/": "text/html; charset=utf-8",
  "/index.html": "text/html; charset=utf-8",
  "/admin": "text/html; charset=utf-8",
  "/admin/": "text/html; charset=utf-8",
  "/admin.html": "text/html; charset=utf-8",
  "/favicon.ico": "image/svg+xml",
  "/style.css": "text/css; charset=utf-8",
  "/admin.css": "text/css; charset=utf-8",
  "/jeftech-mark.svg": "image/svg+xml",
  "/work.js": "text/javascript; charset=utf-8",
  "/site.js": "text/javascript; charset=utf-8",
  "/admin.js": "text/javascript; charset=utf-8",
  "/images/electrical-service-work.jpg": "image/jpeg",
  "/images/distribution-panel-installation.jpg": "image/jpeg",
  "/images/panel-components.jpg": "image/jpeg",
  "/images/panel-breakers.jpg": "image/jpeg"
};

const defaultServices = [
  ["Electrical design", "Well-considered electrical system design shaped around your building and its needs."],
  ["Installation", "Electrical installations for residential, commercial, and industrial spaces."],
  ["Maintenance", "Planned care to help electrical systems continue to serve your property."],
  ["Repairs", "Electrical repair services to help address issues and restore your system."]
];

const defaultProjects = [
  ["Careful work at every connection", "ON-SITE ELECTRICAL WORK", "images/electrical-service-work.jpg", "Electrician wearing protective gloves while working at an electrical meter"],
  ["Fitting and working with distribution panels", "PANEL INSTALLATION", "images/distribution-panel-installation.jpg", "Electrical technician in protective equipment working on a mounted distribution panel"],
  ["Organised breakers, wiring, and controls", "PANEL COMPONENTS", "images/panel-components.jpg", "Close view of circuit breakers and labelled electrical panel components"],
  ["Detailed view of breakers and panel wiring", "ELECTRICAL PANEL", "images/panel-breakers.jpg", "Close view of professionally arranged circuit breakers and control wiring"]
];

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
}

function getClientAddress(request) {
  return request.socket.remoteAddress || "unknown";
}

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || entry.expiresAt <= now) {
    rateLimits.set(key, { count: 1, expiresAt: now + windowMs });
    if (rateLimits.size > 10_000) {
      for (const [oldKey, oldValue] of rateLimits) {
        if (oldValue.expiresAt <= now) rateLimits.delete(oldKey);
      }
    }
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
  }
  try {
    const value = JSON.parse(raw || "{}");
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new Error("Expected an object.");
    }
    return value;
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function cleanText(value, label, maxLength, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string") throw Object.assign(new Error(`${label} is required.`), { statusCode: 400 });
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) {
    throw Object.assign(new Error(`${label} must be between 1 and ${maxLength} characters.`), { statusCode: 400 });
  }
  return cleaned;
}

function cleanEmail(value) {
  const email = cleanText(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Enter a valid email address."), { statusCode: 400 });
  }
  return email;
}

function cleanImageUrl(value) {
  const imageUrl = cleanText(value, "Image URL", 1000);
  if (imageUrl.startsWith("/images/") && !imageUrl.includes("..")) return imageUrl;
  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw Object.assign(new Error("Image URL must be a site image path or HTTPS URL."), { statusCode: 400 });
  }
  if (parsed.protocol !== "https:") {
    throw Object.assign(new Error("Image URL must use HTTPS."), { statusCode: 400 });
  }
  return parsed.toString();
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  const expected = `${request.headers["x-forwarded-proto"] === "https" || IS_PRODUCTION ? "https" : "http"}://${request.headers.host}`;
  if (origin !== expected) {
    throw Object.assign(new Error("Cross-origin requests are not allowed."), { statusCode: 403 });
  }
}

function getCookie(request, name) {
  const cookies = (request.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator !== -1 && cookie.slice(0, separator).trim() === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
  return "";
}

function setSessionCookie(response, token, maxAge) {
  response.setHeader("Set-Cookie", [
    `jeftech_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    IS_PRODUCTION ? "Secure" : ""
  ].filter(Boolean).join("; "));
}

async function getAdmin(request) {
  const token = getCookie(request, "jeftech_session");
  if (!token) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const result = await pool.query(
    `SELECT admins.id, admins.email
       FROM admin_sessions
       JOIN admins ON admins.id = admin_sessions.admin_id
      WHERE admin_sessions.token_hash = $1 AND admin_sessions.expires_at > NOW()`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

async function requireAdmin(request, response) {
  const admin = await getAdmin(request);
  if (!admin) {
    sendError(response, 401, "Sign in to continue.");
    return null;
  }
  return admin;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

async function verifyPassword(password, encoded) {
  const [saltText, hashText] = encoded.split(":");
  if (!saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = await scrypt(password, Buffer.from(saltText, "base64url"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function initializeDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured before the backend can start.");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admin_password_resets (
      token_hash TEXT PRIMARY KEY,
      admin_id BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS services (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS projects (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      image_url TEXT NOT NULL,
      alt_text TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS enquiries (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      service TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions (expires_at);
    CREATE INDEX IF NOT EXISTS admin_password_resets_admin_idx ON admin_password_resets (admin_id);
    CREATE INDEX IF NOT EXISTS enquiries_created_idx ON enquiries (created_at DESC);
  `);

  const migrationFrom = process.env.ADMIN_EMAIL_MIGRATION_FROM;
  const migrationTo = process.env.ADMIN_EMAIL_MIGRATION_TO;
  if (migrationFrom || migrationTo) {
    if (!migrationFrom || !migrationTo) {
      throw new Error("Set both ADMIN_EMAIL_MIGRATION_FROM and ADMIN_EMAIL_MIGRATION_TO to migrate the administrator email.");
    }
    const fromEmail = cleanEmail(migrationFrom);
    const toEmail = cleanEmail(migrationTo);
    if (fromEmail === toEmail) {
      throw new Error("Administrator email migration source and destination must be different.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const matches = await client.query(
        "SELECT id, email FROM admins WHERE email = ANY($1::text[]) FOR UPDATE",
        [[fromEmail, toEmail]]
      );
      const sourceAdmin = matches.rows.find((admin) => admin.email === fromEmail);
      const destinationAdmin = matches.rows.find((admin) => admin.email === toEmail);
      if (sourceAdmin && destinationAdmin) {
        throw new Error("Administrator email migration is ambiguous because both addresses already exist.");
      }
      if (sourceAdmin) {
        await client.query("UPDATE admins SET email = $1 WHERE id = $2", [toEmail, sourceAdmin.id]);
        await client.query("DELETE FROM admin_password_resets WHERE admin_id = $1", [sourceAdmin.id]);
        console.info("Administrator email migration completed.");
      } else if (!destinationAdmin) {
        throw new Error("Administrator email migration source was not found; no account was changed.");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const adminCount = await pool.query("SELECT COUNT(*)::integer AS count FROM admins");
  if (adminCount.rows[0].count === 0) {
    const email = cleanEmail(process.env.ADMIN_EMAIL);
    const password = process.env.ADMIN_PASSWORD;
    if (typeof password !== "string" || password.length < 14 || password.length > 200) {
      throw new Error("For first-time setup, ADMIN_PASSWORD must be 14-200 characters.");
    }
    await pool.query("INSERT INTO admins (email, password_hash) VALUES ($1, $2)", [email, await hashPassword(password)]);
  }

  const serviceCount = await pool.query("SELECT COUNT(*)::integer AS count FROM services");
  if (serviceCount.rows[0].count === 0) {
    for (const [index, [title, description]] of defaultServices.entries()) {
      await pool.query("INSERT INTO services (title, description, display_order) VALUES ($1, $2, $3)", [title, description, index]);
    }
  }

  const projectCount = await pool.query("SELECT COUNT(*)::integer AS count FROM projects");
  if (projectCount.rows[0].count === 0) {
    for (const [index, [title, category, imageUrl, altText]] of defaultProjects.entries()) {
      await pool.query(
        "INSERT INTO projects (title, category, image_url, alt_text, display_order) VALUES ($1, $2, $3, $4, $5)",
        [title, category, imageUrl, altText, index]
      );
    }
  }
  await pool.query("DELETE FROM admin_sessions WHERE expires_at <= NOW()");
  await pool.query("DELETE FROM admin_password_resets WHERE expires_at <= NOW()");
}

async function sendPasswordResetEmail(email, resetUrl) {
  if (!process.env.RESEND_API_KEY || !process.env.RESET_EMAIL_FROM) {
    throw new Error("Password reset email is not configured (set RESEND_API_KEY and RESET_EMAIL_FROM).");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.RESET_EMAIL_FROM,
      to: [email],
      subject: "Reset your JEFTECH website admin password",
      text: `A password reset was requested for your JEFTECH website administrator account.\n\nUse this one-time link within 30 minutes:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>A password reset was requested for your JEFTECH website administrator account.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This one-time link expires in 30 minutes. If you did not request this, you can ignore this email.</p>`
    })
  });

  if (!response.ok) {
    throw new Error(`Password reset email provider returned HTTP ${response.status}.`);
  }
}

async function handleApi(request, response, pathname, searchParams) {
  let authenticatedAdmin = null;
  if (pathname === "/api/content" && request.method === "GET") {
    const [services, projects] = await Promise.all([
      pool.query("SELECT id, title, description, display_order FROM services ORDER BY display_order, id"),
      pool.query("SELECT id, title, category, image_url, alt_text, display_order FROM projects ORDER BY display_order, id")
    ]);
    sendJson(response, 200, { services: services.rows, projects: projects.rows });
    return true;
  }

  if (pathname === "/api/enquiries" && request.method === "POST") {
    assertSameOrigin(request);
    if (!rateLimit(`enquiry:${getClientAddress(request)}`, 5, 60 * 60 * 1000)) {
      sendError(response, 429, "Too many enquiries from this connection. Please try again later.");
      return true;
    }
    const body = await readJson(request);
    if (typeof body.website === "string" && body.website.trim()) {
      sendJson(response, 201, { message: "Thank you. Your enquiry has been received." });
      return true;
    }
    const name = cleanText(body.name, "Name", 120);
    const email = cleanEmail(body.email);
    const phone = cleanText(body.phone, "Phone", 40, { optional: true });
    const service = cleanText(body.service, "Service", 120, { optional: true });
    const message = cleanText(body.message, "Message", 5000);
    await pool.query(
      "INSERT INTO enquiries (name, email, phone, service, message) VALUES ($1, $2, $3, $4, $5)",
      [name, email, phone, service, message]
    );
    sendJson(response, 201, { message: "Thank you. Your enquiry has been received." });
    return true;
  }

  if (pathname === "/api/admin/login" && request.method === "POST") {
    assertSameOrigin(request);
    if (!rateLimit(`login:${getClientAddress(request)}`, 5, 15 * 60 * 1000)) {
      sendError(response, 429, "Too many sign-in attempts. Please wait 15 minutes and try again.");
      return true;
    }
    const body = await readJson(request);
    const email = cleanEmail(body.email);
    if (typeof body.password !== "string" || !body.password.length || body.password.length > 200) {
      throw Object.assign(new Error("Password is required and must be at most 200 characters."), { statusCode: 400 });
    }
    const password = body.password;
    const result = await pool.query("SELECT id, email, password_hash FROM admins WHERE email = $1", [email]);
    const admin = result.rows[0];
    if (!admin || !(await verifyPassword(password, admin.password_hash))) {
      sendError(response, 401, "Email or password is incorrect.");
      return true;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await pool.query("INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES ($1, $2, $3)", [tokenHash, admin.id, expiresAt]);
    setSessionCookie(response, token, SESSION_DURATION_MS / 1000);
    sendJson(response, 200, { email: admin.email });
    return true;
  }

  if (pathname === "/api/admin/password/forgot" && request.method === "POST") {
    assertSameOrigin(request);
    if (!rateLimit(`password-reset:${getClientAddress(request)}`, 5, 60 * 60 * 1000)) {
      sendError(response, 429, "Too many reset requests. Please wait before trying again.");
      return true;
    }
    const body = await readJson(request);
    const email = cleanEmail(body.email);
    const emailHash = crypto.createHash("sha256").update(email).digest("hex");
    if (!rateLimit(`password-reset-email:${emailHash}`, 3, 60 * 60 * 1000)) {
      sendJson(response, 202, { message: "If an admin account matches and email delivery is configured, a reset link will arrive shortly." });
      return true;
    }

    sendJson(response, 202, {
      message: "If an admin account matches and email delivery is configured, a reset link will arrive shortly."
    });
    let resetTokenHash = "";
    try {
      const adminResult = await pool.query("SELECT id FROM admins WHERE email = $1", [email]);
      if (adminResult.rowCount) {
        const token = crypto.randomBytes(32).toString("base64url");
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        resetTokenHash = tokenHash;
        const expiresAt = new Date(Date.now() + PASSWORD_RESET_DURATION_MS);
        await pool.query("DELETE FROM admin_password_resets WHERE admin_id = $1", [adminResult.rows[0].id]);
        await pool.query(
          "INSERT INTO admin_password_resets (token_hash, admin_id, expires_at) VALUES ($1, $2, $3)",
          [tokenHash, adminResult.rows[0].id, expiresAt]
        );

        const baseUrl = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        const parsedBaseUrl = new URL(baseUrl);
        if (IS_PRODUCTION && parsedBaseUrl.protocol !== "https:") {
          throw new Error("Password reset links must use HTTPS in production.");
        }
        parsedBaseUrl.search = "";
        parsedBaseUrl.hash = "";
        parsedBaseUrl.pathname = "/admin";
        parsedBaseUrl.searchParams.set("reset", token);
        await sendPasswordResetEmail(email, parsedBaseUrl.toString());
      }
    } catch (error) {
      if (resetTokenHash) {
        try {
          await pool.query("DELETE FROM admin_password_resets WHERE token_hash = $1", [resetTokenHash]);
        } catch (cleanupError) {
          console.error(`Could not remove an undelivered password reset token (${cleanupError.message}).`);
        }
      }
      console.error(`Could not process admin password reset request (${error.message}).`);
    }
    return true;
  }

  if (pathname === "/api/admin/password/reset" && request.method === "POST") {
    assertSameOrigin(request);
    if (!rateLimit(`password-reset-complete:${getClientAddress(request)}`, 10, 60 * 60 * 1000)) {
      sendError(response, 429, "Too many password reset attempts. Please try again later.");
      return true;
    }
    const body = await readJson(request);
    if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(body.token)) {
      sendError(response, 400, "This reset link is invalid or has expired. Request a new one.");
      return true;
    }
    if (typeof body.password !== "string" || body.password.length < 14 || body.password.length > 200) {
      sendError(response, 400, "New password must be between 14 and 200 characters.");
      return true;
    }

    const tokenHash = crypto.createHash("sha256").update(body.token).digest("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const reset = await client.query(
        "DELETE FROM admin_password_resets WHERE token_hash = $1 AND expires_at > NOW() RETURNING admin_id",
        [tokenHash]
      );
      if (!reset.rowCount) {
        await client.query("ROLLBACK");
        sendError(response, 400, "This reset link is invalid or has expired. Request a new one.");
        return true;
      }

      const adminId = reset.rows[0].admin_id;
      await client.query("UPDATE admins SET password_hash = $1 WHERE id = $2", [await hashPassword(body.password), adminId]);
      await client.query("DELETE FROM admin_password_resets WHERE admin_id = $1", [adminId]);
      await client.query("DELETE FROM admin_sessions WHERE admin_id = $1", [adminId]);
      await client.query("COMMIT");
      sendJson(response, 200, { message: "Password reset. You can now sign in with your new password." });
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (pathname.startsWith("/api/admin/")) {
    assertSameOrigin(request);
    authenticatedAdmin = await requireAdmin(request, response);
    if (!authenticatedAdmin) return true;
  }

  if (pathname === "/api/admin/session" && request.method === "GET") {
    sendJson(response, 200, { authenticated: true, email: (await getAdmin(request)).email });
    return true;
  }

  if (pathname === "/api/admin/logout" && request.method === "POST") {
    const token = getCookie(request, "jeftech_session");
    if (token) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [tokenHash]);
    }
    setSessionCookie(response, "", 0);
    sendJson(response, 200, { message: "Signed out." });
    return true;
  }

  if (pathname === "/api/admin/password" && request.method === "PUT") {
    const body = await readJson(request);
    if (typeof body.oldPassword !== "string" || typeof body.newPassword !== "string") {
      throw Object.assign(new Error("Current and new passwords are required."), { statusCode: 400 });
    }
    const oldPassword = body.oldPassword;
    const newPassword = body.newPassword;
    if (oldPassword.length > 200 || newPassword.length > 200) {
      throw Object.assign(new Error("Passwords must be at most 200 characters."), { statusCode: 400 });
    }
    if (newPassword.length < 14) throw Object.assign(new Error("New password must be at least 14 characters."), { statusCode: 400 });
    const result = await pool.query("SELECT password_hash FROM admins WHERE id = $1", [authenticatedAdmin.id]);
    if (!(await verifyPassword(oldPassword, result.rows[0].password_hash))) {
      sendError(response, 401, "Current password is incorrect.");
      return true;
    }
    await pool.query("UPDATE admins SET password_hash = $1 WHERE id = $2", [await hashPassword(newPassword), authenticatedAdmin.id]);
    const token = getCookie(request, "jeftech_session");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await pool.query("DELETE FROM admin_sessions WHERE admin_id = $1 AND token_hash <> $2", [authenticatedAdmin.id, tokenHash]);
    sendJson(response, 200, { message: "Password updated. Other admin sessions have been signed out." });
    return true;
  }

  if (pathname === "/api/admin/email" && request.method === "PUT") {
    if (!rateLimit(`email-change:${authenticatedAdmin.id}:${getClientAddress(request)}`, 5, 15 * 60 * 1000)) {
      sendError(response, 429, "Too many email-change attempts. Please try again later.");
      return true;
    }
    const body = await readJson(request);
    const email = cleanEmail(body.email);
    if (typeof body.currentPassword !== "string" || !body.currentPassword.length || body.currentPassword.length > 200) {
      throw Object.assign(new Error("Current password is required and must be at most 200 characters."), { statusCode: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT password_hash FROM admins WHERE id = $1 FOR UPDATE", [authenticatedAdmin.id]);
      if (!result.rowCount || !(await verifyPassword(body.currentPassword, result.rows[0].password_hash))) {
        await client.query("ROLLBACK");
        sendError(response, 401, "Current password is incorrect.");
        return true;
      }
      const duplicate = await client.query("SELECT 1 FROM admins WHERE email = $1 AND id <> $2", [email, authenticatedAdmin.id]);
      if (duplicate.rowCount) {
        await client.query("ROLLBACK");
        sendError(response, 409, "That email address is already assigned to an administrator.");
        return true;
      }
      await client.query("UPDATE admins SET email = $1 WHERE id = $2", [email, authenticatedAdmin.id]);
      await client.query("DELETE FROM admin_password_resets WHERE admin_id = $1", [authenticatedAdmin.id]);
      await client.query("COMMIT");
      sendJson(response, 200, { email, message: "Admin email updated. Use the new address the next time you sign in." });
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (pathname === "/api/admin/enquiries" && request.method === "GET") {
    const status = searchParams.get("status");
    const values = ["new", "contacted", "closed"];
    if (status && !values.includes(status)) throw Object.assign(new Error("Invalid enquiry status filter."), { statusCode: 400 });
    const result = status
      ? await pool.query("SELECT * FROM enquiries WHERE status = $1 ORDER BY created_at DESC LIMIT 200", [status])
      : await pool.query("SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 200");
    sendJson(response, 200, { enquiries: result.rows });
    return true;
  }

  const enquiryMatch = pathname.match(/^\/api\/admin\/enquiries\/(\d+)$/);
  if (enquiryMatch && request.method === "PATCH") {
    const id = Number(enquiryMatch[1]);
    const body = await readJson(request);
    if (!["new", "contacted", "closed"].includes(body.status)) {
      throw Object.assign(new Error("Status must be new, contacted, or closed."), { statusCode: 400 });
    }
    const result = await pool.query("UPDATE enquiries SET status = $1 WHERE id = $2 RETURNING id, status", [body.status, id]);
    if (!result.rowCount) throw Object.assign(new Error("Enquiry was not found."), { statusCode: 404 });
    sendJson(response, 200, result.rows[0]);
    return true;
  }

  if (pathname === "/api/admin/services" && request.method === "POST") {
    const body = await readJson(request);
    const title = cleanText(body.title, "Title", 120);
    const description = cleanText(body.description, "Description", 1000);
    const order = Number.isInteger(body.display_order) ? body.display_order : 100;
    const result = await pool.query(
      "INSERT INTO services (title, description, display_order) VALUES ($1, $2, $3) RETURNING id, title, description, display_order",
      [title, description, order]
    );
    sendJson(response, 201, result.rows[0]);
    return true;
  }

  const serviceMatch = pathname.match(/^\/api\/admin\/services\/(\d+)$/);
  if (serviceMatch && request.method === "PUT") {
    const body = await readJson(request);
    const result = await pool.query(
      "UPDATE services SET title = $1, description = $2, display_order = $3, updated_at = NOW() WHERE id = $4 RETURNING id, title, description, display_order",
      [cleanText(body.title, "Title", 120), cleanText(body.description, "Description", 1000), Number.isInteger(body.display_order) ? body.display_order : 100, Number(serviceMatch[1])]
    );
    if (!result.rowCount) throw Object.assign(new Error("Service was not found."), { statusCode: 404 });
    sendJson(response, 200, result.rows[0]);
    return true;
  }
  if (serviceMatch && request.method === "DELETE") {
    const result = await pool.query("DELETE FROM services WHERE id = $1", [Number(serviceMatch[1])]);
    if (!result.rowCount) throw Object.assign(new Error("Service was not found."), { statusCode: 404 });
    sendJson(response, 200, { message: "Service removed." });
    return true;
  }

  if (pathname === "/api/admin/projects" && request.method === "POST") {
    const body = await readJson(request);
    const result = await pool.query(
      "INSERT INTO projects (title, category, image_url, alt_text, display_order) VALUES ($1, $2, $3, $4, $5) RETURNING id, title, category, image_url, alt_text, display_order",
      [
        cleanText(body.title, "Title", 180),
        cleanText(body.category, "Category", 120),
        cleanImageUrl(body.image_url),
        cleanText(body.alt_text, "Image description", 300),
        Number.isInteger(body.display_order) ? body.display_order : 100
      ]
    );
    sendJson(response, 201, result.rows[0]);
    return true;
  }

  const projectMatch = pathname.match(/^\/api\/admin\/projects\/(\d+)$/);
  if (projectMatch && request.method === "PUT") {
    const body = await readJson(request);
    const result = await pool.query(
      "UPDATE projects SET title = $1, category = $2, image_url = $3, alt_text = $4, display_order = $5, updated_at = NOW() WHERE id = $6 RETURNING id, title, category, image_url, alt_text, display_order",
      [
        cleanText(body.title, "Title", 180),
        cleanText(body.category, "Category", 120),
        cleanImageUrl(body.image_url),
        cleanText(body.alt_text, "Image description", 300),
        Number.isInteger(body.display_order) ? body.display_order : 100,
        Number(projectMatch[1])
      ]
    );
    if (!result.rowCount) throw Object.assign(new Error("Project was not found."), { statusCode: 404 });
    sendJson(response, 200, result.rows[0]);
    return true;
  }
  if (projectMatch && request.method === "DELETE") {
    const result = await pool.query("DELETE FROM projects WHERE id = $1", [Number(projectMatch[1])]);
    if (!result.rowCount) throw Object.assign(new Error("Project was not found."), { statusCode: 404 });
    sendJson(response, 200, { message: "Project removed." });
    return true;
  }

  if (pathname.startsWith("/api/")) {
    sendError(response, 404, "API route not found.");
    return true;
  }
  return false;
}

function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  const staticPath = pathname === "/admin" || pathname === "/admin/"
    ? "/admin.html"
    : pathname;
  const contentType = contentTypes[staticPath];
  if (!contentType) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const assetPath = staticPath === "/"
    ? "index.html"
    : staticPath === "/favicon.ico"
      ? "jeftech-mark.svg"
      : staticPath.slice(1);
  const filePath = path.join(WEBSITE_DIR, assetPath);
  fs.readFile(filePath, (error, data) => {
    if (error) {
      console.error(`Could not read website asset ${staticPath} (${error.code || error.message}).`);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Could not load website asset");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": staticPath === "/" || staticPath === "/index.html" || staticPath === "/admin.html" ? "no-cache" : "public, max-age=3600"
    });
    response.end(request.method === "HEAD" ? undefined : data);
  });
}

const server = http.createServer(async (request, response) => {
  setSecurityHeaders(response);
  let url;
  try {
    url = new URL(request.url, "http://localhost");
  } catch {
    sendError(response, 400, "Invalid request URL.");
    return;
  }
  if (url.pathname === "/healthz" && request.method === "GET") {
    try {
      await pool.query("SELECT 1");
      const missingAssets = REQUIRED_ASSETS.filter((asset) => !fs.existsSync(path.join(WEBSITE_DIR, asset)));
      sendJson(response, missingAssets.length ? 503 : 200, {
        status: missingAssets.length ? "error" : "ok",
        databaseConnected: true,
        websiteAssetsAvailable: missingAssets.length === 0,
        missingAssets
      });
    } catch (error) {
      console.error(`Health check could not reach PostgreSQL (${error.code || error.message}).`);
      sendJson(response, 503, {
        status: "error",
        databaseConnected: false,
        websiteAssetsAvailable: REQUIRED_ASSETS.every((asset) => fs.existsSync(path.join(WEBSITE_DIR, asset)))
      });
    }
    return;
  }
  if (url.pathname === "/robots.txt" && request.method === "GET") {
    const host = request.headers.host || "";
    const origin = /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host) ? `https://${host}` : "";
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" });
    response.end(`User-agent: *\nAllow: /\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ""}`);
    return;
  }
  if (url.pathname === "/sitemap.xml" && request.method === "GET") {
    const host = request.headers.host || "";
    if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) {
      sendError(response, 400, "A valid website host is required to generate the sitemap.");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" });
    response.end([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      `  <url><loc>https://${host}/</loc></url>`,
      "</urlset>"
    ].join("\n"));
    return;
  }

  try {
    if (await handleApi(request, response, url.pathname, url.searchParams)) return;
    serveStatic(request, response, url.pathname);
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (status >= 500) console.error(`Request failed for ${url.pathname} (${error.code || error.message}).`);
    sendError(response, status, status >= 500 ? "The request could not be completed. Please try again later." : error.message);
  }
});

pool.on("error", (error) => {
  console.error(`Unexpected PostgreSQL pool error (${error.code || error.message}).`);
});

initializeDatabase().then(() => {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`JEFTECH website and backend listening on port ${PORT}.`);
    console.log(`Serving website files from ${WEBSITE_DIR}.`);
  });
}).catch((error) => {
  console.error(`Could not initialize JEFTECH backend (${error.code || error.message}).`);
  process.exitCode = 1;
  pool.end().catch((poolError) => {
    console.error(`Could not close PostgreSQL pool (${poolError.code || poolError.message}).`);
  });
});
