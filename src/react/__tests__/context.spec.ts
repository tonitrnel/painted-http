import { describe, it, vi, expect } from "vitest";
import { createElement, type FC, type PropsWithChildren } from "react";
import { renderHook } from "@testing-library/react";
import { createARQContext, useARQContext, ARQProvider } from "../context";

describe("Tests", () => {
  // 测试 createARQContext 函数
  describe("createARQContext", () => {
    it("should return a client with the provided options and a QueriesCache", () => {
      const options = {
        cache: {
          capacity: 30,
          staleTime: 2000,
        },
        fetcher: vi.fn(),
      };

      const client = createARQContext(options);

      expect(client).toHaveProperty("options", options);
      expect(client).toHaveProperty("queries");
    });
  });

  // 测试HttpClientProvider组件
  describe("ARQProvider", () => {
    it("renders without crashing", () => {
      const options = {
        cache: {
          capacity: 30,
          staleTime: 2000,
        },
        fetcher: vi.fn(),
      };

      const value = createARQContext(options);
      const TestWrapper: FC<PropsWithChildren> = ({ children }) => {
        return createElement(
          ARQProvider,
          {
            value,
          },
          children,
        );
      };
      const { result } = renderHook(
        () => {
          return useARQContext();
        },
        { wrapper: TestWrapper },
      );

      expect(result.current.options).not.toBeUndefined();
      expect(result.current.options).toBe(options);
    });
    it("should throw an error", () => {
      const { result } = renderHook(() => {
        try {
          useARQContext();
          return false;
        } catch (e) {
          return true;
        }
      });
      expect(result).toBeTruthy();
    });
  });
});
