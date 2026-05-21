import { describe, expect, it, vi } from "vitest";
import {
  BaseARQFactory,
  createBaseMutationHook,
  createBaseQueryHook,
} from "../base";
import { QueriesCache } from "../cache";
import type { ARQContext, HttpSchemaProperties } from "../type";

type Schema = HttpSchemaProperties & {
  Query: { page?: number; q?: string };
  Path: { id: string };
  Body: { name: string };
  Headers: Record<string, string>;
  Response: { id: string; name: string };
  Error: Error;
};

const createClient = (
  options: Partial<ARQContext["options"]> = {},
): ARQContext => ({
  queries: new QueriesCache(20),
  options: {
    baseUrl: "https://api.example",
    ...options,
  },
});

describe("BaseARQFactory", () => {
  it("creates a request function that builds URL, headers, body, and response", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("https://api.example/users/42?q=Ada&page=2");
      expect(request.headers.get("content-type")).toBe("application/json");
      expect(request.headers.get("x-init")).toBe("init");
      expect(request.headers.get("x-request")).toBe("request");
      expect(await request.json()).toEqual({ name: "Ada" });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const request = new BaseARQFactory<Schema>(
      "POST",
      "/users/{id}",
    ).makeRequest();

    await expect(
      request({
        baseUrl: "https://api.example",
        path: { id: "42" },
        query: { q: "Ada", page: 2 },
        body: { name: "Ada" },
        init: { headers: { "x-init": "init" } },
        headers: { "x-request": "request" },
        fetcher,
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("applies runtime overrides before creating a request", async () => {
    const factory = new BaseARQFactory<Schema>("GET", "/old");
    factory.apply("method", "PATCH");
    factory.apply("pathname", "/users/{id}");
    factory.apply("baseUrl", "https://override.example");

    const request = factory.makeRequest();
    const response = await request({
      path: { id: "1" },
      body: { name: "Ada" },
      fetcher: async (input) => {
        expect(input.method).toBe("PATCH");
        expect(input.url).toBe("https://override.example/users/1");
        return new Response(JSON.stringify({ id: "1", name: "Ada" }));
      },
    });

    expect(response).toEqual({ id: "1", name: "Ada" });
  });

  it("uses custom serializers for query, body, and response", async () => {
    const request = new BaseARQFactory<Schema>(
      "POST",
      "/users/{id}",
      "https://api.example",
    ).makeRequest<string>();

    const result = await request({
      path: { id: "7" },
      query: { q: "Ada" },
      body: { name: "Ada" },
      serializers: {
        query: (query) => ({ q: query.q?.toUpperCase() ?? "" }),
        body: (body) => new URLSearchParams({ name: body.name }),
        response: async (response) => response.text(),
      },
      fetcher: async (input) => {
        expect(input.url).toBe("https://api.example/users/7?q=ADA");
        expect(input.headers.get("content-type")).toBe(
          "application/x-www-form-urlencoded",
        );
        expect(await input.text()).toBe("name=Ada");
        return new Response("serialized");
      },
    });

    expect(result).toBe("serialized");
  });
});

describe("createBaseQueryHook", () => {
  it("runs implicit HTTP queries and exposes transformed data", async () => {
    const render = vi.fn();
    const response = new Response("ok");
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe("https://api.example/users/42?page=2");
      expect(request.headers.get("x-query")).toBe("yes");
      return [{ id: "42", name: "Ada" }, response] as const;
    });
    const controller = createBaseQueryHook<Schema, { label: string }>({
      source: {
        method: "GET",
        pathname: "/users/{id}",
        mode: "http",
      },
      options: {
        client: createClient({ fetcher }),
        headers: { "x-query": "yes" },
        onSuccess: (data, context) => {
          expect(context.output).toBe(response);
          return { label: data.name };
        },
      },
      render,
      getQuery: () => ({ page: 2 }),
      getPath: () => ({ id: "42" }),
      getEnabled: () => true,
      nextRequestId: () => "request-1",
    });

    expect(controller.snapshot().status).toBe("idle");
    await controller.implicitly();

    expect(controller.snapshot()).toMatchObject({
      status: "success",
      pending: false,
      data: { label: "Ada" },
      response,
      done: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalled();
  });

  it("deduplicates active cache entries by cache key", async () => {
    const client = createClient();
    const fetcher = vi.fn(async () => {
      return [{ id: "1", name: "Ada" }, new Response("ok")] as const;
    });
    const createController = () =>
      createBaseQueryHook<Schema, unknown>({
        source: {
          method: "GET",
          pathname: "/users/{id}",
          mode: "http",
        },
        options: {
          client,
          fetcher,
          cache: { key: "users", staleTime: 10_000 },
        },
        render: vi.fn(),
        getQuery: () => ({ page: 1 }),
        getPath: () => ({ id: "1" }),
        getEnabled: () => true,
        nextRequestId: () => crypto.randomUUID(),
      });
    const first = createController();
    const second = createController();

    await first.implicitly();
    await second.implicitly();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.snapshot()).toMatchObject({
      status: "success",
      data: { id: "1", name: "Ada" },
    });
  });

  it("keeps in-flight implicit query results after a dev remount cycle", async () => {
    let resolveRequest:
      | ((value: readonly [Schema["Response"], Response]) => void)
      | undefined;
    const fetcher = vi.fn(
      () =>
        new Promise<readonly [Schema["Response"], Response]>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const controller = createBaseQueryHook<Schema, unknown>({
      source: {
        method: "GET",
        pathname: "/users/{id}",
        mode: "http",
      },
      options: {
        client: createClient(),
        fetcher,
      },
      render: vi.fn(),
      getQuery: () => ({ page: 1 }),
      getPath: () => ({ id: "1" }),
      getEnabled: () => true,
      nextRequestId: () => "request-remount",
    });

    const pending = controller.implicitly();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetcher).toHaveBeenCalledTimes(1);
    controller.unmount();
    controller.mount();
    resolveRequest!([{ id: "1", name: "Ada" }, new Response("ok")]);
    await pending;

    expect(controller.snapshot()).toMatchObject({
      status: "success",
      pending: false,
      data: { id: "1", name: "Ada" },
      done: true,
    });
  });

  it("supports manual execute error state and refresh skip options", async () => {
    const onError = vi.fn();
    const onFinally = vi.fn();
    const fetcher = vi.fn(async () => {
      throw new Error("boom");
    });
    const controller = createBaseQueryHook<Schema, unknown>({
      source: {
        method: "GET",
        pathname: "/users/{id}",
        mode: "http",
      },
      options: {
        client: createClient(),
        fetcher,
        onError,
        onFinally,
      },
      render: vi.fn(),
      getQuery: () => ({ page: 1 }),
      getPath: () => ({ id: "1" }),
      getEnabled: () => false,
      nextRequestId: () => "request-error",
    });

    await expect(
      controller.execute({ q: "Ada" }, { silent: false }),
    ).rejects.toThrow("boom");
    await controller.refresh({ skipOnDisabled: true });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onFinally).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      pending: false,
      done: true,
    });
  });
});

