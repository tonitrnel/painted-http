import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { useHttpClient } from './client.ts';
import { useLatestFunc, useLatestRef } from '@painted/shared';
import {
  isEquals,
  isArray,
  isDef,
  isNumber,
  isPlainObject,
  isString,
  pick,
  pipe,
} from '@painted/shared';
import { QueryCacheObject } from './cache.ts';

type HttpSchemaProperties = {
  Query: {};
  Path: {};
  Body: {};
  Headers: {};
  Response: unknown;
  Error: unknown;
};

type ApplicableKeys = keyof HttpSchemaProperties;

// type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | string;

export class HttpFactory<S extends HttpSchemaProperties> {
  constructor(readonly method: string, readonly pathname: string) {}
  public static reconstruct<F extends Function, S extends InferFullSType<F>>(
    fn: F
  ) {
    if (!Reflect.has(fn, ' __source'))
      throw new Error(`Unable to reconstruct the ${fn.name} function`);
    const { method, pathname } = Reflect.get(fn, ' __source') as {
      method: string;
      pathname: string;
    };
    return new HttpFactory<S>(method, pathname);
  }
  public apply<K extends ApplicableKeys, T>() {
    // override prev same type
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return this as unknown as HttpFactory<Omit<S, K> & Record<K, T>>;
  }
  public doQueryRequest = () => {
    const { pathname, method } = this;
    let seq = 0;
    function useHttpQueryRequest<Mutated>(
      options: HttpQueryHookOptions<S, Mutated> = {}
    ) {
      type MutatedData = DecisionResponseType<S['Response'], Mutated>;
      const exposeRef = useRef<{
        data?: MutatedData | undefined;
        error?: S['Error'] | undefined;
        response?: Response;
        request?: Request;
      }>({});
      const metadataRef = useRef<{
        pending?: boolean;
        // 标记组件是否卸载
        unmount?: boolean;
        // 标记组件第一次是否加载完成
        done?: boolean;
        // 标准当前请求的ID
        requestId?: string | undefined;
        // 查询参数
        query?: S['Query'];
        // 路径参数
        path?: S['Path'];
        // 当前Hooks缓存的ID
        cachedIds?: Set<string>;
      }>({});
      // 强制刷新
      const dispatchUpdate = useReducer(() => ({}), { pathname })[1];
      const client = useHttpClient();
      // 引用最新的配置
      const blendRef = useLatestRef({
        ...options,
        client,
        cache: options.cache === true ? { key: pathname } : options.cache,
        fetcher: options.fetcher || client.options.fetcher,
      });
      // 构建参数依赖
      const dependencies = useMemo(() => {
        const { query: previousQuery, path: previousPath } =
          metadataRef.current;
        if (!previousQuery || !isEquals(previousQuery, options.query)) {
          metadataRef.current.query = options.query;
        }
        if (!previousPath || !isEquals(previousPath, options.path)) {
          metadataRef.current.path = options.path;
        }
        return pick(metadataRef.current, ['query', 'path']);
      }, [options.path, options.query]);
      // 清理状态
      const cleanup = useCallback(() => {
        // 注意 不要使用新的对象
        exposeRef.current.data = void 0;
        exposeRef.current.error = void 0;
        exposeRef.current.request = void 0;
        exposeRef.current.response = void 0;
        metadataRef.current.pending = void 0;
      }, []);
      // 缓存订阅
      const cacheSubscriber = useCallback(
        async (ret: readonly [unknown, Request, Response], key: string) => {
          const metadata = metadataRef.current;
          const expose = exposeRef.current;
          const blend = blendRef.current;
          if (metadata.pending || metadata.unmount) return void 0;
          if (!blend.cache || blend.cache.key !== key) return void 0;
          try {
            expose.data = ((await blend.onSuccess?.(ret[0] as S['Response'], {
              req: ret[1],
              res: ret[2],
            })) ?? ret[0]) as MutatedData;
            expose.response = ret[2];
            expose.request = ret[1];
            dispatchUpdate();
          } catch (e) {
            console.error('An error occurred while notifying', e);
          }
        },
        [blendRef, dispatchUpdate]
      );
      const doRequest = useCallback(
        async (
          options?: {
            query?: S['Query'];
            path?: S['Path'];
          } & QueryExecuteOptions<S>
        ) => {
          const blend = blendRef.current;
          const url = new URL(blend.client.options.baseUrl || location.origin);
          injectPathParams(url, pathname, options?.path || dependencies.path);
          if (options?.query || dependencies.query) {
            const search = new URLSearchParams();
            const params = pipe(
              (options?.query || dependencies.query) as S['Query']
            )(
              options?.serializers?.query || blend.serializers?.query
            )() as Record<string, string>;
            for (const key of Object.keys(params)) {
              search.append(key, String(params[key]));
            }
            url.search = search.toString();
          }
          const request = new Request(url, {
            method,
            ...blend.init,
            ...options?.init,
            headers: mergeHeaders(blend.headers, options?.init?.headers),
          });
          const ret = (await blend.fetcher(request)) as [
            S['Response'],
            Response
          ];
          return [ret[0], request, ret[1]] as const;
        },
        [blendRef, dependencies.path, dependencies.query]
      );
      /**
       * Hook 请求执行函数
       * @param refreshCache 是否刷新缓存 (default: false)
       */
      const implicitly = useCallback(
        async (refreshCache = false) => {
          const expose = exposeRef.current;
          const metadata = metadataRef.current;
          const blend = blendRef.current;
          metadata.pending = true;
          // 在loading时无需保留上一次的数据
          if (!blend.keepDirtyOnPending) {
            expose.data = void 0;
            expose.response = void 0;
            expose.error = void 0;
          }
          dispatchUpdate();
          const requestId = `${Date.now()}#${seq++}`;
          metadata.requestId = requestId;
          try {
            await blend.onBefore?.();
            const ret = await new Promise<
              readonly [S['Response'], Request, Response]
            >((resolve, reject) => {
              let cacheObject: QueryCacheObject;
              type DefaultResolveType = (value: unknown) => void;
              // 未启用缓存，直接执行退出
              if (!blend.cache) return void doRequest().then(resolve, reject);
              // 处理缓存等待队列的逻辑
              const doPromise = () =>
                doRequest()
                  .then(
                    (ret) => {
                      // console.log(
                      //   '处理缓存等待队列',
                      //   cacheObject.waitingQueue.resolves.length
                      // );
                      // 更新缓存过期时间
                      cacheObject.expireTime = Date.now() + staleTime;
                      cacheObject.waitingQueue.resolves.forEach((resolve) =>
                        resolve(ret)
                      );
                      cacheObject.notifyQueue.forEach((notify) =>
                        notify(ret, blend.cache!.key)
                      );
                      cacheObject.stage = 'active';
                      return ret;
                    },
                    (reason) => {
                      cacheObject.waitingQueue.rejects.forEach((reject) =>
                        reject(reason)
                      );
                      cacheObject.stage = 'inactive';
                      throw reason;
                    }
                  )
                  .finally(() => {
                    cacheObject.waitingQueue.resolves = [];
                    cacheObject.waitingQueue.rejects = [];
                  });
              const now = Date.now();
              const staleTime =
                blend.cache?.staleTime ??
                blend.client.options.cache?.staleTime ??
                300_000;
              const expireTime = now + staleTime;
              // 存在缓存
              if (blend.client.queries.has(blend.cache.key)) {
                const item = blend.client.queries.get(blend.cache.key)!;
                // 添加自身的缓存通知
                !item.notifyQueue.has(cacheSubscriber) &&
                  item.notifyQueue.add(cacheSubscriber);
                // 缓存还未生成
                if (item.stage === 'pending') {
                  // console.log('追加队列', item.expireTime, now);
                  item.waitingQueue.resolves.push(
                    resolve as DefaultResolveType
                  );
                  item.waitingQueue.rejects.push(reject);
                  return void 0;
                }
                // 缓存可用 并且 未指定强制刷新缓存 并且 缓存未过期
                if (
                  item.stage === 'active' &&
                  !refreshCache &&
                  item.expireTime > now
                ) {
                  // console.log('缓存命中');
                  item.promise.then(resolve as DefaultResolveType, reject);
                  return void 0;
                }
                // 清除过期緩存
                metadata.cachedIds!.delete(blend.cache.key);
                blend.client.queries.delete(blend.cache.key);
                // 重新设置缓存
                cacheObject = {
                  key: blend.cache.key,
                  promise: doPromise(),
                  stage: 'pending',
                  expireTime,
                  cacheScope: blend.cache.scope ?? 'outer',
                  waitingQueue: {
                    resolves: [resolve as DefaultResolveType],
                    rejects: [reject],
                  },
                  notifyQueue: item.notifyQueue,
                };
              } else {
                cacheObject = {
                  key: blend.cache.key,
                  promise: doPromise(),
                  stage: 'pending',
                  cacheScope: blend.cache.scope,
                  expireTime,
                  waitingQueue: {
                    resolves: [resolve as DefaultResolveType],
                    rejects: [reject],
                  },
                  notifyQueue: new Set([cacheSubscriber]),
                };
              }
              // console.log('添加缓存,' cache.cacheKey, now);
              blend.client.queries.set(blend.cache.key, cacheObject);
              metadata.cachedIds!.add(blend.cache.key);
            }).finally(() => {
              // 请求是否过时(有一个新地请求已经发出)
              if (requestId !== metadata.requestId) {
                throw new OverdueError('The request is outdated', {
                  currentRequestId: requestId,
                  latestRequestId: metadata.requestId,
                });
              }
              // hook是否卸载
              if (metadata.unmount) {
                throw new OverdueError('The hook is unmounted');
              }
              // 请求完成，清理状态
              cleanup();
              metadata.pending = false;
              metadata.done = true;
            });
            expose.data = ((await blend.onSuccess?.(ret[0], {
              req: ret[1],
              res: ret[2],
            })) ?? ret[0]) as MutatedData;
            expose.request = ret[1];
            expose.response = ret[2];
            dispatchUpdate();
          } catch (e) {
            if (e instanceof OverdueError) return void 0;
            checkUnexpectedError(e);
            blend.onError?.(e as S['Error']);
            expose.error = e as S['Error'];
            dispatchUpdate();
          } finally {
            blend.onFinally?.();
          }
        },
        [blendRef, dispatchUpdate, doRequest, cacheSubscriber, cleanup]
      );
      /**
       * 执行GET请求
       * @param params 查询参数
       * @param config 配置项
       */
      const execute = useCallback<QueryExecuteFunc<S>>(
        async (...args) => {
          const query = args[0] as S['Query'];
          const config = (args[1] ?? {
            silent: client.options.default?.query?.execution?.silent,
          }) as QueryExecuteOptions<S>;
          const expose = exposeRef.current;
          const metadata = metadataRef.current;
          const blend = blendRef.current;

          const rerender = createRerender(
            config.silent === false,
            dispatchUpdate
          );
          await blend.onBefore?.();
          rerender(() => {
            metadata.pending = true;
          });
          let request: Request;
          try {
            const ret = await doRequest({ query, ...config }).finally(() =>
              rerender(cleanup, false)
            );
            request = ret[1];
            const finalData = ((await blend.onSuccess?.(ret[0], {
              req: ret[1],
              res: ret[2],
            })) ?? ret[0]) as MutatedData;
            rerender(() => {
              expose.data = finalData;
              expose.request = ret[1];
              expose.response = ret[2];
            }, false);
            return ret[0];
          } catch (e) {
            checkUnexpectedError(e);
            rerender(() => {
              expose.request = request;
              expose.error = e as S['Error'];
            }, false);
            blend.onError?.(e as S['Error']);
            throw e;
          } finally {
            if (!metadata.unmount) {
              rerender(() => {
                metadata.pending = false;
                metadata.done = true;
              });
            }
            blend.onFinally?.();
          }
        },
        [
          client.options.default?.query?.execution?.silent,
          blendRef,
          dispatchUpdate,
          doRequest,
          cleanup,
        ]
      );
      /**
       * 刷新请求
       * @param ifInLoadingThenExit 如果处于加载中则退出
       * @default false
       * @param ifNotEnabledThenExit 如果未启用则退出
       * @default false
       * @param ifUnmountedThenExit 如果已卸载则退出
       * @default false
       */
      const refresh = useLatestFunc<RefreshFunc>(
        async (options): Promise<void> => {
          const { enabled } = blendRef.current;
          const { pending, unmount } = metadataRef.current;
          if (options && isPlainObject(options)) {
            if (unmount && (options as RefreshOptions).ifUnmountedThenExit)
              return void 0;
            if (!enabled && (options as RefreshOptions).ifNotEnabledThenExit)
              return void 0;
            if (pending && (options as RefreshOptions).ifInPendingThenExit)
              return void 0;
          }
          await implicitly(true);
        }
      );
      // 在组件卸载时进行标记
      useEffect(() => {
        const metadata = metadataRef.current;
        metadata.unmount = false;
        return () => {
          metadata.unmount = true;
        };
      }, []);
      // 初始化缓存和卸载时对部分缓存进行清除
      useEffect(() => {
        const { cache, client } = blendRef.current;
        if (!cache) return void 0;
        const cacheIds = new Set<string>();
        metadataRef.current.cachedIds = cacheIds;
        return () => {
          const now = Date.now();
          for (const cacheId of cacheIds) {
            const cacheObject = client.queries.get(cacheId);
            if (!cacheObject) continue;
            cacheObject.notifyQueue.delete(cacheSubscriber);
            if (cacheObject.cacheScope === 'inner') {
              client.queries.delete(cacheId);
            }
            if (cacheObject.expireTime <= now) {
              client.queries.delete(cacheId);
            }
          }
        };
      }, [blendRef, cacheSubscriber]);
      // 触发请求
      useEffect(() => {
        if (options.enabled === false) return void 0;
        implicitly().catch((err) => {
          // 都是致命的错误，需要抛出让使用者解决
          throw err;
        });
      }, [options.enabled, implicitly]);
      // // 在 Hook enabled 设置为 false 时的相关逻辑
      useLayoutEffect(() => {
        if (options.enabled !== false) return void 0;
        const metadata = metadataRef.current;
        // 当该请求有启用变为未启用时的处理逻辑, 根据metadata.requestId判断当前hook是否处于活跃
        if (!options.keepDirtyOnNotEnabled && metadata.requestId) {
          cleanup();
          dispatchUpdate();
        } else if (metadata.pending) {
          // 在未启用时 pending 应始终为false
          metadata.pending = false;
          dispatchUpdate();
        }
        // 在 hook 处于 unable 时，将 requestId 设为空，标记处于请求中的已失效
        metadata.requestId = void 0;
      }, [
        cleanup,
        dispatchUpdate,
        options.enabled,
        options.keepDirtyOnNotEnabled,
      ]);
      return {
        kind:
          exposeRef.current.error !== void 0
            ? 'error'
            : metadataRef.current.pending !== false
            ? 'pending'
            : 'success',
        data: exposeRef.current.data,
        /**
         * 当前组件是否处于 loading 状态
         */
        pending: metadataRef.current.pending,
        /**
         * 当前组件是否存在错误
         */
        error: exposeRef.current.error,
        /**
         * 当前组件是否处于 done 状态，该状态不会重置，意味着第一次请求后永远都是 true
         */
        done: metadataRef.current.done,
        /**
         * 上一次请求的响应
         */
        request: exposeRef.current.request,
        response: exposeRef.current.response,
        /**
         * 主动执行请求
         */
        execute,
        /**
         * 刷新请求
         */
        refresh,
      } satisfies Record<
        keyof HttpQueryHookReturn<never, never>,
        unknown
      > as HttpQueryHookReturn<
        DecisionResponseType<S['Response'], MutatedData>,
        S
      >;
    }
    Reflect.set(useHttpQueryRequest, ' __source', { method, pathname });
    return useHttpQueryRequest;
  };
  public doMutationRequest = () => {
    const { pathname, method } = this;
    function useHttpMutationRequest(options: HttpMutationHookOptions<S> = {}) {
      const exposeRef = useRef<{
        data?: S['Response'];
        error?: S['Error'];
        response?: Response;
        request?: Request;
      }>({});
      const metadataRef = useRef<{
        pending?: boolean;
        done?: boolean;
        unmount?: boolean;
      }>({});
      // 强制刷新
      const dispatchUpdate = useReducer(() => ({}), { pathname })[1];
      const client = useHttpClient();
      const blendRef = useLatestRef({
        ...options,
        client,
        fetcher: options.fetcher || client.options.fetcher,
      });
      // 清理相关状态
      const cleanup = useCallback(() => {
        exposeRef.current.data = void 0;
        exposeRef.current.error = void 0;
        exposeRef.current.request = void 0;
        exposeRef.current.response = void 0;
        metadataRef.current.pending = false;
      }, []);
      // 请求执行函数
      const execute = useCallback<MutationExecuteFunc<S>>(
        async (...args) => {
          const config = (args[1] ?? {
            silent: client.options.default?.mutation?.execution?.silent,
          }) as MutationExecuteOptions<S>;
          const expose = exposeRef.current;
          const metadata = metadataRef.current;
          const blend = blendRef.current;
          const rerender = createRerender(
            config.silent === false,
            dispatchUpdate
          );
          await blend.onBefore?.();
          rerender(() => {
            metadata.pending = true;
          });
          let request: Request;
          try {
            const url = new URL(
              blend.client.options.baseUrl || location.origin
            );
            injectPathParams(url, pathname, config?.path || blend.path);
            if (config?.query || blend.query) {
              injectQueryParams(
                url,
                pipe((config?.query || blend.query || {}) as S['Query'])(
                  config.serializers?.query
                )() as Record<string, string>
              );
            }
            const [contentType, body] = pipe(args[0] as S['Body'])(
              config.serializers?.body
            )((body) => serializeBody(body))();
            request = new Request(url, {
              method,
              body,
              ...blend.init,
              ...config?.init,
              headers: mergeHeaders(
                contentType === false ? null : { 'Content-Type': contentType },
                blend.headers,
                blend.init?.headers,
                config.init?.headers,
                blend.headers
              ),
            });
            const ret = await blend
              .fetcher(request)
              .then((res) => res as [S['Response'], Response])
              .finally(() => rerender(cleanup, false));
            rerender(() => {
              expose.data = ret[0];
              expose.response = ret[1];
              expose.request = request;
            }, false);
            blend.onSuccess?.(ret[0], { res: ret[1], req: request });
            return ret[0];
          } catch (e) {
            rerender(() => {
              expose.request = request;
              expose.error = e as S['Error'];
            }, false);
            blend.onError?.(e as S['Error']);
            throw e;
          } finally {
            if (!metadata.unmount) {
              rerender(() => {
                metadata.pending = false;
                metadata.done = true;
              });
            }
            blend.onFinally?.();
          }
        },
        [
          client.options.default?.mutation?.execution?.silent,
          blendRef,
          dispatchUpdate,
          cleanup,
        ]
      );
      // 标记组件已经卸载
      useEffect(() => {
        const metadata = metadataRef.current;
        metadata.unmount = false;
        return () => {
          metadata.unmount = true;
        };
      }, []);
      return {
        kind:
          exposeRef.current.error !== void 0
            ? 'error'
            : metadataRef.current.pending !== false
            ? 'pending'
            : 'success',
        data: exposeRef.current.data,
        pending: metadataRef.current.pending,
        error: exposeRef.current.error,
        done: metadataRef.current.done,
        request: exposeRef.current.request,
        response: exposeRef.current.response,
        execute,
      } satisfies Record<
        keyof HttpMutationHookReturn<never>,
        unknown
      > as HttpMutationHookReturn<S>;
    }
    Reflect.set(useHttpMutationRequest, ' __source', { method, pathname });
    return useHttpMutationRequest;
  };
  public doRequest = () => {
    const { pathname, method } = this;
    async function httpRequest<Mutated = S['Response']>(
      options: HttpRequestOptions<S, Mutated> = {} as HttpRequestOptions<
        S,
        Mutated
      >
    ): Promise<Mutated> {
      const {
        baseUrl = location.origin,
        path: pathParams,
        query,
        body,
        headers,
        init,
        serializers,
        fetcher = fetch,
      } = options || {};
      const url = new URL(baseUrl);
      injectPathParams(
        url,
        pathname,
        pathParams as Record<string, string | number>
      );
      if (query) {
        injectQueryParams(url, pipe(query)(serializers?.query)());
      }
      const [contentType, payload] = pipe(body as S['Body'])(serializers?.body)(
        (body) => serializeBody(body)
      )();
      const req = new Request(url, {
        method,
        body: payload,
        ...init,
        headers: mergeHeaders(
          contentType === false ? null : { 'Content-Type': contentType },
          headers,
          init?.headers
        ),
      });
      const res = await fetcher(req);
      if (serializers?.response)
        return (await serializers.response(res)) as Promise<Mutated>;
      else return (await res.json()) as Promise<Mutated>;
    }
    Reflect.set(httpRequest, ' __source', { method, pathname });
    return httpRequest;
  };
}
type InferableFnTrait<Options> = (options?: Options) => unknown;
type InferFullSType<T> = T extends InferableFnTrait<
  HttpQueryHookOptions<infer S1, unknown>
