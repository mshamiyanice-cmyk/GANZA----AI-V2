/**
 * GANZA AI - Centralized Configuration System
 * 
 * Hierarchy of settings:
 * 1. Environment Variables (Highest - from Vercel/System)
 * 2. Local Storage (Middle - from User settings)
 * 3. Default Values (Lowest - hardcoded fallbacks)
 */

export const SYSTEM_CONFIG = {
    proxyUrl: import.meta.env.VITE_PROXY_URL,
    projectId: import.meta.env.VITE_GCP_PROJECT_ID,
    model: import.meta.env.VITE_DEFAULT_MODEL,
};

export const getAppSetting = (key, defaultValue) => {
    const isProd = import.meta.env.PROD;

    // 1. ENVIRONMENT IS THE ABSOLUTE TRUTH
    // In production, we MUST use the deployed variables.
    if (SYSTEM_CONFIG[key]) {
        return SYSTEM_CONFIG[key];
    }

    // 2. Local Storage (Only allowed in DEV for quick testing)
    if (!isProd) {
        const saved = localStorage.getItem(key);
        if (saved) return saved;
    }

    // 3. FALLBACK - We avoid localhost defaults for core connection params
    if (key === 'proxyUrl' && isProd) {
        throw new Error("❌ CRITICAL: VITE_PROXY_URL is missing in production environment!");
    }

    return defaultValue;
};
