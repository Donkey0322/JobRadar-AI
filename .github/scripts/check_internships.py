# flake8: noqa: E501
import os
import re
import json
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode, unquote
import unicodedata

import requests
from bs4 import BeautifulSoup

# === Sources ===
RAW_VANSH = (
    "https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/dev/README.md"
)
RAW_SIMPLIFY = "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md"

# === Storage ===
SENT_PATH = Path("data/sent.json")
SENT_PATH.parent.mkdir(parents=True, exist_ok=True)

# === Filters & Patterns ===
SYMBOLS_TO_EXCLUDE = ["🛂", "🇺🇸", "🔒"]
ROW_START = re.compile(r"^\s*\|")
HREF_RE = re.compile(r'href="([^"]+)"')

# Today string for vansh format like "Oct 15"
TODAY_STR = datetime.now(ZoneInfo("America/Chicago")).strftime("%b %d")


def load_sent():
    if SENT_PATH.exists():
        try:
            return set(json.loads(SENT_PATH.read_text(encoding="utf-8")))
        except Exception:
            return set()
    return set()


def save_sent(sent_set):
    SENT_PATH.write_text(
        json.dumps(sorted(sent_set), ensure_ascii=False, indent=2), encoding="utf-8"
    )


def fetch_text(url: str) -> str:
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.text


def contains_excluded_symbols(text: str) -> bool:
    return any(sym in text for sym in SYMBOLS_TO_EXCLUDE)


def clean_link(link: str) -> str:
    """
    移除 query 內的 utm_* 與 ref，並去掉 fragment（含 "#/"）
    只處理 query，不修改 path，避免破壞 %2F 等路徑編碼
    """
    try:
        s = urlsplit(link)
        # 只解碼 query，順手去掉 'amp;' 殘留
        raw_q = s.query or ""
        q_decoded = unquote(raw_q).replace("amp;", "")

        pairs = parse_qsl(q_decoded, keep_blank_values=True)

        def keep(kv):
            k, v = kv
            key = (k or "").lstrip(";").lower()
            # 濾掉 utm_* 與 ref
            if key.startswith("utm_"):
                return False
            if key == "ref":
                return False
            return True

        filtered = [kv for kv in pairs if keep(kv)]
        new_query = urlencode(filtered, doseq=True)

        # 去掉 fragment（例如 "#/"）
        new_frag = ""

        cleaned = urlunsplit((s.scheme, s.netloc, s.path, new_query, new_frag))

        # 如果 query 被清空，避免結尾殘留 '?'
        if cleaned.endswith("?"):
            cleaned = cleaned[:-1]

        return cleaned
    except Exception:
        return link


# ---------- vanshb03 Markdown 解析 ----------
def parse_vansh_markdown(md: str):
    """回傳 list[dict(company, role, link)] 只取今天日期 == TODAY_STR"""
    items = []
    last_company = None

    for raw_line in md.splitlines():
        line = raw_line.rstrip()
        if not ROW_START.match(line):
            continue
        if contains_excluded_symbols(line):
            continue

        parts = [p.strip() for p in line.strip().strip("|").split("|")]
        if len(parts) < 5:
            continue

        company_raw = parts[0]
        role = parts[1]
        date_str = parts[-1].strip()

        # 只抓今天
        if date_str != TODAY_STR:
            continue

        # 找 href
        link_html_candidates = [p for p in parts if "<a " in p and "href=" in p]
        if not link_html_candidates:
            continue
        m = HREF_RE.search(link_html_candidates[0])
        if not m:
            continue
        link = clean_link(m.group(1).strip())

        # 公司名處理「↳」
        company = company_raw
        if "↳" in company_raw:
            company = last_company if last_company else "Unknown"
        else:
            last_company = company_raw

        if not contains_excluded_symbols(" ".join(parts)):
            items.append({"company": company, "role": role, "link": link})
    return items


