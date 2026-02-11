import { MeiliSearch } from "meilisearch";
import type { MeilisearchSettings, SearchDocument } from "./types";

const BATCH_SIZE = 1000;

export interface MeilisearchClient {
  client: MeiliSearch;
  hostUrl: string;
  apiKey: string;
}

/**
 * Create Meilisearch client
 */
export function createClient(hostUrl: string, apiKey: string): MeilisearchClient {
  const client = new MeiliSearch({
    host: hostUrl,
    apiKey: apiKey,
  });

  return { client, hostUrl, apiKey };
}

/**
 * Check if index exists
 */
async function indexExists(client: MeiliSearch, indexUid: string): Promise<boolean> {
  try {
    await client.getIndex(indexUid);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete index if exists
 */
async function deleteIndex(client: MeiliSearch, indexUid: string): Promise<void> {
  try {
    const task = await client.deleteIndex(indexUid);
    await client.tasks.waitForTask(task.taskUid);
    console.log(`Deleted index: ${indexUid}`);
  } catch {
    // Index doesn't exist, ignore
  }
}

/**
 * Create index with settings
 */
async function createIndex(
  client: MeiliSearch,
  indexUid: string,
  settings: MeilisearchSettings
): Promise<void> {
  // Create index with primary key
  const createTask = await client.createIndex(indexUid, { primaryKey: "objectID" });
  await client.tasks.waitForTask(createTask.taskUid);
  console.log(`Created index: ${indexUid}`);

  // Apply settings
  const index = client.index(indexUid);
  const updatePayload: Record<string, unknown> = {};
  if (settings.filterableAttributes) updatePayload.filterableAttributes = settings.filterableAttributes;
  if (settings.displayedAttributes) updatePayload.displayedAttributes = settings.displayedAttributes;
  if (settings.searchableAttributes) updatePayload.searchableAttributes = settings.searchableAttributes;
  if (settings.rankingRules) updatePayload.rankingRules = settings.rankingRules;
  if (settings.sortableAttributes) updatePayload.sortableAttributes = settings.sortableAttributes;
  if (settings.distinctAttribute) updatePayload.distinctAttribute = settings.distinctAttribute;
  if (settings.nonSeparatorTokens) updatePayload.nonSeparatorTokens = settings.nonSeparatorTokens;
  if (settings.typoTolerance) updatePayload.typoTolerance = settings.typoTolerance;

  const settingsTask = await index.updateSettings(updatePayload);
  await client.tasks.waitForTask(settingsTask.taskUid);
  console.log(`Applied settings to index: ${indexUid}`);
}

/**
 * Add documents to index in batches
 */
async function addDocuments(
  client: MeiliSearch,
  indexUid: string,
  documents: SearchDocument[]
): Promise<void> {
  const index = client.index(indexUid);
  const total = documents.length;

  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    const task = await index.addDocuments(batch);
    await client.tasks.waitForTask(task.taskUid);
    console.log(`Indexed ${Math.min(i + BATCH_SIZE, total)}/${total} documents`);
  }
}

/**
 * Swap indexes atomically
 */
async function swapIndexes(
  client: MeiliSearch,
  indexA: string,
  indexB: string
): Promise<void> {
  const task = await client.swapIndexes([{ indexes: [indexA, indexB], rename: false }]);
  await client.tasks.waitForTask(task.taskUid);
  console.log(`Swapped indexes: ${indexA} <-> ${indexB}`);
}

/**
 * Full reindex workflow:
 * 1. Create temp index with documents
 * 2. Swap with main index
 * 3. Delete old temp index
 */
export async function reindex(
  meili: MeilisearchClient,
  indexName: string,
  documents: SearchDocument[],
  settings: MeilisearchSettings
): Promise<void> {
  const { client } = meili;
  const tempIndexName = `${indexName}_temp`;

  console.log(`\nStarting reindex for: ${indexName}`);
  console.log(`Total documents: ${documents.length}`);

  // 1. Delete temp index if exists from previous failed run
  await deleteIndex(client, tempIndexName);

  // 2. Create temp index with settings
  await createIndex(client, tempIndexName, settings);

  // 3. Add documents to temp index
  await addDocuments(client, tempIndexName, documents);

  // 4. Check if main index exists
  const mainExists = await indexExists(client, indexName);

  if (!mainExists) {
    // Create empty main index first
    console.log(`Creating main index: ${indexName}`);
    const createTask = await client.createIndex(indexName, { primaryKey: "objectID" });
    await client.tasks.waitForTask(createTask.taskUid);
  }

  // 5. Swap indexes
  await swapIndexes(client, indexName, tempIndexName);

  // 6. Delete old temp index (now contains old data)
  await deleteIndex(client, tempIndexName);

  console.log(`\nReindex completed successfully for: ${indexName}`);
}
