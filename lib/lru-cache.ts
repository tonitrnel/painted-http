export class Linked<K, T> {
    public prev?: Linked<K, T>;
    public next?: Linked<K, T>;
    constructor(public readonly key: K, public readonly value: T) {
        this.prev = void 0;
        this.next = void 0;
    }
}

export class LruCache<K, T> {
    private head?: Linked<K, T>;
    private tail?: Linked<K, T>;
    private readonly linkedMap: Map<K, Linked<K, T>>;
    constructor(private readonly capacity: number) {
        this.head = void 0;
        this.tail = void 0;
        this.linkedMap = new Map();
    }

    public set(key: K, value: T): void {
        if (this.linkedMap.size >= this.capacity) {
            if (this.tail) this.delete(this.tail.key);
        }
        if (this.linkedMap.has(key)) this.deleteLinked(this.linkedMap.get(key)!);
        this.linkedMap.set(key, this.insertLinked(key, value));
    }
    public delete(key: K) {
        if (!this.linkedMap.has(key)) return void 0;
        const node = this.linkedMap.get(key)!;
        this.linkedMap.delete(node.key);
        this.deleteLinked(node);
    }
    public clear() {
        this.linkedMap.clear();
        this.head = void 0;
        this.tail = void 0;
    }
    public get(key: K): T | undefined {
        if (this.linkedMap.has(key)) {
            const node = this.linkedMap.get(key)!;
            this.updateLinked(node);
            return node.value;
        }
        return void 0;
    }
    public has(key: K): boolean {
        return this.linkedMap.has(key);
    }
    public forEach(
        callbackFn: (value: T, key: K, map: Map<K, Linked<K, T>>) => void,
        thisArg?: unknown
    ): void {
        this.linkedMap.forEach(
            (node) => callbackFn(node.value, node.key, this.linkedMap),
            thisArg
        );
    }
    public entries(): IterableIterator<[K, T]> {
        const values = this.linkedMap.values();
        function* iterator() {
            let current = values.next();
            while (!current.done) {
                yield [current.value.key, current.value.value] as [K, T];
                current = values.next();
            }
        }
        return iterator();
    }
    public keys(): IterableIterator<K> {
        const head = this.head;
        const tail = this.tail;
        function* iterator() {
            let node = head;
            while (node !== void 0) {
                yield node.key;
                if (node === tail) return void 0;
                else node = node.next;
            }
        }
        return iterator();
    }
    public values(): IterableIterator<T> {
        const head = this.head;
        const tail = this.tail;
        function* iterator() {
            let node = head;
            while (node !== void 0) {
                yield node.value;
                if (node === tail) return void 0;
                else node = node.next;
            }
        }
        return iterator();
    }
    public get size() {
        return this.linkedMap.size;
    }

    /**
     * 向头插入链表节点
     * @param key
     * @param value
     * @private
     */
    private insertLinked(key: K, value: T) {
        const node = new Linked(key, value);
        if (this.head) {
            node.next = this.head;
            this.head.prev = node;
        }
        this.head = node;
        if (!this.tail) {
            this.tail = node;
        }
        return node;
    }
    /**
     * 将节点更新至链表头部
     * @param node
     * @private
     */
    private updateLinked(node: Linked<K, T>) {
        if (this.head === node) return void 0;
        if (this.tail === node) {
            this.tail = node.prev!;
            this.tail.next = void 0;
        }
        node.next = this.head;
        node.prev = void 0;
        this.head!.prev = node;
        this.head = node;
    }
    /**
     * 删除指定的链表节点
     * @param node
     * @private
     */
    private deleteLinked(node: Linked<K, T>) {
        if (this.head === node && this.tail === node) {
            this.head = void 0;
            this.tail = void 0;
        } else if (this.head === node) {
            this.head = node.next;
            this.head!.prev = void 0;
        } else if (this.tail === node) {
            this.tail = node.prev;
            this.tail!.next = void 0;
        } else {
            node.prev!.next = node.next;
            node.next!.prev = node.prev;
        }
        node.prev = void 0;
        node.next = void 0;
        return node;
    }
}