>
  ? S1
  : T extends InferableFnTrait<HttpMutationHookOptions<infer S2>>
  ? S2
  : T extends InferableFnTrait<HttpRequestOptions<infer S3, unknown>>
  ? S3
  : never;
export type InferSType<T, K extends ApplicableKeys> = InferFullSType<T>[K];

// type ParseMethod<S> = S extends `${infer M extends HttpMethod}:${string}` ? M : never;
type ParsePathParameters<
  S,
  Ret extends {} = {}
> = S extends `${string}{${infer K}}${infer Rest}`
  ? ParsePathParameters<
      Rest,
      Ret & {
        [P in K]: string;
      }
    >
  : Ret;

/**
 *
 * @param url
 * @examples basic usage
 * ```tsx
 * const useGETForUser = createHttpFactory('GET:/users/{userId}')
 *    .apply<"Path", { userId: string }>() // will automatic inferred from url, without to write this line.
 *    .apply<"Response", { id: number, name: string, avatar: string }>() // apply response data type.
 *    .apply<"Query", { t: number }>  // apply query params type structure.
 *    .doQueryRequest(); // generate query react hooks.
 * export function App(){
 *    const {data: user, pending, error } = useGETForUser({
 *        path: {
 *            userId: "36ce21c7-15f5-4e9a-beec-b6604fbebd0f"
 *        },
 *        query: {
 *            t: Date.now()
 *        }
 *    })
 *    return (<>
 *      {pending && <span>loading...</span>}
 *      {error && <span>Oops something in wrong.</span>}
 *      {user && <pre>{JSON.string(user, null, 2)}</pre>}
 *    </>)
 * }
 * @examples unions type
 * ```tsx
 * export function App(){
 *    const { data: user, kind, error } = useGETForUser({
 *        path: {
 *            userId: "36ce21c7-15f5-4e9a-beec-b6604fbebd0f"
 *        },
 *        query: {
 *            t: Date.now()
 *        }
 *    })
 *    return (<>
 *      {(() => {
 *        switch(kind){
 *          case "pending":
 *              return <span>loading...</span>
 *          case "error":
 *              return <p>Oops something in wrong. {error}</p>
 *          case "success":
 *              return <pre>{JSON.string(user, null, 2)}</pre>
 *        }
 *      })()}
 *    </>)
 * }
 * ```
 */
