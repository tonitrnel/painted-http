import { type QueriesCache } from "./cache";

export interface ContextOptions {
  cache?: {
    capacity?: number;
    staleTime?: number;
  };
  baseUrl?: string;
  fetcher?: (request: Request) => Promise<[unknown, Response]>;
  default?: {
    query?: {
      // query execute function options.
      execution?: {
        /**
         * If the silent mode is true, then the execution will not trigger a re-render of React Component.
         * @default true
         */
        silent?: boolean;
      };
    };
    mutation?: {
      // mutation execute function options.
      execution?: {
        /**
         * If the silent mode is true, then the execution will not trigger a re-render of React Component.
         * @default true
         */
        silent?: boolean;
      };
    };
  };
}
export interface ARQContext {
  queries: QueriesCache<unknown, unknown>;
  options: ContextOptions;
}

export type HttpSchemaProperties = {
  Query: unknown;
  Path: unknown;
  Body: unknown;
  Headers: unknown;
  Response: unknown;
  Error: unknown;
};
export type ApplicableKeys = keyof HttpSchemaProperties;
export type Override<Base extends {}, K extends keyof Base, V> = {
  [P in keyof Base]: P extends K ? V : Base[P];
};
export type ApplySchema<
  S extends HttpSchemaProperties,
  K extends keyof HttpSchemaProperties,
  V,
> = {
  [P in keyof HttpSchemaProperties]: P extends K ? V : S[P];
};
export interface Serializers<TQuery, TBody> {
  query?(query: TQuery): unknown;

  body?(body: TBody): unknown;
}
export type RefreshOptions = {
  // 如果处于 pending 则忽略
  skipOnPending?: boolean;
  // 如果未启用则忽略
  skipOnDisabled?: boolean;
  // 如果组件已被卸载则忽略
  skipOnUnmounted?: boolean;
};
export type RefreshFunc = (options?: RefreshOptions | UIEvent) => Promise<void>;
// 用于辅助函数参数，如果值为空的对象则可以省略传参（void 类型为 function 参数类型时可以省略穿参）
// type AcceptOptional<T extends {}> = {} extends T ? void | T : T;
export type isAcceptOptional<T> = {} extends T ? true : false;

/**
 * 决定返回的类型
 * @param R1 请求返回的类型
 * @param R2 onSuccess 函数返回类型
 */
export type ResolvedResponseType<R1, R2> = unknown extends R2
  ? R1
  : R2 extends void
    ? R1
    : R2;

// ====== Query Type ======
export interface BaseQueryHookOptions<
  S extends HttpSchemaProperties,
  Mutated = S["Response"],
  I = Request,
  O = Response,
> {
  /**
   * 请求头数据
   *
   * 注: `headers` 不会作为自动发起请求的依赖
   */
  headers?: S["Headers"];
  /**
   * fetch init 配置
   *
   * 注: `init` 不会作为自动发起请求的依赖
   */
  init?: RequestInit;
  /**
   * 在禁用时保留存在的数据
   * @default false
   */
  keepDirtyOnDisabled?: boolean;
  /**
   * 在加载时保留存在的数据
   * @default true
   */
  keepDirtyOnPending?: boolean;
  /**
   * 自定义如何序列化 query 参数
   */
  serializers?: Omit<Serializers<S["Query"], unknown>, "body">;
  /**
   * Custom fetcher function
   * @description This function can be used to override default behaviors.
   */
  fetcher?: (input: I) => Promise<[S["Response"], O]>;
  /**
   * 是否启用缓存
   * @example ```ts
   * const useUsersQuery = createQueryFactory('/api/users/list')
   * useUsersQuery({
   *     cache: {
   *       cacheKey: 'users',
   *       cacheAge: 1000 * 60 * 60,
   *       cacheLife: 'outer',
   *     }
   * })
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
         * @param outer `HttpClientProvider` 组件生命周期内有效
         * @default outer
         */
        scope?: "inner" | "outer";
      }
    | true;
  /**
   * 当成功时的回调，返回值将作为新的数据
   * @param data
   * @param response
   * @description 可以用于自定义返回数据，该方法返回的值不会作为 `execute` 方法的返回值
   */
  onSuccess?: (
    data: S["Response"],
    context: { input: I; output: O },
  ) => Mutated | Promise<Mutated>;
  /**
   * 当错误时的回调
   * @param error
   */
  onError?: (error: S["Error"]) => void;
  /**
   * 当请求无论是错误或成功都会执行的回调函数
   */
  onFinally?: () => void;
  /**
   * 当请求发出前执行的回调函数
   */
  onBefore?: () => void | Promise<void>;
}
// QueryContext Variants
export type QueryPendingContext<
  S extends HttpSchemaProperties,
  I = Request,
  O = Response,