describe("createBaseMutationHook", () => {
  it("executes HTTP mutations with body, query, path, and callbacks", async () => {
    const render = vi.fn();
    const onBefore = vi.fn();
    const onSuccess = vi.fn();
    const onFinally = vi.fn();
    const response = new Response("ok");
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.method).toBe("PUT");
      expect(request.url).toBe("https://api.example/users/42?q=Ada");
      expect(request.headers.get("content-type")).toBe("application/json");
      expect(request.headers.get("x-option")).toBe("option");
      expect(request.headers.get("x-execute")).toBe("execute");
      expect(await request.json()).toEqual({ name: "Ada" });
      return [{ id: "42", name: "Ada" }, response] as const;
    });
    const controller = createBaseMutationHook<Schema>({
      source: {
        method: "PUT",
        pathname: "/users/{id}",
        mode: "http",
      },
      options: {
        client: createClient({ fetcher }),
        path: { id: "42" },
        headers: { "x-option": "option" },
        onBefore,
        onSuccess,
        onFinally,
      },
      render,
    });

    await expect(
      controller.execute(
        { name: "Ada" },
        {
          query: { q: "Ada" },
          silent: false,
          init: { headers: { "x-execute": "execute" } },
        },
      ),
    ).resolves.toEqual({ id: "42", name: "Ada" });

    expect(controller.snapshot()).toMatchObject({
      status: "success",
      pending: false,
      data: { id: "42", name: "Ada" },
      response,
      done: true,
    });
    expect(onBefore).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(
      { id: "42", name: "Ada" },
      { input: expect.any(Request), output: response },
    );
    expect(onFinally).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalled();
  });

  it("executes custom mutations without creating Request objects", async () => {
    const fetcher = vi.fn(async (input: Schema["Body"]) => {
      return [{ id: "1", name: input.name }, undefined] as const;
    });
    const controller = createBaseMutationHook<Schema, Schema["Body"], undefined>(
      {
        source: {
          method: ".",
          pathname: "/",
          mode: "custom",
          fetcher,
        },
        options: {
          client: createClient(),
        },
        render: vi.fn(),
      },
    );

    await expect(
      controller.execute({ name: "Ada" }, { silent: false }),
    ).resolves.toEqual({
      id: "1",
      name: "Ada",
    });
    expect(fetcher).toHaveBeenCalledWith({ name: "Ada" });
    expect(controller.snapshot().request).toEqual({ name: "Ada" });
  });
});
