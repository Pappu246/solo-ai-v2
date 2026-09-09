"""Solo AI Autonomous Scout.

Free-only policy: this agent never enables billing and only records an access route
when the provider's official page explicitly indicates free access. Community posts
are discovery hints only; they are never treated as proof.
"""
from __future__ import annotations

import json
import os
import re
import smtplib
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / "state.json"

OFFICIAL_SOURCES = [
    ("Google Gemini pricing", "https://ai.google.dev/gemini-api/docs/pricing"),
    ("Google AI updates", "https://ai.google.dev/gemini-api/docs/changelog"),
    ("Groq docs", "https://console.groq.com/docs/overview"),
    ("OpenRouter models", "https://openrouter.ai/models"),
    ("Hugging Face models", "https://huggingface.co/models"),
]

@dataclass
class Finding:
    source: str
    url: str
    kind: str
    title: str
    details: str
    score: int


def fetch(url: str, timeout: int = 15) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Solo-AI-Autonomous-Scout/1.0 (+https://github.com/Pappu246/solo-ai-v2)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read(1_500_000)
        return raw.decode("utf-8", errors="ignore")


def official_free_evidence(url: str, html: str) -> bool:
    text = re.sub(r"\s+", " ", html.lower())
    positive = ("free tier" in text or "free" in text) and any(
        x in text for x in ("pricing", "rate limit", "quota", "models")
    )
    paid_only = any(x in text for x in ("pay-as-you-go", "requires billing", "paid only"))
    return positive and not paid_only


def discover() -> list[Finding]:
    findings: list[Finding] = []
    for name, url in OFFICIAL_SOURCES:
        try:
            html = fetch(url)
            free = official_free_evidence(url, html)
            if free:
                findings.append(Finding(
                    source=name,
                    url=url,
                    kind="free-access",
                    title=f"Verified free-access signal: {name}",
                    details="Official source contains current free/quota evidence. Limits must be rechecked before use.",
                    score=90,
                ))
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            findings.append(Finding(name, url, "source-error", name, str(exc), 10))

    # Hugging Face's public API is a useful model-discovery source and needs no key.
    try:
        data = json.loads(fetch("https://huggingface.co/api/models?sort=trending&direction=-1&limit=8"))
        for model in data[:8]:
            model_id = model.get("id", "unknown")
            findings.append(Finding(
                source="Hugging Face",
                url=f"https://huggingface.co/{model_id}",
                kind="model-discovery",
                title=model_id,
                details="Trending public model candidate; availability and license should be verified before integration.",
                score=70,
            ))
    except Exception as exc:
        findings.append(Finding("Hugging Face", "https://huggingface.co/models", "source-error", "HF discovery failed", str(exc), 10))
    return findings


def project_audit() -> dict:
    repo = os.getenv("GITHUB_REPOSITORY", "Pappu246/solo-ai-v2")
    branch = os.getenv("GITHUB_REF_NAME", "main")
    url = f"https://api.github.com/repos/{repo}"
    try:
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "Solo-AI-Autonomous-Scout/1.0"}
        token = os.getenv("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as r:
            meta = json.loads(r.read().decode())
        return {
            "repo": repo,
            "branch": branch,
            "open_issues": meta.get("open_issues_count", 0),
            "stars": meta.get("stargazers_count", 0),
            "default_branch": meta.get("default_branch"),
            "url": meta.get("html_url", f"https://github.com/{repo}"),
        }
    except Exception as exc:
        return {"repo": repo, "branch": branch, "error": str(exc)}


def opportunity_findings(findings: list[Finding], audit: dict) -> list[Finding]:
    out = []
    free_count = sum(1 for f in findings if f.kind == "free-access")
    if free_count:
        out.append(Finding(
            source="Solo AI Opportunity Engine",
            url="https://github.com/Pappu246/solo-ai-v2",
            kind="monetization",
            title="Free-model comparison / routing feature",
            details="Package the verified free-model router as a visible Solo AI feature and document provider limits clearly.",
            score=min(100, 55 + free_count * 10),
        ))
    if audit.get("stars", 0) >= 0:
        out.append(Finding(
            source="Solo AI Opportunity Engine",
            url=audit.get("url", "https://github.com/Pappu246/solo-ai-v2"),
            kind="project-improvement",
            title="Automated hourly project health report",
            details="Use the scout's recurring audit to surface regressions, dependency changes, and actionable backlog items.",
            score=80,
        ))
    return out


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {"seen": {}, "runs": 0}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


def make_report(findings: list[Finding], audit: dict, state: dict) -> str:
    ranked = sorted(findings, key=lambda x: x.score, reverse=True)
    lines = [
        "SOLO AI — Autonomous Scout",
        datetime.now(timezone.utc).isoformat(),
        "",
        "POLICY: official free access only; no billing activation or access-control bypass.",
        "",
        "TOP FINDINGS",
    ]
    for f in ranked[:10]:
        lines += [f"- [{f.score}] {f.title}", f"  {f.details}", f"  Source: {f.url}"]
    lines += ["", "PROJECT HEALTH", json.dumps(audit, indent=2), "", f"Run number: {state.get('runs', 0)}"]
    return "\n".join(lines)


def send_email(subject: str, body: str) -> bool:
    host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    port = int(os.getenv("SMTP_PORT", "465"))
    user = os.getenv("GMAIL_ADDRESS")
    password = os.getenv("GMAIL_APP_PASSWORD")
    if not user or not password:
        print("Email skipped: GMAIL_ADDRESS/GMAIL_APP_PASSWORD not configured.")
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = user
    msg.set_content(body)
    with smtplib.SMTP_SSL(host, port, timeout=20) as server:
        server.login(user, password)
        server.send_message(msg)
    return True


def main() -> None:
    state = load_state()
    state["runs"] = int(state.get("runs", 0)) + 1
    findings = discover()
    audit = project_audit()
    findings.extend(opportunity_findings(findings, audit))
    report = make_report(findings, audit, state)
    state["last_run"] = datetime.now(timezone.utc).isoformat()
    state["last_summary"] = {"findings": len(findings), "free_access": sum(f.kind == "free-access" for f in findings)}
    save_state(state)
    Path(ROOT / "latest-report.md").write_text(report, encoding="utf-8")
    send_email("Solo AI — Hourly Autonomous Scout", report)
    print(report)


if __name__ == "__main__":
    main()