> = Readonly<{
  status: "pending" | "idle"; // When the pending is `undefined`, the status becomes `idle`
  pending: true | undefined;
  error: undefined;
  done: false | undefined;
  request: I | undefined;
  response: O | undefined;
  execute: QueryExecuteFunc<S>;
  refresh: RefreshFunc;
}>;
export type QuerySuccessContext<
  S extends HttpSchemaProperties,
  I = Request,
  O = Response,
> = Readonly<{
  status: "success";
  pending: false;
  error: undefined;
  done: true;
  request: I;
  response: O;
  execute: QueryExecuteFunc<S>;
  refresh: RefreshFunc;
}>;
export type QueryErrorContext<
  S extends HttpSchemaProperties,
  I = Request,
  O = Response,
> = Readonly<{
  status: "error";
  pending: false;
  error: S["Error"];
  done: true;
  request: I;
  response: O | undefined;
  execute: QueryExecuteFunc<S>;
  refresh: RefreshFunc;
}>;
export type QueryExecuteOptions<S extends HttpSchemaProperties> = {
  init?: RequestInit;
  /**
   * 路径参数
   */
  path?: S["Path"];
  /**
   * 是否静默
   * @description 如果为false将触发重新渲染
   * @default true
   */
  silent?: boolean;
  /**
   * 自定义如何对 query 进行序列化
   */
  serializers?: Omit<Serializers<S["Query"], never>, "body">;
};
export type QueryExecuteFunc<S extends HttpSchemaProperties> = (
  ...args: isAcceptOptional<S["Query"]> extends true
    ? [query?: S["Query"], options?: QueryExecuteOptions<S>]
    : [query: S["Query"], options?: QueryExecuteOptions<S>]
) => Promise<S["Response"]>;
export type QueryHookReturn<D, S extends HttpSchemaProperties, I, O> =
  | Readonly<{ data: undefined } & QueryPendingContext<S, I, O>>
  | Readonly<{ data: D } & QuerySuccessContext<S, I, O>>
  | Readonly<{ data: undefined } & QueryErrorContext<S, I, O>>;

// ====== Mutation Type ======
export type MutationHookOptions<
  S extends HttpSchemaProperties,
  I = Request,
  O = Response,
> = {
  /**
   * 查询参数
   */
  query?: S["Query"];
  /**
   * 路径参数
   */
  path?: S["Path"];
  /**
   * header参数
   */
  headers?: S["Headers"];
  /**
   * Custom fetcher function
   * @description This function can be used to override default behaviors.
   */
  fetcher?: (request: Request) => Promise<[S["Response"], O]>;
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
  onSuccess?: (data: S["Response"], context: { input: I; output: O }) => void;
  /**
   * 当请求失败时的回调函数
   * @param error
   */
  onError?: (error: S["Error"]) => void;
  /**
   * 当请求无论是错误或成功都会执行的回调函数
   */
  onFinally?: () => void;
};
export type MutationHookReturn<S extends HttpSchemaProperties> =
  | Readonly<{ data: undefined } & MutationPendingContext<S>>
  | Readonly<{ data: S["Response"] } & MutationSuccessContext<S>>
  | Readonly<{ data: undefined } & MutationErrorContext<S>>;
