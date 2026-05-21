/**
 * Check if value is defined
 * @param value
 */
export const isDef = <T>(value: T): value is NonNullable<T> => {
  return !(value === void 0 || value === null);
};
/**
 * Check if value is a string
 * @param str
 */
export const isString = (str: unknown): str is string =>
  typeof str === "string";

/**
 * Check if value is a number
 * @param num
 */
export const isNumber = (num: unknown): num is number =>
  typeof num === "number" && !Number.isNaN(num);

/**
 * Check if value is an array
 * @param arg
 */
export const isArray = <T extends unknown[]>(arg: unknown): arg is T => {
  return Array.isArray(arg);
};

/**
 * Check if value is a function
 * @param fn
 */
export const isFunction = <T extends (...args: never[]) => unknown>(
  fn: unknown,
): fn is T => typeof fn === "function";

/**
 * Check if value is `null`
 * @param value
 */
export const isNil = (value: unknown): value is null => value === null;

/**
 * Check if value is an object
 * @param obj
 */
export const isObject = <T extends object = object>(obj: unknown): obj is T =>
  !isNil(obj) && typeof obj === "object" && !Array.isArray(obj);

/**
 * Check if value is a plain object
 * @param obj
 */
export const isPlainObject = (obj: unknown): obj is Record<string, unknown> =>
  isObject(obj) && Reflect.getPrototypeOf(obj) === Object.prototype;
/**
 * Compose a series of transformations
 * @param initialValue
 * @example pipe(1)(prev => prev+2)(prev => prev.toString())() // '3'
 */
export const pipe = <T>(
  initialValue: T,
): PipeReturn<
  unknown,
  {
    _: T;
  }
> => {
  return (<T2 = unknown>(...transformers: [T2] | []) => {
    // return
    if (transformers.length === 0) return initialValue;
    // skip
    if (!isFunction(transformers[0])) return pipe(initialValue);
    // continue
    return pipe((transformers[0] as (arg: unknown) => unknown)(initialValue));
  }) as PipeReturn<
    unknown,
    {
      _: T;
    }
  >;
};
type PipeReturn<PrevValue, NextValue> = NextValue extends {
  "!": never;
}
  ? PrevValue
  : // 避免PipeCarrying生成联合类型（如：PipeCarrying<number> | PipeCarrying<string>），这可能导致类型推导错误。
    // 更理想的方式是将值设为联合（如：PipeCarrying<number | string>）。
    NextValue extends { _: infer Value }
    ? PipeCarrying<Value>
    : PipeCarrying<NextValue>;
type PipeTransformer<PrevValue> =
  | undefined
  | null
  | false
  | ((prevValue: PrevValue) => unknown);
type PipeCarrying<PrevValue> = <
  NextArgs extends [value: PipeTransformer<PrevValue>] | [],
>(
  ...transformer: NextArgs
) => PipeReturn<
  PrevValue,
  [] extends NextArgs
    ? {
        "!": never;
      }
    : NextArgs[0] extends (prevValue: PrevValue) => unknown
      ? { _: ReturnType<NextArgs[0]> }
      : { _: PrevValue }
>;
/**
 * Equality check
 * @param x
 * @param y
 */
export const isEquals = (x: unknown, y: unknown): boolean => {
  if (Object.is(x, y)) return true;
  if (x === null || y === null) return false;
  if (typeof x !== "object" || typeof y !== "object") return false;
  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y)) return false;
    if (x.length !== y.length) return false;
    return x.every((item, index) => isEquals(item, y[index]));
  }
  if (!isPlainObject(x) || !isPlainObject(y)) return false;
  const xKeys = Object.keys(x);
  const yKeys = Object.keys(y);
  if (xKeys.length !== yKeys.length) return false;
  for (const key of xKeys) {
    if (
      !Object.prototype.hasOwnProperty.call(y, key) ||
      !isEquals(
        Reflect.get(x as Record<string, unknown>, key),
        Reflect.get(y as Record<string, unknown>, key),
      )
    )
      return false;
  }
  return true;
};
