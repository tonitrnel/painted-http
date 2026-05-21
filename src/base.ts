import { serializers } from "./serializer";
import type { QueryCacheObject } from "./cache";
import type {
  ARQContext,
  BaseQueryHookOptions,
  HttpRequestOptions,
  HttpSchemaProperties,
  MutationExecuteFunc,
  MutationExecuteOptions,
  MutationHookOptions,
  QueryExecuteFunc,
  QueryExecuteOptions,
  RefreshFunc,
  ResolvedResponseType,
  ApplyArgs,
} from "./type";
import { isArray, isPlainObject, pipe } from "./utilities";

export class BaseARQFactory<
  S extends HttpSchemaProperties,
  I = Request,
  O extends [unknown, unknown] = [unknown, Response],
> {
  constructor(
    protected method: string,
    protected pathname: string,
    // 可选，如果不指定则从 client 中获取
    protected baseUrl?: string,
    protected fetcher?: (input: I) => Promise<O>,
    protected mode: "http" | "custom" = "http",
  ) {}

  /**
   * 应用 TypeScript 类型
   *
   * 可应用的类型有:
   *   - Query: 应用查询类型
   *   - Path: 应用路径参数类型（注: 不要指定该类型，路径参数会自动推导，详见示例）
   *   - Body: 应用数据主体类型
   *   - Headers: 应用 HTTP 头类型(不常见)
   *   - Response: 应用响应类型(不常见)
   *   - Error: 应用错误类型
   *
   * @example ```ts
   * createHttpFactory('GET:/users')
   *   .apply<'Query', { page: number, size: number }>
   *   .apply<'Response', { id: string, nickname: string }[]>
   * ```
   *
   * @example ```ts
   * // 自动推导路径参数
   * createHttpFactory('GET:/users/{user_id}')
   * // 等同与
   * createHttpFactory('GET:/users/{user_id}')
   *   .apply<'Path', { user_id: string }>
   * ```
   */
  public apply(...args: ApplyArgs<I, O>): unknown {
    this._apply(...args);
    return this;
  }

  protected _apply(...args: ApplyArgs<I, O>) {
    if (args.length === 2) {
      const [key, value] = args;
      switch (key) {
        case "fetcher":
          this.fetcher = value;
          break;
        case "method":
          this.method = value;
          break;
        case "pathname":
          this.pathname = value;
          break;
        case "baseUrl":
          this.baseUrl = value;
          break;
        default:
          break;
      }
    }
  }

  /**
   * 制作一个普通地请求，即一个 `fetch` 函数的包装，用于直接调用
   *
   * @example ```typescript
   * const createUser = createHttpFactory('POST:/users')
   *   .apply<'Body', { nickname: string, address: string }>
   *   .apply<'Response', { code: number, msg: string }>
   * await createUser({
   *   body: {
   *     nickname: 'Bob',
   *     address: '...'
   *   }
   * })
   * ```
   */
  public makeRequest() {
    const { pathname, method, baseUrl } = this;

    async function request<Serialized = S["Response"]>(
      options: HttpRequestOptions<S, Serialized> = {} as HttpRequestOptions<
        S,
        Serialized
      >,
    ): Promise<Serialized> {
      const url = new URL(baseUrl || options.baseUrl || location.origin);
      populatePathParams(
        url,
        pathname,
        options.path as Record<string, string | number>,
      );
      if (options.query) {
        populateQueryParams(
          url,
          pipe(options.query)(options.serializers?.query)(),
        );
      }
      const [contentType, payload] = pipe(options.body as S["Body"])(
        options.serializers?.body,
      )((body) =>
        serializers.body(
          body as Record<string, unknown> | ArrayBuffer | Uint8Array | number[],
        ),
      )();
      const req = new Request(url, {
        method,
        body: payload,
        ...options.init,
        headers: mergeHeaders(
          contentType === undefined ? null : { "Content-Type": contentType },
          options.headers as HeadersInit,
          options.init?.headers,
        ),
      });
      const res = await (options.fetcher || fetch)(req);
      if (options.serializers?.response)
        return (await options.serializers.response(res)) as Promise<Serialized>;
      else return (await res.json()) as Promise<Serialized>;
    }

    Reflect.set(request, " __source", { method, pathname, baseUrl });
    return request;
  }
}

