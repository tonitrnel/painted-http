import { describe, expect, it } from "vitest";
import { serializers } from "../serializer";

describe("serializers", () => {
  it.each([
    ["repeat", "tag=a&tag=b"],
    ["csv", "tag=a%2Cb"],
    ["pipes", "tag=a%7Cb"],
    ["bracket", "tag%5B%5D=a&tag%5B%5D=b"],
    ["bracket-index", "tag%5B0%5D=a&tag%5B1%5D=b"],
    ["json", "tag=%5B%22a%22%2C%22b%22%5D"],
  ] as const)("serializes query arrays with %s format", (arrayFormat, query) => {
    expect(serializers.query({ tag: ["a", "b"] }, { arrayFormat })).toBe(query);
  });

  it("serializes query values and omits nullish entries", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");

    expect(
      serializers.query({
        empty: null,
        missing: undefined,
        page: 1,
        ok: true,
        at: date,
      }),
    ).toBe("page=1&ok=true&at=2026-01-02T03%3A04%3A05.000Z");
  });

  it("serializes form data without nullish fields", () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const formData = serializers.formData({
      name: "Ada",
      age: 37,
      skipped: undefined,
      file,
    });

    expect(formData.get("name")).toBe("Ada");
    expect(formData.get("age")).toBe("37");
    expect(formData.has("skipped")).toBe(false);
    expect(formData.get("file")).toBe(file);
  });

  it("serializes supported request bodies", () => {
    const params = new URLSearchParams({ a: "1" });
    const formData = new FormData();
    const blob = new Blob(["hello"]);
    const buffer = new ArrayBuffer(2);
    const bytes = new Uint8Array([1, 2]);

    expect(serializers.body({ a: 1 })).toEqual(["application/json", '{"a":1}']);
    expect(serializers.body(params)).toEqual([
      "application/x-www-form-urlencoded",
      params,
    ]);
    expect(serializers.body(formData)).toEqual([undefined, formData]);
    expect(serializers.body(blob)).toEqual([undefined, blob]);
    expect(serializers.body(buffer)).toEqual([undefined, buffer]);
    expect(serializers.body(bytes)).toEqual([undefined, bytes]);
    expect(serializers.body([1, 2])).toEqual([undefined, new Uint8Array([1, 2])]);
    expect(serializers.body()).toEqual([undefined, undefined]);
  });
});
