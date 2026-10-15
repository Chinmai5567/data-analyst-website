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
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / ".analytics_hub.sqlite3"
HOST = os.environ.get("ANALYTICS_HUB_HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
SESSION_SECONDS = 60 * 60 * 24 * 14
PBKDF2_ROUNDS = 310_000


def connect_db():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_db():
    with connect_db() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash BLOB NOT NULL,
            password_salt BLOB NOT NULL,
            created_at INTEGER NOT NULL
        )""")
        existing_columns = {row["name"] for row in db.execute("PRAGMA table_info(users)")}
        for name, definition in (("email", "TEXT NOT NULL DEFAULT ''"), ("recovery_id", "TEXT NOT NULL DEFAULT ''"), ("profile_image", "TEXT NOT NULL DEFAULT ''")):
            if name not in existing_columns:
                db.execute(f"ALTER TABLE users ADD COLUMN {name} {definition}")
        db.execute("""CREATE TABLE IF NOT EXISTS sessions (
            token_hash BLOB PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)")


def derive_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def send_json(self, status, payload, cookie=None, clear_cookie=False):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", f"ah_session={cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECONDS}")
        if clear_cookie:
            self.send_header("Set-Cookie", "ah_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
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
            row = db.execute("SELECT users.id, users.username, users.profile_image FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>=?", (token_hash, now)).fetchone()
        return dict(row) if row else None

    def do_GET(self):
        route = urlparse(self.path).path
        if route == "/api/me":
            user = self.current_user()
            return self.send_json(HTTPStatus.OK if user else HTTPStatus.UNAUTHORIZED, {"user": user})
        if route == "/api/profile":
            user = self.current_user()
            if not user:
                return self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Please sign in again."})
            with connect_db() as db:
                row = db.execute("SELECT username,email,recovery_id,profile_image FROM users WHERE id=?", (user["id"],)).fetchone()
            return self.send_json(HTTPStatus.OK, {"profile": dict(row)})
        return super().do_GET()

    def do_POST(self):
        route = urlparse(self.path).path
        if not route.startswith("/api/"):
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        data = self.read_json()
        if data is None:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid request."})

        if route == "/api/logout":
            token = next((part.strip()[11:] for part in self.headers.get("Cookie", "").split(";") if part.strip().startswith("ah_session=")), "")
            if token:
                with connect_db() as db:
                    db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode("ascii", "ignore")).digest(),))
            return self.send_json(HTTPStatus.OK, {"ok": True}, clear_cookie=True)

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
            return self.send_json(HTTPStatus.OK, {"profile": dict(profile), "user": {"id": user["id"], "username": username}})
        if route not in ("/api/signup", "/api/login"):
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        username = str(data.get("username", "")).strip()
        password = data.get("password", "")
        if not re.fullmatch(r"[A-Za-z0-9_.-]{3,40}", username):
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Use 3–40 characters: letters, numbers, periods, underscores, or hyphens."})
        if not isinstance(password, str) or len(password) < 10 or len(password) > 256:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Password must be between 10 and 256 characters."})

        with connect_db() as db:
            if route == "/api/signup":
                salt = secrets.token_bytes(16)
                try:
                    cursor = db.execute("INSERT INTO users(username,password_hash,password_salt,created_at) VALUES(?,?,?,?)", (username, derive_password(password, salt), salt, int(time.time())))
                except sqlite3.IntegrityError:
                    return self.send_json(HTTPStatus.CONFLICT, {"error": "That username is already taken. Try signing in instead."})
                user = {"id": cursor.lastrowid, "username": username}
            else:
                row = db.execute("SELECT id,username,password_hash,password_salt FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
                if not row or not hmac.compare_digest(bytes(row["password_hash"]), derive_password(password, bytes(row["password_salt"]))):
                    return self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Username or password is incorrect."})
                user = {"id": row["id"], "username": row["username"]}
            token = secrets.token_urlsafe(32)
            db.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", (hashlib.sha256(token.encode("ascii")).digest(), user["id"], int(time.time()) + SESSION_SECONDS))
        return self.send_json(HTTPStatus.OK, {"user": user}, cookie=token)


if __name__ == "__main__":
    initialize_db()
    print(f"Analytics Hub running at http://{HOST}:{PORT}")
    print("Stop the server with Ctrl+C. Local account database: .analytics_hub.sqlite3")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
