/**
 * Counts and times the database calls of one request and reports them in a Server-Timing header, so a slow
 * request can be read from the browser's network panel: how many calls, and how long the request waited on them.
 * DB_DELAY_MS (local development only) adds a fixed wait to every call, to stand in for a far-away database.
 */
export interface DbStats {
  calls: number;
  spans: [number, number][];
}

export function timedDb(db: D1Database, stats: DbStats, delayMs = 0): D1Database {
  const track = async <T>(run: () => Promise<T>): Promise<T> => {
    const t0 = performance.now();
    stats.calls++;
    try {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return await run();
    } finally {
      stats.spans.push([t0, performance.now()]);
    }
  };
  const raws = new WeakMap<object, D1PreparedStatement>();
  const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(st, {
      get(target, prop) {
        if (prop === "bind") return (...a: unknown[]) => wrap(target.bind(...a));
        if (prop === "first" || prop === "all" || prop === "run" || prop === "raw")
          return (...a: unknown[]) => track(() => (target as never as Record<string, (...x: unknown[]) => Promise<unknown>>)[prop](...a));
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    raws.set(proxy, st);
    return proxy;
  };
  return {
    prepare: (sql: string) => wrap(db.prepare(sql)),
    batch: (list: D1PreparedStatement[]) => track(() => db.batch(list.map((s) => raws.get(s) ?? s))),
    exec: (q: string) => track(() => db.exec(q)),
    withSession: (...a: Parameters<D1Database["withSession"]>) => db.withSession(...a),
    dump: () => db.dump(),
  } as D1Database;
}

/** Milliseconds during which at least one call was in flight. */
export function waitedMs(stats: DbStats): number {
  const s = [...stats.spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of s) {
    if (a > end) total += b - a;
    else if (b > end) total += b - end;
    end = Math.max(end, b);
  }
  return total;
}