// ====== Utils ================

/**
 * 检测是否为有语法等导致的错误
 * @param error
 */
const checkUnexpectedError = (error: unknown) => {
  if (
    [TypeError, SyntaxError, ReferenceError, RangeError].some(
      (Err) => error instanceof Err,
    )
  ) {
    throw error;
  }
};
/**
 * 有条件的重新渲染或者为赋值ref
 * @param allowRendering
 * @param render
 */
const createRerender = (
  allowRendering: boolean | undefined,
  render: () => void,
) => {
  return (before?: () => void, update = true) => {
    if (!allowRendering) return void 0;
    before?.();
    update && render();
  };
};

const makeCacheKey = (mode: string, key: string) => `:${mode}+${key}`;

// for internal use only
class OverdueError extends Error {
  constructor(
    message: string,
    readonly context?: { [key: string]: unknown },
  ) {
    super(message);
    this.name = "OverdueError";
  }
}

/**
 * Merge http Headers
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
const populatePathParams = (
  url: URL,
  pathname: string,
  params?: Record<string, string | number>,
) => {
  if (!params) {
    url.pathname += pathname;
  } else {
    url.pathname += Object.keys(params).reduce((pathname, key) => {
      return pathname.replace(`{${key}}`, String(params[key]));
    }, pathname);
  }
  url.pathname = url.pathname.replace("//", "/");
};
const populateQueryParams = (
  url: URL,
  params?: Record<string, string | number>,
) => {
  if (!params) return void 0;
  url.search = Object.keys(params)
    .reduce((search, key) => {
      search.append(key, String(params[key]));
      return search;
    }, new URLSearchParams())
    .toString();
};

const toStatus = (expose: {
  pending?: boolean | undefined;
  error?: unknown;
  data?: unknown;
}) => {
  return expose.error !== undefined
    ? "error"
    : expose.pending !== false && expose.pending !== undefined
      ? "pending"
      : expose.data === undefined
        ? "idle"
        : "success";
};

type BaseHookSource<I, O> = {
  method: string;
  pathname: string;
  baseUrl?: string;
  fetcher?: (input: I) => Promise<O>;
  mode: "http" | "custom";
};

type QueryRuntimeOptions<
  S extends HttpSchemaProperties,
  Serialized,
  I,
  O,
> = Omit<BaseQueryHookOptions<S, Serialized, I, O>, "cache" | "fetcher"> & {
  client: ARQContext;
  cache?: Exclude<BaseQueryHookOptions<S, Serialized, I, O>["cache"], true>;
  fetcher?: (input: I) => Promise<[S["Response"], O]>;
};

type QueryHookRuntime<S extends HttpSchemaProperties, Serialized, I, O> = {
  source: BaseHookSource<I, [S["Response"], O]>;
  options: QueryRuntimeOptions<S, Serialized, I, O>;
  render: () => void;
  getQuery: () => S["Query"] | undefined;
  getPath: () => S["Path"] | undefined;
  getEnabled: () => boolean | undefined;
  nextRequestId: () => string;
};

type QueryExpose<SerializedData, S extends HttpSchemaProperties, I, O> = {
  pending?: boolean;
  data?: SerializedData | undefined;
  error?: S["Error"] | undefined;
  response?: O;
  request?: I;
};

type QueryMetadata<S extends HttpSchemaProperties> = {
  unmounted?: boolean;
  done?: boolean;
  requestId?: string | undefined;
  cachedIds: Set<string>;
  depOutdated?: boolean;
};

export function createBaseQueryHook<
  S extends HttpSchemaProperties,
  Serialized,
  I = Request,
  O = Response,
>(runtime: QueryHookRuntime<S, Serialized, I, O>) {
  type SerializedData = ResolvedResponseType<S["Response"], Serialized>;
  type UnknownSubscriber = (
    subscriber: readonly [unknown, unknown, unknown],
    key: string,
  ) => void;
  type UnknownCacheObject = QueryCacheObject<unknown, unknown>;

  const { source, options, render, getQuery, getPath, getEnabled } = runtime;
  const { pathname, method, baseUrl, fetcher: localFetcher, mode } = source;
  const expose: QueryExpose<SerializedData, S, I, O> = {};
  const metadata: QueryMetadata<S> = { cachedIds: new Set() };
  const fetcher = (options.fetcher ||
    localFetcher ||
    options.client.options.fetcher) as (
    request: Request,
  ) => Promise<[unknown, O]>;

  if (!fetcher) throw new Error("Failed to initialize fetcher");

  const cleanup = () => {
    Object.keys(expose).forEach(
      (key) => void (expose[key as keyof typeof expose] = void 0),
    );
  };
  const deps = () => ({
    query: getQuery(),
    path: getPath(),
  });
  const cacheSubscriber = async (
    ret: readonly [unknown, I, O],
    key: string,
  ) => {
    if (expose.pending || metadata.unmounted) return void 0;
    if (!options.cache || makeCacheKey(mode, options.cache.key) !== key) {
      return void 0;
    }
    try {
      expose.data = ((await options.onSuccess?.(ret[0] as S["Response"], {
        input: ret[1],
        output: ret[2],
      })) ?? ret[0]) as SerializedData;
      expose.response = ret[2];
      expose.request = ret[1];
      render();
    } catch (e) {
      console.error("An error occurred while notifying", e);
    }
  };
  const makeRequest = async (
    requestOptions?: {
      query?: S["Query"];
      path?: S["Path"];
    } & QueryExecuteOptions<S>,
  ): Promise<readonly [S["Response"], I, O]> => {
    const url = new URL(
      baseUrl || options.client.options.baseUrl || location.origin,
    );
    const latestDeps = deps();
    populatePathParams(
      url,
      pathname,
      (requestOptions?.path || latestDeps.path) as
        | Record<string, string | number>
        | undefined,
    );
    if (requestOptions?.query || latestDeps.query) {
      populateQueryParams(
        url,
        pipe((requestOptions?.query || latestDeps.query) as S["Query"])(
          requestOptions?.serializers?.query || options.serializers?.query,
        )() as Record<string, string | number>,
      );
    }
    const req = new Request(url, {
      method,
      ...options.init,
      ...requestOptions?.init,
      headers: mergeHeaders(
        options.headers as HeadersInit,
        requestOptions?.init?.headers,
      ),
    });
    const ret = (await fetcher(req)) as [S["Response"], O];
    return [ret[0], req as I, ret[1]] as const;
  };
  const makeInvoke = async (
    params?: S["Body"],
  ): Promise<readonly [S["Response"], I, O]> => {
    const latestDeps = deps();
    if (!localFetcher) throw new Error("Fetcher is not defined");
    const input = (params || latestDeps.query) as I;
    const ret = await localFetcher(input);
    return [ret[0], input, ret[1]] as const;
  };
  const executor = mode === "http" ? makeRequest : makeInvoke;

  const implicitly = async (refreshCache = false): Promise<unknown> => {
    expose.pending = true;
    if (!options.keepDirtyOnPending) {
      expose.data = void 0;
      expose.response = void 0;
      expose.error = void 0;
    }
    render();
    const requestId = runtime.nextRequestId();
    metadata.requestId = requestId;
    try {
      await options.onBefore?.();
      const ret = await new Promise<readonly [S["Response"], I, O]>(
        (resolve, reject) => {
          let cacheObject: QueryCacheObject<I, O>;
          type DefaultResolveType = (value: unknown) => void;

          if (!options.cache) return void executor().then(resolve, reject);

          const doPromise = () =>
            executor()
              .then(
                (ret) => {
                  cacheObject.expireTime = Date.now() + staleTime;
                  cacheObject.waitingQueue.resolves.forEach((resolve) =>
                    resolve(ret),
                  );
                  cacheObject.notifyQueue.forEach((notify) =>
                    notify(ret, cacheKey),
                  );
                  cacheObject.stage = "active";
                  return ret;
                },
                (reason) => {
                  cacheObject.waitingQueue.rejects.forEach((reject) =>
                    reject(reason),
                  );
                  cacheObject.stage = "inactive";
                  throw reason;
                },
              )
              .finally(() => {
                cacheObject.waitingQueue.resolves = [];
                cacheObject.waitingQueue.rejects = [];
              });

          const now = Date.now();
          const staleTime =
            options.cache?.staleTime ??
            options.client.options["cache.staleTime"] ??
            300_000;
          const expireTime = now + staleTime;
          const cacheKey = makeCacheKey(mode, options.cache.key);

          if (options.client.queries.has(cacheKey)) {
            const item = options.client.queries.get(cacheKey)!;
            !item.notifyQueue.has(cacheSubscriber as UnknownSubscriber) &&
              item.notifyQueue.add(cacheSubscriber as UnknownSubscriber);
            if (item.stage === "pending") {
              item.waitingQueue.resolves.push(resolve as DefaultResolveType);
              item.waitingQueue.rejects.push(reject);
              return void 0;
            }
            if (
              item.stage === "active" &&
              !refreshCache &&
              item.expireTime > now
            ) {
              item.promise.then(resolve as DefaultResolveType, reject);
              return void 0;
            }
            metadata.cachedIds.delete(cacheKey);
            options.client.queries.delete(cacheKey);
            cacheObject = {
              key: cacheKey,
              promise: doPromise(),
              stage: "pending",
              expireTime,
              cacheScope: options.cache.scope ?? "outer",
              waitingQueue: {
                resolves: [resolve as DefaultResolveType],
                rejects: [reject],
              },
              notifyQueue: item.notifyQueue,
            };
          } else {
            cacheObject = {
              key: cacheKey,
              promise: doPromise(),
              stage: "pending",
              cacheScope: options.cache.scope,
              expireTime,
              waitingQueue: {
                resolves: [resolve as DefaultResolveType],
                rejects: [reject],
              },
              notifyQueue: new Set([cacheSubscriber]),
            };
          }
          options.client.queries.set(
            cacheKey,
            cacheObject as UnknownCacheObject,
          );
          metadata.cachedIds.add(cacheKey);
        },
      ).finally(() => {
        if (requestId !== metadata.requestId) {
          throw new OverdueError("The request is outdated", {
            currentRequestId: requestId,
            latestRequestId: metadata.requestId,
          });
        }
        if (metadata.unmounted) {
          throw new OverdueError("The hook is unmounted");
        }
        cleanup();
        expose.pending = false;
        metadata.done = true;
      });

      expose.data = ((await options.onSuccess?.(ret[0], {
        input: ret[1],
        output: ret[2],
      })) ?? ret[0]) as SerializedData;
      expose.request = ret[1];
      expose.response = ret[2];
      render();
    } catch (e) {
      if (e instanceof OverdueError) return void 0;
      checkUnexpectedError(e);
      options.onError?.(e as S["Error"]);
      expose.error = e as S["Error"];
      render();
    } finally {
      options.onFinally?.();
    }
  };

  const execute: QueryExecuteFunc<S> = async (...args) => {
    const query = args[0] as S["Query"];
    const executeOptions = (args[1] ?? {
      silent: options.client.options.default?.["query.execute.silent"],
    }) as QueryExecuteOptions<S>;
    const rerender = createRerender(executeOptions.silent === false, render);

    await options.onBefore?.();
    rerender(() => {
      expose.pending = true;
    });
    let request: I | undefined;
    try {
      const ret = await executor({
        query,
        ...executeOptions,
      }).finally(() => rerender(cleanup, false));
      request = ret[1];
      const serializedData = ((await options.onSuccess?.(ret[0], {
        input: ret[1],
        output: ret[2],
      })) ?? ret[0]) as SerializedData;
      rerender(() => {
        expose.data = serializedData;
        expose.request = ret[1];
        expose.response = ret[2];
      }, false);
      return ret[0];
    } catch (e) {
      checkUnexpectedError(e);
      rerender(() => {
        expose.request = request;
        expose.error = e as S["Error"];
      }, false);
      options.onError?.(e as S["Error"]);
      throw e;
    } finally {
      if (!metadata.unmounted) {
        rerender(() => {
          expose.pending = false;
          metadata.done = true;
        });
      }
      options.onFinally?.();
    }
  };

  const refresh: RefreshFunc = async (refreshOptions) => {
    if (refreshOptions && isPlainObject(refreshOptions)) {
      if (metadata.unmounted && refreshOptions.skipOnUnmounted) return void 0;
      if (!getEnabled() && refreshOptions.skipOnDisabled) return void 0;
      if (expose.pending && refreshOptions.skipOnPending) return void 0;
    }
    await implicitly(true);
  };

  return {
    execute,
    refresh,
    implicitly,
    mount() {
      metadata.unmounted = false;
    },
    markDependenciesOutdated() {
      metadata.depOutdated = true;
    },
    runImplicitlyWhenNeeded() {
      if (getEnabled() === false) return void 0;
      if (metadata.depOutdated === false) return void 0;
      metadata.depOutdated = false;
      implicitly().catch((err) => {
        throw err;
      });
    },
    handleDisabled() {
      if (getEnabled() !== false) return void 0;
      if (!options.keepDirtyOnDisabled && metadata.requestId) {
        cleanup();
        render();
        metadata.depOutdated = true;
      } else if (expose.pending) {
        expose.pending = false;
        render();
      }
      metadata.requestId = void 0;
    },
    unmount() {
      metadata.unmounted = true;
      const now = Date.now();
      for (const cacheId of metadata.cachedIds) {
        const cacheObject = options.client.queries.get(cacheId);
        if (!cacheObject) continue;
        cacheObject.notifyQueue.delete(cacheSubscriber as UnknownSubscriber);
        if (cacheObject.cacheScope === "inner") {
          options.client.queries.delete(cacheId);
        }
        if (cacheObject.expireTime <= now) {
          options.client.queries.delete(cacheId);
        }
      }
    },
    snapshot() {
      return {
        status: toStatus(expose),
        pending: expose.pending,
        data: expose.data,
        error: expose.error,
        response: expose.response,
        request: expose.request,
        done: metadata.done,
        execute,
        refresh,
      };
    },
  };
}

type MutationRuntimeOptions<S extends HttpSchemaProperties, I, O> = Omit<
  MutationHookOptions<S, I, O>,
  "fetcher"
> & {
  client: ARQContext;
  fetcher?: (input: I) => Promise<[S["Response"], O]>;
};

type MutationHookRuntime<S extends HttpSchemaProperties, I, O> = {
  source: BaseHookSource<I, [S["Response"], O]>;
  options: MutationRuntimeOptions<S, I, O>;
  render: () => void;
};

type MutationExpose<S extends HttpSchemaProperties, I, O> = {
  pending?: boolean;
  data?: S["Response"];
  error?: S["Error"];
  request?: I;
  response?: O;
};

export function createBaseMutationHook<
  S extends HttpSchemaProperties,
  I = Request,
  O = Response,
>(runtime: MutationHookRuntime<S, I, O>) {
  const { source, options, render } = runtime;
  const { pathname, method, baseUrl, fetcher: localFetcher, mode } = source;
  const expose: MutationExpose<S, I, O> = {};
  const metadata: { done?: boolean; unmounted?: boolean } = {};
  const fetcher = (options.fetcher ||
    localFetcher ||
    options.client.options.fetcher) as (
    request: Request,
  ) => Promise<[unknown, O]>;

  if (!fetcher) throw new Error("Failed to initialize fetcher");

  const cleanup = () => {
    Object.keys(expose).forEach(
      (key) => void (expose[key as keyof typeof expose] = void 0),
    );
  };
  const makeRequest = async (
    params: S["Body"],
    executeOptions: MutationExecuteOptions<S> = {},
  ): Promise<readonly [S["Response"], I, O]> => {
    const url = new URL(
      baseUrl || options.client.options.baseUrl || location.origin,
    );
    populatePathParams(
      url,
      pathname,
      (executeOptions.path || options.path) as
        | Record<string, string | number>
        | undefined,
    );
    if (executeOptions.query || options.query) {
      populateQueryParams(
        url,
        pipe((executeOptions.query || options.query || {}) as S["Query"])(
          executeOptions.serializers?.query,
        )() as Record<string, string | number>,
      );
    }
    const [contentType, body] = pipe(params)(executeOptions.serializers?.body)(
      (body) =>
        serializers.body(
          body as Record<string, unknown> | ArrayBuffer | Uint8Array | number[],
        ),
    )();
    const req = new Request(url, {
      method,
      body,
      ...options.init,
      ...executeOptions.init,
      headers: mergeHeaders(
        contentType === undefined ? null : { "Content-Type": contentType },
        options.headers as HeadersInit,
        options.init?.headers,
        executeOptions.init?.headers,
        options.headers as HeadersInit,
      ),
    });
    const ret = await fetcher(req).then((res) => res as [S["Response"], O]);
    return [ret[0], req as I, ret[1]] as const;
  };
  const makeInvoke = async (
    params: S["Body"],
  ): Promise<readonly [S["Response"], I, O]> => {
    if (!localFetcher) throw new Error("Fetcher is not defined");
    const ret = await localFetcher(params as I);
    return [ret[0], params as I, ret[1]] as const;
  };
  const executor = mode === "http" ? makeRequest : makeInvoke;

  const execute: MutationExecuteFunc<S> = async (...args) => {
    const executeOptions = (args[1] ?? {
      silent: options.client.options.default?.["mutation.execute.silent"],
    }) as MutationExecuteOptions<S>;
    const rerender = createRerender(executeOptions.silent === false, render);
    await options.onBefore?.();
    rerender(() => {
      expose.pending = true;
    });

    let request: I | undefined;
    try {
      const ret = await executor(args[0] as S["Body"], executeOptions).finally(
        () => rerender(cleanup, false),
      );
      request = ret[1];
      rerender(() => {
        expose.data = ret[0];
        expose.response = ret[2];
        expose.request = ret[1];
      }, false);
      options.onSuccess?.(ret[0], {
        input: ret[1],
        output: ret[2],
      });
      return ret[0];
    } catch (e) {
      rerender(() => {
        expose.request = request;
        expose.error = e as S["Error"];
      }, false);
      options.onError?.(e as S["Error"]);
      throw e;
    } finally {
      if (!metadata.unmounted) {
        rerender(() => {
          expose.pending = false;
          metadata.done = true;
        });
      }
      options.onFinally?.();
    }
  };

  return {
    execute,
    mount() {
      metadata.unmounted = false;
    },
    unmount() {
      metadata.unmounted = true;
    },
    snapshot() {
      return {
        status: toStatus(expose),
        pending: expose.pending,
        data: expose.data,
        error: expose.error,
        request: expose.request,
        response: expose.response,
        done: metadata.done,
        execute,
      };
    },
  };
}