// MutationContext Variants
type MutationPendingContext<S extends HttpSchemaProperties> = Readonly<{
  status: "pending" | "idle"; // When the pending is `undefined`, the status becomes `idle`
  pending: true | undefined;
  error: undefined;
  done: false | undefined;
  request: Request | undefined;
  response: Response | undefined;
  execute: MutationExecuteFunc<S>;
}>;

type MutationSuccessContext<S extends HttpSchemaProperties> = Readonly<{
  status: "success";
  pending: false;
  error: undefined;
  done: true;
  request: Request;
  response: Response;
  execute: MutationExecuteFunc<S>;
}>;

type MutationErrorContext<S extends HttpSchemaProperties> = Readonly<{
  status: "error";
  pending: false;
  error: S["Error"];
  done: true;
  request: Request;
  response: Response | undefined;
  execute: MutationExecuteFunc<S>;
}>;
export type MutationExecuteFunc<S extends HttpSchemaProperties> = (
  ...args: isAcceptOptional<S["Body"]> extends true
    ? [body?: S["Body"], config?: MutationExecuteOptions<S>]
    : [body: S["Body"], config?: MutationExecuteOptions<S>]
) => Promise<S["Response"]>;

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
  query?: S["Query"];
  /**
   * 路径参数
   */
  path?: S["Path"];
  /**
   * 自定义如何对 query 或 body 进行序列化
   */
  serializers?: Serializers<S["Query"], S["Body"]>;
};

// ====== Request Type ======

export type HttpRequestOptions<
  S extends HttpSchemaProperties,
  Serialized = S["Response"],
> = {
  baseUrl?: string;
  init?: RequestInit;
  serializers?: {
    query?(query: S["Query"]): Record<string, string | number>;
    body?(body: S["Body"]): unknown;
    response?(response: Response): Serialized | Promise<Serialized>;
  };
  fetcher?: (req: Request) => Promise<Response>;
} & ComposeOptions<S["Query"], "query"> &
  ComposeOptions<S["Body"], "body"> &
  ComposeOptions<S["Path"], "path"> &
  ComposeOptions<S["Headers"], "headers">;

export type ApplyArgs<I, O> =
  | [key: "fetcher", value: ((input: I) => Promise<O>) | undefined]
  | [key: "method", value: string]
  | [key: "pathname", value: string]
  | [key: "baseUrl", value: string | undefined]
  | [];

type ComposeOptions<Val, Key extends string> = {} extends Val
  ? { [K in Key]?: Val }
  : {
      [K in Key]: Val;
    };

export type ParsePathParameters<
  S,
  Ret extends {} = {},
> = S extends `${string}{${infer K}}${infer Rest}`
  ? ParsePathParameters<
      Rest,
      Ret & {
        [P in K]: string;
      }
    >
  : Ret;
type InferableHookFn<Options> = (options?: Options) => unknown;

// 辅助类型工具，用于提取 Hook 的 HttpSchemaProperties 内的某个类型
type ExtractFullSchema<T> = T extends (
  ...args: any[]
) => QueryHookReturn<any, infer S1, any, any>
  ? S1
  : T extends (...args: any[]) => MutationHookReturn<infer S2>
    ? S2
    : T extends InferableHookFn<BaseQueryHookOptions<infer S3, any, any, any>>
      ? S3
      : T extends InferableHookFn<MutationHookOptions<infer S4, any, any>>
        ? S4
        : T extends InferableHookFn<HttpRequestOptions<infer S5, unknown>>
          ? S5
          : never;
export type ExtractSchemaType<T, K extends ApplicableKeys> =
  ExtractFullSchema<T> extends infer S extends HttpSchemaProperties
    ? S[K]
    : never;
