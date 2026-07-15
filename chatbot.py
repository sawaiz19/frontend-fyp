from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import requests as http_requests
import os
import base64
import json
import re
import uuid
import random
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

from turso_compat import get_db, get_turso_raw, write_batch, last_insert_rowid

app = Flask(__name__)
CORS(app)

ADMIN_EMAIL = 'sawaiz9898@gmail.com'


def _load_groq_api_keys():
    """Keys from environment only (never commit real keys). GROQ_API_KEY=... or GROQ_API_KEYS=key1,key2."""
    keys = []
    primary = (os.environ.get('GROQ_API_KEY') or '').strip()
    if primary:
        keys.append(primary)
    for part in (os.environ.get('GROQ_API_KEYS') or '').split(','):
        k = part.strip()
        if k and k not in keys:
            keys.append(k)
    return keys


GROQ_API_KEYS = _load_groq_api_keys()
API_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL_NAME = "llama-3.3-70b-versatile"
PROVINCES = ['Punjab', 'KPK', 'Sindh', 'Balochistan']


def _ollama_chat_url():
    base = (os.environ.get('OLLAMA_BASE_URL') or 'http://127.0.0.1:11434').strip().rstrip('/')
    return f"{base}/v1/chat/completions"


OLLAMA_MODEL = (os.environ.get('OLLAMA_MODEL') or 'llama3.2:1b').strip()
# Groq cloud analytics JSON cap (env name kept for backward compatibility).
GROQ_GRAPH_MAX_TOKENS = int(os.environ.get('OLLAMA_GRAPH_MAX_TOKENS') or '3072')
OLLAMA_GRAPH_MAX_TOKENS = GROQ_GRAPH_MAX_TOKENS
# Local Ollama analytics text summary cap.
OLLAMA_GRAPH_LOCAL_MAX_TOKENS = int(os.environ.get('OLLAMA_GRAPH_LOCAL_MAX_TOKENS') or '1400')


def normalize_llm_provider(val):
    if val is None:
        return 'groq'
    s = str(val).lower().strip()
    return 'local' if s == 'local' else 'groq'


def ollama_call(messages, temperature=0.3, max_tokens=1024, read_timeout_sec=None):
    """OpenAI-compatible chat completions (Ollama default: http://127.0.0.1:11434/v1)."""
    url = _ollama_chat_url()
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    # Connect can hang if Ollama is down; read can exceed 120s for large max_tokens on CPU.
    if read_timeout_sec is None:
        read_timeout_sec = max(150.0, min(600.0, 90.0 + float(max_tokens) * 0.12))
    timeout = (15.0, read_timeout_sec)
    r = http_requests.post(url, json=payload, timeout=timeout)
    r.raise_for_status()
    body = r.json()
    return body["choices"][0]["message"]["content"]


def _is_groq_retryable_error(err):
    """True for rate limits, quota exhaustion, and context-length errors."""
    s = str(err).lower()
    return any(x in s for x in (
        '429', 'rate limit', 'rate_limit', 'quota', 'too many requests',
        'tokens per', 'token limit', 'context length', 'maximum context',
        'insufficient_quota', 'billing', 'limit exceeded',
    ))


def _llm_fallback_notice(fallback_reason=None):
    if fallback_reason == 'rate_limit':
        return "Groq API limit reached — switched to local Ollama."
    return "Using local Ollama — Groq was unavailable."


def llm_complete(messages, temperature=0.3, max_tokens=1024, preference='groq', user_api_key=None):
    """
    preference 'groq': use Groq when possible; on any failure fall back to Ollama.
    preference 'local': Ollama only (no Groq).
    user_api_key: optional per-user Groq API key (tried first before system keys).
    Returns dict: content, backend ('groq'|'local'), used_fallback (bool), fallback_reason.
    """
    pref = normalize_llm_provider(preference)
    if pref == 'local':
        content = ollama_call(messages, temperature, max_tokens)
        return {"content": content, "backend": "local", "used_fallback": False, "fallback_reason": None}
    try:
        content = groq_call(messages, temperature, max_tokens, user_api_key=user_api_key)
        return {"content": content, "backend": "groq", "used_fallback": False, "fallback_reason": None}
    except Exception as groq_err:
        fallback_reason = 'rate_limit' if _is_groq_retryable_error(groq_err) else 'error'
        try:
            content = ollama_call(messages, temperature, max_tokens)
            return {
                "content": content,
                "backend": "local",
                "used_fallback": True,
                "fallback_reason": fallback_reason,
            }
        except Exception as local_err:
            raise Exception(
                f"Groq failed ({groq_err}). Local Ollama failed ({local_err}). "
                "Check GROQ_API_KEY, and that Ollama is running with model "
                f"{OLLAMA_MODEL!r} (set OLLAMA_MODEL / OLLAMA_BASE_URL if needed)."
            ) from local_err

# =========================================================
#  DATABASE  (Turso / LibSQL over HTTPS — see turso_compat.py)
# =========================================================
def init_db():
    conn = get_db()
    c = conn.cursor()

    # Users table (preserve existing)
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_id TEXT, username TEXT, email TEXT, name TEXT, picture TEXT,
        password_hash TEXT, role TEXT DEFAULT 'user',
        approved INTEGER DEFAULT 0, pending_admin INTEGER DEFAULT 0,
        last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    existing_cols = [row[1] for row in c.execute("PRAGMA table_info(users)").fetchall()]
    for col, defn in [('role',"TEXT DEFAULT 'user'"),('pending_admin',"INTEGER DEFAULT 0"),
                      ('picture',"TEXT"),('approved',"INTEGER DEFAULT 0"),
                      ('username',"TEXT"),('password_hash',"TEXT"),
                      ('groq_api_key',"TEXT"),('use_own_groq_key',"INTEGER DEFAULT 0")]:
        if col not in existing_cols:
            c.execute(f"ALTER TABLE users ADD COLUMN {col} {defn}")
    c.execute("UPDATE users SET role='admin', approved=1 WHERE email=?", (ADMIN_EMAIL,))

    # Chemicals table
    c.execute('''CREATE TABLE IF NOT EXISTS chemicals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, formula TEXT, province TEXT NOT NULL,
        amount_kg REAL DEFAULT 0, min_threshold REAL DEFAULT 50,
        concentration_pct REAL DEFAULT 100,
        price_per_kg REAL DEFAULT 0, quantity_sold REAL DEFAULT 0,
        category TEXT DEFAULT 'General', description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    chem_cols = [row[1] for row in c.execute("PRAGMA table_info(chemicals)").fetchall()]
    if 'min_threshold' not in chem_cols:
        c.execute("ALTER TABLE chemicals ADD COLUMN min_threshold REAL DEFAULT 50")

    # Deliveries table
    c.execute('''CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chemical_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
        assigned_by_id INTEGER, province TEXT NOT NULL, quantity_kg REAL NOT NULL,
        status TEXT DEFAULT 'ordered', tracking_code TEXT, notes TEXT,
        notified INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    # Migrate deliveries table columns if needed
    del_cols = [row[1] for row in c.execute("PRAGMA table_info(deliveries)").fetchall()]
    if 'assigned_by_id' not in del_cols:
        c.execute("ALTER TABLE deliveries ADD COLUMN assigned_by_id INTEGER")
    if 'notified' not in del_cols:
        c.execute("ALTER TABLE deliveries ADD COLUMN notified INTEGER DEFAULT 0")
    if 'delivery_lat' not in del_cols:
        c.execute("ALTER TABLE deliveries ADD COLUMN delivery_lat REAL")
    if 'delivery_lng' not in del_cols:
        c.execute("ALTER TABLE deliveries ADD COLUMN delivery_lng REAL")
    if 'delivery_location_name' not in del_cols:
        c.execute("ALTER TABLE deliveries ADD COLUMN delivery_location_name TEXT")

    # Feedback table
    c.execute('''CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        delivery_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
        text_feedback TEXT, sentiment_score REAL,
        sentiment_label TEXT, sentiment_justification TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    # Sales analytics table
    c.execute('''CREATE TABLE IF NOT EXISTS chemical_sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chemical_id INTEGER NOT NULL, province TEXT NOT NULL,
        quantity_sold REAL NOT NULL, revenue REAL NOT NULL,
        sale_date TEXT NOT NULL
    )''')

    # Persistent notifications table
    c.execute('''CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        dismissed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    conn.commit()

    # Seed chemicals if empty
    c.execute("SELECT COUNT(*) as cnt FROM chemicals")
    if c.fetchone()['cnt'] == 0:
        seeds = [
            ('Sulfuric Acid','H2SO4','Punjab',500,98.0,45.0,0,'Acids','Industrial grade sulfuric acid for chemical processing'),
            ('Sodium Hydroxide','NaOH','Punjab',300,99.0,30.0,0,'Bases','High purity caustic soda pellets'),
            ('Phosphoric Acid','H3PO4','Punjab',320,85.0,60.0,0,'Acids','Food grade phosphoric acid'),
            ('Hydrochloric Acid','HCl','KPK',200,37.0,25.0,0,'Acids','Analytical grade hydrochloric acid'),
            ('Ethanol','C2H5OH','KPK',400,95.0,55.0,0,'Solvents','Industrial ethanol for pharmaceutical use'),
            ('Isopropanol','C3H8O','KPK',180,99.7,48.0,0,'Solvents','High purity isopropyl alcohol'),
            ('Potassium Permanganate','KMnO4','Sindh',150,99.5,120.0,0,'Oxidizers','Technical grade oxidizing agent'),
            ('Ammonia Solution','NH3','Sindh',250,25.0,20.0,0,'Bases','Aqueous ammonia solution for industrial use'),
            ('Sodium Bicarbonate','NaHCO3','Sindh',600,99.0,12.0,0,'Bases','Pharmaceutical grade baking soda'),
            ('Calcium Carbonate','CaCO3','Balochistan',800,99.0,8.0,0,'Minerals','Food grade calcium carbonate powder'),
            ('Acetone','C3H6O','Balochistan',180,99.8,40.0,0,'Solvents','Laboratory and industrial grade acetone'),
            ('Magnesium Sulfate','MgSO4','Balochistan',350,98.0,22.0,0,'Minerals','Agricultural grade Epsom salt'),
        ]
        c.executemany(
            "INSERT INTO chemicals (name,formula,province,amount_kg,concentration_pct,price_per_kg,quantity_sold,category,description) VALUES (?,?,?,?,?,?,?,?,?)",
            seeds,
        )
        conn.commit()

        # Seed 90 days of sales data
        c.execute("SELECT id, price_per_kg, province FROM chemicals")
        chems = c.fetchall()
        base = datetime.now() - timedelta(days=90)
        for i in range(90):
            for _ in range(random.randint(1,3)):
                ch = random.choice(chems)
                qty = round(random.uniform(5, 200), 2)
                date = (base + timedelta(days=i)).strftime('%Y-%m-%d')
                c.execute("INSERT INTO chemical_sales (chemical_id,province,quantity_sold,revenue,sale_date) VALUES (?,?,?,?,?)",
                          (ch['id'], ch['province'], qty, round(qty * ch['price_per_kg'], 2), date))
        conn.commit()

    conn.close()

init_db()

# =========================================================
#  HELPERS
# =========================================================
def decode_google_jwt(jwt_token):
    try:
        parts = jwt_token.split('.')
        if len(parts) != 3: return None
        payload = parts[1]
        payload += '=' * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload).decode('utf-8'))
    except Exception:
        return None

