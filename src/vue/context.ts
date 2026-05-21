import { defineComponent, inject, provide, type InjectionKey } from "vue";
import type { ARQContext, ContextOptions } from "../type";
import { QueriesCache } from "../cache";

const __CTX_KEY__ = Symbol() as InjectionKey<ARQContext>;

export const createARQContext = (options: ContextOptions = {}): ARQContext => {
  return {
    options,
    queries: new QueriesCache(options["cache.capacity"] ?? 24),
  };
};

export const useARQContext = () => {
  const value = inject(__CTX_KEY__);
  if (!value)
    throw new Error(
      ' "useARQContext" hook must be invoke under <ARQClientProvider/>',
    );
  return value;
};

export const ARQProvider = defineComponent<{ value: ARQContext }>({
  name: "ARQProvider",
  props: {
    value: {
      type: Object,
      required: true,
    },
  },
  setup(props, { slots }) {
    provide(__CTX_KEY__, props.value);
    return () => slots.default?.();
  },
});
