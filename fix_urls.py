RAILWAY_URL = 'https://web-production-fe869d.up.railway.app'

for fname in ['main.js', 'features.js']:
    with open(fname, encoding='utf-8') as f:
        c = f.read()

    old_const = "const API_BASE = '${API_BASE}';"
    new_const = f"const API_BASE = '{RAILWAY_URL}';"
    c = c.replace(old_const, new_const)

    old_fetch = "'${API_BASE}/"
    new_fetch = "API_BASE + '/"
    c = c.replace(old_fetch, new_fetch)

    # Also fix features.js API constant if it still has the literal string
    old_api = "const API = '${API_BASE}';"
    new_api = "const API = (typeof API_BASE !== 'undefined') ? API_BASE : '{RAILWAY_URL}';"
    c = c.replace(old_api, new_api.replace('{RAILWAY_URL}', RAILWAY_URL))

    with open(fname, 'w', encoding='utf-8') as f:
        f.write(c)

    count_base = c.count('API_BASE')
    count_broken = c.count('${API_BASE}')
    print(f'{fname}: {count_base} API_BASE refs, {count_broken} broken ${"{"}API_BASE{"}"} remaining')
