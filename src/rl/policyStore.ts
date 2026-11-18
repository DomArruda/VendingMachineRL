import type { PolicyData } from "./policyIO";
import { sanitizePolicyMetadata, type PolicyMetadata } from "./policyMetadata";

const DB_NAME = "vending-wars";
const INDEX_STORE = "policy-index";
const DATA_STORE = "policy-data";

export interface SavedPolicySummary {
  name: string;
  savedAt: string;
  metadata?: PolicyMetadata;
}

interface SavedPolicy extends SavedPolicySummary {
  policy: PolicyData;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(INDEX_STORE)) {
        request.result.createObjectStore(INDEX_STORE, { keyPath: "name" });
      }
      if (!request.result.objectStoreNames.contains(DATA_STORE)) {
        request.result.createObjectStore(DATA_STORE, { keyPath: "name" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open policy storage"));
  });
}

export async function listSavedPolicies(): Promise<SavedPolicySummary[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(INDEX_STORE, "readonly");
    const request = transaction.objectStore(INDEX_STORE).getAll() as IDBRequest<unknown[]>;
    request.onsuccess = () => {
      const summaries = request.result
        .flatMap((entry): SavedPolicySummary[] => {
          if (!entry || typeof entry !== "object") return [];
          const record = entry as Partial<SavedPolicySummary>;
          if (
            typeof record.name !== "string" ||
            record.name.length === 0 ||
            record.name.length > 40
          ) {
            return [];
          }
          return [{
            name: record.name,
            savedAt:
              typeof record.savedAt === "string" ? record.savedAt.slice(0, 40) : "",
            metadata: sanitizePolicyMetadata(record.metadata),
          }];
        })
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
      resolve(summaries);
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Could not list saved policies"));
    };
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not list saved policies"));
    };
  });
}

export async function loadSavedPolicy(name: string): Promise<PolicyData | null> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DATA_STORE, "readonly");
    const request = transaction.objectStore(DATA_STORE).get(name) as IDBRequest<SavedPolicy | undefined>;
    request.onsuccess = () => resolve(request.result?.policy ?? null);
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Could not load saved policy"));
    };
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not load saved policy"));
    };
  });
}

export async function savePolicy(
  rawName: string,
  policy: PolicyData
): Promise<SavedPolicySummary> {
  const name = rawName.trim();
  if (
    !name ||
    name.length > 40 ||
    name.toLowerCase() === "bundled ppo" ||
    name.toLowerCase() === "__bundled_ppo__"
  ) {
    throw new Error("Choose a name from 1 to 40 characters other than Bundled PPO");
  }
  const summary: SavedPolicySummary = {
    name,
    savedAt: new Date().toISOString(),
    metadata: sanitizePolicyMetadata(policy.metadata),
  };
  const record: SavedPolicy = {
    ...summary,
    policy: { ...policy, metadata: summary.metadata },
  };
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([INDEX_STORE, DATA_STORE], "readwrite");
    transaction.objectStore(INDEX_STORE).add(summary);
    transaction.objectStore(DATA_STORE).add(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save policy"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Policy save was cancelled"));
  }).finally(() => database.close());
  return { name, savedAt: record.savedAt, metadata: record.metadata };
}

export async function clearSavedPolicies(): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([INDEX_STORE, DATA_STORE], "readwrite");
    transaction.objectStore(INDEX_STORE).clear();
    transaction.objectStore(DATA_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clear saved policies"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Policy clear was cancelled"));
  }).finally(() => database.close());
}