export const createHttpFactory = <S extends string>(url: S) => {
  const [method, path] = url.split(':');
  return new HttpFactory(method.toUpperCase(), path).apply<
    'Path',
    ParsePathParameters<S>
  >();
};

/**
 * 检测是否为有语法等导致的错误
 * @param error
 */
const checkUnexpectedError = (error: unknown) => {
  if (
    [TypeError, SyntaxError, ReferenceError, RangeError].some(
      (Err) => error instanceof Err
    )
  ) {
    throw error;
  }
};

/**
 * 决定返回的类型
 * @param R1 请求返回的类型
 * @param R2 onSuccess 函数返回类型
 */
type DecisionResponseType<R1, R2> = unknown extends R2
  ? R1
  : R2 extends void
  ? R1
  : R2;
// 判断是否需要空类型
type Bypass<T extends {}> = {} extends T ? T | void : T;

export interface Serializers<TQuery, TBody> {
  query?(query: TQuery): unknown;
  body?(body: TBody): unknown;
}

// ====== Query Type

export interface HttpQueryHookOptions<
  S extends HttpSchemaProperties,
  Mutated = S['Response']
> {
  /**
   * 查询参数
   * @examples ```typescript
   * const useGETForUsers = createHttpGetFactory('/api/users/list')
   * export default function App() {
   *   useGETForUsers({
   *     query: {
   *       page: 1,
   *       size: 10,
   *     }
   *   })
   * }
   * ```
   */
  query?: S['Query'];
  /**
   * 路径参数
   * @examples ```typescript
   * const useGETForUser = createHttpGetFactory('/api/users/{userId}')
   * export default function App() {
   *   useGETForUsers({
   *     path: {
   *       userId: '1',
   *     }
   *   })
   * }
   * ```
   */
  path?: S['Path'];
  /**
   * 启用该查询
   * @examples ```typescript
   * const useGETForUsers = createHttpGetFactory('/api/users/list')
   * export default function App() {
   *   useGETForUsers({
   *     enabled: true,
   *   })
   * }
   * ```
   * @tips 建议使用Boolean强行转为boolean值
   * @default true
   */
  enabled?: boolean;
  /**
   * 请求头数据
   */
  headers?: S['Headers'];
  /**
   * fetch init 配置
   */
  init?: RequestInit;
  /**
   * 在禁用时保留存在的数据
   * @default false
   */
  keepDirtyOnNotEnabled?: boolean;
  /**
   * 在加载时保留存在的数据
   * @default true
   */
  keepDirtyOnPending?: boolean;
  /**
   * 自定义如何序列化 query 参数
   * @examples ```ts
   * const useGETForUsers = createHttpGetFactory('/api/user/list')
   * // GET请求时，自定义如何将query参数序列化为query字符串
   * export default function App() {
   *   useGETForUsers({
   *     serializers: {
   *       query: (params) => new URLSearchParams(params).toString(),
   *     }
   *   })
   * }
   *
   * const usePOSTForCreateUser = createHttpGetFactory('/api/users/create')
   * // POST请求时使用 FormData
   * export default function App() {
   *   usePOSTForCreateUser({
   *     serializers: {
   *       body: body => {
   *         const formData = new FormData();
   *         Object.entries(body).forEach(([key, value]) => {
   *           if(value !== void 0) formData.append(key, value);
   *         });
   *       },
   *     }
   *   })
   * }
   * ```
   */
  serializers?: Omit<Serializers<S['Query'], unknown>, 'body'>;
  /**
   * Custom fetcher function
   * @description This function can be used to override default behaviors.
   */
  fetcher?: (request: Request) => Promise<[S['Response'], Response]>;
  /**
   * 是否启用缓存
   * @tips 需要在父层组件使用 HttpCacheProvider
   * @examples ```ts
   * const useGETForUsers = createHttpGetFactory('/api/users/list')
   * export default function App() {
   *   useGETForUsers({
   *     cache: {
   *       cacheKey: 'users',
   *       cacheAge: 1000 * 60 * 60,
   *       cacheLife: 'outer',
   *     }
   *   })
   * }
   * ```
   * @default false
   */
  cache?:
    | {
        /**
         * 缓存键
         */
        key: string;
        /**
         * 缓存有效期(unit: ms)
         * @default 5 Minutes
         */
        staleTime?: number;
        /**
         * 缓存生命周期
         * @param inner 只在当前组件生命周期内有效
         * @param outer 在HttpCacheProvider组件生命周期内有效
         * @default outer
         */
        scope?: 'inner' | 'outer';
      }
    | true;
  /**
   * 当成功时的回调，返回值将作为新的数据
   * @param data
   * @param response
   * @description 可以用于自定义返回数据，该方法返回的值不会作为 `execute` 方法的返回值
   */
  onSuccess?: (
    data: S['Response'],
    context: { req: Request; res: Response }
  ) => Mutated | Promise<Mutated>;
  /**
   * 当错误时的回调
   * @param error
   */
  onError?: (error: S['Error']) => void;
  /**
   * 当请求无论是错误或成功都会执行的回调函数
   */
  onFinally?: () => void;
  /**
   * 当请求发出前执行的回调函数
   */
  onBefore?: () => void | Promise<void>;
}

