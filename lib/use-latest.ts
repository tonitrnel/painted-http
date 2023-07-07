import { MutableRefObject, useCallback, useRef } from 'react';

/**
 * 返回数据最新的引用
 * @param value
 */
export const useLatestRef = <T>(value: T): MutableRefObject<T> => {
  const ref = useRef<T>();
  ref.current = value;
  return ref as MutableRefObject<T>;
};

/**
 * 返回一个不变的函数执行最新的函数
 * @param func
 */
export const useLatestFunc = <
  T extends ((...args: never[]) => unknown) | undefined
>(
  func: T
): T => {
  const ref = useLatestRef(func);
  const apply = useCallback((...args: never[]) => ref.current!(...args), [ref]);
  return (ref.current ? apply : void 0) as T;
};

// mod tests
if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe('Tests', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    it('useLatestRef updates the ref on every render', () => {
      const { result, rerender } = renderHook(
        ({ value }) => useLatestRef(value),
        {
          initialProps: { value: 'first' },
        }
      );

      expect(result.current.current).toBe('first');

      rerender({ value: 'second' });

      expect(result.current.current).toBe('second');
    });
    it('useLatestFunc should always execute the latest function', () => {
      const firstFunc = vi.fn();
      const secondFunc = vi.fn();
      const { result, rerender } = renderHook(({ func }) => useLatestFunc(func), {
        initialProps: { func: firstFunc as (() => void) | undefined },
      });

      act(() => {
        result.current?.();
      });

      expect(firstFunc).toHaveBeenCalled();

      rerender({ func: secondFunc });

      act(() => {
        result.current?.();
      });

      expect(secondFunc).toHaveBeenCalled();

      rerender({ func: undefined });

      expect(result.current).toBe(undefined)
    });
  });
}
