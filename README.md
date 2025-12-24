# Meilisearch Docs Scraper

A fast, lightweight documentation scraper for [Meilisearch](https://www.meilisearch.com/) built with [Bun](https://bun.sh/).

## Why not use the official docs-scraper?

The official [meilisearch/docs-scraper](https://github.com/meilisearch/docs-scraper) is a great tool, but it has some limitations:

|                   | docs-scraper                       | meilisearch-docs-scraper       |
| ----------------- | ---------------------------------- | ------------------------------ |
| Runtime           | Python + Scrapy + Chromium         | Bun (single binary)            |
| Docker image      | ~1GB                               | **~150MB**                     |
| JS rendering      | Yes (Chromium)                     | No                             |
| Speed (500 pages) | ~3-5 min                           | **~1 min**                     |
| Zero-downtime     | No (overwrites index)              | **Yes (atomic index swap)**    |
| Deps count        | ~50+ (Chromium, OpenSSL, libxml2)  | **3 (linkedom, meilisearch)**  |

**Use this scraper if:**

- Your documentation is server-side rendered (SSR)
- You don't need JavaScript rendering
- You want a smaller, faster Docker image
- You want to minimize security vulnerabilities
- You need zero-downtime reindexing (atomic index swap)

**Use the official docs-scraper if:**

- Your documentation requires JavaScript to render (SPA)
- You need advanced authentication (Cloudflare, IAP, Keycloak)

## Features

- **100% compatible** with docs-scraper config format
- **Multi-config support** — index multiple sites in one run
- **Sitemap-based** URL discovery
- **CSS selector-based** content extraction
- **Hierarchical heading structure** (lvl0-lvl6) with anchor links
- **Zero-downtime reindexing** with atomic index swapping
- **Concurrent scraping** (10 pages in parallel)
- **Batch indexing** (100 documents per batch)
- **Stop URLs** filtering
- **Proper error handling** with task waiting (no `sleep()` hacks)
- **Automatic cleanup** of failed previous runs

## Quick Start

```bash
docker run --rm \
  -e MEILISEARCH_HOST_URL=http://host.docker.internal:7700 \
  -e MEILISEARCH_API_KEY=your-api-key \
  -v $(pwd)/config.json:/app/config.json \
  ghcr.io/healthsamurai/meilisearch-docs-scraper:latest
```

## Usage

### Docker (recommended)

```bash
docker run --rm \
  -e MEILISEARCH_HOST_URL=http://meilisearch:7700 \
  -e MEILISEARCH_API_KEY=your-api-key \
  -e INDEX_NAME=docs \
  -v $(pwd)/config.json:/app/config.json \
  ghcr.io/healthsamurai/meilisearch-docs-scraper:latest
```

### Environment Variables

| Variable               | Required | Description                     |
| ---------------------- | -------- | ------------------------------- |
| `MEILISEARCH_HOST_URL` | Yes      | Meilisearch server URL          |
| `MEILISEARCH_API_KEY`  | Yes      | Meilisearch API key             |
| `INDEX_NAME`           | No       | Override index name from config |

### Kubernetes CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: meilisearch-reindex
spec:
  schedule: "0 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: scraper
              image: ghcr.io/healthsamurai/meilisearch-docs-scraper:latest
              env:
                - name: MEILISEARCH_HOST_URL
                  value: "http://meilisearch:7700"
                - name: MEILISEARCH_API_KEY
                  valueFrom:
                    secretKeyRef:
                      name: meilisearch-secret
                      key: api-key
                - name: INDEX_NAME
                  value: "docs"
              volumeMounts:
                - name: config
                  mountPath: /app/config.json
                  subPath: config.json
          volumes:
            - name: config
              configMap:
                name: scraper-config
```

### Multiple Configs (Single Job)

Index multiple sites in one run — useful for reducing k8s jobs:

```bash
docker run --rm \
  -e MEILISEARCH_HOST_URL=http://meilisearch:7700 \
  -e MEILISEARCH_API_KEY=your-api-key \
  -v $(pwd)/configs:/configs \
  ghcr.io/healthsamurai/meilisearch-docs-scraper:latest \
  /configs/docs.json /configs/fhirbase.json /configs/auditbox.json
```

Each config creates its own index (from `index_uid` in config).

### Run from Source

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone https://github.com/HealthSamurai/meilisearch-docs-scraper.git
cd meilisearch-docs-scraper
bun install

# Single config
MEILISEARCH_HOST_URL=http://localhost:7700 \
MEILISEARCH_API_KEY=your-api-key \
bun run src/index.ts config.json

# Multiple configs
MEILISEARCH_HOST_URL=http://localhost:7700 \
MEILISEARCH_API_KEY=your-api-key \
bun run src/index.ts docs.json fhirbase.json auditbox.json
```

## Configuration

Uses the same config format as the official docs-scraper:

```json
{
  "index_uid": "docs",
  "sitemap_urls": ["https://example.com/sitemap.xml"],
  "start_urls": ["https://example.com/docs/"],
  "stop_urls": ["https://example.com/docs/deprecated"],
  "selectors": {
    "lvl0": {
      "selector": "nav li:last-child",
      "global": true,
      "default_value": "Documentation"
    },
    "lvl1": "article h1",
    "lvl2": "article h2",
    "lvl3": "article h3",
    "lvl4": "article h4",
    "lvl5": "article h5",
    "lvl6": "article h6",
    "text": "article p, article li, article td"
  },
  "custom_settings": {
    "searchableAttributes": [
      "hierarchy_lvl1",
      "hierarchy_lvl2",
      "hierarchy_lvl3",
      "content"
    ],
    "rankingRules": [
      "attribute",
      "words",
      "typo",
      "proximity",
      "sort",
      "exactness"
    ]
  }
}
```

## How It Works

1. **Fetch sitemap** — Parses sitemap.xml to get all documentation URLs
2. **Filter URLs** — Excludes URLs matching `stop_urls` patterns
3. **Scrape pages** — Fetches pages concurrently (10 at a time) and extracts content
4. **Build hierarchy** — Tracks heading levels (h1→h6) with anchor links for deep linking
5. **Index to temp** — Creates `{index}_temp` and pushes documents in batches of 100
6. **Atomic swap** — Swaps temp with production index (zero downtime)
7. **Cleanup** — Deletes the old temp index

### Zero-Downtime Index Swap

```
                    ┌─────────────┐
   Scrape pages ───►│ docs_temp   │ (new data)
                    └──────┬──────┘
                           │ swap
                    ┌──────▼──────┐
   Search works ───►│ docs        │ (now has new data)
                    └─────────────┘
                           │ delete
                    ┌──────▼──────┐
                    │ docs_temp   │ ✗ deleted
                    └─────────────┘
```

Search remains available throughout the entire reindex process.

## Development

```bash
# Run locally
bun run src/index.ts config.json

# Type check
bun run tsc --noEmit

# Build
bun build src/index.ts --outdir dist
```

## License

MIT
