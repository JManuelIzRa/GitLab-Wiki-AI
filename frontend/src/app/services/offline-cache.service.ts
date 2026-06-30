import { Injectable } from '@angular/core';

const DB_NAME = 'deepwiki-offline';
const DB_VERSION = 3;

/**
 * Minimal page shape used in wiki structure listings.
 */
export interface WikiPageEntry {
  slug: string;
  title: string;
  parent_slug?: string | null;
  [key: string]: unknown;
}

/**
 * Shape returned by the wiki structure API endpoint.
 */
export interface WikiStructureResponse {
  repository: Record<string, unknown>;
  pages: WikiPageEntry[];
  [key: string]: unknown;
}

/**
 * Shape returned by the wiki page detail API endpoint.
 */
export interface WikiPageDetail {
  slug: string;
  title: string;
  content_markdown?: string;
  [key: string]: unknown;
}

/**
 * Shape returned by the group detail API endpoint.
 */
export interface GroupDetail {
  id: number | string;
  name?: string;
  group_path?: string;
  repositories?: unknown[];
  languages?: string[];
  wiki_content?: string;
  [key: string]: unknown;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('pages')) {
        db.createObjectStore('pages');
      }
      if (!db.objectStoreNames.contains('structure')) {
        db.createObjectStore('structure');
      }
      if (!db.objectStoreNames.contains('groups')) {
        db.createObjectStore('groups');
      }
      if (!db.objectStoreNames.contains('repositories')) {
        db.createObjectStore('repositories');
      }
    };
    req.onsuccess = (e: Event) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e: Event) => reject((e.target as IDBOpenDBRequest).error);
  });
}

async function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  try {
    const db = await openDB();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(storeName: string, key: IDBValidKey, value: unknown): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Silently ignore write failures (e.g. private browsing with storage blocked)
  }
}

async function idbDeleteByPrefix(storeName: string, prefix: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.openCursor();
      req.onsuccess = (e: Event) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor) {
          resolve();
          return;
        }
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

/**
 * Injectable IndexedDB-backed offline cache for wiki pages, structure,
 * groups, and repositories.
 *
 * Data survives network loss or server restart. Reads fall back to the
 * cache when the API is unreachable.
 */
@Injectable({
  providedIn: 'root',
})
export class OfflineCacheService {
  /**
   * Retrieve the full list of cached repositories, or null.
   */
  getRepositories(): Promise<Record<string, unknown>[] | null> {
    return idbGet<Record<string, unknown>[]>('repositories', 'all');
  }

  /**
   * Cache the full list of repositories.
   */
  setRepositories(repositories: Record<string, unknown>[]): Promise<void> {
    return idbSet('repositories', 'all', repositories);
  }

  /**
   * Retrieve a cached wiki page, or null if not cached.
   */
  getPage(repoId: number | string, slug: string): Promise<WikiPageDetail | null> {
    return idbGet<WikiPageDetail>('pages', `${repoId}/${slug}`);
  }

  /**
   * Cache a wiki page detail.
   */
  setPage(repoId: number | string, slug: string, page: WikiPageDetail): Promise<void> {
    return idbSet('pages', `${repoId}/${slug}`, page);
  }

  /**
   * Retrieve a cached wiki structure (pages list + repo meta), or null.
   */
  getStructure(repoId: number | string): Promise<WikiStructureResponse | null> {
    return idbGet<WikiStructureResponse>('structure', String(repoId));
  }

  /**
   * Cache a wiki structure.
   */
  setStructure(repoId: number | string, structure: WikiStructureResponse): Promise<void> {
    return idbSet('structure', String(repoId), structure);
  }

  /**
   * Invalidate all cached data for a repository (called when re-indexing starts).
   */
  clearRepo(repoId: number | string): Promise<void[]> {
    return Promise.all([
      idbDeleteByPrefix('pages', `${repoId}/`),
      idbSet('structure', String(repoId), null),
    ]);
  }

  /**
   * Retrieve a cached group detail (overview + repos list), or null.
   */
  getGroup(groupId: number | string): Promise<GroupDetail | null> {
    return idbGet<GroupDetail>('groups', String(groupId));
  }

  /**
   * Cache a group detail response.
   */
  setGroup(groupId: number | string, groupDetail: GroupDetail): Promise<void> {
    return idbSet('groups', String(groupId), groupDetail);
  }

  /**
   * Invalidate cached group data (called when re-indexing the group).
   */
  clearGroup(groupId: number | string): Promise<void> {
    return idbSet('groups', String(groupId), null);
  }
}