export type HttpQueryHookReturn<D, S extends HttpSchemaProperties> =
  | Readonly<{ data: undefined } & QueryPendingContext<S>>
  | Readonly<{ data: D } & QuerySuccessContext<S>>
  | Readonly<{ data: undefined } & QueryErrorContext<S>>;

type QueryPendingContext<S extends HttpSchemaProperties> = Readonly<{
  kind: 'pending';
  pending: true | undefined;
  error: undefined;
  done: false | undefined;
  request: Request | undefined;
  response: Response | undefined;
  execute: QueryExecuteFunc<S>;
  refresh: RefreshFunc;
}>;

type QuerySuccessContext<S extends HttpSchemaProperties> = Readonly<{
  kind: 'success';
  pending: false;
  error: undefined;
  done: true;
  request: Request;
  response: Response;
  execute: QueryExecuteFunc<S>;
  refresh: RefreshFunc;
}>;

type QueryErrorContext<S extends HttpSchemaProperties> = Readonly<{
  kind: 'error';
  pending: false;
  error: S['Error'];
  done: true;
  request: Request;
  response: Response | undefined;
  execute: QueryExecuteFunc<S>;
  refresh: RefreshFunc;
}>;

type QueryExecuteOptions<S extends HttpSchemaProperties> = {
  init?: RequestInit;
  /**
   * 路径参数
   */
  path?: S['Path'];
  /**
   * 是否静默
   * @description 如果为false将触发React重新渲染
   * @default true
   */
  silent?: boolean;
  /**
   * 自定义如何对 query 进行序列化
   */
  serializers?: Omit<Serializers<S['Query'], never>, 'body'>;
};
type QueryExecuteFunc<S extends HttpSchemaProperties> = (
  ...args: [query: Bypass<S['Query']>, options?: QueryExecuteOptions<S>]
) => Promise<S['Response']>;

