#!/usr/bin/env python3
"""Session digest prefill — injected into every gateway turn via webui_prefill_messages_script."""
import subprocess, json, os, sys

def main():
    script = os.path.join(os.environ.get("HERMES_HOME", "/root/.hermes"), ".hermes", "scripts", "session-digest-pull.sh")
    # Try alternate path
    if not os.path.exists(script):
        script = "/root/.hermes/scripts/session-digest-pull.sh"
    
    result = subprocess.run(
        ["bash", script, "pull"],
        capture_output=True, text=True, timeout=10,
        env={**os.environ}
    )
    
    digest = result.stdout.strip()
    
    if not digest or "No active sessions" in digest:
        print(json.dumps({"status": "not_configured"}))
        return
    
    content = "\n[Session Digest — other active sessions]\n" + digest
    print(json.dumps({
        "status": "loaded",
        "source": "session_digest",
        "label": "cross-session context",
        "message_count": 1,
        "messages": [{"role": "system", "content": content}]
    }))

if __name__ == "__main__":
    main()
