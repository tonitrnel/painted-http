import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useARQContext } from "./context";
import type {
  ApplyArgs,
  ApplySchema,
  BaseQueryHookOptions,
  HttpSchemaProperties,
  MutationHookOptions,
  MutationHookReturn,
  ParsePathParameters,
  QueryHookReturn,
  ResolvedResponseType,
} from "../type";
import {
  BaseARQFactory,
  createBaseMutationHook,
  createBaseQueryHook,
} from "../base";

export interface QueryHookOptions<
  S extends HttpSchemaProperties,
  Mutated = S["Response"],
  I = Request,
  O = Response,
> extends BaseQueryHookOptions<S, Mutated, I, O> {
  /**
   * 查询参数
   *
   * 注：`query` 所有字段将会作为自动发起请求的依赖，即发生变化时自动发起请求
   */
  query?: S["Query"];
  /**
   * 路径参数
   *
   * 注：`path` 所有字段将会作为自动发起请求的依赖，即发生变化时自动发起请求
   */
  path?: S["Path"];
  /**
   * 启用该查询
   * @default true
   */
  enabled?: boolean;
}

export class ARQFactory<
  S extends HttpSchemaProperties,
  I = Request,
  O extends [unknown, unknown] = [unknown, Response],
> extends BaseARQFactory<S, I, O> {
  public apply(): ARQFactory<S, I, O>;
  public apply<
    K extends keyof HttpSchemaProperties,
    T extends HttpSchemaProperties[K],
  >(...args: ApplyArgs<I, O>): ARQFactory<ApplySchema<S, K, T>, I, O>;
  public apply(...args: ApplyArgs<I, O>): unknown {
    this._apply(...args);
    return this;
  }

  /**
   * 制作一个 Query 请求 Hook，常用于 GET 请求
   *
   * @tips 该请求 Hook 会在使用时立即发出请求
   */
  public makeQuery() {
    const { pathname, method, baseUrl, fetcher, mode } = this;
    let callSeq = 0;

    function useQuery<Serialized>(
      options: QueryHookOptions<S, Serialized, I, O[1]> = {},
    ) {
      type SerializedData = ResolvedResponseType<S["Response"], Serialized>;
      type Controller = ReturnType<
        typeof createBaseQueryHook<S, Serialized, I, O[1]>
      >;

      const [, dispatchUpdate] = useReducer((v: number) => v + 1, 0);
      const render = useCallback(() => dispatchUpdate(), [dispatchUpdate]);
      const client = useARQContext();
      const latestOptions = useRef({
        ...options,
        client,
        cache: options.cache === true ? { key: pathname } : options.cache,
        fetcher: (options.fetcher || client.options.fetcher) as
          | ((input: I) => Promise<[S["Response"], O[1]]>)
          | undefined,
      });
      Object.assign(latestOptions.current, {
        ...options,
        client,
        cache: options.cache === true ? { key: pathname } : options.cache,
        fetcher: (options.fetcher || client.options.fetcher) as
          | ((input: I) => Promise<[S["Response"], O[1]]>)
          | undefined,
      });

      const queryRef = useRef(options.query);
      const pathRef = useRef(options.path);
      const enabledRef = useRef(options.enabled);
      const dependenciesRef = useRef<{
        initialized?: boolean;
        query?: S["Query"];
        path?: S["Path"];
        version: number;
      }>({ version: 0 });
      queryRef.current = options.query;
      pathRef.current = options.path;
      enabledRef.current = options.enabled;

      const controller = useMemo<Controller>(() => {
        return createBaseQueryHook<S, Serialized, I, O[1]>({
          source: {
            pathname,
            method,
            baseUrl,
            fetcher: fetcher as
              | ((input: I) => Promise<[S["Response"], O[1]]>)
              | undefined,
            mode,
          },
          options: latestOptions.current,
          render,
          getQuery: () => queryRef.current,
          getPath: () => pathRef.current,
          getEnabled: () => enabledRef.current,
          nextRequestId: () => `:${mode}+${Date.now()}#${callSeq++}`,
        });
      }, []);

      const dependenciesVersion = useMemo(() => {
        const dependencies = dependenciesRef.current;
        if (!dependencies.initialized) {
          dependencies.initialized = true;
          dependencies.query = options.query;
          dependencies.path = options.path;
          return dependencies.version;
        }
        const queryChanged = !isEquals(dependencies.query, options.query);
        const pathChanged = !isEquals(dependencies.path, options.path);
        if (!queryChanged && !pathChanged) return dependencies.version;

        dependencies.query = options.query;
        dependencies.path = options.path;
        dependencies.version += 1;
        controller.markDependenciesOutdated();
        return dependencies.version;
      }, [controller, options.path, options.query]);

      useEffect(() => {
        controller.runImplicitlyWhenNeeded();
      }, [controller, dependenciesVersion, options.enabled]);

      useEffect(() => {
        controller.handleDisabled();
      }, [controller, options.enabled]);

      useEffect(() => {
        return () => {
          controller.unmount();
        };
      }, [controller]);

      return controller.snapshot() as QueryHookReturn<
        SerializedData,
        S,
        I,
        O[1]
      >;
    }

    Reflect.set(useQuery, "__source", { method, pathname, baseUrl });
    return useQuery;
  }

  /**
   * 制作一个 Mutation 请求 Hook，常用于 POST 请求
   *
   * @tips 该请求 Hook 不会自动发出请求，需要主动调用 `execute` 方法才可发出请求
   */
  public makeMutation() {
    const { pathname, method, baseUrl, fetcher, mode } = this;

    function useMutation(options: MutationHookOptions<S, I, O[1]> = {}) {
      type Controller = ReturnType<typeof createBaseMutationHook<S, I, O[1]>>;

      const [, dispatchUpdate] = useReducer((v: number) => v + 1, 0);
      const render = useCallback(() => dispatchUpdate(), [dispatchUpdate]);
      const client = useARQContext();
      const latestOptions = useRef({
        ...options,
        client,
        fetcher: (options.fetcher || client.options.fetcher) as
          | ((input: I) => Promise<[S["Response"], O[1]]>)
          | undefined,
      });
      Object.assign(latestOptions.current, {
        ...options,
        client,
        fetcher: (options.fetcher || client.options.fetcher) as
          | ((input: I) => Promise<[S["Response"], O[1]]>)
          | undefined,
      });

      const controller = useMemo<Controller>(() => {
        return createBaseMutationHook<S, I, O[1]>({
          source: {
            pathname,
            method,
            baseUrl,
            fetcher: fetcher as
              | ((input: I) => Promise<[S["Response"], O[1]]>)
              | undefined,
            mode,
          },
          options: latestOptions.current,
          render,
        });
      }, []);

      useEffect(() => {
        return () => {
          controller.unmount();
        };
      }, [controller]);

      return controller.snapshot() as MutationHookReturn<S>;
    }

    Reflect.set(useMutation, " __source", {
      method,
      pathname,
      baseUrl,
    });
    return useMutation;
  }

  public static fromQueryCustom<P extends HttpSchemaProperties["Query"], R>(
    execute: (params: P) => Promise<R>,
  ) {
    const instance = new ARQFactory<
      Omit<HttpSchemaProperties, "Query" | "Response"> & {
        Query: P;
        Response: R;
      },
      P,
      [R, undefined]
    >("/", ".");
    instance.fetcher = (params: P) =>
      execute(params).then((data) => [data, void 0]);
    instance.mode = "custom";
    return instance.makeQuery();
  }

  public static fromMutationCustom<P extends HttpSchemaProperties["Body"], R>(
    execute: (params: P) => Promise<R>,
  ) {
    const instance = new ARQFactory<
      Omit<HttpSchemaProperties, "Body" | "Response"> & {
        Body: P;
        Response: R;
      },
      P,
      [R, undefined]
    >("/", ".");
    instance.fetcher = (params: P) =>
      execute(params).then((data) => [data, void 0]);
    instance.mode = "custom";
    return instance.makeMutation();
  }
}

export const createARQFactory = <S extends string>(
  url: S,
  sep = ":",
  fetcher:
    | ((input: Request) => Promise<[unknown, Response]>)
    | undefined = undefined,
) => {
  const [method, pathname] = url.split(sep);

  return new ARQFactory(
    method.toUpperCase(),
    pathname,
    undefined,
    fetcher,
  ) as ARQFactory<
    Omit<HttpSchemaProperties, "Path"> & {
      Path: ParsePathParameters<S>;
    }
  >;
};

const isEquals = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return left === right;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => isEquals(item, right[index]));
  }
  if (
    Object.getPrototypeOf(left) !== Object.prototype ||
    Object.getPrototypeOf(right) !== Object.prototype
  ) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      isEquals(leftRecord[key], rightRecord[key]),
  );
};
