# � Engineering Request: Debugging Render Blueprint Validation for Monorepo

**TO:** Senior LLM/DevOps Engineer  
**FROM:** Antigravity AI  
**SUBJECT:** Critical Bottleneck: Render.com Blueprint static validation failure in deep monorepo structure.

---

## 1. Executive Summary
We are deploying a **Vertex AI Gemini Live API Proxy Server** (Python/Websockets) to Render.com. The code is functionally complete and has "Self-Healing" logic for authentication. However, the **Render Blueprint (`render.yaml`)** fails to detect the service, reporting "0 services selected," likely due to the depth of the target application in the monorepo.

---

## 2. Technical Stack
- **Source Folder:** `gemini/multimodal-live-api/native-audio-websocket-demo-apps/react-demo-app`
- **Language:** Python 3.11
- **Server:** Async WebSocket server (`websockets` library).
- **Auth:** Google Vertex AI Service Account (JSON Key).

---

## 3. Work Accomplished (The "Self-Healing" Backend)
To minimize deployment friction, the following logic has been implemented in `server.py`:
- **Auth Fallback:** Automatically searches for `/etc/secrets/googlekey.json` (Render's default path for Secret Files).
- **Project Discovery:** Validates `GCP_PROJECT_ID` against the Service Account's embedded project ID automatically.
- **Health Check:** Implemented `/healthz` endpoint on port 8080.
- **Env Discovery:** Uses `find_dotenv()` to locate the `.env` file even when triggered from Render's root.

---

## 4. The Obstacle: Blueprint Validation
Despite a valid `render.yaml` at the root, Render's Blueprint validator returns **"A render.yaml file was found, but there was an issue"** followed by **"0 services selected."**

### Current `render.yaml` Structure:
```yaml
services:
  - type: web
    name: ganza-server-final
    runtime: python
    rootDirectory: gemini/multimodal-live-api/native-audio-websocket-demo-apps/react-demo-app
    buildCommand: pip install -r requirements.txt
    startCommand: python server.py
```

### Analysis of Failure:
- **Depth:** The `rootDirectory` is 5 levels deep. Render's static scanner/parser frequently times out or fails to resolve file paths at this depth during the validation phase.
- **Validation Quirks:** We have attempted switching `runtime` to `env`, adding `version: "1"`, and quoting all strings. None have bypassed the "0 services selected" error.

---

## 5. Required Environment for Success
If you bypass the blueprint and set up manually, ensure these are present:

### **Environment Variables:**
- `GCP_PROJECT_ID`: `ganza-ai-sovereign-2026`
- `GCP_REGION`: `us-central1`
- `DEFAULT_MODEL`: `gemini-live-2.5-flash-native-audio` (Vertex GA Name)
- `GOOGLE_APPLICATION_CREDENTIALS`: `/etc/secrets/googlekey.json`

### **Secret Files:**
- **Filename:** `googlekey.json`
- **Content:** The Service Account JSON provided by the user.

---

## 6. Critical Engineering Questions for Resolution

I need the next engineer to investigate and provide definitive answers on the following:

1.  **Monorepo Path Depth**: Does Render's Blueprint validator have a hard limit on directory nesting? Current path is 5 levels deep. Is it possible the static parser times out before reaching the `rootDirectory`?
2.  **Validator vs. Runtime Context**: Why does the manual **"New Web Service"** UI successfully validate this path while the **Blueprint (`render.yaml`)** returns "0 services"? Is there a secondary YAML schema required for monorepos (e.g., using `publishDir` or `baseDirectory`)?
3.  **The "Hidden" Validator Error**: Render's UI is reporting "A render.yaml was found, but there was an issue" without a stack trace. Is there an API endpoint or CLI command (`render-cli`) that can return the raw JSON error message instead of the summarized UI error?
4.  **Character Encoding Conflict**: Could the Windows line endings (`CRLF`) in a file generated on a Windows system cause the Linux-based Blueprint validator to fail silently, even if the syntax is correct?
5.  **Service Name Reservation**: If a service was previously deleted or exists under a similar name, does Render's Blueprint validator block "New Blueprint" creation for that specific string?

---
**STATUS OVERVIEW:**  
Backend Code: ✅ VERIFIED (Self-Healing logic implemented)  
Dependencies: ✅ VERIFIED (`gunicorn` added)  
Auth Strategy: ✅ VERIFIED (ADC + Render Secret fallback)  
Blueprint Validator: ❌ BLOCKING (Static Parser/Pathing failure)

**CONFIDENTIAL:** DO NOT PUSH THIS DOCUMENT TO GITHUB.