// ====== Mutation Type
export type HttpMutationHookOptions<S extends HttpSchemaProperties> = {
  /**
   * 查询参数
   */
  query?: S['Query'];
  /**
   * 路径参数
   */
  path?: S['Path'];
  /**
   * header参数
   */
  headers?: S['Headers'];
  fetcher?: (request: Request) => Promise<[S['Response'], Response]>;
  /**
   * fetch init 配置
   */
  init?: RequestInit;
  /**
   * 当请求发出前执行的回调函数
   */
  onBefore?: () => void | Promise<void>;
  /**
   * 当请求成功时的回调函数
   * @param data
   * @param response
   */
  onSuccess?: (
    data: S['Response'],
    context: { res: Response; req: Request }
  ) => void;
  /**
   * 当请求失败时的回调函数
   * @param error
   */
  onError?: (error: S['Error']) => void;
  /**
   * 当请求无论是错误或成功都会执行的回调函数
   */
  onFinally?: () => void;
};
export type HttpMutationHookReturn<S extends HttpSchemaProperties> =
  | Readonly<{ data: undefined } & MutationPendingContext<S>>
  | Readonly<{ data: S['Response'] } & MutationSuccessContext<S>>
  | Readonly<{ data: undefined } & MutationErrorContext<S>>;

type MutationPendingContext<S extends HttpSchemaProperties> = Readonly<{
  kind: 'pending';
  pending: true | undefined;
  error: undefined;
  done: false | undefined;
  request: Request | undefined;
  response: Response | undefined;
  execute: MutationExecuteFunc<S>;
}>;

