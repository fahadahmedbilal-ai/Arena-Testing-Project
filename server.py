# =====================================================================
# ARENA SURVIVOR 3D - server.py
#
# A small Flask backend that adds real user accounts on top of the
# otherwise-static game in public/. It does three things:
#   1. Serves the game's static files (public/index.html, style.css,
#      script.js) - same job nginx used to do.
#   2. Provides a JSON API for signup/login/logout/session-check
#      (/api/signup, /api/login, /api/logout, /api/me).
#   3. Stores accounts (hashed passwords only) and each account's best
#      score per game mode in a SQLite database.
#
# Nothing here talks to the 3D game itself - script.js calls these
# endpoints with fetch() and only unlocks the game once /api/me confirms
# someone is logged in.
# =====================================================================

import os
import re
import sqlite3
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"

# DB_PATH is overridable via an environment variable so it can point at a
# mounted, persistent volume in production (see fly.toml) instead of the
# container's throwaway filesystem, which is wiped on every deploy/restart.
DB_PATH = Path(os.environ.get("DB_PATH", BASE_DIR / "data" / "arena.db"))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(PUBLIC_DIR), static_url_path="")

# The session cookie is cryptographically signed with this key - anyone who
# knows it could forge a login session, so it must come from the
# environment (a real secret), never be hardcoded in source that ends up in
# a public-ish git repo. Locally, docker-compose.yml sets a dev-only value.
app.secret_key = os.environ.get("SECRET_KEY")
if not app.secret_key:
    raise RuntimeError(
        "SECRET_KEY environment variable must be set - see README for local/dev setup."
    )

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,   # JavaScript can't read the session cookie
    SESSION_COOKIE_SAMESITE="Lax",  # basic cross-site request protection
    # Only send the cookie over HTTPS once deployed - our local dev server
    # runs over plain http://localhost, so this stays off there.
    SESSION_COOKIE_SECURE=os.environ.get("FLASK_ENV") != "development",
)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS scores (
                user_id INTEGER NOT NULL REFERENCES users(id),
                mode TEXT NOT NULL,
                best_score INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, mode)
            )
            """
        )


init_db()

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{3,20}$")
PASSWORD_MIN_LENGTH = 8
VALID_MODES = ("survival", "range")


def credential_error(username, password):
    """Returns a human-readable validation error, or None if both are valid."""
    if not username or not USERNAME_PATTERN.match(username):
        return "Username must be 3-20 characters: letters, numbers, or underscores only."
    if not password or len(password) < PASSWORD_MIN_LENGTH:
        return f"Password must be at least {PASSWORD_MIN_LENGTH} characters."
    return None


def get_scores(user_id):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT mode, best_score FROM scores WHERE user_id = ?", (user_id,)
        ).fetchall()
    return {row["mode"]: row["best_score"] for row in rows}


def start_session(user_id, username):
    session.clear()
    session["user_id"] = user_id
    session["username"] = username


@app.post("/api/signup")
def signup():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    error = credential_error(username, password)
    if error:
        return jsonify({"error": error}), 400

    try:
        with get_db() as conn:
            cursor = conn.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                # Explicit method: werkzeug's default picks scrypt when the
                # local Python's hashlib supports it, which isn't guaranteed
                # across every Python build (it wasn't on the one this was
                # developed on) - pbkdf2:sha256 is a portable, still-strong
                # standard that doesn't depend on that.
                (username, generate_password_hash(password, method="pbkdf2:sha256")),
            )
            user_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        return jsonify({"error": "That username is already taken."}), 409

    start_session(user_id, username)
    return jsonify({"username": username, "scores": {}}), 201


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    with get_db() as conn:
        user = conn.execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()

    # Checking the hash even when no user was found (against a dummy hash)
    # would be the textbook way to avoid a timing side-channel that reveals
    # whether a username exists; skipped here as out of scope for a college
    # project, but noted since it's a real, known simplification.
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Incorrect username or password."}), 401

    start_session(user["id"], user["username"])
    return jsonify({"username": user["username"], "scores": get_scores(user["id"])})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"user": None})
    return jsonify({"username": session.get("username"), "scores": get_scores(user_id)})


@app.post("/api/score")
def submit_score():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not logged in."}), 401

    data = request.get_json(silent=True) or {}
    mode = data.get("mode")
    score = data.get("score")

    if mode not in VALID_MODES or not isinstance(score, int) or score < 0:
        return jsonify({"error": "Invalid score submission."}), 400

    with get_db() as conn:
        existing = conn.execute(
            "SELECT best_score FROM scores WHERE user_id = ? AND mode = ?",
            (user_id, mode),
        ).fetchone()

        if existing is None:
            conn.execute(
                "INSERT INTO scores (user_id, mode, best_score) VALUES (?, ?, ?)",
                (user_id, mode, score),
            )
            best = score
        elif score > existing["best_score"]:
            conn.execute(
                "UPDATE scores SET best_score = ?, updated_at = CURRENT_TIMESTAMP "
                "WHERE user_id = ? AND mode = ?",
                (score, user_id, mode),
            )
            best = score
        else:
            best = existing["best_score"]

    return jsonify({"mode": mode, "best_score": best})


# --- Static file serving (the game itself) ---

@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    # Only used for local development (`python3 server.py`). In production
    # the Dockerfile runs this through gunicorn instead.
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=False)
