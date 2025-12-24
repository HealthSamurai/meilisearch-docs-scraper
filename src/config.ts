import type { Config, Env, Selector, SelectorConfig } from "./types";

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