# ---------- SimplifyJobs HTML <table> 解析 ----------
def parse_simplify_html(html: str):
    """
    回傳 list[dict(company, role, link)] 只取 Age == "0d"
    結構：
      <td><strong><a href="...">Company</a></strong></td>
      <td>Role text ...</td>
      <td>Location</td>
      <td><div><a href="APPLY">...</a> <a href="Simplify">...</a></div></td>
      <td>Age</td>
    子列用 <td>↳</td> 當 company 欄，沿用上一個非箭頭公司
    """
    def _norm_text(s: str) -> str:
        # 去除前後空白、常見裝飾 emoji 與多餘空白
        s = unicodedata.normalize("NFKC", s).strip()
        # 去掉常見前綴符號（🔥、↳ 等），保留內文
        s = s.lstrip("🔥⭐→↳·•-–— ").strip()
        return s
    
    def _find_software_table(soup: BeautifulSoup):
        """
        在整份 README HTML 中，找到標題包含 'Software Engineering Internship Roles' 的小節，
        回傳它後面的第一個 <table>；找不到就回傳第一個 <table> 作為 fallback。
        """
        # 優先找 h2/h3 等 heading
        for heading in soup.find_all(["h2", "h3"]):
            if "software engineering internship roles" in heading.get_text(" ", strip=True).lower():
                nxt = heading.find_next("table")
                if nxt:
                    return nxt
        # Fallback：找註解標記 TABLE_START 之後的第一個表
        for c in soup.find_all(string=lambda t: isinstance(t, type(soup.original_encoding)) or False):
            pass  # 占位，部分頁面不容易抓註解，略過
        # 最後的保險：整頁第一個表
        return soup.find("table")
    
    items = []
    soup = BeautifulSoup(html, "html.parser")
    table = _find_software_table(soup)
    if not table:
        return items

    tbody = table.find("tbody")
    if not tbody:
        return items

    last_company = None

    for tr in tbody.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 5:
            continue

        # Company cell
        company_cell = tds[0]
        company_text_raw = company_cell.get_text(" ", strip=True)
        if contains_excluded_symbols(company_text_raw):
            continue

        if company_text_raw.strip() == "↳":
            company = last_company if last_company else "Unknown"
        else:
            a = company_cell.find("a")
            company = _norm_text(a.get_text(" ", strip=True) if a else company_text_raw)
            last_company = company

        # Role cell
        role_raw = tds[1].get_text(" ", strip=True)
        if contains_excluded_symbols(role_raw):
            continue
        role = _norm_text(role_raw)

        # Application cell：第一個 <a> 為 Apply 連結
        app_cell = tds[3]
        a_tags = app_cell.find_all("a", href=True)
        if not a_tags:
            continue
        link = clean_link(a_tags[0]["href"].strip())

        # Age cell：只要 0d
        age_text = tds[4].get_text(" ", strip=True).lower()
        if age_text != "0d":
            continue

        # 整列再檢查一次符號
        row_text = " ".join(td.get_text(" ", strip=True) for td in tds)
        if contains_excluded_symbols(row_text):
            continue

        items.append({"company": company, "role": role, "link": link})

    return items


# ---------- Email ----------
def send_email(company, role, link):
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")
    from_email = os.environ.get("FROM_EMAIL", "")
    to_email = os.environ.get("TO_EMAIL", "")

    if not all([smtp_host, smtp_port, smtp_user, smtp_pass, from_email, to_email]):
        raise ValueError("Email env not fully configured, skip sending.")

    subject = f"[{company}] {role} — {TODAY_STR}"

    plain_text = f"Company: {company}\nRole: {role}\nLink: {link}"

    html_body = f"""\
        <html>
        <body style="font-family: Arial, sans-serif; color: #333; background-color: #fafafa; padding: 30px;">
            <table align="center" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:24px;">
            <tr><td>
                <h2 style="color:#1a73e8;margin:0;">{company}</h2>
                <p style="font-size:16px;margin:8px 0 16px;"><b>Role:</b> {role}</p>
                <a href="{link}" target="_blank" style="display:inline-block;padding:10px 18px;background-color:#1a73e8;color:white;text-decoration:none;border-radius:6px;font-weight:bold;">Apply Now</a>
                <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
                <p style="font-size:13px;color:#888;">Sent automatically on {TODAY_STR}</p>
            </td></tr>
            </table>
        </body>
        </html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)
    msg.attach(MIMEText(plain_text, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    context = ssl.create_default_context()
    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls(context=context)
        server.login(smtp_user, smtp_pass)
        server.sendmail(from_email, [to_email], msg.as_string())

    print(f"✅ Sent email: {company} | {role}")


# ---------- Main ----------
def main():
    sent = load_sent()
    all_new = []

    # vansh markdown
    try:
        md1 = fetch_text(RAW_VANSH)
        vansh_items = parse_vansh_markdown(md1)
        all_new.extend(vansh_items)
    except Exception as e:
        print(f"[warn] vansh fetch/parse failed: {e}")

    # simplify html
    try:
        md2 = fetch_text(RAW_SIMPLIFY)
        simplify_items = parse_simplify_html(md2)
        all_new.extend(simplify_items)
    except Exception as e:
        print(f"[warn] simplify fetch/parse failed: {e}")

    # 去重、僅寄未寄送過的（以 link 當唯一鍵）
    to_send = []
    for it in all_new:
        key = it["link"]
        if key not in sent:
            to_send.append(it)
            sent.add(key)

    if not to_send:
        print("No new items for today.")
        return

    # 每項一封
    for it in to_send:
        send_email(it["company"], it["role"], it["link"])

    save_sent(sent)
    print(f"🎉 Sent {len(to_send)} new job emails for {TODAY_STR}")


if __name__ == "__main__":
    main()
