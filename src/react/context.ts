import {
  createContext,
  createElement,
  type FC,
  type PropsWithChildren,
  useContext,
} from "react";
import type { ARQContext, ContextOptions } from "../type";
import { QueriesCache } from "../cache";

const __CTX__ = createContext<ARQContext | null>(null);

export const createARQContext = (options: ContextOptions = {}): ARQContext => {
  return {
    options,
    queries: new QueriesCache(options["cache.capacity"] ?? 24),
  };
};
export const useARQContext = () => {
  const value = useContext(__CTX__);
  if (!value)
    throw new Error(
      ' "useARQContext" hook must be invoke under <ARQClientProvider/>',
    );
  return value;
};
export const ARQProvider: FC<PropsWithChildren<{ value: ARQContext }>> = ({
  value,
  children,
}) => {
  return createElement(
    __CTX__.Provider,
    {
      value,
    },
    children,
  );
};
