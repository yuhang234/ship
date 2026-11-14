/**
 * 写作后台的本地草稿仓库（IndexedDB）。
 *
 * 只用一个 objectStore `drafts`，按 `key`（`kind:id`）存取；
 * 目的很朴素：断网、关标签页、或者还没登录时，写下的内容不能丢。
 * 隐私模式下 IndexedDB 可能完全不可用，此时所有函数静默降级（返回空值、不抛错），
 * 只在第一次失败时给一条警告。
 */

export type DraftKind = 'thought' | 'article';

export interface Draft {
  /** `${kind}:${id}`，id 为 'new' 或文章 slug */
  key: string;
  kind: DraftKind;
  /** 最后写入时间（Date.now()） */
  updatedAt: number;
  /** 可选标题，用于草稿列表摘要 */
  title?: string;
  /** 表单原始值，按页面自定形状 */
  payload: Record<string, unknown>;
  /** 已存在远端文件的路径 */
  remotePath?: string;
  /** 已存在远端文件的 sha */
  remoteSha?: string;
}

const DB_NAME = 'ship-studio';
const DB_VERSION = 1;
const STORE = 'drafts';
const INDEX_UPDATED = 'by-updatedAt';

let dbPromise: Promise<IDBDatabase | null> | null = null;
let hasWarned = false;

/** 只提示一次，避免每次输入都刷控制台。 */
function warnOnce(reason: unknown): void {
  if (hasWarned) return;
  hasWarned = true;
  console.warn('[ship studio] 本地草稿不可用（可能处于隐私模式或已禁用存储）：', reason);
}

/** 打开数据库；失败或不可用时返回 null，并缓存结果避免反复尝试。 */
function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.open !== 'function') {
      warnOnce('indexedDB 不存在');
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      warnOnce(error);
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex(INDEX_UPDATED, 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      warnOnce(request.error);
      resolve(null);
    };
    request.onblocked = () => {
      warnOnce('数据库被其他标签页占用');
      resolve(null);
    };
  });
  return dbPromise;
}

/** 把 IDBRequest 包装成 Promise。 */
function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
  });
}

/** 等待事务提交完成。 */
function waitTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务被中止'));
  });
}

/** 保存（覆盖）一份草稿。 */
export async function saveDraft(draft: Draft): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    const record: Draft = { ...draft, updatedAt: draft.updatedAt || Date.now() };
    transaction.objectStore(STORE).put(record);
    await waitTransaction(transaction);
  } catch (error) {
    warnOnce(error);
  }
}

/** 按 key 读取草稿；不存在时返回 null。 */
export async function getDraft(key: string): Promise<Draft | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const transaction = db.transaction(STORE, 'readonly');
    const result = await wrapRequest<Draft | undefined>(transaction.objectStore(STORE).get(key));
    return result ?? null;
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

/** 列出草稿（可按类型过滤），按 updatedAt 倒序。 */
export async function listDrafts(kind?: DraftKind): Promise<Draft[]> {
  const db = await openDatabase();
  if (!db) return [];
  try {
    const transaction = db.transaction(STORE, 'readonly');
    const all = await wrapRequest<Draft[]>(transaction.objectStore(STORE).getAll());
    return all
      .filter((draft) => (kind ? draft.kind === kind : true))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (error) {
    warnOnce(error);
    return [];
  }
}

/** 删除单份草稿。 */
export async function deleteDraft(key: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(key);
    await waitTransaction(transaction);
  } catch (error) {
    warnOnce(error);
  }
}

/** 清空全部草稿（导出备份后清场时用）。 */
export async function clearDrafts(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).clear();
    await waitTransaction(transaction);
  } catch (error) {
    warnOnce(error);
  }
}