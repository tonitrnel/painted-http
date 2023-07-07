import { useRef } from 'react';

/**
 * 返回一个常量的引用
 * @param init 初始函数
 * @example useConstant(() => 'hello world');
 */
export const useConstant = <T>(init: () => T): T => {
  const ref = useRef<T>();
  if (!ref.current) ref.current = init();
  return ref.current;
};

// mod tests
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  describe('Tests', async () => {
    const { useEffect} = await import('react')
    const { renderHook} = await import('@testing-library/react')
    it('Basic', () => {
      let callCount = 0;
      let renderCount = 0;
      const { result, rerender } = renderHook(() => {
        renderCount += 1;
        return useConstant(() => {
          callCount += 1;
          return callCount;
        });
      });
      rerender();
      expect(result.current).toBe(1);
      expect(callCount).toBe(1);
      expect(renderCount).toBe(2);
    });
    it('Immutability', () => {
      let obj: Record<string, string> | undefined;
      let renderCount = 0;
      const { result, rerender } = renderHook(() => {
        const currentObj = { key: 'value' };
        useEffect(() => {
          obj = currentObj;
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);
        renderCount += 1;
        return useConstant(() => currentObj);
      });
      rerender();
      rerender();
      expect(renderCount).toBe(3);
      expect(result.current).toBe(obj);
    });
  });
}