def groq_call(messages, temperature=0.3, max_tokens=1024, user_api_key=None, timeout_sec=None):
    # Build the key list: user key first (if provided), then system keys
    keys_to_try = []
    if user_api_key:
        keys_to_try.append(('user', user_api_key))
    for k in GROQ_API_KEYS:
        keys_to_try.append(('system', k))

    if not keys_to_try:
        raise Exception(
            'No Groq API key configured. Add GROQ_API_KEY to your .env file '
            '(create a key at https://console.groq.com/keys).'
        )
    if timeout_sec is None:
        timeout_sec = 30 if max_tokens <= 1024 else min(90, 30 + max_tokens // 64)

    last_err = None
    rate_limited = False
    for i, (source, api_key) in enumerate(keys_to_try):
        try:
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {"model": MODEL_NAME, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
            r = http_requests.post(API_URL, headers=headers, json=payload, timeout=timeout_sec)
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]
        except Exception as e:
            last_err = e
            if _is_groq_retryable_error(e):
                rate_limited = True
            print(f"API key [{source}] index {i} failed ({e}), trying next key if available...")

    hint = ''
    if last_err and '401' in str(last_err):
        hint = ' Groq returned 401: key missing, wrong, or revoked — check your API key.'
    elif rate_limited:
        hint = ' Groq rate or token limit reached on all available keys.'
    raise Exception(
        f"All {len(keys_to_try)} API key(s) failed. Last error: {last_err}.{hint}"
    )

def is_admin_by_id(user_id):
    if not user_id: return False
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT role FROM users WHERE id=?", (user_id,))
    row = c.fetchone(); conn.close()
    return row and row['role'] == 'admin'

def is_admin(google_id):
    if not google_id: return False
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT role FROM users WHERE google_id=?", (google_id,))
    row = c.fetchone(); conn.close()
    return row and row['role'] == 'admin'

def is_regional_admin_by_id(user_id):
    if not user_id: return False
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT role FROM users WHERE id=?", (user_id,))
    row = c.fetchone(); conn.close()
    return row and row['role'] == 'regional_admin'

def is_admin_or_regional(user_id, google_id=None):
    """Returns True for admins and regional admins."""
    if is_admin_by_id(user_id): return True
    if google_id and is_admin(google_id): return True
    return is_regional_admin_by_id(user_id)

def _insert_notification(conn, user_id, notif_type, title, body):
    """Insert a persistent notification for a single user."""
    try:
        c = conn.cursor()
        c.execute(
            "INSERT INTO notifications (user_id, type, title, body) VALUES (?,?,?,?)",
            (user_id, notif_type, title, body)
        )
        conn.commit()
    except Exception as e:
        print(f"[notify] insert error: {e}")

def _check_low_stock_notify(chemical_id):
    """After stock depletion, notify all admins & regional admins if chemical drops below threshold."""
    try:
        conn = get_db(); c = conn.cursor()
        c.execute("SELECT name, province, amount_kg, min_threshold FROM chemicals WHERE id=?", (chemical_id,))
        chem = c.fetchone()
        if not chem:
            conn.close(); return
        threshold = chem['min_threshold'] if chem['min_threshold'] is not None else 50.0
        if chem['amount_kg'] < threshold:
            title = f"⚠ Low Stock: {chem['name']}"
            body = (f"{chem['name']} ({chem['province']}) is now at "
                    f"{round(chem['amount_kg'], 1)} kg — below the "
                    f"{round(threshold, 1)} kg threshold. Restock soon.")
            # Notify all admins
            c.execute("SELECT id FROM users WHERE role='admin' AND approved=1")
            admin_ids = [r['id'] for r in c.fetchall()]
            # Notify regional admins of the same province
            c.execute(
                "SELECT DISTINCT u.id FROM users u WHERE u.role='regional_admin' AND u.approved=1",
            )
            reg_ids = [r['id'] for r in c.fetchall()]
            all_ids = list(set(admin_ids + reg_ids))
            for uid in all_ids:
                c.execute(
                    "INSERT INTO notifications (user_id, type, title, body) VALUES (?,?,?,?)",
                    (uid, 'low_stock', title, body)
                )
            conn.commit()
        conn.close()
    except Exception as e:
        print(f"[low_stock_notify] error: {e}")

def user_to_dict(row):
    if not row: return None
    return {"user_id": row['id'], "google_id": row['google_id'] or '',
            "username": row['username'] or '', "email": row['email'] or '',
            "name": row['name'] or row['username'] or 'Unknown',
            "picture": row['picture'] or '', "role": row['role'] or 'user',
            "approved": bool(row['approved']), "pending_admin": bool(row['pending_admin']),
            "login_type": 'google' if row['google_id'] else 'manual'}

def get_auth_user(data):
    """Returns user_id from request body (caller_id)."""
    return data.get('caller_id') or data.get('user_id')

def _get_user_groq_key(caller_id):
    """Return the user's personal Groq API key if they have one enabled, else None."""
    if not caller_id:
        return None
    try:
        conn = get_db(); c = conn.cursor()
        c.execute("SELECT groq_api_key, use_own_groq_key FROM users WHERE id=?", (caller_id,))
        row = c.fetchone(); conn.close()
        if row and row['use_own_groq_key'] and row['groq_api_key']:
            return row['groq_api_key'].strip()
    except Exception as e:
        print(f"[_get_user_groq_key] error: {e}")
    return None

# =========================================================
#  LEGACY HTML ROUTE
# =========================================================
html_form = """<!doctype html><title>Chatbot</title><h2>Ask!</h2><form method="post">
<input name="question" style="width:300px;" autofocus required><button>Ask</button></form>
{% if response %}<h3>Response:</h3><p>{{ response }}</p>{% endif %}"""

@app.route("/", methods=["GET","POST"])
def chat():
    response = None
    if request.method == "POST":
        q = request.form["question"]
        try:
            out = llm_complete([{"role": "user", "content": q}], temperature=0.3, max_tokens=1024, preference='groq')
            response = out["content"]
        except Exception as e:
            response = f"Error: {e}"
    return render_template_string(html_form, response=response)

# =========================================================
#  CHAT API  —  DB-aware system prompt
# =========================================================

def fetch_key_metrics(c):
    """Compact aggregate stats — always injected so models can answer count/total questions."""
    c.execute("SELECT COUNT(*) as total FROM users WHERE approved=1")
    approved_users = c.fetchone()['total']
    c.execute("SELECT COUNT(*) as total FROM users WHERE role='admin'")
    admin_count = c.fetchone()['total']
    c.execute("SELECT COUNT(*) as cnt FROM chemicals")
    chemical_count = c.fetchone()['cnt']
    c.execute("SELECT SUM(quantity_sold) as qty, SUM(revenue) as rev, COUNT(*) as txn_count FROM chemical_sales")
    sales_row = c.fetchone()
    total_kg_sold = round(sales_row['qty'] or 0, 2)
    total_revenue = round(sales_row['rev'] or 0, 2)
    sale_txn_count = sales_row['txn_count'] or 0
    c.execute("""SELECT ch.name, ch.formula, ch.province, ch.category,
                        SUM(cs.quantity_sold) as kg_sold, SUM(cs.revenue) as revenue_PKR
                 FROM chemical_sales cs JOIN chemicals ch ON cs.chemical_id=ch.id
                 GROUP BY ch.id ORDER BY kg_sold DESC""")
    sales_by_chemical = [
        {k: (round(v, 2) if isinstance(v, float) else v) for k, v in dict(r).items()}
        for r in c.fetchall()
    ]
    c.execute("SELECT status, COUNT(*) as cnt FROM deliveries GROUP BY status")
    deliveries_by_status = {r['status']: r['cnt'] for r in c.fetchall()}
    c.execute("SELECT COUNT(*) as cnt FROM deliveries")
    total_deliveries = c.fetchone()['cnt']
    c.execute("SELECT province, COUNT(*) as cnt FROM deliveries GROUP BY province")
    deliveries_by_province = {r['province']: r['cnt'] for r in c.fetchall()}
    c.execute("SELECT COUNT(*) as cnt, AVG(sentiment_score) as avg_sent FROM feedback")
    fb_row = c.fetchone()
    feedback_count = fb_row['cnt'] or 0
    avg_sentiment = round(fb_row['avg_sent'] or 0, 3)
    c.execute("""SELECT d.province, AVG(f.sentiment_score) as avg_sent
                 FROM feedback f JOIN deliveries d ON f.delivery_id=d.id GROUP BY d.province""")
    sentiment_by_province = {r['province']: round(r['avg_sent'], 3) for r in c.fetchall()}
    c.execute("""SELECT name, province, amount_kg, min_threshold, quantity_sold
                 FROM chemicals WHERE amount_kg < min_threshold ORDER BY amount_kg ASC""")
    low_stock = [dict(r) for r in c.fetchall()]
    c.execute("SELECT province, SUM(revenue) as rev, SUM(quantity_sold) as qty FROM chemical_sales GROUP BY province")
    provincial_sales = {
        r['province']: {"revenue_PKR": round(r['rev'], 2), "kg_sold": round(r['qty'], 2)}
        for r in c.fetchall()
    }
    return {
        "company": "ChemTech Pakistan — chemical distribution across Punjab, KPK, Sindh, Balochistan",
        "approved_users": approved_users,
        "admin_count": admin_count,
        "chemicals_in_catalog": chemical_count,
        "total_kg_sold_all_time": total_kg_sold,
        "total_revenue_PKR_all_time": total_revenue,
        "sale_transaction_count": sale_txn_count,
        "sales_by_chemical": sales_by_chemical,
        "provincial_sales": provincial_sales,
        "total_deliveries": total_deliveries,
        "deliveries_by_status": deliveries_by_status,
        "deliveries_by_province": deliveries_by_province,
        "feedback_entries": feedback_count,
        "avg_sentiment_score_0_to_1": avg_sentiment,
        "sentiment_by_province": sentiment_by_province,
        "low_stock_alerts": low_stock,
    }


def build_ground_truth_block(query, metrics):
    """
    Pre-computed authoritative answers from SQL aggregates.
    Injected into all AI features so Groq and Ollama cite the same figures.
    """
    q = (query or '').lower()
    if not q or not metrics:
        return ""
    lines = []
    prov_sales = metrics.get('provincial_sales') or {}
    provinces = ['Punjab', 'KPK', 'Sindh', 'Balochistan']

    if any(k in q for k in (
        'how many kg', 'how much kg', 'total kg', 'kg sold', 'kilogram',
        'how much did we sell', 'how much have we sold', 'quantity sold', 'how much sold',
    )):
        lines.append(f"Total kg sold (all time): {metrics.get('total_kg_sold_all_time', 0):,.1f} kg")

    if any(k in q for k in (
        'total revenue', 'how much revenue', 'revenue total', 'pkr total',
        'how much money', 'sales revenue', 'total sales',
    )):
        lines.append(f"Total revenue (all time): PKR {metrics.get('total_revenue_PKR_all_time', 0):,.0f}")

    if any(k in q for k in ('how many chemical', 'chemicals in catalog', 'how many product', 'products in catalog')):
        lines.append(f"Chemicals in catalog: {metrics.get('chemicals_in_catalog', 0)}")

    if any(k in q for k in ('how many deliver', 'total deliver', 'number of deliver', 'delivery count')):
        lines.append(f"Total deliveries: {metrics.get('total_deliveries', 0)}")

    if any(k in q for k in ('how many feedback', 'how many review', 'feedback count')):
        lines.append(f"Feedback entries: {metrics.get('feedback_entries', 0)}")

    if any(k in q for k in ('transaction', 'how many sale', 'sale count')):
        lines.append(f"Sale transactions: {metrics.get('sale_transaction_count', 0)}")

    if any(k in q for k in (
        'highest revenue', 'most revenue', 'top province', 'best province',
        'which province', 'leading province',
    )):
        if prov_sales:
            top = max(provinces, key=lambda p: prov_sales.get(p, {}).get('revenue_PKR', 0))
            rev = prov_sales.get(top, {}).get('revenue_PKR', 0)
            kg = prov_sales.get(top, {}).get('kg_sold', 0)
            lines.append(f"Highest-revenue province: {top} — PKR {rev:,.0f}, {kg:,.1f} kg sold")

    if any(k in q for k in (
        'lowest revenue', 'worst province', 'underperform', 'weakest province', 'least revenue',
    )):
        if prov_sales:
            bottom = min(provinces, key=lambda p: prov_sales.get(p, {}).get('revenue_PKR', 0))
            rev = prov_sales.get(bottom, {}).get('revenue_PKR', 0)
            kg = prov_sales.get(bottom, {}).get('kg_sold', 0)
            lines.append(f"Lowest-revenue province: {bottom} — PKR {rev:,.0f}, {kg:,.1f} kg sold")

    if any(k in q for k in (
        'top chemical', 'best selling', 'top selling', 'most popular',
        'highest selling', 'best seller',
    )):
        sbc = metrics.get('sales_by_chemical') or []
        if sbc:
            top = sbc[0]
            lines.append(
                f"Top-selling chemical by kg: {top.get('name')} — "
                f"{top.get('kg_sold', 0):,.1f} kg, PKR {top.get('revenue_PKR', 0):,.0f}"
            )

    if any(k in q for k in ('sentiment', 'satisfaction', 'customer happy', 'avg sentiment')):
        avg = metrics.get('avg_sentiment_score_0_to_1', 0)
        lines.append(f"Average customer sentiment: {avg:.2f} (scale 0–1)")

    if any(k in q for k in ('low stock', 'below threshold', 'restock', 'out of stock')):
        low = metrics.get('low_stock_alerts') or []
        if low:
            names = ', '.join(r.get('name', '?') for r in low[:5])
            lines.append(f"Chemicals below minimum threshold ({len(low)} total): {names}")

    if not lines:
        return ""
    return (
        "AUTHORITATIVE PRE-COMPUTED ANSWERS (use these exact figures — never invent different numbers):\n"
        + "\n".join(f"- {line}" for line in lines)
    )


def ground_truth_summary_lines(ground_truth_block):
    """Turn a ground-truth block into a concise plain-text summary."""
    if not ground_truth_block:
        return ""
    lines = [
        ln.lstrip('- ').strip()
        for ln in ground_truth_block.split('\n')[1:]
        if ln.strip() and not ln.strip().startswith('AUTHORITATIVE')
    ]
    return '. '.join(lines[:5])


def _analytics_query_flags(query):
    """Classify analytics query intent for deterministic table selection."""
    qlo = (query or '').lower()

    def _qhas(*kws):
        return any(k in qlo for k in kws)

    return {
        'is_competitor': _qhas(
            'competitor', 'market', 'industry', 'compare', 'vs ', 'ici',
            'nimir', 'sitara', 'engro', 'rival', 'global', 'extern',
        ),
        'is_delivery': _qhas('deliver', 'shipment', 'order', 'transit', 'status', 'track', 'ship'),
        'is_sentiment': _qhas('sentiment', 'feedback', 'review', 'satisf', 'customer', 'rating', 'opinion'),
        'is_trend': _qhas('trend', 'month', 'growth', 'forecast', 'over time', 'period', 'annual', 'quarter', 'historic'),
        'is_inventory': _qhas('stock', 'inventor', 'available', 'level', 'remain', 'supply', 'storage'),
        'is_chemical': _qhas('chem', 'product', 'popular', 'sell', 'formula', 'compound', 'sku') and not _qhas(
            'competitor', 'market', 'industry',
        ),
        'is_underperf': _qhas('underperform', 'worst', 'lowest', 'weak', 'poor', 'least', 'bottom', 'lag', 'behind'),
        'is_totals': _qhas('how many', 'how much', 'total', 'count', 'sold', 'overall', 'company wide', 'nationwide'),
    }


def build_db_context(compact=False):
    """Pull a live database snapshot. compact=True trims detail for small local models."""
    try:
        conn = get_db()
        c = conn.cursor()
        context_parts = ["=== CHEMTECH PAKISTAN — LIVE DATABASE SNAPSHOT ===\n"]
        metrics = fetch_key_metrics(c)
        context_parts.append(f"KEY METRICS (authoritative totals — use these for count/how-many/total questions):\n{json.dumps(metrics, indent=2)}\n")

        chem_limit = 12 if compact else None
        chem_sql = (
            "SELECT name, formula, province, category, amount_kg, min_threshold, "
            "concentration_pct, price_per_kg, quantity_sold, description FROM chemicals ORDER BY province, name"
        )
        if chem_limit:
            chem_sql += f" LIMIT {chem_limit}"
        c.execute(chem_sql)
        chemicals = [dict(r) for r in c.fetchall()]
        c.execute("SELECT COUNT(*) as cnt FROM chemicals")
        total_chems = c.fetchone()['cnt']
        inv_note = f" (showing {len(chemicals)} of {total_chems})" if compact and total_chems > len(chemicals) else ""
        context_parts.append(f"CHEMICAL INVENTORY{inv_note}:\n{json.dumps(chemicals, indent=2)}\n")

        monthly_limit = 8 if compact else 16
        top_limit = 6 if compact else 10
        c.execute(
            f"""SELECT strftime('%Y-%m', sale_date) as month, province,
                       SUM(revenue) as rev, SUM(quantity_sold) as qty
                FROM chemical_sales GROUP BY month, province ORDER BY month DESC LIMIT {monthly_limit}"""
        )
        monthly = [dict(r) for r in c.fetchall()]
        c.execute(
            f"""SELECT ch.name, ch.formula, ch.category, ch.province,
                       SUM(cs.revenue) as total_rev, SUM(cs.quantity_sold) as total_qty
                FROM chemical_sales cs JOIN chemicals ch ON cs.chemical_id=ch.id
                GROUP BY ch.name ORDER BY total_rev DESC LIMIT {top_limit}"""
        )
        top_chems = [dict(r) for r in c.fetchall()]
        c.execute(
            """SELECT ch.category, SUM(cs.revenue) as rev, SUM(cs.quantity_sold) as qty
               FROM chemical_sales cs JOIN chemicals ch ON cs.chemical_id=ch.id
               GROUP BY ch.category ORDER BY rev DESC"""
        )
        categories = [dict(r) for r in c.fetchall()]
        context_parts.append(f"TOP CHEMICALS BY REVENUE:\n{json.dumps(top_chems, indent=2)}\n")
        context_parts.append(f"CATEGORY REVENUE BREAKDOWN:\n{json.dumps(categories, indent=2)}\n")
        context_parts.append(f"RECENT MONTHLY TRENDS (latest first):\n{json.dumps(monthly, indent=2)}\n")

        del_limit = 25 if compact else 100
        c.execute(
            f"""SELECT d.id, c.name as chemical, d.province, d.quantity_kg, d.status,
                       d.tracking_code, d.created_at, d.delivery_location_name,
                       u.name as user_name, u.username, u.email
                FROM deliveries d
                JOIN chemicals c ON d.chemical_id=c.id JOIN users u ON d.user_id=u.id
                ORDER BY d.created_at DESC LIMIT {del_limit}"""
        )
        deliveries = []
        for d in c.fetchall():
            row = dict(d)
            row['user_identifier'] = row.get('email') or row.get('username') or row.get('user_name')
            deliveries.append(row)
        context_parts.append(f"RECENT DELIVERIES ({len(deliveries)} shown, {metrics['total_deliveries']} total):\n{json.dumps(deliveries, indent=2)}\n")

        fb_limit = 15 if compact else 100
        c.execute(
            f"""SELECT f.text_feedback, f.sentiment_label, f.sentiment_score,
                       u.name as user_name, u.username, u.email,
                       ch.name as chemical, d.province, f.created_at
                FROM feedback f JOIN users u ON f.user_id=u.id
                JOIN deliveries d ON f.delivery_id=d.id JOIN chemicals ch ON d.chemical_id=ch.id
                ORDER BY f.created_at DESC LIMIT {fb_limit}"""
        )
        feedback = []
        for f in c.fetchall():
            row = dict(f)
            row['user_identifier'] = row.get('email') or row.get('username') or row.get('user_name')
            feedback.append(row)
        context_parts.append(
            f"CUSTOMER FEEDBACK ({len(feedback)} shown, {metrics['feedback_entries']} total):\n{json.dumps(feedback, indent=2)}\n"
        )

        conn.close()
        return "\n".join(context_parts)
    except Exception as e:
        return f"[DB context unavailable: {e}]"


def build_chat_system_prompt(db_context, user_context, provider='groq'):
    """Tailored system prompts — Groq gets full analyst depth; local gets concise, data-grounded rules."""
    if normalize_llm_provider(provider) == 'local':
        return f"""You are ChemTech AI — the on-device assistant for ChemTech Pakistan (chemical distribution).

You have LIVE database access below. Treat KEY METRICS and sales_by_chemical as the source of truth for totals, counts, and kg sold.

{db_context}
{user_context}

RULES:
1. Use ONLY numbers from the DATABASE. For "how many chemicals sold" use total_kg_sold_all_time or sales_by_chemical — never guess.
2. If data is missing, say "That isn't in our records" — do not invent figures.
3. Answer in 3–6 short sentences OR 3–5 bullet points. Lead with the direct answer.
4. For vague or silly questions, reason step-by-step from the data you have (e.g. compare provinces, name top chemical).
5. Flag low_stock_alerts from KEY METRICS if relevant.
6. End with one practical next step when helpful."""

    return f"""You are ChemTech AI — the intelligent operations assistant for ChemTech Pakistan, a chemical distribution company.
You have FULL, LIVE access to ChemTech's database. KEY METRICS contains authoritative totals — always use these for count, total, and "how many" questions (e.g. total_kg_sold_all_time, chemicals_in_catalog, sale_transaction_count).

{db_context}
{user_context}

BEHAVIOUR RULES:
1. DATA-FIRST: Every PKR figure, kg quantity, and count must come from the DATABASE unless clearly labeled as inference or industry context.
2. NARRATIVE FINANCIAL COMMENTARY: Write like a senior business analyst. For every metric:
   - State what it means operationally.
   - Compare to something else in the data (ratio, rank, trend).
   - End with what action the number implies.
3. CONFIDENCE-TIERED LANGUAGE:
   - Direct DB fact: state as absolute ("Total kg sold: X").
   - Aggregation: "Based on the data, this works out to..."
   - Inference: "This pattern suggests..." — never present inference as fact.
4. DYNAMIC FORMATTING by question type:
   - Comparison: ranked list with % differences.
   - Status: clear status line, then timeline.
   - Trend: headline number, delta, biggest driver.
   - Diagnostic: root cause → evidence → action.
   - Simple/count: one-line answer with the exact number, then brief context.
5. PROACTIVE ANOMALY CALLOUTS: After answering, scan for:
   - Chemicals below min_threshold (see low_stock_alerts).
   - Deliveries stuck in same status 3+ days.
   - Sentiment below 0.35.
   If found, append "🚨 Unsolicited Alert" with specifics.
6. USER IDENTITY: Use exact user_identifier (email/username) to avoid name collisions.
7. REASONING: For vague or off-topic questions, bridge logically to relevant ChemTech data rather than refusing.
8. If NOT in the database, say so clearly; then offer general knowledge only if useful, labeled as non-DB."""


@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json()
    if not data or "question" not in data:
        return jsonify({"error": "Missing question"}), 400

    pref = normalize_llm_provider(data.get("llm_provider"))
    conn = get_db()
    c = conn.cursor()
    metrics = fetch_key_metrics(c)
    conn.close()
    ground_truth = build_ground_truth_block(data["question"], metrics)
    db_context = build_db_context(compact=(pref == 'local'))
    
    # Optional Caller Context
    caller_id = data.get("caller_id")
    role = data.get("role", "user")
    name = data.get("name", "Unknown")
    province = data.get("province", "None")
    
    # Role-based persona block
    if role == "admin" or role == "regional_admin":
        tone_instructions = """
    Tone: Executive CFO Analyst. Lead with the KPI, follow with the insight.
    Skip pleasantries. Use precise PKR figures. Bullet key findings.
    Max 3 sentences before the data. End with one bold recommendation.
    """
    else:
        tone_instructions = """
    Tone: Helpful, human, and proactive. This person cares about their order, not company financials.
    Use plain language. If there's a problem, acknowledge it empathetically before explaining.
    Always end with a clear 'what happens next' statement.
    """

    user_context = ""
    if caller_id:
        try:
            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT d.chemical_id, c.name, d.status, d.quantity_kg FROM deliveries d JOIN chemicals c ON d.chemical_id=c.id WHERE d.user_id=?", (caller_id,))
            user_dels = c.fetchall()
            conn.close()
            
            d_list = [f"  - {d['quantity_kg']}kg of {d['name']} (Status: {d['status'].replace('_', ' ')})" for d in user_dels]
            user_context = f"""
=== CURRENT USER PROFILE ===
You are speaking with: {name} (Role: {role}, Region: {province})
Their recent interaction history mapping:
{chr(10).join(d_list) if d_list else "  - No recent orders found."}
* If they ask about "my orders", refer ONLY to these deliveries. 
{tone_instructions}
"""
        except Exception:
            pass

    system_prompt = build_chat_system_prompt(db_context, user_context, provider=pref)
    if ground_truth:
        system_prompt += f"\n\n{ground_truth}\n"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": data["question"]}
    ]

    try:
        user_key = _get_user_groq_key(caller_id)
        max_tokens = 1024 if pref == 'local' else 2048
        temperature = 0.2 if pref == 'local' else 0.3
        out = llm_complete(messages, temperature=temperature, max_tokens=max_tokens, preference=pref, user_api_key=user_key)
        payload = {
            "response": out["content"],
            "llm_used": out["backend"],
            "used_fallback": out["used_fallback"],
        }
        if out["used_fallback"]:
            payload["llm_notice"] = _llm_fallback_notice(out.get("fallback_reason"))
        return jsonify(payload)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# =========================================================
