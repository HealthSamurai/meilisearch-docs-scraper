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
  tags?: Selector;  // Optional selector for tags
}

/**
 * start_urls entry — string (backward compat) or object with page_rank + selectors_key
 */
export interface StartUrlConfig {
  url: string;           // regex pattern matched against page URL
  page_rank: number;     // higher = more important (docs=10, blog=5, landing=3)
  selectors_key: string; // key into selectors map
}

export type StartUrl = string | StartUrlConfig;

/**
 * Meilisearch index settings
 */
export interface MeilisearchSettings {
  filterableAttributes?: string[];
  displayedAttributes?: string[];
  searchableAttributes?: string[];
  rankingRules?: string[];
  sortableAttributes?: string[];
  distinctAttribute?: string;
  nonSeparatorTokens?: string[];
  typoTolerance?: {
    enabled?: boolean;
    minWordSizeForTypos?: { oneTypo?: number; twoTypos?: number };
  };
}

/**
 * Main configuration file format (compatible with docs-scraper)
 *
 * Selectors can be:
 * - A single Selectors object (old format, backward compatible)
 * - A map of { key: Selectors } for selectors_key routing
 */
export interface Config {
  index_uid: string;
  start_urls: StartUrl[];
  sitemap_urls: string[];
  stop_urls: string[];
  selectors: Selectors | Record<string, Selectors>;
  selectors_exclude?: string[];
  custom_settings: MeilisearchSettings;
  tags?: string[];  // Global tags for all documents
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
  url_without_anchor: string;
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
  product: string;
  tags: string[];
  item_priority: number;
}

/**
 * Environment variables
 */
export interface Env {
  MEILISEARCH_HOST_URL: string;
  MEILISEARCH_API_KEY: string;
  INDEX_NAME?: string;
}
