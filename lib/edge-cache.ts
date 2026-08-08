interface EdgeStaleCacheOptions {
  freshMs: number;
  staleMs: number;
  maxEntries?: number;
  now?: () => number;
}

interface EdgeStaleCacheEntry<Value> {
  value: Value | undefined;
  hasValue: boolean;
  refreshedAt: number;
  refreshPromise?: Promise<Value>;
}

export class EdgeStaleCache<Value> {
  private entries = new Map<string, EdgeStaleCacheEntry<Value>>();
  private readonly now: () => number;

  constructor(private readonly options: EdgeStaleCacheOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  get(key: string, load: () => Promise<Value>): Promise<Value> {
    const entry = this.entries.get(key);
    const now = this.now();

    if (
      entry?.hasValue &&
      now - entry.refreshedAt < this.options.freshMs
    ) {
      this.touch(key, entry);
      return Promise.resolve(entry.value as Value);
    }

    if (
      entry?.hasValue &&
      now - entry.refreshedAt < this.options.staleMs
    ) {
      void this.refresh(key, load);
      return Promise.resolve(entry.value as Value);
    }

    // `staleMs` is the hard freshness ceiling. Once it has elapsed, remove the
    // old value before loading so an outage cannot keep a deleted or revoked
    // public record alive indefinitely.
    if (entry?.hasValue) this.entries.delete(key);

    return this.refresh(key, load);
  }

  private refresh(key: string, load: () => Promise<Value>): Promise<Value> {
    const entry = this.entries.get(key);
    if (entry?.refreshPromise) return entry.refreshPromise;

    // Convert a synchronous loader throw into a rejected promise while still
    // invoking the loader immediately, which preserves cold-load coalescing.
    let loaded: Promise<Value>;
    try {
      loaded = load();
    } catch (error) {
      loaded = Promise.reject(error);
    }
    const refreshPromise = loaded
      .then((value) => {
        this.setEntry(key, {
          value,
          hasValue: true,
          refreshedAt: this.now(),
        });
        return value;
      })
      .catch((err) => {
        if (entry?.hasValue) return entry.value as Value;
        throw err;
      })
      .finally(() => {
        const current = this.entries.get(key);
        if (!current) return;
        if (!current.hasValue) {
          this.entries.delete(key);
          return;
        }
        delete current.refreshPromise;
      });

    this.setEntry(
      key,
      entry ? { ...entry, refreshPromise } : {
        value: undefined,
        hasValue: false,
        refreshedAt: 0,
        refreshPromise,
      },
    );
    return refreshPromise;
  }

  private setEntry(key: string, entry: EdgeStaleCacheEntry<Value>) {
    this.pruneExpired();
    const maxEntries = this.options.maxEntries;
    if (
      maxEntries &&
      !this.entries.has(key) &&
      this.entries.size >= maxEntries
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) this.entries.delete(oldestKey);
    }
    // Map iteration order is the eviction order, so replace existing entries
    // to make recently loaded/refreshed keys the most recently used.
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private touch(key: string, entry: EdgeStaleCacheEntry<Value>) {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private pruneExpired() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (
        entry.hasValue &&
        !entry.refreshPromise &&
        now - entry.refreshedAt >= this.options.staleMs
      ) {
        this.entries.delete(key);
      }
    }
  }
}