type MutationSuccessContext<S extends HttpSchemaProperties> = Readonly<{
  kind: 'success';
  pending: false;
  error: undefined;
  done: true;
  request: Request;
  response: Response;
  execute: MutationExecuteFunc<S>;
}>;

type MutationErrorContext<S extends HttpSchemaProperties> = Readonly<{
  kind: 'error';
  pending: false;
  error: S['Error'];
  done: true;
  request: Request;
  response: Response | undefined;
  execute: MutationExecuteFunc<S>;
}>;
type MutationExecuteFunc<S extends HttpSchemaProperties> = (
  ...args: [body: Bypass<S['Body']>, config?: MutationExecuteOptions<S>]
) => Promise<S['Response']>;
export type MutationExecuteOptions<S extends HttpSchemaProperties> = {
  init?: RequestInit;
  /**
   * 是否静默
   * @description 如果为false将触发React重新渲染
   * @default true
   */
  silent?: boolean;
  /**
   * query 参数
   */
  query?: S['Query'];
  /**
   * 路径参数
   */
  path?: S['Path'];
  /**
   * 自定义如何对 query 或 body 进行序列化
   */
  serializers?: Serializers<S['Query'], S['Body']>;
};

// ====== Request Type
type HttpRequestOptions<
  S extends HttpSchemaProperties,
  Mutated = S['Response']
