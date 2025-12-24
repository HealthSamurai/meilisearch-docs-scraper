/**
 * Selector can be a simple string or an object with options
 */
export interface SelectorConfig {
  selector: string;
  global?: boolean;
  default_value?: string;
}

export type Selector = string | SelectorConfig;

/**
 * Selectors configuration matching docs-scraper format
 */
export interface Selectors {
  lvl0: Selector;
  lvl1: Selector;
  lvl2: Selector;
  lvl3: Selector;
  lvl4: Selector;
  lvl5: Selector;
  lvl6: Selector;
  text: Selector;
}

/**
 * Meilisearch index settings
 */
export interface MeilisearchSettings {
  filterableAttributes?: string[];
  displayedAttributes?: string[];
  searchableAttributes?: string[];
  rankingRules?: string[];
  distinctAttribute?: string;
}

/**
 * Main configuration file format (compatible with docs-scraper)
 */
export interface Config {
  index_uid: string;
  start_urls: string[];
  sitemap_urls: string[];
  stop_urls: string[];
  selectors: Selectors;
  custom_settings: MeilisearchSettings;
}

/**
 * Document type - matches docs-scraper format
 */
export type DocumentType = "content" | "lvl0" | "lvl1" | "lvl2" | "lvl3" | "lvl4" | "lvl5" | "lvl6";

/**
 * Document to be indexed in Meilisearch
 */
export interface SearchDocument {
  objectID: string;
  url: string;
  anchor?: string;
  content: string;
  type: DocumentType;
  hierarchy_lvl0: string;
  hierarchy_lvl1: string;
  hierarchy_lvl2: string;
  hierarchy_lvl3: string;
  hierarchy_lvl4: string;
  hierarchy_lvl5: string;
  hierarchy_lvl6: string;
}

/**
 * Environment variables
 */
export interface Env {
  MEILISEARCH_HOST_URL: string;
  MEILISEARCH_API_KEY: string;
  INDEX_NAME?: string;
}
