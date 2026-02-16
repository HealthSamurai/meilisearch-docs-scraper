import type { Config, Env, Selector, SelectorConfig, Selectors, StartUrl, StartUrlConfig } from "./types";

const USER_AGENT = "MeilisearchDocsScraper/1.0 (https://github.com/HealthSamurai/meilisearch-docs-scraper)";

/**
 * Build headers for fetching pages, including basic auth if configured
 */
export function getFetchHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  const user = process.env.BASIC_AUTH_USERNAME;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (user && pass) {
    headers["Authorization"] = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }
  return headers;
}

/**
 * Load and parse config file
 */
export async function loadConfig(configPath: string): Promise<Config> {
  const file = Bun.file(configPath);
  const config = await file.json() as Config;

  validateConfig(config);
  return config;
}

/**
 * Validate config has required fields
 */
function validateConfig(config: Config): void {
  if (!config.index_uid) {
    throw new Error("Config missing required field: index_uid");
  }
  if (!config.sitemap_urls?.length && !config.start_urls?.length) {
    throw new Error("Config must have either sitemap_urls or start_urls");
  }
  if (!config.selectors) {
    throw new Error("Config missing required field: selectors");
  }
}

/**
 * Load environment variables
 */
export function loadEnv(): Env {
  const hostUrl = process.env.MEILISEARCH_HOST_URL;
  const apiKey = process.env.MEILISEARCH_API_KEY;

  if (!hostUrl) {
    throw new Error("Missing required env var: MEILISEARCH_HOST_URL");
  }
  if (!apiKey) {
    throw new Error("Missing required env var: MEILISEARCH_API_KEY");
  }

  return {
    MEILISEARCH_HOST_URL: hostUrl,
    MEILISEARCH_API_KEY: apiKey,
    INDEX_NAME: process.env.INDEX_NAME,
  };
}

/**
 * Get selector string from Selector type
 */
export function getSelectorString(selector: Selector): string {
  if (typeof selector === "string") {
    return selector;
  }
  return selector.selector;
}

/**
 * Get selector config with defaults
 */
export function getSelectorConfig(selector: Selector): SelectorConfig {
  if (typeof selector === "string") {
    return { selector };
  }
  return selector;
}

/**
 * Check if URL should be skipped based on stop_urls
 */
export function shouldSkipUrl(url: string, stopUrls: string[]): boolean {
  return stopUrls.some(stopUrl => url.startsWith(stopUrl));
}

/**
 * Check if selectors config is a map (multiple selector sets) or a single Selectors object.
 * Old format has `lvl0` key directly; new format has named keys like "docs", "blog", "default".
 */
function isSelectorsMap(selectors: Selectors | Record<string, Selectors>): selectors is Record<string, Selectors> {
  return !("lvl0" in selectors);
}

/**
 * Get the Selectors for a given selectors_key.
 * If config uses old single-selectors format, always returns that.
 */
export function getSelectorsForKey(config: Config, key?: string): Selectors {
  if (!isSelectorsMap(config.selectors)) {
    return config.selectors;
  }
  if (key && key in config.selectors) {
    return config.selectors[key];
  }
  // Fallback: try "default", then first key
  if ("default" in config.selectors) {
    return config.selectors["default"];
  }
  const firstKey = Object.keys(config.selectors)[0];
  return config.selectors[firstKey];
}

/**
 * Match a URL against start_urls to get page_rank and selectors_key.
 * Returns defaults if no match or start_urls uses old string format.
 */
export function matchStartUrl(url: string, startUrls: StartUrl[]): { page_rank: number; selectors_key?: string } {
  for (const entry of startUrls) {
    if (typeof entry === "string") continue;

    const config = entry as StartUrlConfig;
    try {
      const regex = new RegExp(config.url);
      if (regex.test(url)) {
        return { page_rank: config.page_rank, selectors_key: config.selectors_key };
      }
    } catch {
      // Invalid regex, try simple prefix match
      if (url.includes(config.url)) {
        return { page_rank: config.page_rank, selectors_key: config.selectors_key };
      }
    }
  }
  return { page_rank: 1 };
}
