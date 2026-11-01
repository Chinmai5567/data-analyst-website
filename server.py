#!/usr/bin/env python3
"""Local Analytics Hub server with SQLite-backed accounts and sessions."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent


def load_local_env():
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(name.strip(), value)


load_local_env()
DATA_DIR = Path(os.environ.get("ANALYTICS_HUB_DATA_DIR", str(ROOT))).expanduser()
if not DATA_DIR.is_absolute():
    DATA_DIR = ROOT / DATA_DIR
DATA_DIR = DATA_DIR.resolve()
DB_PATH = DATA_DIR / ".analytics_hub.sqlite3"
HOST = os.environ.get("ANALYTICS_HUB_HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
SESSION_SECONDS = 60 * 60 * 24 * 14
PBKDF2_ROUNDS = 310_000
COOKIE_SECURE = os.environ.get("ANALYTICS_HUB_COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes"}
TRUSTED_ORIGINS = {origin.strip().rstrip("/") for origin in os.environ.get("ANALYTICS_HUB_ALLOWED_ORIGINS", f"http://127.0.0.1:{PORT},http://localhost:{PORT}").split(",") if origin.strip()}
LOGIN_FAILURE_LIMIT = 5
LOGIN_WINDOW_SECONDS = 15 * 60
login_failures: dict[str, list[int]] = {}
login_lock = threading.Lock()
ADMIN_USERNAME = os.environ.get("ANALYTICS_HUB_ADMIN_USERNAME", "").strip()
ADMIN_PASSWORD = os.environ.get("ANALYTICS_HUB_ADMIN_PASSWORD", "")


def connect_db():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with connect_db() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash BLOB NOT NULL,
            password_salt BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0
        )""")
        existing_columns = {row["name"] for row in db.execute("PRAGMA table_info(users)")}
        for name, definition in (("email", "TEXT NOT NULL DEFAULT ''"), ("recovery_id", "TEXT NOT NULL DEFAULT ''"), ("profile_image", "TEXT NOT NULL DEFAULT ''"), ("is_admin", "INTEGER NOT NULL DEFAULT 0")):
            if name not in existing_columns:
                db.execute(f"ALTER TABLE users ADD COLUMN {name} {definition}")
        db.execute("""CREATE TABLE IF NOT EXISTS sessions (
            token_hash BLOB PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)")
        db.execute("""CREATE TABLE IF NOT EXISTS admin_sessions (
            token_hash BLOB PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at)")
        db.execute("""CREATE TABLE IF NOT EXISTS admin_pro_grants (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            granted_by INTEGER NOT NULL REFERENCES users(id),
            reason TEXT NOT NULL DEFAULT '',
            granted_at INTEGER NOT NULL
        )""")
        db.execute("""CREATE TABLE IF NOT EXISTS admin_access_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id INTEGER NOT NULL REFERENCES users(id),
            target_user_id INTEGER NOT NULL REFERENCES users(id),
            action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
            reason TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL
        )""")
        if ADMIN_USERNAME and ADMIN_PASSWORD:
            if not re.fullmatch(r"[A-Za-z0-9_.-]{3,40}", ADMIN_USERNAME) or len(ADMIN_PASSWORD) < 16:
                raise RuntimeError("Configure a valid admin username and an admin password of at least 16 characters.")
            admin = db.execute("SELECT id FROM users WHERE username=? COLLATE NOCASE", (ADMIN_USERNAME,)).fetchone()
            if admin:
                db.execute("UPDATE users SET is_admin=1 WHERE id=?", (admin["id"],))
            else:
                salt = secrets.token_bytes(16)
                db.execute("INSERT INTO users(username,password_hash,password_salt,created_at,is_admin) VALUES(?,?,?,?,1)",
                           (ADMIN_USERNAME, derive_password(ADMIN_PASSWORD, salt), salt, int(time.time())))
        db.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE is_admin=1)")


def access_state(user_id: int) -> dict:
    with connect_db() as db:
        grant = db.execute("SELECT 1 FROM admin_pro_grants WHERE user_id=?", (user_id,)).fetchone()
    complimentary = bool(grant)
    return {"is_pro": complimentary, "access_type": "complimentary" if complimentary else "free"}


