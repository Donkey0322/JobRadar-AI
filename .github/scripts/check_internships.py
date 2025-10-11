import os
import re
import json
import smtplib
import ssl
from email.mime.text import MIMEText
from email.utils import formatdate
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

import requests  # pyright: ignore[reportMissingModuleSource]

RAW_URL = "https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/dev/README.md"
SENT_PATH = Path("data/sent.json")
SENT_PATH.parent.mkdir(parents=True, exist_ok=True)

SYMBOLS_TO_EXCLUDE = ["🛂", "🇺🇸", "🔒"]
ROW_START = re.compile(r"^\s*\|")
HREF_RE = re.compile(r'href="([^"]+)"')

# 以美中時區決定今天日期 並格式化成 README 使用的樣式 例如 Oct 09
TODAY_STR = datetime.now(ZoneInfo("America/Chicago")).strftime("%b %d")


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
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    from_email = os.environ.get("FROM_EMAIL")
    to_email = os.environ.get("TO_EMAIL")

    if not all(
        [smtp_host, smtp_port, smtp_user, smtp_pass, from_email,
         to_email]
    ):
        raise ValueError("Email env not fully configured, skip sending.")

    subject = f"[{company}] {role} — {TODAY_STR}"
    body = f"Company: {company}\nRole: {role}\nLink: {link}"

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = from_email if from_email else "Unknown"
    msg["To"] = to_email if to_email else "Unknown"
    msg["Date"] = formatdate(localtime=True)

    context = ssl.create_default_context()
    with smtplib.SMTP(
        smtp_host if smtp_host else "Unknown",
        smtp_port
    ) as server:
        server.starttls(context=context)
        server.login(
            smtp_user if smtp_user else "Unknown",
            smtp_pass if smtp_pass else "Unknown")
        server.sendmail(
            from_email if from_email else "Unknown",
            [to_email if to_email else "Unknown"],
            msg.as_string()
        )


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
