/**
 * IndexedDB-backed offline cache for wiki pages and structure.
 *
 * Stores wiki pages and structure so they remain readable after a network
 * loss or server restart. Reads from the cache when the API is unreachable.
 *
 * DB: "deepwiki-offline"  version 1
 * Stores:
 *   "pages"    — keyed by "<repoId>/<slug>",  value: WikiPageDetail
 *   "structure" — keyed by "<repoId>",         value: WikiStructureResponse
 */

const DB_NAME = "deepwiki-offline";
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pages")) {
        db.createObjectStore("pages");
      }
      if (!db.objectStoreNames.contains("structure")) {
        db.createObjectStore("structure");
      }
      if (!db.objectStoreNames.contains("groups")) {
        db.createObjectStore("groups");
      }
      if (!db.objectStoreNames.contains("repositories")) {
        db.createObjectStore("repositories");
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbGet(storeName, key) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(storeName, key, value) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const req = tx.objectStore(storeName).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Silently ignore write failures (e.g. private browsing with storage blocked)
  }
}

async function idbDeleteByPrefix(storeName, prefix) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) { resolve(); return; }
        if (String(cursor.key).startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore
  }
}

export const offlineCache = {
  getRepositories() {
    return idbGet("repositories", "all");
  },

  setRepositories(repositories) {
    return idbSet("repositories", "all", repositories);
  },
  /** Retrieve a cached wiki page, or null if not cached. */
  getPage(repoId, slug) {
    return idbGet("pages", `${repoId}/${slug}`);
  },

  /** Cache a wiki page detail. */
  setPage(repoId, slug, page) {
    return idbSet("pages", `${repoId}/${slug}`, page);
  },

  /** Retrieve a cached wiki structure (pages list + repo meta), or null. */
  getStructure(repoId) {
    return idbGet("structure", String(repoId));
  },

  /** Cache a wiki structure. */
  setStructure(repoId, structure) {
    return idbSet("structure", String(repoId), structure);
  },

  /** Invalidate all cached data for a repository (called when re-indexing starts). */
  clearRepo(repoId) {
    return Promise.all([
      idbDeleteByPrefix("pages", `${repoId}/`),
      idbSet("structure", String(repoId), null),
    ]);
  },

  /** Retrieve a cached group detail (overview + repos list), or null. */
  getGroup(groupId) {
    return idbGet("groups", String(groupId));
  },

  /** Cache a group detail response. */
  setGroup(groupId, groupDetail) {
    return idbSet("groups", String(groupId), groupDetail);
  },

  /** Invalidate cached group data (called when re-indexing the group). */
  clearGroup(groupId) {
    return idbSet("groups", String(groupId), null);
  },
};
