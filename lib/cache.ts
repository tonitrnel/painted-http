import { LruCache } from './lru-cache.ts';

export type QueryCacheObject = {
  key: string
  /**
   * 缓存的Promise对象
   */
  promise: Promise<unknown>;
  /**
   * 该缓存的阶段
   */
  stage: 'pending' | 'active' | 'inactive';
  /**
   * 过期时间
   * 过期策略: 发起请求完成时的时间 + Hooks 设置的过期时间 = 过期时间 (注：多个相同 cacheKey 的 Hooks 可能会设置不同的过期时间，按第一个Hooks的过期时间计算)
   * @default 5 min
   */
  expireTime: number;
  /**
   * 缓存存活
   * @property inner: 只在当前组件生命周期内有效
   * @property outer: 在 `HttpClientProvider` 组件生命周期内有效
   * @default outer
   */
  cacheScope?: 'inner' | 'outer';
  /**
   * 当该缓存处于 pending 状态时，其他相同地请求合并进入本次请求
   */
  waitingQueue: {
    resolves: ((value: readonly [unknown, Request, Response]) => void)[];
    rejects: ((reason: unknown) => void)[];
  };
  /**
   * 用于广播给相同 Key 的Hooks
   */
  notifyQueue: Set<(subscriber: readonly [unknown, Request, Response], key: string) => void>;
};

export class QueriesCache extends LruCache<string, QueryCacheObject>{
  public invalidate(key: string): void {
    const entity = this.get(key);
    if (!entity) return void 0;
    entity.stage = "inactive"
  }
  public isStale(key: string): boolean {
    const entity = this.get(key);
    return !entity || entity.expireTime <= Date.now()
  }
}

// mod tests
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest
  describe("Tests", () => {
    it('QueriesCache invalidate', () => {
      const cache = new QueriesCache(10);
      cache.set('key1', {
        key: 'key1',
        promise: Promise.resolve(true),
        stage: 'active',
        expireTime: Date.now() + 60000, // 1分钟后过期
        waitingQueue: {
          resolves: [],
          rejects: []
        },
        notifyQueue: new Set()
      });
      expect(cache.get('key1')!.stage).to.equal('active');
      cache.invalidate('key1');
      expect(cache.get('key1')!.stage).to.equal('inactive');
      cache.invalidate('key2');
    });
    it('QueriesCache isStale', () => {
      const cache = new QueriesCache(10);
      cache.set('key1', {
        key: 'key1',
        promise: Promise.resolve(true),
        stage: 'active',
        expireTime: Date.now() + 60000, // 1分钟后过期
        waitingQueue: {
          resolves: [],
          rejects: []
        },
        notifyQueue: new Set()
      });
      expect(cache.isStale('key1')).to.equal(false);
      cache.get('key1')!.expireTime = Date.now() - 1; //设置过期时间至前1秒
      expect(cache.isStale('key1')).to.equal(true);
    });
  })
}