// mod tests
if (import.meta.vitest) {
    const { describe, it, expect } = import.meta.vitest;

    describe('Tests', () => {
        describe('Linked Tests', () => {
            it('should create an instance', () => {
                expect(new Linked('key', 'value')).toBeTruthy();
            });
            it('basic', () => {
                const linked = new Linked('key', 'value');
                expect(linked.key).toBe('key');
                expect(linked.value).toBe('value');
                expect(linked.next).toBeUndefined();
                expect(linked.prev).toBeUndefined();
            });
        });

        describe('LRU Cache Tests', () => {
            it('should create a new LRU Cache instance', () => {
                expect(new LruCache(3)).toBeTruthy();
            });

            it('should set and get a value from the cache', () => {
                const cache = new LruCache(10);
                cache.set('key', 'value');
                expect(cache.get('key')).toBe('value');
                expect(cache.get('naba')).toBeUndefined();
                expect(cache.size).toBe(1);
                expect([...cache.keys()]).toEqual(['key']);
            });

            it('should be replaced value and in the head position', () => {
                const cache = new LruCache<string, string>(4);
                cache.set('a', 'A');
                cache.set('b', 'B');
                cache.set('c', 'C');
                cache.set('a', 'A2');
                expect([...cache.values()]).toEqual(['A2', 'C', 'B']);
            })

            it('should remove least recently set value when cache is full', () => {
                const cache = new LruCache(2);
                cache.set('a', 'A');
                cache.set('b', 'B');
                cache.set('c', 'C');
                expect(cache.get('c')).toBe('C');
                expect(cache.get('b')).toBe('B');
                expect(cache.get('a')).toBeUndefined();
            });

            it('should keep recently accessed value when cache is full', () => {
                const cache = new LruCache(2);
                cache.set('a', 'A');
                cache.set('b', 'B');
                cache.get('a');
                cache.set('c', 'C');
                expect(cache.get('c')).toBe('C');
                expect(cache.get('b')).toBeUndefined();
                expect(cache.get('a')).toBe('A');
            });

            it('should delete a value from the cache', () => {
                const cache = new LruCache(2);
                cache.set('a', 'A');
                cache.delete('a');
                expect(cache.get('a')).toBeUndefined();
            });

            it('should delete a value from a larger cache', () => {
                const cache = new LruCache(7);
                cache.set('a', 'A');
                cache.set('b', 'B');
                cache.delete('b');
                expect(cache.get('b')).toBeUndefined();
                expect(cache.size).toBe(1);
                expect([...cache.keys()]).toEqual(['a']);
            });

            it('should not delete any values', () => {
                const cache = new LruCache(2);
                cache.set('a', 'A');
                cache.delete('b')
                expect(cache.get('a')).not.toBeUndefined();
            })

            it('should remove a value from an almost full cache', () => {
                const cache = new LruCache(3);
                cache.set('a', 'A');
                cache.set('b', 'B');
                cache.set('c', 'C');
                cache.delete('b');
                expect(cache.get('b')).toBeUndefined();
                expect(cache.size).toBe(2);
                expect([...cache.keys()]).toEqual(['c', 'a']);
            });

            it('should only keep the most recent values in the cache', () => {
                const cache = new LruCache<string, string>(3);
                for (let i = 0; i < 100; i++) {
                    cache.set(i.toString(), i.toString());
                }
                expect(cache.size).toBe(3);
                expect([...cache.values()]).toEqual(['99', '98', '97']);
            });

            it('should clear all values from the cache', () => {
                const cache = new LruCache(3);
                cache.set('a', 'A');
                cache.set('b', 'B');
                cache.clear();
                expect(cache.size).toBe(0);
                expect(cache.get('a')).toBeUndefined();
                expect(cache.get('b')).toBeUndefined();
            });

            it('should update a value in the cache', () => {
                const cache = new LruCache(3);
                cache.set('a', 'A');
                cache.set('b', 'B');
                cache.set('c', 'C');
                cache.set('a', 'AA');
                expect(cache.get('a')).toBe('AA');
                expect(cache.get('b')).toBe('B');
                expect(cache.get('c')).toBe('C');
            });

            it('should return all cache entries as array of [key, value] pairs', () => {
                const cache = new LruCache(3);
                cache.set('a', 'A');
                cache.set('b', 'B');
                cache.set('c', 'C');
                expect([...cache.entries()]).toEqual([
                    ['a', 'A'],
                    ['b', 'B'],
                    ['c', 'C'],
                ]);
            });

            it('should check if a key exists in the cache', () => {
                const cache = new LruCache(3);
                cache.set('a', 'A');
                cache.set('b', 'B');
                cache.set('c', 'C');
                expect(cache.has('a')).toBe(true);
                expect(cache.has('b')).toBe(true);
                expect(cache.has('c')).toBe(true);
                expect(cache.has('d')).toBe(false);
            });

            it('should iterate over the cache values', () => {
                const cache = new LruCache<string, string>(3);
                cache.set('a', 'A');
                cache.set('b', 'B');
                cache.set('c', 'C');
                const keys: string[] = [];
                const values: string[] = [];
                cache.forEach((value, key) => {
                    keys.push(key);
                    values.push(value);
                });
                expect(keys).toEqual(['a', 'b', 'c']);
                expect(values).toEqual(['A', 'B', 'C']);
            });
        });
    })

}