> = {
  baseUrl?: string;
  init?: RequestInit;
  serializers?: {
    query?(query: S['Query']): Record<string, string | number>;
    body?(body: S['Body']): unknown;
    response?(response: Response): Mutated | Promise<Mutated>;
  };
  fetcher?: (req: Request) => Promise<Response>;
} & ComposeOptions<S['Query'], 'query'> &
  ComposeOptions<S['Body'], 'body'> &
  ComposeOptions<S['Path'], 'path'> &
  ComposeOptions<S['Headers'], 'headers'>;
type ComposeOptions<Val, Key extends string> = {} extends Val
  ? { [K in Key]?: Val }
  : {
      [K in Key]: Val;
    };
// ====== End

// for internal use only
class OverdueError extends Error {
  constructor(message: string, readonly context?: { [key: string]: unknown }) {
    super(message);
    this.name = 'OverdueError';
  }
}

/**
 * 有条件的重新渲染或者为赋值ref
 * @param allowRendering
 * @param render
 */
const createRerender = (
  allowRendering: boolean | undefined,
  render: () => void
) => {
  return (before?: () => void, update = true) => {
    if (!allowRendering) return void 0;
    before?.();
    update && render();
  };
};

/**
 * 合并 Headers
 * @param args
 */
const mergeHeaders = (...args: (HeadersInit | undefined | false | null)[]) => {
  const headers = new Headers();
  for (const arg of args) {
    if (isArray(arg)) {
      for (const [key, value] of arg) {
        headers.set(key, value);
      }
    } else if (isPlainObject(arg)) {
      for (const key of Object.keys(arg)) {
        headers.set(key, arg[key]);
      }
    } else if (arg instanceof Headers) {
      for (const [key, value] of arg.entries()) {
        headers.set(key, value);
      }
    }
  }
  return headers;
};
const injectPathParams = (
  url: URL,
  pathname: string,
  params?: Record<string, string | number>
) => {
  if (!params) {
    url.pathname = pathname;
  } else {
    url.pathname = Object.keys(params).reduce((pathname, key) => {
      return pathname.replace(`{${key}}`, String(params[key]));
    }, pathname);
  }
};
const injectQueryParams = (
  url: URL,
  params?: Record<string, string | number>
) => {
  if (!params) return void 0;
  url.search = Object.keys(params)
    .reduce((search, key) => {
      search.append(key, String(params[key]));
      return search;
    }, new URLSearchParams())
    .toString();
};
const serializeBody = (body?: Record<string, unknown>) => {
  if (body instanceof URLSearchParams)
    return ['application/x-www-form-urlencoded', body] as const;
  if (body instanceof FormData) return [false, body] as const;
  if (body instanceof Blob) return [false, body] as const;
  if (body instanceof ArrayBuffer) return [false, body] as const;
  if (isPlainObject(body))
    return ['application/json', JSON.stringify(body) as string] as const;
  return [false, null] as const;
};

type RefreshOptions = {
  ifInPendingThenExit?: boolean;
  ifNotEnabledThenExit?: boolean;
  ifUnmountedThenExit?: boolean;
};
type RefreshFunc = (options?: RefreshOptions | UIEvent) => Promise<void>;

export const serializerHelpers = {
  /**
   * Query参数序列化
   * @param values
   * @param options
   * @examples ```ts
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'repeat' }) // a=1&a=2&a=3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'pipes' }) // a=1|2|3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'csv' }) // a=1,2,3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'bracket' }) // a[]=1&a[]=2&a[]=3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'bracket' }) // a[]=1&a[]=2&a[]=3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'bracket-index' }) // ?a[0]=1&a[1]=2&a[2]=3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'json' }) // a=[1,2,3]
   * ```
   */
  query: (
    values: Record<string, unknown>,
    {
      arrayFormat,
    }: {
      // 数组格式化方式
      arrayFormat:
        | 'csv'
        | 'pipes'
        | 'repeat'
        | 'bracket'
        | 'bracket-index'
        | 'json';
    } = { arrayFormat: 'repeat' }
  ): string => {
    const search = new URLSearchParams();
    Object.entries(values).forEach(([k, v]) => {
      if (!isDef(v)) return void 0;
      if (isString(v) || isNumber(v)) {
        search.append(k, v.toString());
        return void 0;
      }
      if (Array.isArray(v)) {
        switch (arrayFormat) {
          case 'csv':
            search.append(k, v.join(','));
            break;
          case 'pipes':
            search.append(k, v.join('|'));
            break;
          case 'repeat':
            v.forEach((item) => search.append(k, item));
            break;
          case 'bracket':
            v.forEach((item) => search.append(`${k}[]`, item));
            break;
          case 'bracket-index':
            v.forEach((item, index) => search.append(`${k}[${index}]`, item));
            break;
          case 'json':
            search.append(k, JSON.stringify(v));
            break;
        }
        return void 0;
      }
      if (v instanceof Date) {
        search.append(k, v.toISOString());
        return void 0;
      }
      search.append(k, String(v));
    });
    return search.toString();
  },
  /**
   * 将 Object 序列化为 FormData
   * @param values
   * @examples ```ts
   * serializerHelpers.formData({a: 'value1', b: 'value2'}) // FormData
   * ```
   */
  formData: (values: Record<string, unknown>): FormData => {
    const formData = new FormData();
    Object.entries(values).forEach(([k, v]) => {
      if (!isDef(v)) return void 0;
      if (v instanceof File) {
        formData.append(k, v);
      } else {
        formData.append(k, v.toString());
      }
    });
    return formData;
  },
};

