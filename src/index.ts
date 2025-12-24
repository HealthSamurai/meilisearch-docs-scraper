#!/usr/bin/env bun
/**
 * Meilisearch Docs Scraper
 *
 * Usage:
 *   bun run src/index.ts <config.json> [config2.json] [config3.json] ...
 *
 * Environment variables:
 *   MEILISEARCH_HOST_URL - Meilisearch server URL
 *   MEILISEARCH_API_KEY  - Meilisearch API key
 *   INDEX_NAME           - Override index name from config (optional, only for single config)
 */

import { loadConfig, loadEnv, shouldSkipUrl, type Config } from "./config";
import { parseMultipleSitemaps } from "./sitemap";
import { scrapePages } from "./scraper";
import { createClient, reindex, type MeilisearchClient } from "./meilisearch";

interface ProcessResult {
  configPath: string;
  indexName: string;
  pages: number;
  documents: number;
  duration: number;
  error?: string;
}

async function processConfig(
  configPath: string,
  meili: MeilisearchClient,
  indexNameOverride?: string
): Promise<ProcessResult> {
  const startTime = Date.now();

  console.log("\n" + "=".repeat(60));
  console.log(`Processing: ${configPath}`);
  console.log("=".repeat(60));

  try {
    // Load configuration
    const config = await loadConfig(configPath);

    // Determine index name (override or from config)
    const indexName = indexNameOverride || config.index_uid.replace(/_temp$/, "");
    console.log(`Index: ${indexName}`);

    // Fetch URLs from sitemaps
    console.log("\n--- Fetching Sitemaps ---");
    let urls: string[] = [];

    if (config.sitemap_urls?.length) {
      urls = await parseMultipleSitemaps(config.sitemap_urls);
    } else if (config.start_urls?.length) {
      urls = config.start_urls;
    }

    // Filter out stop URLs
    if (config.stop_urls?.length) {
      const originalCount = urls.length;
      urls = urls.filter(url => !shouldSkipUrl(url, config.stop_urls));
      const filtered = originalCount - urls.length;
      if (filtered > 0) {
        console.log(`Filtered ${filtered} URLs matching stop_urls`);
      }
    }

    console.log(`Total URLs to scrape: ${urls.length}`);

    if (urls.length === 0) {
      return {
        configPath,
        indexName,
        pages: 0,
        documents: 0,
        duration: (Date.now() - startTime) / 1000,
        error: "No URLs to scrape"
      };
    }

    // Scrape pages
    console.log("\n--- Scraping Pages ---");
    const documents = await scrapePages(urls, config, 10);

    console.log(`\nTotal documents extracted: ${documents.length}`);

    if (documents.length === 0) {
      return {
        configPath,
        indexName,
        pages: urls.length,
        documents: 0,
        duration: (Date.now() - startTime) / 1000,
        error: "No documents extracted"
      };
    }

    // Reindex in Meilisearch
    console.log("\n--- Indexing in Meilisearch ---");
    await reindex(meili, indexName, documents, config.custom_settings);

    return {
      configPath,
      indexName,
      pages: urls.length,
      documents: documents.length,
      duration: (Date.now() - startTime) / 1000
    };
  } catch (error) {
    return {
      configPath,
      indexName: "unknown",
      pages: 0,
      documents: 0,
      duration: (Date.now() - startTime) / 1000,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  const totalStartTime = Date.now();

  // Parse command line arguments - support multiple configs
  const configPaths = process.argv.slice(2);
  if (configPaths.length === 0) {
    console.error("Usage: bun run src/index.ts <config.json> [config2.json] [config3.json] ...");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("Meilisearch Docs Scraper");
  console.log("=".repeat(60));
  console.log(`\nConfigs to process: ${configPaths.length}`);
  configPaths.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));

  // Load environment variables
  const env = loadEnv();
  console.log(`\nMeilisearch URL: ${env.MEILISEARCH_HOST_URL}`);

  // Create Meilisearch client (shared for all configs)
  const meili = createClient(env.MEILISEARCH_HOST_URL, env.MEILISEARCH_API_KEY);

  // Process each config sequentially
  const results: ProcessResult[] = [];

  for (const configPath of configPaths) {
    // INDEX_NAME override only makes sense for single config
    const indexOverride = configPaths.length === 1 ? env.INDEX_NAME : undefined;
    const result = await processConfig(configPath, meili, indexOverride);
    results.push(result);
  }

  // Summary
  const totalDuration = ((Date.now() - totalStartTime) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));

  let totalPages = 0;
  let totalDocs = 0;
  let hasErrors = false;

  for (const r of results) {
    const status = r.error ? `❌ ${r.error}` : "✅";
    console.log(`\n${r.configPath}:`);
    console.log(`  Index: ${r.indexName}`);
    console.log(`  Pages: ${r.pages}, Documents: ${r.documents}`);
    console.log(`  Time: ${r.duration.toFixed(1)}s`);
    console.log(`  Status: ${status}`);

    totalPages += r.pages;
    totalDocs += r.documents;
    if (r.error) hasErrors = true;
  }

  console.log("\n" + "-".repeat(60));
  console.log(`Total: ${totalPages} pages, ${totalDocs} documents`);
  console.log(`Total time: ${totalDuration}s`);
  console.log("=".repeat(60));

  if (hasErrors) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
