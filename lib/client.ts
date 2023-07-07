import {
  createContext,
  createElement,
  FC,
  PropsWithChildren,
  useContext,
} from 'react';
import { QueriesCache } from './cache.ts';

type ClientOptions = {
  cache?: {
    capacity?: number;
    staleTime?: number;
  };
  baseUrl?: string;
  fetcher: (request: Request) => Promise<[unknown, Response]>;
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
};

export type Client = {
  // internal use, Queries cache
  queries: QueriesCache;
  // internal use
  options: ClientOptions;
};
const __CLIENT__ = createContext<Client | null>(null);

export const createHttpClient = (options: ClientOptions): Client => {
  return {
    options,
    queries: new QueriesCache(options.cache?.capacity ?? 24),
  };
};

export const useHttpClient = () => {
  const value = useContext(__CLIENT__);
  if (!value)
    throw new Error(
      ' "useHttpClient" hook must be invoke under <HttpClientProvider/>'
    );
  return value;
};

export const HttpClientProvider: FC<PropsWithChildren<{ value: Client }>> = ({
  value,
  children,
}) => {
  return createElement(
    __CLIENT__.Provider,
    {
      value,
    },
    children
  );
};

// mod tests
if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;
  describe('Tests', async () => {
    const { createElement } = await import('react');
    const { renderHook } = await import('@testing-library/react');
    // 测试createHttpClient函数
    describe('createHttpClient', () => {
      it('should return a client with the provided options and a QueriesCache', () => {
        const options = {
          cache: {
            capacity: 30,
            staleTime: 2000,
          },
          fetcher: vi.fn(),
        };

        const client = createHttpClient(options);

        expect(client).toHaveProperty('options', options);
        expect(client).toHaveProperty('queries');
      });
    });

    // 测试HttpClientProvider组件
    describe('HttpClientProvider', () => {
      it('renders without crashing', () => {
        const options = {
          cache: {
            capacity: 30,
            staleTime: 2000,
          },
          fetcher: vi.fn(),
        };

        const client = createHttpClient(options);
        const TestWrapper: FC<PropsWithChildren> = ({children}) => {
          return createElement(HttpClientProvider, {
            value: client
          }, children)
        }
        const { result } = renderHook(
          () => {
            return useHttpClient();
          },
          {wrapper: TestWrapper}
        );

        expect(result.current.options).not.toBeUndefined();
        expect(result.current.options).toBe(options)
      });
      it("should throw an error", () => {
        const { result } = renderHook(
          () => {
            try {
              useHttpClient();
              return false
            } catch (e) {
              return true;
            }
          }
        );
        expect(result).toBeTruthy()
      })
    });
  });
}