def derive_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if COOKIE_SECURE:
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        super().end_headers()

    def send_json(self, status, payload, cookie=None, clear_cookie=False, cookie_name="ah_session"):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            secure = "; Secure" if COOKIE_SECURE else ""
            self.send_header("Set-Cookie", f"{cookie_name}={cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}{secure}")
        if clear_cookie:
            secure = "; Secure" if COOKIE_SECURE else ""
            self.send_header("Set-Cookie", f"{cookie_name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0{secure}")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            maximum = 2_100_000 if urlparse(self.path).path == "/api/profile" else 8192
            if length > maximum:
                return None
            return json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return None

    def current_user(self):
        cookie = self.headers.get("Cookie", "")
        token = next((part.strip()[11:] for part in cookie.split(";") if part.strip().startswith("ah_session=")), "")
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode("ascii", "ignore")).digest()
        now = int(time.time())
        with connect_db() as db:
            db.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            row = db.execute("SELECT users.id, users.username, users.profile_image, users.is_admin FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>=?", (token_hash, now)).fetchone()
        return dict(row) if row else None

    def current_admin(self):
        cookie = self.headers.get("Cookie", "")
        token = next((part.strip()[17:] for part in cookie.split(";") if part.strip().startswith("ah_admin_session=")), "")
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode("ascii", "ignore")).digest()
        now = int(time.time())
        with connect_db() as db:
            db.execute("DELETE FROM admin_sessions WHERE expires_at < ?", (now,))
            row = db.execute("SELECT users.id,users.username FROM admin_sessions JOIN users ON users.id=admin_sessions.user_id WHERE token_hash=? AND expires_at>=? AND users.is_admin=1", (token_hash, now)).fetchone()
        return dict(row) if row else None

    def do_GET(self):
        route = urlparse(self.path).path
        if route == "/admin":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/admin.html")
            self.end_headers()
            return
        if route == "/api/admin/me":
            admin = self.current_admin()
            return self.send_json(HTTPStatus.OK if admin else HTTPStatus.UNAUTHORIZED, {"admin": admin})
        if route == "/api/me":
            user = self.current_user()
            if user:
                user.update(access_state(user["id"]))
            return self.send_json(HTTPStatus.OK if user else HTTPStatus.UNAUTHORIZED, {"user": user})
        if route == "/api/profile":
            user = self.current_user()
            if not user:
                return self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Please sign in again."})
            with connect_db() as db:
                row = db.execute("SELECT username,email,recovery_id,profile_image FROM users WHERE id=?", (user["id"],)).fetchone()
            return self.send_json(HTTPStatus.OK, {"profile": dict(row)})
        if route == "/api/admin/users":
            admin = self.current_admin()
            if not admin:
                return self.send_json(HTTPStatus.FORBIDDEN, {"error": "Admin access is required."})
            now = int(time.time())
            with connect_db() as db:
                rows = db.execute("""SELECT u.id,u.username,u.email,u.created_at,u.is_admin,
                    EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.expires_at>=?) AS has_session,
                    EXISTS(SELECT 1 FROM admin_pro_grants g WHERE g.user_id=u.id) AS complimentary,
                    (SELECT g.reason FROM admin_pro_grants g WHERE g.user_id=u.id) AS grant_reason
                    FROM users u ORDER BY u.created_at DESC""", (now,)).fetchall()
            users = []
            for row in rows:
                item = dict(row)
                item["access_type"] = "complimentary" if item["complimentary"] else "free"
                item["is_pro"] = bool(item["complimentary"])
                users.append(item)
            return self.send_json(HTTPStatus.OK, {"users": users})
        return super().do_GET()

    def do_POST(self):
        route = urlparse(self.path).path
        if not route.startswith("/api/"):
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        origin = self.headers.get("Origin", "").rstrip("/")
        if origin not in TRUSTED_ORIGINS:
            return self.send_json(HTTPStatus.FORBIDDEN, {"error": "Request origin was not allowed."})
        data = self.read_json()
        if data is None:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid request."})

        grant_match = re.fullmatch(r"/api/admin/users/(\d+)/pro-grant", route)
        if grant_match:
            admin = self.current_admin()
            if not admin:
                return self.send_json(HTTPStatus.FORBIDDEN, {"error": "Admin access is required."})
            target_id = int(grant_match.group(1))
            action = data.get("action")
            if action not in {"grant", "revoke"}:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Choose grant or revoke."})
            reason = str(data.get("reason", "")).strip()[:160]
            with connect_db() as db:
                target = db.execute("SELECT id,is_admin FROM users WHERE id=?", (target_id,)).fetchone()
                if not target:
                    return self.send_json(HTTPStatus.NOT_FOUND, {"error": "User not found."})
                if target["is_admin"]:
                    return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Admin accounts are managed through server settings."})
                if action == "grant":
                    db.execute("INSERT OR REPLACE INTO admin_pro_grants(user_id,granted_by,reason,granted_at) VALUES(?,?,?,?)",
                               (target_id, admin["id"], reason, int(time.time())))
                else:
                    db.execute("DELETE FROM admin_pro_grants WHERE user_id=?", (target_id,))
                db.execute("INSERT INTO admin_access_audit(actor_id,target_user_id,action,reason,created_at) VALUES(?,?,?,?,?)",
                           (admin["id"], target_id, action, reason, int(time.time())))
            return self.send_json(HTTPStatus.OK, {"user_id": target_id, **access_state(target_id)})

        if route == "/api/logout":
            token = next((part.strip()[11:] for part in self.headers.get("Cookie", "").split(";") if part.strip().startswith("ah_session=")), "")
            if token:
                with connect_db() as db:
                    db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode("ascii", "ignore")).digest(),))
            return self.send_json(HTTPStatus.OK, {"ok": True}, clear_cookie=True)

        if route == "/api/admin/logout":
            token = next((part.strip()[17:] for part in self.headers.get("Cookie", "").split(";") if part.strip().startswith("ah_admin_session=")), "")
            if token:
                with connect_db() as db:
                    db.execute("DELETE FROM admin_sessions WHERE token_hash=?", (hashlib.sha256(token.encode("ascii", "ignore")).digest(),))
            return self.send_json(HTTPStatus.OK, {"ok": True}, clear_cookie=True, cookie_name="ah_admin_session")

        if route == "/api/profile":
            user = self.current_user()
            if not user:
                return self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Please sign in again."})
            with connect_db() as db:
                existing = db.execute("SELECT username,email,recovery_id,profile_image,password_hash,password_salt FROM users WHERE id=?", (user["id"],)).fetchone()
            username = str(data.get("username", existing["username"])).strip()
            email = str(data.get("email", existing["email"])).strip()
            recovery_id = str(data.get("recovery_id", existing["recovery_id"])).strip()
            image = str(data.get("profile_image", existing["profile_image"]))
            if not re.fullmatch(r"[A-Za-z0-9_.-]{3,40}", username):
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Username must be 3–40 characters using letters, numbers, periods, underscores, or hyphens."})
            if email and (len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)):
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Enter a valid email address."})
            if len(recovery_id) > 120:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Recovery ID must be 120 characters or fewer."})
            if len(image) > 2_000_000 or (image and not re.fullmatch(r"data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}", image)):
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Choose a PNG, JPG, GIF, or WebP image under 1.5 MB."})
            new_password = data.get("new_password", "")
            with connect_db() as db:
                if new_password:
                    old_password = data.get("current_password", "")
                    if not hmac.compare_digest(bytes(existing["password_hash"]), derive_password(str(old_password), bytes(existing["password_salt"]))):
                        return self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "The current password is incorrect."})
                    if not isinstance(new_password, str) or len(new_password) < 10 or len(new_password) > 256:
                        return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "New password must be between 10 and 256 characters."})
                try:
                    db.execute("UPDATE users SET username=?,email=?,recovery_id=?,profile_image=? WHERE id=?", (username, email, recovery_id, image, user["id"]))
                except sqlite3.IntegrityError:
                    return self.send_json(HTTPStatus.CONFLICT, {"error": "That username is already taken."})
                if new_password:
                    salt = secrets.token_bytes(16)
                    db.execute("UPDATE users SET password_hash=?,password_salt=? WHERE id=?", (derive_password(new_password, salt), salt, user["id"]))
                profile = db.execute("SELECT username,email,recovery_id,profile_image FROM users WHERE id=?", (user["id"],)).fetchone()
            return self.send_json(HTTPStatus.OK, {"profile": dict(profile), "user": {"id": user["id"], "username": username, **access_state(user["id"])}})
        if route not in ("/api/signup", "/api/login", "/api/admin/login"):
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        username = str(data.get("username", "")).strip()
        password = data.get("password", "")
        if not re.fullmatch(r"[A-Za-z0-9_.-]{3,40}", username):
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Use 3–40 characters: letters, numbers, periods, underscores, or hyphens."})
        if not isinstance(password, str) or len(password) < 10 or len(password) > 256:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Password must be between 10 and 256 characters."})

        throttle_key = str(self.client_address[0])
        now = int(time.time())
        with login_lock:
            recent_failures = [stamp for stamp in login_failures.get(throttle_key, []) if stamp > now - LOGIN_WINDOW_SECONDS]
            if route in ("/api/login", "/api/admin/login") and len(recent_failures) >= LOGIN_FAILURE_LIMIT:
                login_failures[throttle_key] = recent_failures
                return self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many sign-in attempts. Try again in 15 minutes."})
            login_failures[throttle_key] = recent_failures
            for ip in list(login_failures):
                if not login_failures[ip]:
                    login_failures.pop(ip, None)

        with connect_db() as db:
            if route == "/api/signup":
                salt = secrets.token_bytes(16)
                try:
                    cursor = db.execute("INSERT INTO users(username,password_hash,password_salt,created_at) VALUES(?,?,?,?)", (username, derive_password(password, salt), salt, int(time.time())))
                except sqlite3.IntegrityError:
                    return self.send_json(HTTPStatus.CONFLICT, {"error": "That username is already taken. Try signing in instead."})
                user = {"id": cursor.lastrowid, "username": username}
            else:
                row = db.execute("SELECT id,username,password_hash,password_salt,is_admin FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
                is_admin_login = route == "/api/admin/login"
                authenticated = row and hmac.compare_digest(bytes(row["password_hash"]), derive_password(password, bytes(row["password_salt"]))) and bool(row["is_admin"]) == is_admin_login
                if not authenticated:
                    if route in ("/api/login", "/api/admin/login"):
                        with login_lock:
                            login_failures.setdefault(throttle_key, []).append(now)
                    message = "Admin username or password is incorrect." if is_admin_login else "Username or password is incorrect."
                    return self.send_json(HTTPStatus.UNAUTHORIZED, {"error": message})
                if route == "/api/login" and row["is_admin"]:
                    return self.send_json(HTTPStatus.FORBIDDEN, {"error": "Use the separate admin portal to sign in."})
                user = {"id": row["id"], "username": row["username"], "is_admin": bool(row["is_admin"])}
            if route in ("/api/login", "/api/admin/login"):
                with login_lock:
                    login_failures.pop(throttle_key, None)
            token = secrets.token_urlsafe(32)
            session_table = "admin_sessions" if route == "/api/admin/login" else "sessions"
            db.execute(f"INSERT INTO {session_table}(token_hash,user_id,expires_at) VALUES(?,?,?)", (hashlib.sha256(token.encode("ascii")).digest(), user["id"], int(time.time()) + SESSION_SECONDS))
        user.update(access_state(user["id"]))
        if route == "/api/admin/login":
            return self.send_json(HTTPStatus.OK, {"admin": {"username": user["username"]}}, cookie=token, cookie_name="ah_admin_session")
        return self.send_json(HTTPStatus.OK, {"user": user}, cookie=token)



if __name__ == "__main__":
    initialize_db()
    print(f"Analytics Hub running at http://{HOST}:{PORT}")
    print(f"Stop the server with Ctrl+C. Account database: {DB_PATH}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
