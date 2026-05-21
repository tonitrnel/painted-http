import { isObject } from "../utilities";
import {
  computed,
  onUnmounted,
  readonly,
  ref,
  unref,
  watchEffect,
  type ComputedRef,
  type UnwrapNestedRefs,
  MaybeRef,
  watch,
} from "vue";
import { useARQContext } from "./context";
import type {
  ApplySchema,
  HttpSchemaProperties,
  ResolvedResponseType,
  BaseQueryHookOptions,
  QueryHookReturn,
  MutationHookOptions,
  MutationHookReturn,
  ParsePathParameters,
  ApplyArgs,
} from "../type";
import {
  BaseARQFactory,
  createBaseMutationHook,
  createBaseQueryHook,
} from "../base";

// ====== Query Type ======
export interface QueryHookOptions<
  S extends HttpSchemaProperties,
  Mutated = S["Response"],
  I = Request,
  O = Response,
> extends BaseQueryHookOptions<S, Mutated, I, O> {
  /**
   * 查询参数
   *
   * 注：`query` 所有字段将会作为自动发起请求的依赖，即指发生变化时自动发起请求
   *
   * @example ```typescript
   * const useUsersQuery = createARQFactory('GET:/api/users/list');
   * const pagination = reactive({ page: 1, size: 10 })
   * const usersQuery = useUsersQuery({
   *   query: computed(() => ({
   *     page: pagination.page,
   *     size: pagination.size,
   *   }))
   * })
   * ```
   */
  query?: MaybeRef<S["Query"]>;
  /**
   * 路径参数
   *
   * 注：`query` 所有字段将会作为自动发起请求的依赖，即指发生变化时自动发起请求
   *
   * @example ```typescript
   * const useUserQuery = createARQFactory('GET:/api/users/{userId}');
   * const userId = ref("25654...")
   * const userQuery = useUserQuery({
   *   path: {
   *     userId
   *   }
   * })
   * ```
   */
  path?: MaybeRef<S["Path"]>;
  /**
   * 启用该查询
   * @example ```typescript
   * const useUsersQuery = createARQFactory('GET:/api/users/list');
   * const pagination = reactive({ page: 1, size: 10 })
   * const usersQuery = useUsersQuery({
   *   query: computed(() => ({
   *     page: pagination.page,
   *     size: pagination.size,
   *   })),
   *   enabled: false
   * })
   * ```
   * @tips 建议使用Boolean强行转为boolean值
   * @default true
   */
  enabled?: MaybeRef<boolean>;
}

// ====== Core Class Impl ======

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
      const updateTrigger = ref(Math.random());
      const triggerUpdate = () => void (updateTrigger.value = Math.random());
      const client = useARQContext();
      const mergedOptions = {
        ...options,
        client,
        cache: options.cache === true ? { key: pathname } : options.cache,
        fetcher: (options.fetcher || client.options.fetcher) as
          | ((input: I) => Promise<[S["Response"], O[1]]>)
          | undefined,
      };
      let controller: ReturnType<
        typeof createBaseQueryHook<S, Serialized, I, O[1]>
      >;
      const unrefObject = <T>(obj: T | MaybeRef<T> | ComputedRef<T>): T => {
        if (!isObject(obj)) return obj;
        return Object.entries(unref(obj) as Record<string, unknown>).reduce(
          (acc, [key, value]) => {
            acc[key as keyof T] = unref(value) as T[keyof T];
            return acc;
          },
          {} as T,
        );
      };
      const dependencies = computed(() => {
        controller?.markDependenciesOutdated();
        return {
          query: unrefObject(options.query),
          path: unrefObject(options.path),
        };
      });

      controller = createBaseQueryHook<S, Serialized, I, O[1]>({
        source: {
          pathname,
          method,
          baseUrl,
          fetcher: fetcher as
            | ((input: I) => Promise<[S["Response"], O[1]]>)
            | undefined,
          mode,
        },
        options: mergedOptions,
        render: triggerUpdate,
        getQuery: () => dependencies.value.query,
        getPath: () => dependencies.value.path,
        getEnabled: () => unref(options.enabled),
        nextRequestId: () => `:${mode}+${Date.now()}#${callSeq++}`,
      });
      // 自动调用的逻辑
      watch(
        () => [dependencies, options.enabled],
        () => controller.runImplicitlyWhenNeeded(),
        { deep: true, immediate: true },
      );
      // 在 enabled 设置为 false 时的相关逻辑
      watchEffect(() => {
        controller.handleDisabled();
      });
      onUnmounted(() => {
        controller.unmount();
      });

      const proxy = toReactive(
        computed(() => {
          // @ts-ignore
          const _ = updateTrigger.value; // track
          return controller.snapshot() satisfies Record<
            keyof QueryHookReturn<unknown, S, unknown, unknown>,
            unknown
          >; // 仅用于确保不会缺失字段
        }),
      );
      return proxy as QueryHookReturn<SerializedData, S, I, O[1]>;
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
      const updateTrigger = ref(Math.random());
      const triggerUpdate = () => void (updateTrigger.value = Math.random());
      const client = useARQContext();
      const mergedOptions = {
        ...options,
        client,
        fetcher: (options.fetcher || client.options.fetcher) as
          | ((input: I) => Promise<[S["Response"], O[1]]>)
          | undefined,
      };
      const controller = createBaseMutationHook<S, I, O[1]>({
        source: {
          pathname,
          method,
          baseUrl,
          fetcher: fetcher as
            | ((input: I) => Promise<[S["Response"], O[1]]>)
            | undefined,
          mode,
        },
        options: mergedOptions,
        render: triggerUpdate,
      });

      onUnmounted(() => {
        controller.unmount();
      });

      const proxy = toReactive(
        computed(() => {
          // @ts-ignore
          const _ = updateTrigger.value; // track
          return controller.snapshot() satisfies Record<
            keyof MutationHookReturn<S>,
            unknown
          >;
        }),
      );
      return proxy as MutationHookReturn<S>;
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

// 将 computed ref 转化为 readonly reactive
const toReactive = <T extends object>(computedRef: ComputedRef<T>) => {
  const proxy = new Proxy(
    {},
    {
      get(_, p, receiver) {
        return Reflect.get(computedRef.value, p, receiver);
      },
      set(_, p) {
        console.warn(
          `Set operation on key "${String(p)}" failed: arq hook returned read-only data`,
        );
        return true;
      },
      defineProperty(_, p) {
        console.warn(
          `Delete operation on key "${String(p)}" failed: arq hook returned read-only data`,
        );
        return true;
      },
      has(_, p) {
        return Reflect.has(computedRef.value, p);
      },
      ownKeys() {
        return Object.keys(computedRef.value);
      },
      getOwnPropertyDescriptor() {
        return {
          enumerable: true,
          configurable: true,
        };
      },
    },
  );
  return readonly(proxy) as UnwrapNestedRefs<T>;
};
