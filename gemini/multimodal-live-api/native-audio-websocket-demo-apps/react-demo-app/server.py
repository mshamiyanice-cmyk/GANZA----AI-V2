import asyncio
import json
import ssl
import certifi
import os
import http
from pathlib import Path
from urllib.parse import urlparse

from aiohttp import web, WSMsgType, ClientSession, ClientWebSocketResponse

# Load environment variables
from dotenv import load_dotenv, find_dotenv
load_dotenv(find_dotenv())

# Authentication imports
import google.auth
from google.auth.transport.requests import Request

# Configuration from environment variables
DEBUG = os.getenv('DEBUG', 'false').lower() == 'true'
WS_PORT = int(os.getenv('PORT', os.getenv('WS_PORT', '8080')))
GCP_PROJECT_ID = os.getenv('GCP_PROJECT_ID', '')
GCP_REGION = os.getenv('GCP_REGION', 'us-central1')
DEFAULT_MODEL = os.getenv('DEFAULT_MODEL', 'gemini-live-2.5-flash-native-audio')
_creds_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS', '').strip()
GOOGLE_APPLICATION_CREDENTIALS = _creds_path if _creds_path else None

def generate_access_token():
    """Retrieves an access token using credentials from environment."""
    try:
        # 1. Path detection logic (Self-Healing)
        render_secret_default = "/etc/secrets/googlekey.json"
        target_creds = GOOGLE_APPLICATION_CREDENTIALS
        
        if not target_creds:
            if os.path.exists(render_secret_default):
                target_creds = render_secret_default
                print(f"🔑 Auto-detected Render secret: {target_creds}")
        
        if target_creds:
            os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = target_creds
            print(f"🔑 Using service account: {target_creds}")

        # 2. Get credentials with explicit scope (Auth Fix)
        scopes = ['https://www.googleapis.com/auth/cloud-platform']
        creds, project = google.auth.default(scopes=scopes)
        
        if GCP_PROJECT_ID and project and project != GCP_PROJECT_ID:
            print(f"⚠️ Warning: Credentials project ({project}) mismatch with {GCP_PROJECT_ID}")
        
        if not creds.valid:
            print("🔄 Refreshing access token...")
            creds.refresh(Request())
        
        return creds.token
    except Exception as e:
        print(f"❌ Auth Error: {e}")
        return None

# =============================================================================
# PROXY CORE
# =============================================================================

async def proxy_bidirectional(ws_client, ws_server):
    """Bidirectional proxy between browser and Gemini."""
    async def client_to_server():
        async for msg in ws_client:
            if msg.type == WSMsgType.TEXT:
                await ws_server.send_str(msg.data)
            elif msg.type == WSMsgType.BINARY:
                await ws_server.send_bytes(msg.data)
            elif msg.type == WSMsgType.CLOSE:
                break

    async def server_to_client():
        async for msg in ws_server:
            if msg.type == WSMsgType.TEXT:
                await ws_client.send_str(msg.data)
            elif msg.type == WSMsgType.BINARY:
                await ws_client.send_bytes(msg.data)
            elif msg.type == WSMsgType.CLOSE:
                break

    await asyncio.gather(client_to_server(), server_to_client())

# =============================================================================
# HANDLERS
# =============================================================================

async def websocket_handler(request):
    """Handles WebSocket connections and proxies to Gemini."""
    ws_client = web.WebSocketResponse()
    await ws_client.prepare(request)
    
    print("🔌 New client connection...")
    
    try:
        # Initial setup message
        msg = await ws_client.receive()
        if msg.type != WSMsgType.TEXT:
            await ws_client.close(code=1008)
            return ws_client
            
        data = json.loads(msg.data)
        bearer_token = data.get("bearer_token")
        service_url = data.get("service_url")
        
        # 1. Security Validation (Gemini Fix)
        if not service_url:
            await ws_client.close(code=1008, message=b"Service URL missing")
            return ws_client
            
        allowed_host = f"{GCP_REGION}-aiplatform.googleapis.com"
        parsed = urlparse(service_url)
        if parsed.hostname != allowed_host:
            print(f"❌ Security Block: Invalid host {parsed.hostname}")
            await ws_client.close(code=1008, message=b"Unauthorized Service URL")
            return ws_client
            
        # 2. Auth generation (Self-Healing)
        if not bearer_token:
            bearer_token = generate_access_token()
            if not bearer_token:
                await ws_client.close(code=1008, message=b"Auth failed")
                return ws_client

        # 3. Connection to Gemini
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {bearer_token}",
        }
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        
        async with ClientSession() as session:
            async with session.ws_connect(service_url, headers=headers, ssl=ssl_context) as ws_server:
                print("✅ Connected to Gemini API")
                await proxy_bidirectional(ws_client, ws_server)
                
    except Exception as e:
        print(f"❌ Proxy Error: {e}")
    return ws_client

async def health_check(request):
    """Responds to GET/HEAD health checks (Claude Fix)."""
    return web.Response(text="OK\n", status=200)

async def root_router(request):
    """Routes based on Upgrade header."""
    if request.headers.get('Upgrade', '').lower() == 'websocket':
        return await websocket_handler(request)
    return await health_check(request)

# =============================================================================
# APP SETUP
# =============================================================================

def create_app():
    app = web.Application()
    app.router.add_get('/', root_router)
    app.router.add_get('/healthz', health_check)
    app.router.add_get('/ws', websocket_handler)
    return app

if __name__ == "__main__":
    print(f"🚀 Starting Master Backend on port {WS_PORT}")
    app = create_app()
    web.run_app(app, host='0.0.0.0', port=WS_PORT)