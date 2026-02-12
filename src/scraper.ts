import { parseHTML } from "linkedom";
import type { Config, DocumentType, SearchDocument, Selector, Selectors } from "./types";
import { getSelectorConfig, getSelectorString, getSelectorsForKey, matchStartUrl } from "./config";

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
 * Extract text content from an element, cleaning whitespace.
 * For <tr> elements, concatenate <td> text with spaces between cells.
 */
function getTextContent(element: Element): string {
  if (element.tagName === "TR") {
    const cells = Array.from(element.querySelectorAll("td, th"));
    if (cells.length > 0) {
      return cells
        .map(cell => (cell.textContent || "").replace(/\s+/g, " ").trim())
        .filter(t => t.length > 0)
        .join(" ");
    }
  }
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
): string {
  const config = getSelectorConfig(selector);
  const selectorString = config.selector;

  const element = queryOne(document, selectorString);
  const text = element ? (element.textContent || "").replace(/\s+/g, " ").trim() : "";
  return text || config.default_value || "";
}

/**
 * Compute level weight for item_priority (higher = more important).
 * A record under only h1 (lvl1) is more important than one nested under h3.
 */
function computeLevelWeight(hierarchy: Record<string, string>): number {
  // Find the deepest non-empty level
  for (let i = 6; i >= 0; i--) {
    if (hierarchy[`lvl${i}`]) {
      // lvl0 only = 90, lvl1 = 80, ..., lvl6 = 30
      return (7 - i) * 10 + 20;
    }
  }
  return 0;
}

/**
 * Extract <meta name="docsearch:product"> from <head>
 */
function extractMetaProduct(document: Document): string {
  const meta = queryOne(document, 'meta[name="docsearch:product"]');
  return meta?.getAttribute("content") || "";
}

/**
 * Extract all <meta name="docsearch:tag"> from <head>
 */
function extractMetaTags(document: Document): string[] {
  const metas = queryAll(document, 'meta[name="docsearch:tag"]');
  return metas
    .map(m => m.getAttribute("content") || "")
    .filter(t => t.length > 0);
}

/**
 * Scrape a single page and extract documents
 */
export async function scrapePage(
  url: string,
  config: Config,
  selectors: Selectors,
  pageRank: number,
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
  const urlWithoutAnchor = url.split("#")[0];

  // Extract product from <meta name="docsearch:product">
  const product = extractMetaProduct(document);

  // Extract breadcrumb from CSS selector (e.g. nav[aria-label="Breadcrumb"])
  let breadcrumb = "";
  if (selectors.breadcrumb) {
    const breadcrumbSelector = getSelectorString(selectors.breadcrumb);
    const breadcrumbEl = queryOne(document, breadcrumbSelector);
    if (breadcrumbEl) {
      // Text content includes separator chars (e.g. "/"), normalize whitespace
      breadcrumb = (breadcrumbEl.textContent || "").replace(/\s+/g, " ").trim();
    }
  }

  // Extract tags: <meta name="docsearch:tag"> + CSS selector + global fallback
  let pageTags: string[] = extractMetaTags(document);
  if (selectors.tags) {
    const tagsSelector = getSelectorString(selectors.tags);
    const tagElements = queryAll(document, tagsSelector);
    const cssTags = tagElements
      .map(el => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(t => t.length > 0);
    pageTags = [...new Set([...pageTags, ...cssTags])];
  }
  if (pageTags.length === 0 && config.tags) {
    pageTags = config.tags;
  }

  // Remove excluded elements from DOM before scraping
  if (config.selectors_exclude) {
    for (const excludeSelector of config.selectors_exclude) {
      const excludeElements = queryAll(document, excludeSelector);
      for (const el of excludeElements) {
        el.remove();
      }
    }
  }

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
        url_without_anchor: urlWithoutAnchor,
        content: "",
        type: "lvl1",
        hierarchy_lvl0: globalLvl0 || lvl0Config.default_value || "",
        hierarchy_lvl1: lvl1,
        hierarchy_lvl2: "",
        hierarchy_lvl3: "",
        hierarchy_lvl4: "",
        hierarchy_lvl5: "",
        hierarchy_lvl6: "",
        product,
        breadcrumb,
        tags: pageTags,
        item_priority: pageRank * 1_000_000_000 + 90 * 1000,
      });
    }
    return documents;
  }

  // Track current hierarchy state
  const currentHierarchy: Record<string, string> = {
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
  ].filter(h => h.selector); // skip empty selectors

  // Get all content elements (headings + text) in document order
  const allSelectors = headingSelectors
    .map(h => h.selector)
    .concat(textSelector)
    .filter(s => s)
    .join(", ");

  const allElements = queryAll(document, allSelectors);
  const totalElements = allElements.length;
  let contentIndex = 0;

  for (const element of allElements) {
    // Check if this is a heading
    let isHeading = false;
    for (const { level, selector } of headingSelectors) {
      if (element.matches(selector)) {
        isHeading = true;
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        const key = `lvl${level}`;
        currentHierarchy[key] = text;

        // Clear lower levels
        for (let i = level + 1; i <= 6; i++) {
          currentHierarchy[`lvl${i}`] = "";
        }

        // Save anchor from heading for text content that follows
        lastHeadingAnchor = element.id || undefined;
        break;
      }
    }

    // If it's a text element, create document with content
    if (!isHeading && element.matches(textSelector)) {
      const content = getTextContent(element);
      if (content && content.length > 10) {
        const anchor = lastHeadingAnchor;
        const docUrl = anchor ? `${urlWithoutAnchor}#${anchor}` : urlWithoutAnchor;
        const levelWeight = computeLevelWeight(currentHierarchy);
        const positionDesc = totalElements - contentIndex;

        documents.push({
          objectID: generateObjectId(url, anchor) + "-" + documents.length,
          url: docUrl,
          url_without_anchor: urlWithoutAnchor,
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
          product,
          breadcrumb,
          tags: pageTags,
          item_priority: pageRank * 1_000_000_000 + levelWeight * 1000 + positionDesc,
        });
        contentIndex++;
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
          // Match URL to get page_rank and selectors_key
          const { page_rank, selectors_key } = matchStartUrl(url, config.start_urls);
          const selectors = getSelectorsForKey(config, selectors_key);

          const docs = await scrapePage(url, config, selectors, page_rank);
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
