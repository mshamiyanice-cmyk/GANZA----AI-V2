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

/**
 * Retrieves an application setting based on the priority hierarchy.
 * @param {string} key - The configuration key (e.g., 'proxyUrl')
 * @param {any} defaultValue - Fallback value if no setting is found
 * @returns {any} The resolved setting value
 */
export const getAppSetting = (key, defaultValue) => {
    // 1. Check if the environment has a hard override (e.g. from Vercel)
    if (SYSTEM_CONFIG[key]) {
        return SYSTEM_CONFIG[key];
    }

    // 2. Check user's local preference
    const saved = localStorage.getItem(key);
    if (saved) {
        return saved;
    }

    // 3. Fallback to default
    return defaultValue;
};
