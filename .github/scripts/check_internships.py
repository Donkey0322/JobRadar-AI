# flake8: noqa: E501
import os
import re
import json
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formatdate
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

import requests  # pyright: ignore[reportMissingModuleSource]

RAW_URL = "https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/dev/README.md"
SENT_PATH = Path("data/sent.json")
SENT_PATH.parent.mkdir(parents=True, exist_ok=True)

SYMBOLS_TO_EXCLUDE = ["🛂", "🇺🇸", "🔒"]
ROW_START = re.compile(r"^\s*\|")
HREF_RE = re.compile(r'href="([^"]+)"')

# 以美中時區決定今天日期 並格式化成 README 使用的樣式 例如 Oct 09
TODAY_STR = datetime.now(ZoneInfo("America/Chicago")).strftime("%b %d")


def clean_link(link: str) -> str:
    try:
        parsed = urlparse(link)
        query = parse_qsl(parsed.query)
        filtered = [(k, v) for k, v in query if not k.lower().startswith("utm_")]
        new_query = urlencode(filtered)
        return urlunparse(parsed._replace(query=new_query))
    except Exception:
        return link


def load_sent():
    if SENT_PATH.exists():
        try:
            return set(json.loads(SENT_PATH.read_text(encoding="utf-8")))
        except Exception:
            return set()
    return set()


def save_sent(sent_set):
    SENT_PATH.write_text(json.dumps(sorted(sent_set), ensure_ascii=False,
                                    indent=2), encoding="utf-8")


def fetch_readme():
    resp = requests.get(RAW_URL, timeout=30)
    resp.raise_for_status()
    return resp.text


def contains_excluded_symbols(text):
    return any(sym in text for sym in SYMBOLS_TO_EXCLUDE)


def parse_company_role_link_date(line):
    """
    期望表格行：
    | Company | Role | City, ST | <a href="...">...</a> | Oct 09 |
    回傳 (company_raw, role, link, date_str) 或 None
    """
    parts = [p.strip() for p in line.strip().strip("|").split("|")]
    if len(parts) < 5:
        return None

    company_raw = parts[0]
    role = parts[1]
    date_str = parts[-1].strip()  # 例如 Oct 09

    # 找 href
    link_html_candidates = [p for p in parts if "<a " in p and "href=" in p]
    if not link_html_candidates:
        return None
    m = HREF_RE.search(link_html_candidates[0])
    if not m:
        return None
    link = m.group(1).strip()

    return company_raw, role, link, date_str


def send_email(company, role, link):
    link = clean_link(link)
    
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")
    from_email = os.environ.get("FROM_EMAIL", "")
    to_email = os.environ.get("TO_EMAIL", "")

    if not all(
        [smtp_host, smtp_port, smtp_user, smtp_pass, from_email,
         to_email]
    ):
        raise ValueError("Email env not fully configured, skip sending.")

    subject = f"[{company}] {role} — {TODAY_STR}"
    # 🧩 HTML 信件樣式
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
    
    # MIME Multipart：可擴充純文字 + HTML
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)

    # 附上純文字備用版本（某些郵件系統會用）
    plain_text = f"Company: {company}\nRole: {role}\nLink: {link}"
    msg.attach(MIMEText(plain_text, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    # 傳送郵件
    context = ssl.create_default_context()
    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls(context=context)
        server.login(smtp_user, smtp_pass)
        server.sendmail(from_email, [to_email], msg.as_string())

    print(f"✅ Sent pretty email: {company} | {role}")


def main():
    md = fetch_readme()
    sent = load_sent()

    new_items = []
    last_company = None

    for raw_line in md.splitlines():
        line = raw_line.rstrip()
        if not ROW_START.match(line):
            continue
        if contains_excluded_symbols(line):
            continue

        parsed = parse_company_role_link_date(line)
        if not parsed:
            continue

        company_raw, role, link, date_str = parsed

        # 只處理今天的職缺
        if date_str != TODAY_STR:
            continue

        company = company_raw
        if "↳" in company_raw:
            company = last_company if last_company else "Unknown"
        else:
            last_company = company_raw

        key = link
        if key not in sent:
            new_items.append({"company": company, "role": role, "link": link})
            sent.add(key)

    if not new_items:
        print("No new items for today.")
        return

    for item in new_items:
        send_email(item["company"], item["role"], item["link"])
    save_sent(sent)
    print(f"New items sent today: {len(new_items)}")


if __name__ == "__main__":
    main()
