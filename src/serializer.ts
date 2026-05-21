import { isDef, isNumber, isPlainObject, isString } from "./utilities";

export const serializers = {
  /**
   * Query参数序列化
   * @param values
   * @param options
   * @examples ```ts
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'repeat' }) // a=1&a=2&a=3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'pipes' }) // a=1|2|3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'csv' }) // a=1,2,3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'bracket' }) // a[]=1&a[]=2&a[]=3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'bracket' }) // a[]=1&a[]=2&a[]=3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'bracket-index' }) // ?a[0]=1&a[1]=2&a[2]=3
   * serializerHelpers.query({a: [1, 2, 3]}, { arrayFormat: 'json' }) // a=[1,2,3]
   * ```
   */
  query: (
    values: Record<string, unknown>,
    {
      arrayFormat,
    }: {
      // 数组格式化方式
      arrayFormat:
        | "csv"
        | "pipes"
        | "repeat"
        | "bracket"
        | "bracket-index"
        | "json";
    } = { arrayFormat: "repeat" },
  ): string => {
    const search = new URLSearchParams();
    Object.entries(values).forEach(([k, v]) => {
      if (!isDef(v)) return void 0;
      if (isString(v) || isNumber(v)) {
        search.append(k, String(v));
        return void 0;
      }
      if (Array.isArray(v)) {
        switch (arrayFormat) {
          case "csv":
            search.append(k, v.join(","));
            break;
          case "pipes":
            search.append(k, v.join("|"));
            break;
          case "repeat":
            v.forEach((item) => search.append(k, item));
            break;
          case "bracket":
            v.forEach((item) => search.append(`${k}[]`, item));
            break;
          case "bracket-index":
            v.forEach((item, index) => search.append(`${k}[${index}]`, item));
            break;
          case "json":
            search.append(k, JSON.stringify(v));
            break;
        }
        return void 0;
      }
      if (v instanceof Date) {
        search.append(k, v.toISOString());
        return void 0;
      }
      search.append(k, String(v));
    });
    return search.toString();
  },
  /**
   * 将 Object 序列化为 FormData
   * @param values
   * @examples ```ts
   * serializerHelpers.formData({a: 'value1', b: 'value2'}) // FormData
   * ```
   */
  formData: (values: Record<string, unknown>): FormData => {
    const formData = new FormData();
    Object.entries(values).forEach(([k, v]) => {
      if (!isDef(v)) return void 0;
      if (v instanceof File) {
        formData.append(k, v);
      } else {
        formData.append(k, String(v));
      }
    });
    return formData;
  },
  body: (
    body?: Record<string, unknown> | number[] | ArrayBuffer | Uint8Array,
  ): [content_type: string | undefined, body: BodyInit | undefined] => {
    if (body instanceof URLSearchParams)
      return ["application/x-www-form-urlencoded", body] as const;
    if (body instanceof FormData) return [undefined, body] as const;
    if (body instanceof Blob) return [undefined, body] as const;
    if (body instanceof ArrayBuffer) return [undefined, body] as const;
    if (body instanceof Uint8Array) return [undefined, body] as const;
    if (Array.isArray(body)) return [undefined, new Uint8Array(body)] as const;
    if (isPlainObject(body))
      return ["application/json", JSON.stringify(body) as string] as const;
    return [undefined, undefined] as const;
  },
};
