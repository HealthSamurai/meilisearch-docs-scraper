/**
 * Sitemap parser - extracts URLs from sitemap.xml
 */

import { getFetchHeaders } from "./config";

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  priority?: string;
}

/**
 * Fetch and parse sitemap.xml, returning list of URLs
 */
export async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  console.log(`Fetching sitemap: ${sitemapUrl}`);

  const response = await fetch(sitemapUrl, {
    headers: getFetchHeaders()
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  return extractUrlsFromXml(xml);
}

/**
 * Extract URLs from sitemap XML using regex (no XML parser needed)
 */
function extractUrlsFromXml(xml: string): string[] {
  const urls: string[] = [];

  // Match <loc>...</loc> tags
  const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;

  while ((match = locRegex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (url) {
      urls.push(url);
    }
  }

  console.log(`Found ${urls.length} URLs in sitemap`);
  return urls;
}

/**
 * Fetch multiple sitemaps and combine URLs
 */
export async function parseMultipleSitemaps(sitemapUrls: string[]): Promise<string[]> {
  const allUrls: Set<string> = new Set();

  for (const sitemapUrl of sitemapUrls) {
    try {
      const urls = await parseSitemap(sitemapUrl);
      urls.forEach(url => allUrls.add(url));
    } catch (error) {
      console.error(`Error parsing sitemap ${sitemapUrl}:`, error);
    }
  }

  return Array.from(allUrls);
}