// mod tests
if (import.meta.vitest) {
  const { describe, it, expect, vi: jest } = import.meta.vitest;
  describe('Tests', async () => {
    describe('checkUnexpectedError', () => {
      it('should throw error when error is an instance of TypeError', () => {
        const error = new TypeError();
        expect(() => checkUnexpectedError(error)).toThrow(TypeError);
      });

      it('should throw error when error is an instance of SyntaxError', () => {
        const error = new SyntaxError();
        expect(() => checkUnexpectedError(error)).toThrow(SyntaxError);
      });

      it('should throw error when error is an instance of ReferenceError', () => {
        const error = new ReferenceError();
        expect(() => checkUnexpectedError(error)).toThrow(ReferenceError);
      });

      it('should throw error when error is an instance of RangeError', () => {
        const error = new RangeError();
        expect(() => checkUnexpectedError(error)).toThrow(RangeError);
      });

      it('should not throw error when error is not an instance of TypeError, SyntaxError, ReferenceError, or RangeError', () => {
        const error = new Error();
        expect(() => checkUnexpectedError(error)).not.toThrow();
      });
    });
    describe('createRerender', () => {
      // Test when allowRendering is true and update is true
      it('should call render when allowRendering and update is true', () => {
        const render = jest.fn();
        const rerender = createRerender(true, render);
        rerender();
        expect(render).toBeCalled();
      });

      // Test when allowRendering is true and update is false
      it('should not call render when allowRendering is true and update is false', () => {
        const render = jest.fn();
        const rerender = createRerender(true, render);
        rerender(undefined, false);
        expect(render).not.toBeCalled();
      });

      // Test when allowRendering is false
      it('should not call render when allowRendering is false', () => {
        const render = jest.fn();
        const rerender = createRerender(false, render);
        rerender();
        expect(render).not.toBeCalled();
      });

      // Test when before function is provided
      it('should call before function when provided', () => {
        const render = jest.fn();
        const before = jest.fn();
        const rerender = createRerender(true, render);
        rerender(before);
        expect(before).toBeCalled();
      });
    });
    describe('mergeHeaders', () => {
      it('should correctly merge headers from multiple sources', () => {
        const headers1 = new Headers({ 'Content-Type': 'application/json' });
        const headers2 = { Accept: 'application/json' };
        const headers3: [string, string][] = [
          ['Authorization', 'Bearer token123'],
        ];

        // Call the function with different types of header inputs
        const result = mergeHeaders(headers1, false, null, headers2, headers3);

        // Check if all header values from the input sources are set correctly in the result
        expect(result.get('Content-Type')).toBe('application/json');
        expect(result.get('Accept')).toBe('application/json');
        expect(result.get('Authorization')).toBe('Bearer token123');
      });
    });
    describe('serializerHelpers.query()', () => {
      it('Should handle arrayFormat: repeat', () => {
        expect(
          decodeURIComponent(
            serializerHelpers.query({ a: [1, 2, 3] }, { arrayFormat: 'repeat' })
          )
        ).toEqual('a=1&a=2&a=3');
      });

      it('should handle arrayFormat: pipes', () => {
        expect(
          decodeURIComponent(
            serializerHelpers.query({ a: [1, 2, 3] }, { arrayFormat: 'pipes' })
          )
        ).toEqual('a=1|2|3');
      });

      it('should handle arrayFormat: csv', () => {
        expect(
          decodeURIComponent(
            serializerHelpers.query({ a: [1, 2, 3] }, { arrayFormat: 'csv' })
          )
        ).toEqual('a=1,2,3');
      });

      it('should handle arrayFormat: bracket', () => {
        expect(
          decodeURIComponent(
            serializerHelpers.query(
              { a: [1, 2, 3] },
              { arrayFormat: 'bracket' }
            )
          )
        ).toEqual('a[]=1&a[]=2&a[]=3');
      });

      it('should handle arrayFormat: bracket-index', () => {
        expect(
          decodeURIComponent(
            serializerHelpers.query(
              { a: [1, 2, 3] },
              { arrayFormat: 'bracket-index' }
            )
          )
        ).toEqual('a[0]=1&a[1]=2&a[2]=3');
      });

      it('should handle arrayFormat: json', () => {
        expect(
          decodeURIComponent(
            serializerHelpers.query({ a: [1, 2, 3] }, { arrayFormat: 'json' })
          )
        ).toEqual('a=[1,2,3]');
      });

      it('should skip undefined of value', () => {
        expect(serializerHelpers.query({ a: undefined, b: '1' })).toBe('b=1');
      });
      it('should handle number or string of value', () => {
        expect(serializerHelpers.query({ a: 1, b: '1' })).toBe('a=1&b=1');
      });
      it('should convert other types in value to string', () => {
        expect(
          decodeURIComponent(
            serializerHelpers.query({
              a: false,
              b: BigInt(111),
              c: new Date(1688720399911),
            })
          )
        ).toBe('a=false&b=111&c=2023-07-07T08:59:59.911Z');
      });
    });
    describe('serializerHelpers.formData()', () => {
      it('should serialize an object into a FormData', () => {
        const file = new File(['foo'], 'foo.txt', {
          type: 'text/plain',
        });
        const values = { a: 'value1', b: 'val2', c: file };
        const result = serializerHelpers.formData(values);
        expect(result.get('a')).toBe('value1');
        expect(result.get('b')).toBe('val2');
        expect(result.get('c')).toBe(file);
      });

      it('should skip adding undefined values to FormData', () => {
        const values = { a: 'value1', b: undefined };
        const result = serializerHelpers.formData(values);
        expect(result.get('a')).toBe('value1');
        expect(result.has('b')).toBe(false);
      });
    });
  });
}
