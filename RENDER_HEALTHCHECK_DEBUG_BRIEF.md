# 📟 Engineering Request: Resolving "HEAD" Method Incompatibility on Render

**DATE:** 2026-01-23  
**TO:** Senior Backend / DevOps Engineer  
**RE:** WebSocket Server (Python/websockets) Health Check Failure

---

## 1. Current Status: "Functionally Live, Infrastructure Failing"
The GANZA AI backend is successfully deployed on Render:
- **Root URL:** `https://ganza-ai-v2.onrender.com/`
- **Verification:** Browsing to the URL returns a `426 Upgrade Required`, confirming the Python process is active on port 8080.
- **Problem:** Render's health checks are failing, causing logs to fill with errors and potential service restarts.

---

## 2. The Core Technical Blocker
The logs reveal a persistent failure whenever Render's load balancer probes the service:

```python
ValueError: unsupported HTTP method; expected GET; got HEAD
websockets.exceptions.InvalidMessage: did not receive a valid HTTP request
```

### **Technical Breakdown:**
1.  **Strict Parser:** The `websockets` library (used for the proxy) has a hardcoded HTTP parser (`websockets.http11.py`) that **only** accepts `GET`.
2.  **Infrastructure Behavior:** Render (and many other cloud providers) uses `HEAD` requests for health checks to verify service availability without downloading the full body.
3.  **Parsing Timing:** Because the `ValueError` happens during the **initial character parsing of the HTTP method**, our custom `process_request=handle_health_check` hook is **never reached**. The library crashes before it can ask us what to do with the request.

---

## 3. Evidence & Reproducibility
*   **Log Trace:** `File "/opt/render/project/src/.venv/lib/python3.13/site-packages/websockets/http11.py", line 151, in parse`
*   **Direct Result:** Status code 400 is likely returned to Render, or the connection is dropped, leading to an "Unhealthy" state.

---

## 4. Work Done to Date
- [x] Implemented a `handle_health_check` hook for `/healthz` and `/`.
- [x] Verified URLs manually via browser.
- [x] Confirmed the server is "Self-Healing" for GCP credentials (access tokens are generating correctly).

---

## 5. Engineering Questions for Resolution
1.  **Parser Bypass:** Is there a supported way to monkey-patch or configure the `websockets` parser to ignore or accept `HEAD` methods?
2.  **Shared Port Strategy:** Since Render only exposes one port (8080), how can we run a lightweight HTTP health check (e.g., via `aiohttp` or a raw `asyncio` listener) on the same port while still allowing `websockets` to handle the upgrade?
3.  **Render Workaround:** Can the health check be converted to a "TCP Connect" check instead of an "HTTP GET/HEAD" check in `render.yaml`? (Note: Render's "Web Service" usually requires a valid HTTP response on the health path).
4.  **Library Swap:** Is it time to switch the entry-point from `websockets.serve` to an `aiohttp.web` application that supports both HTTP and WebSocket seamlessly?

---

## 6. Project Assets
- **Repository Root:** [GANZA----AI-V2](https://github.com/mshamiyanice-cmyk/GANZA----AI-V2)
- **Target App:** `gemini/multimodal-live-api/native-audio-websocket-demo-apps/react-demo-app`
- **Entry Point:** `server.py`

**CONFIDENTIAL:** DO NOT PUSH THIS DOCUMENT TO GITHUB.
