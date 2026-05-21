import { describe, expect, it, vi } from "vitest";
import {
  isArray,
  isDef,
  isEquals,
  isFunction,
  isNil,
  isNumber,
  isObject,
  isPlainObject,
  isString,
  pipe,
} from "../utilities";

describe("utilities", () => {
  it("checks primitive and structural type guards", () => {
    expect(isDef(0)).toBe(true);
    expect(isDef(null)).toBe(false);
    expect(isString("value")).toBe(true);
    expect(isNumber(1)).toBe(true);
    expect(isNumber(Number.NaN)).toBe(false);
    expect(isArray([])).toBe(true);
    expect(isFunction(() => void 0)).toBe(true);
    expect(isNil(null)).toBe(true);
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(new Date())).toBe(false);
  });

  it("composes transformations while skipping empty steps", () => {
    const transform = vi.fn((value: number) => value * 2);

    const result = pipe(2)(null)(transform)((value) => String(value))();

    expect(result).toBe("4");
    expect(transform).toHaveBeenCalledWith(2);
  });

  it("deeply compares arrays and plain objects", () => {
    expect(isEquals(Number.NaN, Number.NaN)).toBe(true);
    expect(isEquals({ a: [1, { b: "c" }] }, { a: [1, { b: "c" }] })).toBe(
      true,
    );
    expect(isEquals({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(isEquals(new Date(0), new Date(0))).toBe(false);
  });
});
