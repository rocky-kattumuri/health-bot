from datetime import datetime, timedelta
from dateutil import parser
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import smtplib

def parse_iso_datetime(value: str) -> datetime:
    value = value.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)


def send_email(to_email, subject, body):
    sender_email = os.getenv("EMAIL_SENDER")
    sender_password = os.getenv("SMTP_PASSWORD")
    if not sender_email or not sender_password:
        raise RuntimeError(
            "Email is not configured. Set EMAIL_SENDER and SMTP_PASSWORD in the backend environment."
        )

    msg = MIMEMultipart()
    msg["From"] = sender_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))
    smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", 587))

    try:
        with smtplib.SMTP(smtp_server, smtp_port, timeout=15) as server:
            server.starttls()
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, to_email, msg.as_string())
    except Exception as e:
        raise RuntimeError(f"SMTP delivery failed: {e}") from e
    return True


def parse_natural_date(text: str) -> datetime:
    try:
        # Handle relative dates
        now = datetime.now()
        if "tomorrow" in text.lower():
            base_date = now + timedelta(days=1)
            return parser.parse(text, default=base_date)
        return parser.parse(text)
    except Exception as e:
        raise ValueError(f"Could not parse date: {str(e)}")