#  AUTH ROUTES (preserved from original)
# =========================================================
@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json()
    if not data or 'credential' not in data:
        return jsonify({"success": False, "error": "No credential"}), 400
    if data['credential'] == 'MOCK_JWT_DEV_MODE':
        jwt_data = {"sub":"dev_00001","email":"dev@chemtech.local","name":"Dev User","picture":""}
    else:
        jwt_data = decode_google_jwt(data['credential'])
    if not jwt_data or 'email' not in jwt_data:
        return jsonify({"success": False, "error": "Invalid token"}), 400
    google_id = jwt_data.get('sub'); email = jwt_data.get('email')
    name = jwt_data.get('name',''); picture = jwt_data.get('picture','')
    try:
        conn = get_db(); c = conn.cursor()
        c.execute("SELECT * FROM users WHERE google_id=?", (google_id,))
        user = c.fetchone()
        if user:
            if email == ADMIN_EMAIL:
                c.execute("UPDATE users SET last_login=CURRENT_TIMESTAMP,name=?,picture=?,role='admin',approved=1 WHERE google_id=?", (name,picture,google_id))
            else:
                c.execute("UPDATE users SET last_login=CURRENT_TIMESTAMP,name=?,picture=? WHERE google_id=?", (name,picture,google_id))
        else:
            req_role = data.get('role') or 'user'
            role = 'admin' if email == ADMIN_EMAIL else req_role
            approved = 1 if email == ADMIN_EMAIL else 0
            c.execute("INSERT INTO users (google_id,email,name,picture,role,approved,pending_admin) VALUES (?,?,?,?,?,?,0)", (google_id,email,name,picture,role,approved))
        conn.commit()
        c.execute("SELECT * FROM users WHERE google_id=?", (google_id,))
        row = c.fetchone(); conn.close()
        return jsonify({"success": True, "user": user_to_dict(row)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data: return jsonify({"success": False, "error": "No data"}), 400
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    if not username or not password: return jsonify({"success": False, "error": "Username and password required"}), 400
    if len(username) < 3: return jsonify({"success": False, "error": "Username must be at least 3 characters"}), 400
    if len(password) < 4: return jsonify({"success": False, "error": "Password must be at least 4 characters"}), 400
    try:
        conn = get_db(); c = conn.cursor()
        c.execute("SELECT id FROM users WHERE username=?", (username,))
        if c.fetchone(): conn.close(); return jsonify({"success": False, "error": "Username already taken"}), 409
        req_role = (data.get('role') or 'user').strip()
        pw_hash = generate_password_hash(password)
        c.execute("INSERT INTO users (username,password_hash,name,role,approved,pending_admin) VALUES (?,?,?,?,0,0)", (username,pw_hash,username,req_role))
        conn.commit(); conn.close()
        return jsonify({"success": True, "message": "Registration successful. Awaiting admin approval."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/manual-login', methods=['POST'])
def manual_login():
    data = request.get_json()
    if not data: return jsonify({"success": False, "error": "No data"}), 400
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    if not username or not password: return jsonify({"success": False, "error": "Username and password required"}), 400
    try:
        conn = get_db(); c = conn.cursor()
        c.execute("SELECT * FROM users WHERE username=?", (username,))
        user = c.fetchone()
        if not user or not user['password_hash'] or not check_password_hash(user['password_hash'], password):
            conn.close(); return jsonify({"success": False, "error": "Invalid credentials"}), 401
        c.execute("UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?", (user['id'],))
        conn.commit()
        c.execute("SELECT * FROM users WHERE id=?", (user['id'],))
        row = c.fetchone(); conn.close()
        return jsonify({"success": True, "user": user_to_dict(row)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/logout', methods=['POST'])
def api_logout():
    return jsonify({"success": True})

# =========================================================
#  USER MANAGEMENT (admin only)
# =========================================================
@app.route('/api/pending-users', methods=['POST'])
def pending_users():
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not is_admin_by_id(caller_id) and not is_admin(data.get('google_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM users WHERE approved=0")
    rows = c.fetchall(); conn.close()
    return jsonify({"success": True, "users": [user_to_dict(r) for r in rows]})

@app.route('/api/approve-user', methods=['POST'])
def approve_user():
    data = request.get_json() or {}
    if not is_admin_by_id(data.get('caller_id')) and not is_admin(data.get('google_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    target_id = data.get('target_id')
    if not target_id: return jsonify({"success": False, "error": "Missing target_id"}), 400
    role = data.get('role', 'user')
    if role not in ('user', 'regional_admin', 'admin'):
        role = 'user'
    conn = get_db(); c = conn.cursor()
    c.execute("UPDATE users SET approved=1, role=? WHERE id=?", (role, target_id))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/api/deny-user', methods=['POST'])
def deny_user():
    data = request.get_json() or {}
    if not is_admin_by_id(data.get('caller_id')) and not is_admin(data.get('google_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    target_id = data.get('target_id')
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT email FROM users WHERE id=?", (target_id,))
    row = c.fetchone()
    if row and row['email'] == ADMIN_EMAIL:
        conn.close(); return jsonify({"success": False, "error": "Cannot remove the primary admin"}), 403
    c.execute("DELETE FROM users WHERE id=?", (target_id,))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/api/revoke-access', methods=['POST'])
def revoke_access():
    data = request.get_json() or {}
    if not is_admin_by_id(data.get('caller_id')) and not is_admin(data.get('google_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    target_id = data.get('target_id')
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT email FROM users WHERE id=?", (target_id,))
    row = c.fetchone()
    if row and row['email'] == ADMIN_EMAIL:
        conn.close(); return jsonify({"success": False, "error": "Cannot revoke the primary admin"}), 403
    c.execute("UPDATE users SET approved=0 WHERE id=?", (target_id,))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/api/add-user', methods=['POST'])
def add_user():
    data = request.get_json() or {}
    if not is_admin_by_id(data.get('caller_id')) and not is_admin(data.get('google_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    username = (data.get('username') or '').strip()
    password = (data.get('password') or '').strip()
    role = data.get('role', 'user')
    if role not in ('user', 'regional_admin', 'admin'): role = 'user'
    if not username or not password: return jsonify({"success": False, "error": "Username and password required"}), 400
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT id FROM users WHERE username=?", (username,))
    if c.fetchone(): conn.close(); return jsonify({"success": False, "error": "Username already taken"}), 409
    pw_hash = generate_password_hash(password)
    c.execute("INSERT INTO users (username,password_hash,name,role,approved,pending_admin) VALUES (?,?,?,?,1,0)", (username,pw_hash,username,role))
    conn.commit(); conn.close()
    return jsonify({"success": True, "message": f"User '{username}' created as {role} and approved."})

@app.route('/api/users/list-delivery-targets', methods=['POST'])
def list_delivery_targets():
    """Returns all approved users (role='user') for regional admins to assign deliveries to."""
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT id, username, name, email, picture FROM users WHERE approved=1 AND role='user' ORDER BY name, username")
    rows = c.fetchall(); conn.close()
    users = [{"user_id": r['id'], "username": r['username'] or '', "name": r['name'] or r['username'] or 'Unknown',
              "email": r['email'] or '', "picture": r['picture'] or ''} for r in rows]
    return jsonify({"success": True, "users": users})

@app.route('/api/notifications/pending', methods=['POST'])
def pending_notifications():
    """Legacy: Returns unread delivery assignments, marks them as notified in deliveries table."""
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    conn = get_db(); c = conn.cursor()
    c.execute("""SELECT d.id, d.tracking_code, d.quantity_kg, d.province, c.name as chem_name,
                 u.name as assigned_by_name, u.username as assigned_by_username
                 FROM deliveries d
                 JOIN chemicals c ON d.chemical_id=c.id
                 LEFT JOIN users u ON d.assigned_by_id=u.id
                 WHERE d.user_id=? AND d.notified=0""", (caller_id,))
    rows = c.fetchall()
    notifications = [dict(r) for r in rows]
    if notifications:
        ids = [r['id'] for r in rows]
        c.execute(f"UPDATE deliveries SET notified=1 WHERE id IN ({','.join('?'*len(ids))})", ids)
        conn.commit()
    conn.close()
    return jsonify({"success": True, "notifications": notifications})

@app.route('/api/notifications/list', methods=['POST'])
def list_notifications():
    """Return all undismissed persistent notifications for the calling user."""
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    conn = get_db(); c = conn.cursor()
    c.execute(
        "SELECT * FROM notifications WHERE user_id=? AND dismissed=0 ORDER BY created_at DESC",
        (caller_id,)
    )
    rows = c.fetchall(); conn.close()
    return jsonify({"success": True, "notifications": [dict(r) for r in rows]})

@app.route('/api/notifications/dismiss', methods=['POST'])
def dismiss_notification():
    """Mark a single notification as dismissed."""
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    notif_id = data.get('notification_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    if not notif_id: return jsonify({"success": False, "error": "notification_id required"}), 400
    conn = get_db(); c = conn.cursor()
    # Only dismiss own notifications
    c.execute("UPDATE notifications SET dismissed=1 WHERE id=? AND user_id=?", (notif_id, caller_id))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/api/notifications/dismiss-all', methods=['POST'])
def dismiss_all_notifications():
    """Mark all notifications for the calling user as dismissed."""
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    conn = get_db(); c = conn.cursor()
    c.execute("UPDATE notifications SET dismissed=1 WHERE user_id=?", (caller_id,))
    conn.commit(); conn.close()
    return jsonify({"success": True})

# =========================================================
#  USER GROQ API KEY MANAGEMENT
# =========================================================
@app.route('/api/user/groq-key', methods=['POST'])
def save_user_groq_key():
    """Save or update the user's personal Groq API key."""
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    api_key = (data.get('groq_api_key') or '').strip()
    if not api_key: return jsonify({"success": False, "error": "API key cannot be empty"}), 400
    try:
        conn = get_db(); c = conn.cursor()
        c.execute("UPDATE users SET groq_api_key=? WHERE id=?", (api_key, caller_id))
        conn.commit(); conn.close()
        return jsonify({"success": True, "message": "API key saved."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/user/groq-key/get', methods=['POST'])
def get_user_groq_key():
    """Retrieve masked API key status for the calling user."""
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    try:
        conn = get_db(); c = conn.cursor()
        c.execute("SELECT groq_api_key, use_own_groq_key FROM users WHERE id=?", (caller_id,))
        row = c.fetchone(); conn.close()
        if not row:
            return jsonify({"success": False, "error": "User not found"}), 404
        raw_key = (row['groq_api_key'] or '').strip()
        has_key = bool(raw_key)
        masked = ''
        if has_key:
            # Show first 4 and last 4 chars, mask the rest
            if len(raw_key) > 8:
                masked = raw_key[:4] + '****' + raw_key[-4:]
            else:
                masked = raw_key[:2] + '****'
        return jsonify({
            "success": True,
            "has_key": has_key,
            "use_own_key": bool(row['use_own_groq_key']),
            "masked_key": masked
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/user/groq-key/toggle', methods=['POST'])
def toggle_user_groq_key():
    """Toggle use of the user's own Groq API key on or off."""
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    enabled = bool(data.get('enabled', False))
    try:
        conn = get_db(); c = conn.cursor()
        # Verify user has a key saved before enabling
        if enabled:
            c.execute("SELECT groq_api_key FROM users WHERE id=?", (caller_id,))
            row = c.fetchone()
            if not row or not (row['groq_api_key'] or '').strip():
                conn.close()
                return jsonify({"success": False, "error": "Save an API key first before enabling."}), 400
        c.execute("UPDATE users SET use_own_groq_key=? WHERE id=?", (1 if enabled else 0, caller_id))
        conn.commit(); conn.close()
        return jsonify({"success": True, "enabled": enabled})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/user/groq-key/delete', methods=['POST'])
def delete_user_groq_key():
    """Remove the user's saved Groq API key and disable it."""
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    try:
        conn = get_db(); c = conn.cursor()
        c.execute("UPDATE users SET groq_api_key=NULL, use_own_groq_key=0 WHERE id=?", (caller_id,))
        conn.commit(); conn.close()
        return jsonify({"success": True, "message": "API key removed."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/all-users', methods=['POST'])
def all_users():
    data = request.get_json() or {}
    if not is_admin_by_id(data.get('caller_id')) and not is_admin(data.get('google_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM users ORDER BY approved DESC, name ASC")
    rows = c.fetchall(); conn.close()
    return jsonify({"success": True, "users": [user_to_dict(r) for r in rows]})

@app.route('/api/request-admin', methods=['POST'])
def request_admin():
    data = request.get_json() or {}
    google_id = data.get('google_id')
    if not google_id: return jsonify({"success": False, "error": "Missing google_id"}), 400
    conn = get_db(); c = conn.cursor()
    c.execute("UPDATE users SET pending_admin=1 WHERE google_id=? AND role != 'admin'", (google_id,))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/api/pending-admin-requests', methods=['POST'])
def pending_admin_requests():
    data = request.get_json() or {}
    if not is_admin(data.get('google_id')) and not is_admin_by_id(data.get('caller_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT id,google_id,email,name,picture FROM users WHERE pending_admin=1")
    rows = c.fetchall(); conn.close()
    users = [{"user_id":r['id'],"google_id":r['google_id'],"email":r['email'],"name":r['name'],"picture":r['picture']} for r in rows]
    return jsonify({"success": True, "pending": users})

@app.route('/api/approve-admin', methods=['POST'])
def approve_admin():
    data = request.get_json() or {}
    if not is_admin(data.get('google_id')) and not is_admin_by_id(data.get('caller_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    target_id = data.get('target_google_id')
    if not target_id: return jsonify({"success": False, "error": "Missing target_google_id"}), 400
    conn = get_db(); c = conn.cursor()
    c.execute("UPDATE users SET role='admin',pending_admin=0 WHERE google_id=?", (target_id,))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/api/deny-admin', methods=['POST'])
def deny_admin():
    data = request.get_json() or {}
    if not is_admin(data.get('google_id')) and not is_admin_by_id(data.get('caller_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    target_id = data.get('target_google_id')
    conn = get_db(); c = conn.cursor()
    c.execute("UPDATE users SET pending_admin=0 WHERE google_id=?", (target_id,))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/api/revoke-admin', methods=['POST'])
def revoke_admin():
    data = request.get_json() or {}
    if not is_admin(data.get('google_id')) and not is_admin_by_id(data.get('caller_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    target_id = data.get('target_google_id')
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT email FROM users WHERE google_id=?", (target_id,))
    row = c.fetchone()
    if row and row['email'] == ADMIN_EMAIL:
        conn.close(); return jsonify({"success": False, "error": "Cannot revoke the primary admin"}), 403
    c.execute("UPDATE users SET role='user',pending_admin=0 WHERE google_id=?", (target_id,))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/api/admins', methods=['POST'])
def list_admins():
    data = request.get_json() or {}
    if not is_admin(data.get('google_id')) and not is_admin_by_id(data.get('caller_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT id,google_id,email,name,picture FROM users WHERE role='admin'")
    rows = c.fetchall(); conn.close()
    admins = [{"user_id":r['id'],"google_id":r['google_id'],"email":r['email'],"name":r['name'],"picture":r['picture']} for r in rows]
    return jsonify({"success": True, "admins": admins})

# =========================================================
#  CHEMICALS
# =========================================================
@app.route('/api/chemicals', methods=['POST'])
def list_chemicals():
    data = request.get_json() or {}
    province = data.get('province')
    conn = get_db(); c = conn.cursor()
    if province and province in PROVINCES:
        c.execute("SELECT * FROM chemicals WHERE province=? ORDER BY name", (province,))
    else:
        c.execute("SELECT * FROM chemicals ORDER BY province, name")
    rows = c.fetchall(); conn.close()
    return jsonify({"success": True, "chemicals": [dict(r) for r in rows]})

@app.route('/api/chemicals/add', methods=['POST'])
def add_chemical():
    data = request.get_json() or {}
    if not is_admin_by_id(data.get('caller_id')) and not is_admin(data.get('google_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    name = (data.get('name') or '').strip()
    province = data.get('province','').strip()
    if not name or province not in PROVINCES:
        return jsonify({"success": False, "error": "Name and valid province required"}), 400
    conn = get_db(); c = conn.cursor()
    c.execute("""INSERT INTO chemicals (name,formula,province,amount_kg,concentration_pct,price_per_kg,quantity_sold,category,description)
                 VALUES (?,?,?,?,?,?,0,?,?)""",
              (name, data.get('formula',''), province,
               float(data.get('amount_kg', 0)), float(data.get('concentration_pct', 100)),
               float(data.get('price_per_kg', 0)),
               data.get('category','General'), data.get('description','')))
    conn.commit()
    new_id = c.lastrowid
    c.execute("SELECT * FROM chemicals WHERE id=?", (new_id,))
    row = c.fetchone(); conn.close()
    return jsonify({"success": True, "chemical": dict(row)})

@app.route('/api/chemicals/remove', methods=['POST'])
def remove_chemical():
    data = request.get_json() or {}
    if not is_admin_by_id(data.get('caller_id')) and not is_admin(data.get('google_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    chem_id = data.get('chemical_id')
    if not chem_id: return jsonify({"success": False, "error": "Missing chemical_id"}), 400
    conn = get_db(); c = conn.cursor()
    c.execute("DELETE FROM chemicals WHERE id=?", (chem_id,))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/api/chemicals/update', methods=['POST'])
def update_chemical():
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    chem_id = data.get('chemical_id')
    if not chem_id: return jsonify({"success": False, "error": "Missing chemical_id"}), 400
    conn = get_db(); c = conn.cursor()
    updates = []
    vals = []
    # Admins can update everything; users can only update quantity_sold
    is_adm = is_admin_by_id(caller_id) or is_admin(data.get('google_id'))
    allowed_admin = ['amount_kg','concentration_pct','price_per_kg','quantity_sold','description','category']
    allowed_user  = ['quantity_sold']
    fields = allowed_admin if is_adm else allowed_user
    for f in fields:
        if f in data:
            updates.append(f"{f}=?"); vals.append(data[f])
    if not updates: conn.close(); return jsonify({"success": False, "error": "Nothing to update"}), 400
    vals.append(chem_id)
    c.execute(f"UPDATE chemicals SET {', '.join(updates)} WHERE id=?", vals)
    conn.commit()
    c.execute("SELECT * FROM chemicals WHERE id=?", (chem_id,))
    row = c.fetchone(); conn.close()
    return jsonify({"success": True, "chemical": dict(row)})

# =========================================================
#  DELIVERIES
# =========================================================
@app.route('/api/deliveries', methods=['POST'])
def list_deliveries():
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    is_adm = is_admin_by_id(caller_id) or is_admin(data.get('google_id'))
    is_reg = is_regional_admin_by_id(caller_id)
    conn = get_db(); c = conn.cursor()
    if is_adm or is_reg:
        province = data.get('province')
        if province and province in PROVINCES:
            c.execute("""SELECT d.*, c.name as chem_name, c.formula, u.name as user_name, u.username,
                         ab.name as assigned_by_name
                         FROM deliveries d JOIN chemicals c ON d.chemical_id=c.id
                         JOIN users u ON d.user_id=u.id
                         LEFT JOIN users ab ON d.assigned_by_id=ab.id
                         WHERE d.province=? ORDER BY d.created_at DESC""", (province,))
        else:
            c.execute("""SELECT d.*, c.name as chem_name, c.formula, u.name as user_name, u.username,
                         ab.name as assigned_by_name
                         FROM deliveries d JOIN chemicals c ON d.chemical_id=c.id
                         JOIN users u ON d.user_id=u.id
                         LEFT JOIN users ab ON d.assigned_by_id=ab.id
                         ORDER BY d.created_at DESC""")
    else:
        c.execute("""SELECT d.*, c.name as chem_name, c.formula, u.name as user_name, u.username,
                     ab.name as assigned_by_name
                     FROM deliveries d JOIN chemicals c ON d.chemical_id=c.id
                     JOIN users u ON d.user_id=u.id
                     LEFT JOIN users ab ON d.assigned_by_id=ab.id
                     WHERE d.user_id=? ORDER BY d.created_at DESC""", (caller_id,))
    rows = c.fetchall(); conn.close()
    deliveries = [dict(r) for r in rows]
    return jsonify({"success": True, "deliveries": deliveries})

@app.route('/api/deliveries/create', methods=['POST'])
def create_delivery():
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    chem_id = data.get('chemical_id')
    qty = float(data.get('quantity_kg', 0))
    if not chem_id or qty <= 0:
        return jsonify({"success": False, "error": "chemical_id and quantity_kg required"}), 400
    # If regional admin assigns to a specific user
    is_reg = is_regional_admin_by_id(caller_id)
    assigned_user_id = data.get('assigned_user_id')
    if is_reg and not assigned_user_id:
        return jsonify({"success": False, "error": "Regional admins must assign delivery to a user"}), 400
    delivery_user_id = int(assigned_user_id) if assigned_user_id else caller_id
    assigned_by_id = caller_id if assigned_user_id else None
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM chemicals WHERE id=?", (chem_id,))
    chem = c.fetchone()
    if not chem:
        conn.close(); return jsonify({"success": False, "error": "Chemical not found"}), 404
    if qty > chem['amount_kg']:
        conn.close(); return jsonify({"success": False, "error": f"Only {chem['amount_kg']}kg available"}), 400
    tracking_code = 'CT-' + uuid.uuid4().hex[:8].upper()
    ins_del = """INSERT INTO deliveries (chemical_id,user_id,assigned_by_id,province,quantity_kg,status,tracking_code,notes,notified)
                 VALUES (?,?,?,?,?,'ordered',?,?,0)"""
    ins_del_args = (
        chem_id,
        delivery_user_id,
        assigned_by_id,
        chem["province"],
        qty,
        tracking_code,
        data.get("notes", ""),
    )
    upd_chem = "UPDATE chemicals SET amount_kg=amount_kg-?, quantity_sold=quantity_sold+? WHERE id=?"
    upd_chem_args = (qty, qty, chem_id)
    ins_sale = "INSERT INTO chemical_sales (chemical_id,province,quantity_sold,revenue,sale_date) VALUES (?,?,?,?,?)"
    ins_sale_args = (
        chem_id,
        chem["province"],
        qty,
        round(qty * chem["price_per_kg"], 2),
        datetime.now().strftime("%Y-%m-%d"),
    )
    batch_results = write_batch(
        get_turso_raw(),
        [(ins_del, ins_del_args), (upd_chem, upd_chem_args), (ins_sale, ins_sale_args)],
    )
    delivery_id = last_insert_rowid(batch_results[0])
    if not delivery_id:
        conn.close()
        return jsonify({"success": False, "error": "Failed to create delivery"}), 500
    c.execute(
        "SELECT d.*, c.name as chem_name FROM deliveries d JOIN chemicals c ON d.chemical_id=c.id WHERE d.id=?",
        (delivery_id,),
    )
    row = c.fetchone()

    # ── Persistent notification for the assigned user ──
    if assigned_by_id:  # Only notify when a reg-admin/admin assigned it to someone else
        c.execute("SELECT name, username FROM users WHERE id=?", (int(assigned_by_id),))
        assigner = c.fetchone()
        assigner_name = (assigner['name'] or assigner['username'] or 'Regional Admin') if assigner else 'Regional Admin'
        _insert_notification(
            conn,
            int(delivery_user_id),
            'delivery',
            f"📦 New Delivery Assigned",
            f"{chem['name']} — {qty} kg assigned to you by {assigner_name}. Tracking: {tracking_code}"
        )

    conn.close()

    # ── Low-stock check (runs after conn closed to avoid lock) ──
    _check_low_stock_notify(chem_id)

    return jsonify({"success": True, "delivery": dict(row), "tracking_code": tracking_code})

@app.route('/api/deliveries/update-status', methods=['POST'])
def update_delivery_status():
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    delivery_id = data.get('delivery_id')
    new_status = data.get('status')
    valid_statuses = ['ordered','processing','in_transit','delivered']
    if not delivery_id or new_status not in valid_statuses:
        return jsonify({"success": False, "error": "delivery_id and valid status required"}), 400
    is_adm = is_admin_by_id(caller_id) or is_admin(data.get('google_id'))
    is_reg = is_regional_admin_by_id(caller_id)
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM deliveries WHERE id=?", (delivery_id,))
    delivery = c.fetchone()
    if not delivery: conn.close(); return jsonify({"success": False, "error": "Delivery not found"}), 404
    # Admins, regional admins, AND the assigned user can advance status
    if not is_adm and not is_reg and delivery['user_id'] != caller_id:
        conn.close(); return jsonify({"success": False, "error": "Forbidden"}), 403
    c.execute("UPDATE deliveries SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (new_status, delivery_id))
    conn.commit()
    c.execute("SELECT d.*, c.name as chem_name FROM deliveries d JOIN chemicals c ON d.chemical_id=c.id WHERE d.id=?", (delivery_id,))
    row = c.fetchone(); conn.close()
    return jsonify({"success": True, "delivery": dict(row)})

@app.route('/api/deliveries/set-location', methods=['POST'])
def set_delivery_location():
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not is_admin_or_regional(caller_id, data.get('google_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    delivery_id = data.get('delivery_id')
    lat = data.get('lat')
    lng = data.get('lng')
    location_name = (data.get('location_name') or '').strip()
    if delivery_id is None or lat is None or lng is None:
        return jsonify({"success": False, "error": "delivery_id, lat, lng required"}), 400
    conn = get_db(); c = conn.cursor()
    c.execute("UPDATE deliveries SET delivery_lat=?, delivery_lng=?, delivery_location_name=? WHERE id=?",
              (float(lat), float(lng), location_name, delivery_id))
    conn.commit(); conn.close()
    return jsonify({"success": True})

@app.route('/api/deliveries/delete', methods=['POST'])
def delete_delivery():
    """Admins and regional admins may remove a delivery (and its feedback rows)."""
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not is_admin_by_id(caller_id) and not is_admin(data.get('google_id')) and not is_regional_admin_by_id(caller_id):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    did = data.get('delivery_id')
    if not did:
        return jsonify({"success": False, "error": "Missing delivery_id"}), 400
    try:
        did_int = int(did)
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "Invalid delivery_id"}), 400
    write_batch(get_turso_raw(), [
        ("DELETE FROM feedback WHERE delivery_id=?", (did_int,)),
        ("DELETE FROM deliveries WHERE id=?", (did_int,)),
    ])
    return jsonify({"success": True})

# =========================================================
#  FEEDBACK + AI SENTIMENT
# =========================================================
_SENTIMENT_STOP = frozenset(
    'the a an and or but in on at to for of is was were be been with this that it its my our your they them'.split()
)
_POSITIVE_SIGNALS = (
    'happy', 'great', 'good', 'fast', 'quick', 'quickly', 'excellent', 'satisfied',
    'thank', 'thanks', 'perfect', 'wonderful', 'amazing', 'pleased', 'love', 'awesome',
)
_NEGATIVE_SIGNALS = (
    'bad', 'late', 'delay', 'delayed', 'slow', 'damaged', 'broken', 'angry', 'terrible',
    'awful', 'horrible', 'disappointed', 'spilled', 'missing', 'never', 'wrong', 'incorrect',
    'mistaken', 'poor', 'unsatisfied', 'complaint', 'complain', 'refund', 'unacceptable',
)
_STRONG_NEGATIVE_SIGNALS = (
    'wrong', 'incorrect', 'damaged', 'broken', 'angry', 'terrible', 'awful', 'never',
    'disappointed', 'spilled', 'unacceptable', 'horrible', 'refund',
)


def _rule_based_sentiment(text_feedback):
    """Keyword-based sentiment when the local model output is ungrounded or missing."""
    t = text_feedback.lower()
    pos = sum(1 for w in _POSITIVE_SIGNALS if w in t)
    neg = sum(1 for w in _NEGATIVE_SIGNALS if w in t)
    for phrase in ('wrong product', 'never again', 'demand refund', 'half the product'):
        if phrase in t:
            neg += 2

    if neg > pos:
        strong = any(w in t for w in _STRONG_NEGATIVE_SIGNALS) or neg >= 3
        score = 0.10 if strong else 0.28
        label = 'Negative'
        if any(w in t for w in ('wrong', 'incorrect', 'mistaken')):
            justification = 'Customer reports receiving the wrong or incorrect product.'
        elif any(w in t for w in ('damage', 'damaged', 'broken', 'spilled', 'leak', 'cracked')):
            justification = 'Serious complaint about damaged packaging or product loss.'
        elif any(w in t for w in ('late', 'delay', 'delayed', 'slow', 'waiting')):
            justification = 'Customer raised concerns about delayed delivery.'
        elif any(w in t for w in ('angry', 'terrible', 'awful', 'horrible', 'never', 'refund')):
            justification = 'Strong negative feedback expressing serious dissatisfaction.'
        else:
            justification = 'Customer expressed dissatisfaction with the delivery experience.'
    elif pos > neg:
        strong = pos >= 2 or any(w in t for w in ('excellent', 'perfect', 'amazing', 'wonderful'))
        score = 0.88 if strong else 0.68
        label = 'Positive'
        if any(w in t for w in ('fast', 'quick', 'quickly', 'speed')):
            justification = 'Customer praised fast delivery and expressed satisfaction.'
        elif any(w in t for w in ('perfect', 'excellent', 'condition')):
            justification = 'Customer expressed strong satisfaction with product condition.'
        else:
            justification = 'Customer gave positive feedback about the delivery experience.'
    else:
        score = 0.50
        label = 'Neutral'
        if any(w in t for w in ('late', 'delay', 'delayed')) and any(
            w in t for w in ('fine', 'okay', 'ok', 'acceptable', 'good')
        ):
            justification = 'Mixed feedback: delay noted but overall outcome acceptable.'
        else:
            justification = 'Feedback is factual or mixed without strong positive or negative tone.'

    return {
        'score': score,
        'label': label,
        'justification': justification,
    }


def _sentiment_justification_ungrounded(text_feedback, justification):
    """True when the model justification cites ideas not present in the feedback."""
    fb = text_feedback.lower()
    j = (justification or '').strip().lower()
    if not j:
        return True

    concept_bleed = (
        (('late', 'delay', 'delayed', 'slow', 'waiting'), ('late', 'delay', 'delivery time', 'on time')),
        (('quality', 'fine', 'acceptable', 'condition'), ('quality', 'product quality', 'acceptable')),
        (('damage', 'damaged', 'broken', 'spilled', 'leak', 'cracked'), ('damage', 'damaged', 'broken', 'spilled', 'packaging')),
        (('wrong', 'incorrect', 'mistaken'), ('wrong', 'incorrect', 'mistaken', 'wrong product')),
        (('fast', 'quick', 'quickly', 'speed'), ('fast', 'quick', 'speed', 'quickly')),
        (('happy', 'satisfied', 'excellent', 'perfect', 'thank'), ('happy', 'satisfied', 'excellent', 'perfect', 'thank')),
    )
    for fb_kws, j_phrases in concept_bleed:
        if any(p in j for p in j_phrases) and not any(k in fb for k in fb_kws):
            return True

    if 'minor complaint' in j and any(w in fb for w in _STRONG_NEGATIVE_SIGNALS):
        return True

    fb_tokens = [w for w in re.findall(r"[a-z']+", fb) if len(w) >= 4 and w not in _SENTIMENT_STOP]
    if fb_tokens and not any(tok in j for tok in fb_tokens):
        return True

    return False


@app.route('/api/feedback/submit', methods=['POST'])
def submit_feedback():
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    delivery_id = data.get('delivery_id')
    text_feedback = (data.get('text_feedback') or '').strip()
    if not caller_id or not delivery_id:
        return jsonify({"success": False, "error": "caller_id and delivery_id required"}), 400
    if not text_feedback:
        return jsonify({"success": False, "error": "Feedback text is required"}), 400

    # Run AI sentiment analysis
    sentiment_score = 0.5; sentiment_label = 'Neutral'; sentiment_justification = 'Unable to analyze.'
    llm_used = 'groq'; used_fallback = False; llm_notice = None
    try:
        pref = normalize_llm_provider(data.get("llm_provider"))

        if pref == 'local':
            # ── Ollama / local-model prompt (no few-shot examples — small models copy them) ──
            prompt = f"""Classify sentiment of this ChemTech Pakistan delivery feedback.

FEEDBACK: "{text_feedback}"

Score table:
  Very Positive → 0.80–1.00, label "Positive"
  Mildly Positive → 0.60–0.79, label "Positive"
  Neutral → 0.40–0.59, label "Neutral"
  Mildly Negative → 0.20–0.39, label "Negative"
  Very Negative → 0.00–0.19, label "Negative"

Rules:
- Base score and justification ONLY on words in FEEDBACK above.
- Do not mention delivery time, product quality, or damage unless FEEDBACK does.
- Justification: one short sentence (max 20 words) quoting the customer's concern.

Respond ONLY with valid JSON (no markdown):
{{"score": <0.0-1.0>, "label": "<Positive|Neutral|Negative>", "justification": "<one sentence>"}}"""
        else:
            # ── Groq / cloud prompt (structured for calibration) ─────────────
            prompt = f"""Classify sentiment of this ChemTech Pakistan delivery feedback.

FEEDBACK: "{text_feedback}"

Score table:
  Very Positive → 0.80–1.00, label "Positive"
  Mildly Positive → 0.60–0.79, label "Positive"
  Neutral → 0.40–0.59, label "Neutral"
  Mildly Negative → 0.20–0.39, label "Negative"
  Very Negative → 0.00–0.19, label "Negative"

Rules:
- Base score and justification ONLY on words in FEEDBACK above.
- Do not mention delivery time, product quality, or damage unless FEEDBACK does.
- Justification: one detailed sentence (max 30 words) citing specific words from the feedback.

Respond ONLY with valid JSON (no markdown):
{{"score": <0.0-1.0>, "label": "<Positive|Neutral|Negative>", "justification": "<one sentence>"}}"""

        out = llm_complete(
            [{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=200 if pref == 'local' else 280,
            preference=pref,
            user_api_key=_get_user_groq_key(data.get('caller_id')),
        )
        llm_used = out.get("backend", pref)
        used_fallback = out.get("used_fallback", False)
        if used_fallback:
            llm_notice = _llm_fallback_notice(out.get("fallback_reason"))
        raw = out["content"].strip()
        # Extract JSON from response
        start = raw.find('{'); end = raw.rfind('}') + 1
        if start >= 0 and end > start:
            parsed = json.loads(raw[start:end])
            sentiment_score = float(parsed.get('score', 0.5))
            # Clamp score to valid range
            sentiment_score = max(0.0, min(1.0, sentiment_score))
            raw_label = parsed.get('label', 'Neutral').strip().capitalize()
            # Enforce label consistency with score if model drifts
            if raw_label not in ('Positive', 'Neutral', 'Negative'):
                raw_label = 'Positive' if sentiment_score >= 0.6 else ('Negative' if sentiment_score < 0.4 else 'Neutral')
            sentiment_label = raw_label
            sentiment_justification = (parsed.get('justification') or '').strip()

        if _sentiment_justification_ungrounded(text_feedback, sentiment_justification):
            rb = _rule_based_sentiment(text_feedback)
            sentiment_score = rb['score']
            sentiment_label = rb['label']
            sentiment_justification = rb['justification']
    except Exception as e:
        print(f"Sentiment error: {e}")
        rb = _rule_based_sentiment(text_feedback)
        sentiment_score = rb['score']
        sentiment_label = rb['label']
        sentiment_justification = rb['justification']
        llm_used = 'rules'
        llm_notice = 'AI sentiment unavailable — used rule-based keyword analysis.'

    conn = get_db(); c = conn.cursor()
    c.execute("""INSERT INTO feedback (delivery_id,user_id,text_feedback,sentiment_score,sentiment_label,sentiment_justification)
                 VALUES (?,?,?,?,?,?)""",
              (delivery_id, caller_id, text_feedback, sentiment_score, sentiment_label, sentiment_justification))
    conn.commit()
    new_id = c.lastrowid
    c.execute("SELECT * FROM feedback WHERE id=?", (new_id,))
    row = c.fetchone(); conn.close()
    payload = {
        "success": True,
        "feedback": dict(row),
        "sentiment": {
            "score": sentiment_score,
            "label": sentiment_label,
            "justification": sentiment_justification,
        },
        "llm_used": llm_used,
        "used_fallback": used_fallback,
    }
    if llm_notice:
        payload["llm_notice"] = llm_notice
    return jsonify(payload)

@app.route('/api/feedback/list', methods=['POST'])
def list_feedback():
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not caller_id: return jsonify({"success": False, "error": "Not authenticated"}), 401
    is_adm = is_admin_by_id(caller_id) or is_admin(data.get('google_id'))
    is_reg = is_regional_admin_by_id(caller_id)
    conn = get_db(); c = conn.cursor()
    if is_adm or is_reg:
        province = data.get('province')
        if province and province in PROVINCES:
            c.execute("""SELECT f.*, u.name as user_name, d.tracking_code, d.province,
                         ch.name as chem_name FROM feedback f
                         JOIN users u ON f.user_id=u.id
                         JOIN deliveries d ON f.delivery_id=d.id
                         JOIN chemicals ch ON d.chemical_id=ch.id
                         WHERE d.province=? ORDER BY f.created_at DESC""", (province,))
        else:
            c.execute("""SELECT f.*, u.name as user_name, d.tracking_code, d.province,
                         ch.name as chem_name FROM feedback f
                         JOIN users u ON f.user_id=u.id
                         JOIN deliveries d ON f.delivery_id=d.id
                         JOIN chemicals ch ON d.chemical_id=ch.id
                         ORDER BY f.created_at DESC""")
    else:
        c.execute("""SELECT f.*, u.name as user_name, d.tracking_code, d.province,
                     ch.name as chem_name FROM feedback f
                     JOIN users u ON f.user_id=u.id
                     JOIN deliveries d ON f.delivery_id=d.id
                     JOIN chemicals ch ON d.chemical_id=ch.id
                     WHERE f.user_id=? ORDER BY f.created_at DESC""", (caller_id,))
    rows = c.fetchall(); conn.close()
    return jsonify({"success": True, "feedback": [dict(r) for r in rows]})

@app.route('/api/feedback/delete', methods=['POST'])
def delete_feedback():
    """Admins and regional admins may remove a single feedback entry."""
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not is_admin_by_id(caller_id) and not is_admin(data.get('google_id')) and not is_regional_admin_by_id(caller_id):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    fid = data.get('feedback_id')
    if not fid:
        return jsonify({"success": False, "error": "Missing feedback_id"}), 400
    try:
        fid_int = int(fid)
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "Invalid feedback_id"}), 400
    conn = get_db(); c = conn.cursor()
    c.execute("DELETE FROM feedback WHERE id=?", (fid_int,))
    conn.commit(); conn.close()
    return jsonify({"success": True})

# =========================================================
#  REGIONAL ANALYTICS
# =========================================================
@app.route('/api/analytics/regional', methods=['POST'])
def regional_analytics():
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not is_admin_by_id(caller_id) and not is_admin(data.get('google_id')) and not is_regional_admin_by_id(caller_id):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    conn = get_db(); c = conn.cursor()
    result = {}
    for prov in PROVINCES:
        # Total sales
        c.execute("SELECT SUM(revenue) as total_rev, SUM(quantity_sold) as total_qty FROM chemical_sales WHERE province=?", (prov,))
        sales_row = c.fetchone()
        # Deliveries by status
        c.execute("""SELECT status, COUNT(*) as cnt FROM deliveries WHERE province=? GROUP BY status""", (prov,))
        deliveries = {r['status']: r['cnt'] for r in c.fetchall()}
        # Avg sentiment
        c.execute("""SELECT AVG(f.sentiment_score) as avg_score, COUNT(f.id) as total_feedback
                     FROM feedback f JOIN deliveries d ON f.delivery_id=d.id WHERE d.province=?""", (prov,))
        sent_row = c.fetchone()
        # Chemical count
        c.execute("SELECT COUNT(*) as cnt FROM chemicals WHERE province=?", (prov,))
        chem_count = c.fetchone()['cnt']
        # Monthly sales trend (last 6 months)
        c.execute("""SELECT strftime('%Y-%m', sale_date) as month, SUM(revenue) as rev, SUM(quantity_sold) as qty
                     FROM chemical_sales WHERE province=?
                     GROUP BY month ORDER BY month DESC LIMIT 6""", (prov,))
        monthly = [dict(r) for r in c.fetchall()]
        # Top chemicals by revenue
        c.execute("""SELECT ch.name, SUM(cs.revenue) as total_rev, SUM(cs.quantity_sold) as total_qty
                     FROM chemical_sales cs JOIN chemicals ch ON cs.chemical_id=ch.id
                     WHERE cs.province=? GROUP BY ch.name ORDER BY total_rev DESC LIMIT 5""", (prov,))
        top_chems = [dict(r) for r in c.fetchall()]

        result[prov] = {
            "total_revenue": round(sales_row['total_rev'] or 0, 2),
            "total_quantity_kg": round(sales_row['total_qty'] or 0, 2),
            "deliveries": deliveries,
            "total_deliveries": sum(deliveries.values()),
            "avg_sentiment": round(sent_row['avg_score'] or 0, 3),
            "total_feedback": sent_row['total_feedback'] or 0,
            "chemical_count": chem_count,
            "monthly_trend": list(reversed(monthly)),
            "top_chemicals": top_chems,
        }
    conn.close()
    return jsonify({"success": True, "analytics": result})

def _strip_markdown_json_fence(text):
    t = (text or '').strip()
    if t.startswith('```'):
        t = re.sub(r'^```(?:json)?\s*', '', t, flags=re.I)
        t = re.sub(r'\s*```\s*$', '', t)
    return t.strip()


def _repair_trailing_commas(blob):
    out = blob
    prev = None
    while prev != out:
        prev = out
        out = re.sub(r',(\s*})', r'\1', out)
        out = re.sub(r',(\s*])', r'\1', out)
    return out


def extract_first_balanced_json(text):
    """
    Return the first top-level {...} substring with correct brace depth (strings aware).
    Avoids grabbing a monster slice from first '{' to last '}' when the model repeats JSON.
    """
    text = text or ''
    i = text.find('{')
    if i < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for j in range(i, len(text)):
        c = text[j]
        if in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return text[i : j + 1]
    return None



def _sanitize_local_graph_payload(parsed):
    """Keep one bar chart with clean numeric series so Chart.js always renders."""
    if not isinstance(parsed, dict):
        return {'summary': '', 'charts': [], 'followups': []}
    charts_in = parsed.get('charts')
    if not isinstance(charts_in, list) or not charts_in or not isinstance(charts_in[0], dict):
        parsed['charts'] = []
        return parsed
    ch = dict(charts_in[0])
    ch['type'] = 'bar'
    rows = ch.get('data')
    cleaned = []
    if isinstance(rows, list):
        for row in rows[:10]:
            if not isinstance(row, dict):
                continue
            xv = row.get('x') if row.get('x') is not None else row.get('label')
            if xv is None:
                continue
            yv = row.get('y')
            try:
                if isinstance(yv, (int, float)):
                    yn = float(yv)
                elif yv is not None:
                    yn = float(re.sub(r'[^0-9.\-eE]', '', str(yv)) or 0)
                else:
                    continue
            except (TypeError, ValueError):
                continue
            cleaned.append({'x': str(xv)[:80], 'y': yn})
    ch['data'] = cleaned
    parsed['charts'] = [ch]
    fu = parsed.get('followups')
    if isinstance(fu, list):
        parsed['followups'] = [str(x) for x in fu[:3] if x is not None and str(x).strip()]
    summ = parsed.get('summary')
    if isinstance(summ, str) and len(summ) > 5000:
        parsed['summary'] = summ[:5000] + '…'
    return parsed


_ANALYTICS_CONTEXT_LEAK_MARKERS = re.compile(
    r'\b(?:KEY\s*METRICS|LIVE\s*DATA|CHEMICAL\s*INVENTORY|INDUSTRY\s*BENCHMARKS|ORIENTATION'
    r'|Top\s*chemicals?|Recent\s*monthly|Deliveries\s*by\s*status|Sentiment\s*by\s*province'
    r'|INTERNAL\s*DATA|Company\s*totals)\s*:',
    re.IGNORECASE,
)


def sanitize_analytics_summary(text):
    """Remove leaked prompt context or raw JSON from analytics LLM replies."""
    if not text or not isinstance(text, str):
        return ''
    s = text.strip()
    if not s:
        return ''

    m = _ANALYTICS_CONTEXT_LEAK_MARKERS.search(s)
    if m and m.start() > 0:
        s = s[:m.start()].strip()
        s = re.sub(r'[\s,;:—–-]+$', '', s)
        s = re.sub(r'\b(?:based on|from|using|per|via)\s*$', '', s, flags=re.IGNORECASE).strip()

    brace = s.find('{')
    if brace >= 0:
        blob = extract_first_balanced_json(s[brace:])
        if blob and len(blob) > 30:
            before = s[:brace].strip()
            before = re.sub(r'[\s,;:—–-]+$', '', before)
            before = re.sub(r'\b(?:based on|from|using|per|via)\s*$', '', before, flags=re.IGNORECASE).strip()
            if len(before) >= 20:
                s = before
            elif brace == 0:
                s = ''

    s = re.sub(r'\s{2,}', ' ', s).strip()
    return s


def parse_graph_query_json(raw):
    """
    Parse LLM output into {summary, charts, followups}. Tolerates markdown fences,
    trailing commas, and extra prose. Falls back to a text-only summary if needed
    (common with small local models).
    """
    raw = (raw or '').strip()
    if not raw:
        return {'summary': '', 'charts': [], 'followups': []}

    candidates = [raw, _strip_markdown_json_fence(raw)]
    last_err = None
    for cand in candidates:
        cand = cand.strip()
        blob = extract_first_balanced_json(cand)
        if blob is None:
            i = cand.find('{')
            j = cand.rfind('}')
            if i < 0 or j <= i:
                continue
            blob = cand[i : j + 1]
        for fixer in (lambda b: b, _repair_trailing_commas):
            try:
                parsed = json.loads(fixer(blob))
                if isinstance(parsed, dict):
                    return {
                        'summary': sanitize_analytics_summary(str(parsed.get('summary') or '')),
                        'charts': parsed.get('charts') if isinstance(parsed.get('charts'), list) else [],
                        'followups': parsed.get('followups') if isinstance(parsed.get('followups'), list) else [],
                    }
            except (json.JSONDecodeError, TypeError, ValueError) as e:
                last_err = e
                continue
    note = (
        'The model returned text that could not be parsed as structured JSON'
        + (f' ({last_err}).' if last_err else '.')
        + ' Raw output follows; try again or use Groq cloud for reliable chart JSON.\n\n'
    )
    cleaned = sanitize_analytics_summary(raw)
    if cleaned:
        return {'summary': cleaned, 'charts': [], 'followups': []}
    return {'summary': note + raw[:4000], 'charts': [], 'followups': []}


# =========================================================
#  ANALYTICS SNAPSHOTS (optional deep-focus context)
# =========================================================
ANALYTICS_SNAPSHOT_META = {
    'sales_ledger': {
        'label': 'Sales ledger',
        'description': 'Individual sale transactions with dates, chemicals, provinces, kg, and PKR revenue.',
        'example': 'Which day had the highest sales? Revenue for Sulfuric Acid in March?',
    },
    'inventory_full': {
        'label': 'Full inventory',
        'description': 'Complete chemical catalog — stock, thresholds, pricing, formulas, categories.',
        'example': 'Which products are below minimum threshold? Price per kg by province?',
    },
    'deliveries_ops': {
        'label': 'Deliveries & GPS',
        'description': 'Orders with status, tracking, notes, GPS coordinates, and location names.',
        'example': 'How many deliveries are stuck in transit? Map delivery hotspots.',
    },
    'feedback_reviews': {
        'label': 'Feedback & sentiment',
        'description': 'All customer reviews with AI sentiment scores and justifications.',
        'example': 'What complaints mention damaged packaging? Sentiment by chemical?',
    },
    'users_directory': {
        'label': 'Users directory',
        'description': 'Approved accounts — names, emails, roles (no passwords or API keys).',
        'example': 'How many regional admins? Who has pending approval?',
    },
    'notifications_log': {
        'label': 'Notifications',
        'description': 'In-app alerts sent to users — stock warnings, assignments, dismissals.',
        'example': 'What low-stock alerts were sent? Who was notified about deliveries?',
    },
}


def normalize_snapshot_id(val):
    if not val:
        return None
    s = str(val).strip().lower()
    return s if s in ANALYTICS_SNAPSHOT_META else None


def _rows_to_dicts(cursor):
    return [dict(r) for r in cursor.fetchall()]


def build_analytics_snapshot(snapshot_id, c):
    """Build a deep, single-domain context block for analytics (token-efficient focus)."""
    meta = ANALYTICS_SNAPSHOT_META[snapshot_id]
    parts = [f"=== FOCUSED SNAPSHOT: {meta['label'].upper()} ===", meta['description'], ""]

    if snapshot_id == 'sales_ledger':
        c.execute("SELECT COUNT(*) as cnt FROM chemical_sales")
        total = c.fetchone()['cnt']
        c.execute(
            """SELECT cs.id, cs.sale_date, ch.name as chemical, ch.formula, ch.category,
                      cs.province, cs.quantity_sold as kg, cs.revenue as revenue_PKR
               FROM chemical_sales cs JOIN chemicals ch ON cs.chemical_id=ch.id
               ORDER BY cs.sale_date DESC, cs.id DESC LIMIT 250"""
        )
        rows = _rows_to_dicts(c)
        c.execute(
            """SELECT cs.sale_date, ch.name as chemical, cs.province,
                      SUM(cs.quantity_sold) as daily_kg, SUM(cs.revenue) as daily_revenue_PKR
               FROM chemical_sales cs JOIN chemicals ch ON cs.chemical_id=ch.id
               GROUP BY cs.sale_date, ch.name, cs.province
               ORDER BY cs.sale_date DESC LIMIT 120"""
        )
        daily = _rows_to_dicts(c)
        parts.append(f"Total transactions in database: {total} (showing {len(rows)} most recent)")
        parts.append(f"TRANSACTIONS:\n{json.dumps(rows, indent=2)}")
        parts.append(f"DAILY BREAKDOWNS (sample):\n{json.dumps(daily, indent=2)}")

    elif snapshot_id == 'inventory_full':
        c.execute(
            """SELECT id, name, formula, province, category, amount_kg, min_threshold,
                      concentration_pct, price_per_kg, quantity_sold, description, created_at
               FROM chemicals ORDER BY province, name"""
        )
        rows = _rows_to_dicts(c)
        low = [r for r in rows if (r.get('amount_kg') or 0) < (r.get('min_threshold') or 0)]
        parts.append(f"Total chemicals: {len(rows)} | Below threshold: {len(low)}")
        parts.append(f"FULL CATALOG:\n{json.dumps(rows, indent=2)}")

    elif snapshot_id == 'deliveries_ops':
        c.execute("SELECT COUNT(*) as cnt FROM deliveries")
        total = c.fetchone()['cnt']
        c.execute(
            """SELECT d.id, d.tracking_code, d.status, d.province, d.quantity_kg, d.notes,
                      d.delivery_lat, d.delivery_lng, d.delivery_location_name,
                      d.notified, d.created_at, d.updated_at,
                      c.name as chemical, c.formula,
                      u.name as customer_name, u.username, u.email as customer_email,
                      ab.name as assigned_by_name
               FROM deliveries d
               JOIN chemicals c ON d.chemical_id=c.id
               JOIN users u ON d.user_id=u.id
               LEFT JOIN users ab ON d.assigned_by_id=ab.id
               ORDER BY d.created_at DESC LIMIT 200"""
        )
        rows = _rows_to_dicts(c)
        for r in rows:
            r['customer_identifier'] = r.get('customer_email') or r.get('username') or r.get('customer_name')
        c.execute("SELECT status, COUNT(*) as cnt FROM deliveries GROUP BY status")
        by_status = {r['status']: r['cnt'] for r in c.fetchall()}
        parts.append(f"Total deliveries: {total} (showing {len(rows)} most recent)")
        parts.append(f"STATUS SUMMARY: {json.dumps(by_status)}")
        parts.append(f"DELIVERY RECORDS:\n{json.dumps(rows, indent=2)}")

    elif snapshot_id == 'feedback_reviews':
        c.execute("SELECT COUNT(*) as cnt FROM feedback")
        total = c.fetchone()['cnt']
        c.execute(
            """SELECT f.id, f.text_feedback, f.sentiment_score, f.sentiment_label,
                      f.sentiment_justification, f.created_at,
                      ch.name as chemical, d.province, d.tracking_code, d.status as delivery_status,
                      u.name as user_name, u.username, u.email
               FROM feedback f
               JOIN deliveries d ON f.delivery_id=d.id
               JOIN chemicals ch ON d.chemical_id=ch.id
               JOIN users u ON f.user_id=u.id
               ORDER BY f.created_at DESC LIMIT 150"""
        )
        rows = _rows_to_dicts(c)
        for r in rows:
            r['user_identifier'] = r.get('email') or r.get('username') or r.get('user_name')
        c.execute(
            """SELECT f.sentiment_label, COUNT(*) as cnt, AVG(f.sentiment_score) as avg_score
               FROM feedback f GROUP BY f.sentiment_label"""
        )
        summary = _rows_to_dicts(c)
        parts.append(f"Total feedback entries: {total} (showing {len(rows)} most recent)")
        parts.append(f"SENTIMENT SUMMARY: {json.dumps(summary, indent=2)}")
        parts.append(f"FEEDBACK RECORDS:\n{json.dumps(rows, indent=2)}")

    elif snapshot_id == 'users_directory':
        c.execute(
            """SELECT id, username, name, email, role, approved, pending_admin, last_login
               FROM users ORDER BY role DESC, name, username"""
        )
        rows = _rows_to_dicts(c)
        c.execute("SELECT role, COUNT(*) as cnt FROM users GROUP BY role")
        by_role = {r['role']: r['cnt'] for r in c.fetchall()}
        parts.append(f"Total users: {len(rows)}")
        parts.append(f"BY ROLE: {json.dumps(by_role)}")
        parts.append(f"USER RECORDS (no passwords/API keys):\n{json.dumps(rows, indent=2)}")

    elif snapshot_id == 'notifications_log':
        c.execute("SELECT COUNT(*) as cnt FROM notifications")
        total = c.fetchone()['cnt']
        c.execute(
            """SELECT n.id, n.type, n.title, n.body, n.dismissed, n.created_at,
                      u.name as user_name, u.email as user_email, u.role as user_role
               FROM notifications n JOIN users u ON n.user_id=u.id
               ORDER BY n.created_at DESC LIMIT 200"""
        )
        rows = _rows_to_dicts(c)
        c.execute("SELECT type, COUNT(*) as cnt FROM notifications GROUP BY type")
        by_type = {r['type']: r['cnt'] for r in c.fetchall()}
        parts.append(f"Total notifications: {total} (showing {len(rows)} most recent)")
        parts.append(f"BY TYPE: {json.dumps(by_type)}")
        parts.append(f"NOTIFICATION RECORDS:\n{json.dumps(rows, indent=2)}")

    body = "\n".join(parts)
    return {
        'id': snapshot_id,
        'label': meta['label'],
        'context': body,
        'context_light': body[:12000] + ('…' if len(body) > 12000 else ''),
    }


def build_default_analytics_context(c):
    """Balanced multi-domain snapshot (current default behaviour)."""
    metrics = fetch_key_metrics(c)
    c.execute(
        """SELECT ch.name, SUM(cs.revenue) as rev, SUM(cs.quantity_sold) as qty
           FROM chemical_sales cs JOIN chemicals ch ON cs.chemical_id=ch.id
           GROUP BY ch.name ORDER BY rev DESC LIMIT 10"""
    )
    top_chems = [{"name": r['name'], "revenue": round(r['rev'], 2), "kg_sold": round(r['qty'], 2)} for r in c.fetchall()]
    c.execute(
        """SELECT strftime('%Y-%m', sale_date) as month, province, SUM(revenue) as rev, SUM(quantity_sold) as qty
           FROM chemical_sales GROUP BY month, province ORDER BY month DESC LIMIT 24"""
    )
    monthly = [dict(r) for r in c.fetchall()]
    c.execute("SELECT province, COUNT(*) as cnt, status FROM deliveries GROUP BY province, status")
    del_stats = [dict(r) for r in c.fetchall()]
    c.execute(
        """SELECT ch.name, ch.province, ch.amount_kg, ch.min_threshold, ch.quantity_sold
           FROM chemicals ch ORDER BY ch.amount_kg ASC LIMIT 12"""
    )
    inventory_snapshot = [dict(r) for r in c.fetchall()]
    sentiments = metrics['sentiment_by_province']
    prov_sales = metrics['provincial_sales']

    context = f"""ChemTech Pakistan — LIVE DATABASE (use these exact figures for all ChemTech metrics):

KEY METRICS:
{json.dumps(metrics, indent=2)}

Top 10 Chemicals (revenue + kg sold): {json.dumps(top_chems)}
Monthly Sales (recent 12 rows): {json.dumps(monthly[:12])}
Delivery Stats by Province/Status: {json.dumps(del_stats)}
Inventory Snapshot (low stock first): {json.dumps(inventory_snapshot)}"""

    context_light = (
        f"Company totals: {json.dumps(metrics)}\n"
        f"Top chemicals: {json.dumps(top_chems[:6])}\n"
        f"Recent monthly rows: {json.dumps(monthly[:8])}\n"
        f"Deliveries by status: {json.dumps(metrics['deliveries_by_status'])}\n"
        f"Sentiment by province: {json.dumps(sentiments)}"
    )
    return {
        'metrics': metrics,
        'top_chems': top_chems,
        'monthly': monthly,
        'del_stats': del_stats,
        'inventory_snapshot': inventory_snapshot,
        'prov_sales': prov_sales,
        'sentiments': sentiments,
        'context': context,
        'context_light': context_light,
        'snapshot_label': None,
    }


def build_analytics_ai_context(c, snapshot_id=None):
    """Return context strings for analytics AI. Focused snapshot OR default overview."""
    if snapshot_id:
        snap = build_analytics_snapshot(snapshot_id, c)
        orientation = {
            'mode': 'focused_snapshot',
            'snapshot': snapshot_id,
            'label': snap['label'],
            'note': 'Deep data for one domain only. Use this snapshot as the primary source.',
        }
        context = f"ORIENTATION:\n{json.dumps(orientation, indent=2)}\n\n{snap['context']}"
        context_light = f"ORIENTATION: {json.dumps(orientation)}\n\n{snap['context_light']}"
        metrics = fetch_key_metrics(c)
        # Still include aggregate chart data for supplemental visualizations
        c.execute(
            """SELECT ch.name, SUM(cs.revenue) as rev, SUM(cs.quantity_sold) as qty
               FROM chemical_sales cs JOIN chemicals ch ON cs.chemical_id=ch.id
               GROUP BY ch.name ORDER BY rev DESC LIMIT 10"""
        )
        top_chems = [{"name": r['name'], "revenue": round(r['rev'], 2), "kg_sold": round(r['qty'], 2)} for r in c.fetchall()]
        c.execute(
            """SELECT strftime('%Y-%m', sale_date) as month, province, SUM(revenue) as rev
               FROM chemical_sales GROUP BY month, province ORDER BY month DESC LIMIT 24"""
        )
        monthly = [dict(r) for r in c.fetchall()]
        return {
            'context': context,
            'context_light': context_light,
            'metrics': metrics,
            'snapshot_id': snapshot_id,
            'snapshot_label': snap['label'],
            'top_chems': top_chems,
            'monthly': monthly,
            'del_stats': [],
            'prov_sales': metrics.get('provincial_sales', {}),
            'sentiments': metrics.get('sentiment_by_province', {}),
        }
    out = build_default_analytics_context(c)
    out['snapshot_id'] = None
    return out


def build_local_snapshot_table(snapshot_id, c):
    """Deterministic table for local analytics when a focused snapshot is selected."""
    if snapshot_id == 'sales_ledger':
        c.execute(
            """SELECT cs.sale_date, ch.name, cs.province, cs.quantity_sold, cs.revenue
               FROM chemical_sales cs JOIN chemicals ch ON cs.chemical_id=ch.id
               ORDER BY cs.sale_date DESC LIMIT 20"""
        )
        rows = c.fetchall()
        return {
            'title': 'Recent Sales Transactions',
            'headers': ['Date', 'Chemical', 'Province', 'Kg', 'Revenue (PKR)'],
            'rows': [[r['sale_date'], r['name'], r['province'], f"{r['quantity_sold']:,.1f}", f"{r['revenue']:,.0f}"] for r in rows],
        }
    if snapshot_id == 'inventory_full':
        c.execute(
            "SELECT name, province, amount_kg, min_threshold, price_per_kg FROM chemicals ORDER BY amount_kg ASC"
        )
        rows = c.fetchall()
        return {
            'title': 'Full Inventory',
            'headers': ['Chemical', 'Province', 'Stock (kg)', 'Min threshold', 'Price/kg'],
            'rows': [[r['name'], r['province'], f"{r['amount_kg']:,.1f}", f"{r['min_threshold']:,.0f}", f"{r['price_per_kg']:,.0f}"] for r in rows],
        }
    if snapshot_id == 'deliveries_ops':
        c.execute(
            """SELECT d.tracking_code, c.name, d.province, d.status, d.quantity_kg,
                      d.delivery_location_name, d.created_at
               FROM deliveries d JOIN chemicals c ON d.chemical_id=c.id
               ORDER BY d.created_at DESC LIMIT 20"""
        )
        rows = c.fetchall()
        return {
            'title': 'Recent Deliveries',
            'headers': ['Tracking', 'Chemical', 'Province', 'Status', 'Kg', 'Location', 'Date'],
            'rows': [[r['tracking_code'] or '—', r['name'], r['province'], r['status'], f"{r['quantity_kg']:,.1f}",
                      r['delivery_location_name'] or '—', (r['created_at'] or '')[:10]] for r in rows],
        }
    if snapshot_id == 'feedback_reviews':
        c.execute(
            """SELECT ch.name, d.province, f.sentiment_label, f.sentiment_score, f.text_feedback
               FROM feedback f JOIN deliveries d ON f.delivery_id=d.id
               JOIN chemicals ch ON d.chemical_id=ch.id ORDER BY f.created_at DESC LIMIT 15"""
        )
        rows = c.fetchall()
        return {
            'title': 'Recent Customer Feedback',
            'headers': ['Chemical', 'Province', 'Sentiment', 'Score', 'Feedback'],
            'rows': [[r['name'], r['province'], r['sentiment_label'], f"{r['sentiment_score']:.2f}",
                      (r['text_feedback'] or '')[:80]] for r in rows],
        }
    if snapshot_id == 'users_directory':
        c.execute("SELECT name, email, role, approved, last_login FROM users ORDER BY role, name LIMIT 25")
        rows = c.fetchall()
        return {
            'title': 'Users Directory',
            'headers': ['Name', 'Email', 'Role', 'Approved', 'Last login'],
            'rows': [[r['name'] or '—', r['email'] or '—', r['role'], 'Yes' if r['approved'] else 'No',
                      (r['last_login'] or '')[:10]] for r in rows],
        }
    if snapshot_id == 'notifications_log':
        c.execute(
            """SELECT n.type, n.title, u.email, n.dismissed, n.created_at
               FROM notifications n JOIN users u ON n.user_id=u.id
               ORDER BY n.created_at DESC LIMIT 20"""
        )
        rows = c.fetchall()
        return {
            'title': 'Recent Notifications',
            'headers': ['Type', 'Title', 'User', 'Dismissed', 'Date'],
            'rows': [[r['type'], (r['title'] or '')[:40], r['email'], 'Yes' if r['dismissed'] else 'No',
                      (r['created_at'] or '')[:10]] for r in rows],
        }
    return None


@app.route('/api/ai/snapshot-options', methods=['GET', 'POST'])
def ai_snapshot_options():
    """List optional deep-focus snapshot types for AI Analytics."""
    caller_id = None
    if request.method == 'POST':
        data = request.get_json() or {}
        caller_id = data.get('caller_id')
        if not is_admin_by_id(caller_id) and not is_admin(data.get('google_id')):
            return jsonify({"success": False, "error": "Forbidden"}), 403
    options = [
        {'id': sid, **meta}
        for sid, meta in ANALYTICS_SNAPSHOT_META.items()
    ]
    return jsonify({
        'success': True,
        'options': options,
        'hint': 'Select one snapshot to send deep data for a single domain. Leave on Overview for balanced context.',
    })


# =========================================================
#  AI GRAPH QUERY
# =========================================================
def _build_local_analytics_payload(query, snapshot_id, snapshot_label, ctx_bundle, user_key, pref='local', llm_out=None):
    """Concise Ollama analytics: SQL-backed tables + short summary grounded in KEY METRICS."""
    metrics = ctx_bundle['metrics']
    top_chems = ctx_bundle.get('top_chems') or []
    monthly = ctx_bundle.get('monthly') or []
    del_stats = ctx_bundle.get('del_stats') or []
    prov_sales = ctx_bundle['prov_sales']
    sentiments = ctx_bundle['sentiments']
    context_light = ctx_bundle['context_light']
    PROVS = ["Punjab", "KPK", "Sindh", "Balochistan"]

    flags = _analytics_query_flags(query)
    is_competitor = flags['is_competitor']
    is_delivery = flags['is_delivery']
    is_sentiment = flags['is_sentiment']
    is_trend = flags['is_trend']
    is_inventory = flags['is_inventory']
    is_chemical = flags['is_chemical']
    is_underperf = flags['is_underperf']
    is_totals = flags['is_totals']

    ground_truth = build_ground_truth_block(query, metrics)
    gt_summary = ground_truth_summary_lines(ground_truth)

    used_fallback = bool(llm_out and llm_out.get("used_fallback"))
    llm_used = (llm_out or {}).get("backend", "local")
    llm_notice = _llm_fallback_notice((llm_out or {}).get("fallback_reason")) if used_fallback else None

    if gt_summary:
        summary = gt_summary
    else:
        total_annual = sum(prov_sales.get(p, {}).get('revenue_PKR', 0) for p in PROVS) * 4
        industry_ctx = ""
        if is_competitor:
            industry_ctx = (
                f"\n\nINDUSTRY BENCHMARKS (Pakistan Chemical Market 2025-26):\n"
                f"- ICI Pakistan annual revenue: ~PKR 28,000,000,000 (national)\n"
                f"- Nimir Chemicals: ~PKR 8,000,000,000/yr (Punjab)\n"
                f"- Sitara Chemicals: ~PKR 12,000,000,000/yr (Punjab)\n"
                f"- Engro Polymer: ~PKR 15,000,000,000/yr (Sindh)\n"
                f"- ChemTech annualised revenue: ~PKR {total_annual:,.0f}\n"
                f"- Pakistan chemical market growth: ~8% YoY\n"
                f"- Average industry delivery time: 3-5 days; ChemTech benchmark: 2-4 days"
            )
        prompt_local_text = (
            f"You are a concise analyst for ChemTech Pakistan.\n\n"
            f"INTERNAL DATA (read only — never repeat this block, labels, or JSON in your answer):\n{context_light}"
            f"{industry_ctx}\n\n"
            f"QUESTION: \"{query}\"\n\n"
            f"Answer in 2-4 plain sentences. Lead with the direct numeric answer. "
            f"Use figures from the data block (e.g. total_kg_sold_all_time, provincial_sales). "
            f"If comparing to competitors, cite industry estimates in plain language only. "
            f"Never paste JSON or dataset headers. No markdown, no bullet points."
        )
        if llm_out and llm_out.get("content"):
            summary = sanitize_analytics_summary((llm_out.get("content") or "").strip())
        else:
            out = llm_complete(
                [
                    {"role": "system", "content": (
                        "You are a concise business analyst. "
                        "Reply with 2-3 plain sentences only. "
                        "Use specific numbers from the data. "
                        "Never repeat dataset labels or paste JSON. "
                        "No markdown, no headers, no bullet points."
                    )},
                    {"role": "user", "content": prompt_local_text},
                ],
                temperature=0.2,
                max_tokens=OLLAMA_GRAPH_LOCAL_MAX_TOKENS,
                preference=pref,
                user_api_key=user_key,
            )
            llm_used = out.get("backend", "local")
            used_fallback = out.get("used_fallback", False)
            if used_fallback:
                llm_notice = _llm_fallback_notice(out.get("fallback_reason"))
            summary = sanitize_analytics_summary((out.get("content") or "").strip())
        if summary.startswith('{') or summary.startswith('[') or not summary:
            summary = "See data tables below for a full breakdown of ChemTech's current performance."

    tables = []
    total_annual = sum(prov_sales.get(p, {}).get('revenue_PKR', 0) for p in PROVS) * 4

    if snapshot_id:
        conn_snap = get_db()
        snap_table = build_local_snapshot_table(snapshot_id, conn_snap.cursor())
        conn_snap.close()
        if snap_table:
            tables.append(snap_table)
    elif is_totals:
        tables.append({
            "title": "Company-Wide Sales Totals",
            "headers": ["Metric", "Value"],
            "rows": [
                ["Total kg sold (all time)", f"{metrics.get('total_kg_sold_all_time', 0):,.1f} kg"],
                ["Total revenue (PKR)", f"PKR {metrics.get('total_revenue_PKR_all_time', 0):,.0f}"],
                ["Sale transactions", str(metrics.get('sale_transaction_count', 0))],
                ["Chemicals in catalog", str(metrics.get('chemicals_in_catalog', 0))],
                ["Total deliveries", str(metrics.get('total_deliveries', 0))],
                ["Feedback entries", str(metrics.get('feedback_entries', 0))],
                ["Avg sentiment (0–1)", f"{metrics.get('avg_sentiment_score_0_to_1', 0):.2f}"],
            ],
        })
        if metrics.get('sales_by_chemical'):
            tables.append({
                "title": "Kg Sold by Chemical",
                "headers": ["Chemical", "Kg Sold", "Revenue (PKR)"],
                "rows": [
                    [chem.get('name', '—'), f"{chem.get('kg_sold', 0):,.1f}", f"{chem.get('revenue_PKR', 0):,.0f}"]
                    for chem in metrics['sales_by_chemical'][:10]
                ],
            })
    elif is_competitor:
        tables.append({
            "title": "Market Comparison — Annual Revenue (PKR)",
            "headers": ["Company", "Annual Revenue (PKR)", "Scope"],
            "rows": [
                ["ICI Pakistan", "28,000,000,000", "National"],
                ["Engro Polymer", "15,000,000,000", "Sindh"],
                ["Sitara Chemicals", "12,000,000,000", "Punjab"],
                ["Nimir Chemicals", "8,000,000,000", "Punjab"],
                [f"ChemTech (annualised)", f"{total_annual:,.0f}", "National"],
            ],
        })
        tables.append({
            "title": "ChemTech Provincial Revenue (Current Period)",
            "headers": ["Province", "Revenue (PKR)", "Volume (kg)"],
            "rows": [[p, f"{prov_sales.get(p, {}).get('revenue_PKR', 0):,.0f}",
                      f"{prov_sales.get(p, {}).get('kg_sold', 0):,.1f}"] for p in PROVS],
        })
    elif is_delivery:
        prov_del = {}
        for d in del_stats:
            pr = d.get('province', '—')
            prov_del.setdefault(pr, {})
            prov_del[pr][d.get('status', '')] = d.get('cnt', 0)
        tables.append({
            "title": "Delivery Status by Province",
            "headers": ["Province", "Ordered", "Processing", "In Transit", "Delivered", "Total"],
            "rows": [
                [p,
                 str(prov_del.get(p, {}).get('ordered', 0)),
                 str(prov_del.get(p, {}).get('processing', 0)),
                 str(prov_del.get(p, {}).get('in_transit', 0)),
                 str(prov_del.get(p, {}).get('delivered', 0)),
                 str(sum(prov_del.get(p, {}).values()))]
                for p in PROVS
            ],
        })
    elif is_sentiment:
        tables.append({
            "title": "Customer Sentiment by Province",
            "headers": ["Province", "Avg Sentiment", "Rating"],
            "rows": [
                [p, f"{sentiments.get(p, 0) * 100:.0f}%",
                 "Positive" if sentiments.get(p, 0) >= 0.6
                 else "Neutral" if sentiments.get(p, 0) >= 0.4
                 else "Needs Attention"]
                for p in PROVS
            ],
        })
    elif is_trend:
        months_data = {}
        for m in monthly:
            mon = m.get('month', '')
            pr = m.get('province', '')
            months_data.setdefault(mon, {})
            months_data[mon][pr] = round(m.get('rev', 0))
        sorted_months = sorted(months_data.keys())[-6:]
        tables.append({
            "title": "Monthly Revenue Trend (PKR) — Last 6 Months",
            "headers": ["Month"] + PROVS,
            "rows": [[mon] + [f"{months_data[mon].get(p, 0):,.0f}" for p in PROVS]
                     for mon in sorted_months],
        })
        tables.append({
            "title": "Current Period Provincial Summary",
            "headers": ["Province", "Revenue (PKR)", "Volume (kg)", "Sentiment"],
            "rows": [[p, f"{prov_sales.get(p, {}).get('revenue_PKR', 0):,.0f}",
                      f"{prov_sales.get(p, {}).get('kg_sold', 0):,.1f}",
                      f"{sentiments.get(p, 0) * 100:.0f}%"] for p in PROVS],
        })
    elif is_inventory:
        conn2 = get_db()
        c2 = conn2.cursor()
        c2.execute("SELECT name, province, amount_kg, quantity_sold FROM chemicals ORDER BY amount_kg ASC LIMIT 12")
        inv_rows = [dict(r) for r in c2.fetchall()]
        conn2.close()
        tables.append({
            "title": "Chemical Inventory — Low Stock First",
            "headers": ["Chemical", "Province", "Stock (kg)", "Sold (kg)"],
            "rows": [[r["name"], r["province"], f"{r['amount_kg']:,.1f}", f"{r['quantity_sold']:,.1f}"]
                     for r in inv_rows],
        })
    elif is_chemical:
        chems_sorted = sorted(top_chems, key=lambda x: x['revenue']) if is_underperf else top_chems
        tables.append({
            "title": "Chemicals by Revenue" + (" — Lowest First" if is_underperf else " — Top Performers"),
            "headers": ["Chemical", "Revenue (PKR)"],
            "rows": [[chem["name"], f"{chem['revenue']:,.0f}"] for chem in chems_sorted[:10]],
        })
        tables.append({
            "title": "Provincial Context",
            "headers": ["Province", "Revenue (PKR)", "Volume (kg)"],
            "rows": [[p, f"{prov_sales.get(p, {}).get('revenue_PKR', 0):,.0f}",
                      f"{prov_sales.get(p, {}).get('kg_sold', 0):,.1f}"] for p in PROVS],
        })
    elif is_underperf:
        prov_sorted = sorted(PROVS, key=lambda p: prov_sales.get(p, {}).get('revenue_PKR', 0))
        tables.append({
            "title": "Provincial Revenue — Underperformers First",
            "headers": ["Province", "Revenue (PKR)", "Volume (kg)", "Sentiment"],
            "rows": [[p, f"{prov_sales.get(p, {}).get('revenue_PKR', 0):,.0f}",
                      f"{prov_sales.get(p, {}).get('kg_sold', 0):,.1f}",
                      f"{sentiments.get(p, 0) * 100:.0f}%"] for p in prov_sorted],
        })
    else:
        tables.append({
            "title": "Provincial Revenue Breakdown",
            "headers": ["Province", "Revenue (PKR)", "Volume (kg)", "Avg Sentiment"],
            "rows": [[p, f"{prov_sales.get(p, {}).get('revenue_PKR', 0):,.0f}",
                      f"{prov_sales.get(p, {}).get('kg_sold', 0):,.1f}",
                      f"{sentiments.get(p, 0) * 100:.0f}%"] for p in PROVS],
        })
        if top_chems:
            tables.append({
                "title": "Top Chemicals by Revenue",
                "headers": ["Chemical", "Revenue (PKR)"],
                "rows": [[chem["name"], f"{chem['revenue']:,.0f}"] for chem in top_chems[:8]],
            })

    followup_pool = {
        'sales_ledger': ["Which chemical had the highest single-day revenue?", "How do weekend sales compare to weekdays?", "Which province buys the most per transaction?"],
        'inventory_full': ["Which items need urgent restock?", "What is the total inventory value at current prices?", "Which category has the lowest stock levels?"],
        'deliveries_ops': ["Which deliveries are stuck in transit longest?", "Which provinces have the most GPS-mapped locations?", "What is the average delivery quantity by province?"],
        'feedback_reviews': ["What are the most common complaints?", "Which chemical has the lowest sentiment?", "How many reviews are strongly positive?"],
        'users_directory': ["How many users are pending approval?", "Which role has the most accounts?", "Who logged in most recently?"],
        'notifications_log': ["What low-stock alerts were sent?", "Which users have unread notifications?", "What delivery assignments were notified?"],
        'totals': ["Which chemical sold the most kg?", "How does revenue compare by province?", "Are any products low on stock?"],
        'competitor': ["How can we close the gap with industry leaders?", "Which province has our strongest growth?", "What is our customer sentiment vs delivery speed?"],
        'delivery': ["Which province has the most delayed deliveries?", "How does delivery volume correlate with revenue?", "What is customer sentiment by province?"],
        'sentiment': ["Which province has the lowest satisfaction?", "What chemicals are associated with negative feedback?", "How many deliveries have feedback?"],
        'trend': ["Which province grew fastest month over month?", "What is our top chemical this quarter?", "Should we increase stock in high-growth regions?"],
        'inventory': ["Which low-stock items sell the fastest?", "What is total kg sold for our scarcest chemical?", "Which province needs a restock most urgently?"],
        'chemical': ["How does this chemical perform by province?", "What is our total company-wide kg sold?", "Which category drives the most revenue?"],
        'default': ["How many kg have we sold in total?", "Which province has the highest revenue?", "What are our top-selling chemicals?"],
    }
    if snapshot_id and snapshot_id in followup_pool:
        fu_key = snapshot_id
    elif is_totals:
        fu_key = 'totals'
    elif is_competitor:
        fu_key = 'competitor'
    elif is_delivery:
        fu_key = 'delivery'
    elif is_sentiment:
        fu_key = 'sentiment'
    elif is_trend:
        fu_key = 'trend'
    elif is_inventory:
        fu_key = 'inventory'
    elif is_chemical or is_underperf:
        fu_key = 'chemical'
    else:
        fu_key = 'default'

    payload = {
        "success": True,
        "charts": [],
        "summary": summary,
        "table": tables[0] if tables else None,
        "table2": tables[1] if len(tables) > 1 else None,
        "followups": followup_pool[fu_key],
        "query": query,
        "snapshot": snapshot_id,
        "snapshot_label": snapshot_label,
        "llm_used": llm_used,
        "used_fallback": used_fallback,
    }
    if llm_notice:
        payload["llm_notice"] = llm_notice
    return payload


@app.route('/api/ai/graph-query', methods=['POST'])
def ai_graph_query():
    data = request.get_json() or {}
    caller_id = data.get('caller_id')
    if not is_admin_by_id(caller_id) and not is_admin(data.get('google_id')):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    query = (data.get('query') or '').strip()
    if not query: return jsonify({"success": False, "error": "Query required"}), 400
    user_key = _get_user_groq_key(caller_id)
    snapshot_id = normalize_snapshot_id(data.get('snapshot'))

    # Off-topic guard — intercept queries that have no business relevance
    _BIZ_KEYWORDS = [
        'chem', 'revenue', 'sales', 'province', 'deliver', 'stock',
        'inventor', 'sentiment', 'feedback', 'pakistan', 'punjab', 'sindh',
        'kpk', 'baloch', 'perform', 'trend', 'growth', 'profit', 'forecast',
        'market', 'competitor', ' kg', 'pkr', 'price', 'supply', 'demand',
        'region', 'monthly', 'quarter', 'annual', 'order', 'product',
        'what', 'which', 'how', 'show', 'our', 'we ', 'tell', 'give',
        'most', 'least', 'top', 'best', 'worst', 'highest', 'lowest',
        'popular', 'analys', 'report', 'breakdown', 'compare', 'summary',
        'total', 'average', 'improve', 'recommend', 'overview', 'data',
        'notif', 'user', 'gps', 'location', 'ledger', 'account', 'alert',
    ]
    q_lower = query.lower()
    if not any(kw in q_lower for kw in _BIZ_KEYWORDS):
        return jsonify({
            "success": True,
            "charts": [],
            "summary": "I can only answer questions about **ChemTech business data** — chemicals, sales, deliveries, provincial revenue, and operational performance. Please ask a business analytics question.",
            "followups": [
                "Which province has the highest revenue?",
                "What are our top-selling chemicals?",
                "How is delivery performance across regions?"
            ],
            "query": query,
        })

    conn = get_db()
    c = conn.cursor()
    ctx_bundle = build_analytics_ai_context(c, snapshot_id)
    conn.close()

    metrics = ctx_bundle['metrics']
    top_chems = ctx_bundle.get('top_chems') or []
    monthly = ctx_bundle.get('monthly') or []
    del_stats = ctx_bundle.get('del_stats') or []
    prov_sales = ctx_bundle['prov_sales']
    sentiments = ctx_bundle['sentiments']
    context = ctx_bundle['context']
    context_light = ctx_bundle['context_light']
    snapshot_label = ctx_bundle.get('snapshot_label')

    ground_truth = build_ground_truth_block(query, metrics)
    gt_injection = f"{ground_truth}\n\n" if ground_truth else ""

    snapshot_note = ""
    if snapshot_id:
        snapshot_note = (
            f"\nFOCUSED SNAPSHOT MODE: You are analyzing the '{snapshot_label}' dataset only. "
            "Use the snapshot records as your primary source. Do not claim data is missing if it appears in the snapshot.\n"
        )

    prompt_cloud = f"""You are an elite Market Intelligence and Data Visualization AI for ChemTech Pakistan.
Generate a comprehensive response: text summary, 2-3 interactive chart specifications, and follow-up questions.
{snapshot_note}
DATA RULES (critical):
1. The LIVE DATABASE below is authoritative for ALL ChemTech figures — revenue, kg sold, chemical counts, deliveries, sentiment.
2. Use exact numbers from KEY METRICS (e.g. total_kg_sold_all_time, sales_by_chemical, provincial_sales) — never say data is unavailable when it is in KEY METRICS.
3. Chart y-values MUST match real database numbers (not rounded guesses).
4. Only add hypothetical competitor/forecast data when the user explicitly asks about competitors, market share vs rivals, or future projections — label those series clearly as "Industry estimate" in the chart title or description.
5. If the question is simple (e.g. "how much did we sell?"), answer directly from KEY METRICS in the summary first.
6. If AUTHORITATIVE PRE-COMPUTED ANSWERS are provided below, use those exact figures in your summary and charts.

{gt_injection}LIVE DATABASE:
{context}

Admin Query: "{query}"

Respond ONLY with a valid JSON object (no markdown fences, no text outside JSON):
{{
  "summary": "Detailed analysis. Use **bold** for key PKR/kg numbers from the database. 3-5 paragraphs. Lead with the direct answer to the query.",
  "charts": [
    {{
      "type": "bar3d",
      "title": "Chart Title",
      "description": "2-3 sentence analysis of what this chart reveals using real data.",
      "xLabel": "X Axis Label",
      "yLabel": "Y Axis",
      "data": [
        {{"x": "Punjab", "y": 125000, "z": 45, "label": "Punjab"}},
        {{"x": "Sindh", "y": 98000, "z": 32, "label": "Sindh"}}
      ],
      "colorScheme": "cyan"
    }},
    {{
      "type": "doughnut",
      "title": "Market Share",
      "description": "Insight about the trend.",
      "data": [{{"x": "ChemTech", "y": 45}}, {{"x": "Other", "y": 55}}],
      "colorScheme": "purple"
    }}
  ],
  "followups": ["Follow-up question 1?", "Follow-up question 2?"]
}}

Allowable chart types: bar3d, line, radar, doughnut, bar. Pick types that best fit the query. Descriptions must cite specific figures from the database."""

    try:
        pref = normalize_llm_provider(data.get("llm_provider"))

        if pref == 'local':
            return jsonify(_build_local_analytics_payload(
                query, snapshot_id, snapshot_label, ctx_bundle, user_key, pref=pref,
            ))

        messages = [
            {"role": "system", "content": (
                "You are a JSON-only analytics API for ChemTech Pakistan. "
                "Output a single valid JSON object with keys: summary, charts, followups. "
                "All ChemTech numbers must come from the LIVE DATABASE in the user message."
            )},
            {"role": "user", "content": prompt_cloud},
        ]
        out = llm_complete(
            messages,
            temperature=0.2,
            max_tokens=GROQ_GRAPH_MAX_TOKENS,
            preference=pref,
            user_api_key=user_key,
        )
        if out.get("used_fallback"):
            payload = _build_local_analytics_payload(
                query, snapshot_id, snapshot_label, ctx_bundle, user_key,
                pref='local', llm_out=out,
            )
            return jsonify(payload)

        parsed = parse_graph_query_json(out["content"])
        payload = {
            "success": True,
            "charts": parsed.get("charts", []),
            "summary": parsed.get("summary", ""),
            "followups": parsed.get("followups", []),
            "query": query,
            "snapshot": snapshot_id,
            "snapshot_label": snapshot_label,
            "llm_used": out.get("backend", "groq"),
            "used_fallback": False,
        }
        if not payload["charts"] and not payload["summary"]:
            payload = _build_local_analytics_payload(
                query, snapshot_id, snapshot_label, ctx_bundle, user_key,
                pref='local', llm_out=out,
            )
        return jsonify(payload)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    # Werkzeug reloader forks a child; disable when spawned from Electron (CHEMTECH_NO_RELOADER=1).
    _no_reload = (os.environ.get("CHEMTECH_NO_RELOADER") or "").strip() in ("1", "true", "yes")
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True,
        use_reloader=not _no_reload,
        threaded=True,
    )
