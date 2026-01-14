import { parseHTML } from "linkedom";
import type { Config, DocumentType, SearchDocument, Selector, SelectorConfig } from "./types";
import { getSelectorConfig, getSelectorString } from "./config";

// Bot User-Agent so analytics (PostHog, GA) can filter us out
const USER_AGENT = "MeilisearchDocsScraper/1.0 (https://github.com/HealthSamurai/meilisearch-docs-scraper)";

/**
 * Generate unique objectID for a document
 */
function generateObjectId(url: string, anchor?: string): string {
  const base = url + (anchor ? `#${anchor}` : "");
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    const char = base.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Extract text content from an element, cleaning whitespace
 */
function getTextContent(element: Element | null): string {
  if (!element) return "";
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

/**
 * Query single element with selector
 */
function queryOne(document: Document, selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

/**
 * Query all elements with selector
 */
function queryAll(document: Document, selector: string): Element[] {
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/**
 * Extract hierarchy level value
 */
function extractLevelValue(
  document: Document,
  selector: Selector,
  currentElement?: Element
): string {
  const config = getSelectorConfig(selector);
  const selectorString = config.selector;

  let element: Element | null = null;

  if (config.global) {
    // Global selector - search from document root
    element = queryOne(document, selectorString);
  } else if (currentElement) {
    // Find previous sibling heading or search in ancestors
    element = queryOne(document, selectorString);
  } else {
    element = queryOne(document, selectorString);
  }

  const text = getTextContent(element);
  return text || config.default_value || "";
}

/**
 * Scrape a single page and extract documents
 */
export async function scrapePage(
  url: string,
  config: Config
): Promise<SearchDocument[]> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT }
  });
  if (!response.ok) {
    console.error(`Failed to fetch ${url}: ${response.status}`);
    return [];
  }

  const html = await response.text();
  const { document } = parseHTML(html);

  const documents: SearchDocument[] = [];
  const selectors = config.selectors;

  // Extract tags from #doc-tags div if present
  const tagsContainer = document.getElementById("doc-tags");
  const pageTags = tagsContainer
    ? Array.from(tagsContainer.querySelectorAll("span"))
        .map(span => span.textContent?.trim())
        .filter((t): t is string => Boolean(t))
    : (config.tags || []);

  // Extract global hierarchy levels (lvl0, lvl1 if global)
  const lvl0Config = getSelectorConfig(selectors.lvl0);
  const lvl1Config = getSelectorConfig(selectors.lvl1);

  const globalLvl0 = lvl0Config.global
    ? extractLevelValue(document, selectors.lvl0)
    : "";
  const globalLvl1 = lvl1Config.global
    ? extractLevelValue(document, selectors.lvl1)
    : "";

  // Get text selector
  const textSelector = getSelectorString(selectors.text);
  const textElements = queryAll(document, textSelector);

  if (textElements.length === 0) {
    // No text elements found, create a single document with page title
    const lvl1 = globalLvl1 || extractLevelValue(document, selectors.lvl1);

    if (lvl1) {
      documents.push({
        objectID: generateObjectId(url),
        url,
        content: "",
        type: "lvl1",
        hierarchy_lvl0: globalLvl0 || lvl0Config.default_value || "",
        hierarchy_lvl1: lvl1,
        hierarchy_lvl2: "",
        hierarchy_lvl3: "",
        hierarchy_lvl4: "",
        hierarchy_lvl5: "",
        hierarchy_lvl6: "",
        tags: pageTags,
      });
    }
    return documents;
  }

  // Track current hierarchy state
  let currentHierarchy = {
    lvl0: globalLvl0 || lvl0Config.default_value || "",
    lvl1: globalLvl1 || "",
    lvl2: "",
    lvl3: "",
    lvl4: "",
    lvl5: "",
    lvl6: "",
  };

  // Track last heading anchor for text content
  let lastHeadingAnchor: string | undefined;

  // Find all heading elements to track hierarchy
  const headingSelectors = [
    { level: 1, selector: getSelectorString(selectors.lvl1) },
    { level: 2, selector: getSelectorString(selectors.lvl2) },
    { level: 3, selector: getSelectorString(selectors.lvl3) },
    { level: 4, selector: getSelectorString(selectors.lvl4) },
    { level: 5, selector: getSelectorString(selectors.lvl5) },
    { level: 6, selector: getSelectorString(selectors.lvl6) },
  ];

  // Get all content elements (headings + text) in document order
  const allSelectors = headingSelectors
    .map(h => h.selector)
    .concat(textSelector)
    .filter(s => s)
    .join(", ");

  const allElements = queryAll(document, allSelectors);

  for (const element of allElements) {
    // Check if this is a heading
    let isHeading = false;
    for (const { level, selector } of headingSelectors) {
      if (element.matches(selector)) {
        isHeading = true;
        const text = getTextContent(element);
        const key = `lvl${level}` as keyof typeof currentHierarchy;
        currentHierarchy[key] = text;

        // Clear lower levels
        for (let i = level + 1; i <= 6; i++) {
          const lowerKey = `lvl${i}` as keyof typeof currentHierarchy;
          currentHierarchy[lowerKey] = "";
        }

        // Save anchor from heading for text content that follows
        const anchor = element.id || undefined;
        lastHeadingAnchor = anchor;
        // Don't create document for heading itself - only track hierarchy
        // Documents are created only for text content blocks
        break;
      }
    }

    // If it's a text element, create document with content
    if (!isHeading && element.matches(textSelector)) {
      const content = getTextContent(element);
      if (content && content.length > 10) {
        // Use anchor from last heading in current hierarchy
        const anchor = lastHeadingAnchor;

        documents.push({
          objectID: generateObjectId(url, anchor) + "-" + documents.length,
          url,
          anchor,
          content,
          type: "content",
          hierarchy_lvl0: currentHierarchy.lvl0,
          hierarchy_lvl1: currentHierarchy.lvl1,
          hierarchy_lvl2: currentHierarchy.lvl2,
          hierarchy_lvl3: currentHierarchy.lvl3,
          hierarchy_lvl4: currentHierarchy.lvl4,
          hierarchy_lvl5: currentHierarchy.lvl5,
          hierarchy_lvl6: currentHierarchy.lvl6,
          tags: pageTags,
        });
      }
    }
  }

  return documents;
}

/**
 * Scrape multiple pages with concurrency control
 */
export async function scrapePages(
  urls: string[],
  config: Config,
  concurrency: number = 5
): Promise<SearchDocument[]> {
  const allDocuments: SearchDocument[] = [];
  const total = urls.length;
  let processed = 0;

  // Process in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (url) => {
        try {
          const docs = await scrapePage(url, config);
          processed++;
          console.log(`[${processed}/${total}] ${url} -> ${docs.length} docs`);
          return docs;
        } catch (error) {
          console.error(`Error scraping ${url}:`, error);
          processed++;
          return [];
        }
      })
    );

    for (const docs of results) {
      allDocuments.push(...docs);
    }
  }

  return allDocuments;
}
