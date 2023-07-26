import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { isFunction, pipe, wait } from '@painted/shared';
import { createHttpFactory, HttpFactory, InferSType } from '../http-factory.ts';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createHttpClient, HttpClientProvider } from '../client.ts';
import { createElement, FC, PropsWithChildren } from 'react';

type ResponsibleType =
  | Record<string, unknown>
  | Array<unknown>
  | number
  | string
  | boolean
  | Response;
type ResponseHandler = (request: {
  path: Record<string, string>;
  query: Record<string, string>;
  request: Request;
  url: URL;
  db: Map<string, User>;
  headers: HeadersInit;
}) => Promise<ResponsibleType>;

type User = {
  id: string;
  name: string;
  gender: string;
  email: string;
  phone: string;
};

class HttpMocker {
  constructor(private db: Map<string, User>) {}
  public readonly calls: URL[] = [];
  private routes = new Map<string, ResponsibleType | ResponseHandler>();
  public static resources: readonly Readonly<User>[] = [
    {
      id: 'c6ab405d-4921-4435-a38a-40e0a34291d6',
      name: '寒菁菁',
      gender: '女',
      email: 'eoxyqqlr@qq.com',
      phone: '15292094214',
    },
    {
      id: '8fe20f6c-6f00-45d1-822b-d3a0e1f98d9c',
      name: '孙子迟',
      gender: '男',
      email: 'cfyxvexcbk@56.com',
      phone: '15526716605',
    },
    {
      id: '1a656ce4-c2bb-44dc-a428-6dffe5747f4c',
      name: '楚婉',
      gender: '女',
      email: 'lhycua@yahoo.com.br',
      phone: '19940121569',
    },
    {
      id: '790eba2d-1ba3-4f7a-8f51-949577868af1',
      name: '裘宇文',
      gender: '男',
      email: 'btrcuox@live.co.uk',
      phone: '15514833373',
    },
    {
      id: '91580ada-2156-44ef-95cc-e7c83c2a4a13',
      name: '殴高澹',
      gender: '男',
      email: 'phyfgis@yeah.net',
      phone: '17777604013',
    },
    {
      id: 'a5143a86-807a-456a-9ce9-45af54deb9e5',
      name: '楚桐夕',
      gender: '女',
      email: 'psawywaz@chello.nl',
      phone: '19997978114',
    },
    {
      id: '26b7267f-04a2-40e4-8e9a-ae33ca6a1c0d',
      name: '郦梦函',
      gender: '女',
      email: 'hmifg@yahoo.de',
      phone: '18612526086',
    },
    {
      id: 'abf9ed72-133f-4267-b5ed-c1dc7bf7ced1',
      name: '俞元良',
      gender: '男',
      email: 'ecrnicdzh@windstream.net',
      phone: '15829715415',
    },
    {
      id: '58eda78e-7c34-46d7-9bb1-3b807f6b3ce7',
      name: '侨半芹',
      gender: '女',
      email: 'idlmvstb@freenet.de',
      phone: '18274622698',
    },
  ];
  public static create() {
    const mocker = new HttpMocker(
      new Map(this.resources.map((it) => [it.id, it]))
    );
    mocker
      .on('GET:/api/greet', async () => {
        return 'Hi!';
      })
      .on('GET:/api/users/list', async ({ query, db }) => {
        const { page, limit, keywords, gender } = query;
        const start = ((Number(page) || 1) - 1) * Number(limit || 10);
        const end = start + Number(limit || 10);
        return pipe([...db.values()])((users) =>
          gender ? users.filter((it) => it.gender === gender) : users
        )((users) =>
          keywords
            ? users.filter(
                (it) =>
                  it.name.includes(keywords) || it.phone.includes(keywords)
              )
            : users
        )((users) => ({
          list: users.slice(start, end),
          total: users.length,
        }))();
      })
      .on(`GET:/api/users/{userId}/profile`, async ({ path, db }) => {
        return pipe(db.get(path.userId))((v) => {
          return !v ? HttpMocker.statusCode(404) : v;
        })();
      })
      .on('POST:/api/users/create', async ({ request, db }) => {
        const id = crypto.randomUUID().toLowerCase();
        db.set(id, {
          id,
          ...(await request.json()),
        });
        return id;
      })
      .on(`PUT:/api/users/{userId}`, async ({ path, request, db }) => {
        const data = db.get(path.userId);
        if (!data) return HttpMocker.statusCode(404);
        db.set(path.userId, {
          ...data,
          ...(await request.json()),
        });
        return path.userId;
      });
    return mocker;
  }
  public reload() {
    this.db = new Map(HttpMocker.resources.map((it) => [it.id, it]));
    this.calls.splice(0, this.calls.length);
  }
  static transformToResponse(respond: ResponsibleType) {
    if (respond instanceof Response) {
      return respond;
    } else {
      return new Response(JSON.stringify(respond), {
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  }
  static statusCode(
    ...statusCode: [code: number, body?: BodyInit, headers?: HeadersInit]
  ) {
    return new Response(statusCode[1], {
      status: statusCode[0],
      headers: statusCode[2],
    });
  }
  async fetch(request: Request) {
    const input = new URL(request.url);
    const pathParameters: Record<string, string> = {};
    const actionPath = `${request.method?.toUpperCase() || 'GET'}:${
      input.pathname
    }`;
    const key = Array.from(this.routes.keys()).find((key) => {
      const re = new RegExp(
        key.replace('/', '\\/').replace(/\{(\w+)}/gm, '(?<$1>[\\w-]+)')
      );
      re.lastIndex = -1;
      const result = re.exec(actionPath);
      if (!result) return false;
      Object.assign(pathParameters, result.groups);
      return true;
    });
    await wait(Math.round(Math.random() * 360));
    this.calls.push(input);
    if (!key) {
      return HttpMocker.statusCode(404);
    }
    const respond = this.routes.get(key)!;
    if (isFunction(respond)) {
      const query = Object.fromEntries(input.searchParams.entries());
      try {
        return HttpMocker.transformToResponse(
          await respond({
            query,
            path: pathParameters,
            request,
            headers: new Headers(request.headers),
            db: this.db,
            url: input,
          })
        );
      } catch (e) {
        if (e instanceof Error) {
          return HttpMocker.statusCode(500, String(e.message));
        }
        if (e instanceof Response) {
          return e;
        }
        return HttpMocker.statusCode(500, String(e));
      }
    } else {
      return HttpMocker.transformToResponse(respond);
    }
  }
  on(url: string, respond: ResponsibleType | ResponseHandler) {
    this.routes.set(url, respond);
    return this;
  }
}
describe('Tests', () => {
  const mocker = HttpMocker.create();
  const client = createHttpClient({
    fetcher: async (request) => {
      const response = await mocker.fetch(request);
      if (!response.ok) {
        throw new Error(
          `${request.method} ${request.url.toString()} ${response.status} ${
            response.statusText
          }\n${await response.text()}`
        );
      }
      const clonedResponse = response.clone();
      return [
        await (async () => {
          switch (response.headers.get('Content-Type')) {
            case 'application/json':
              return await response.json();
            case 'text/plain':
              return await response.text();
            default:
              return void 0;
          }
        })(),
        clonedResponse,
      ];
    },
  });
  const TestHttpClientProvider: FC<PropsWithChildren> = ({ children }) => {
    return createElement(
      HttpClientProvider,
      {
        value: client,
      },
      children
    );
  };
  const useGETForGreet = createHttpFactory('GET:/api/greet')
    .apply<'Response', 'hi!'>()
    .doQueryRequest();
  const useGETForUsers = createHttpFactory('GET:/api/users/list')
    .apply<'Response', { list: User[]; total: number }>()
    .apply<'Query', { limit: number; page: number; keywords?: string }>()
    .doQueryRequest();
  const useGETForUserProfile = createHttpFactory(
    'GET:/api/users/{userId}/profile'
  )
    .apply<'Response', User>()
    .doQueryRequest();
  const usePOSTForCreateUser = createHttpFactory('POST:/api/users/create')
    .apply<'Response', User['id']>()
    .doMutationRequest();
  const usePUTForUpdateUser = createHttpFactory('PUT:/api/users/{userId}')
    .apply<'Response', User['id']>()
    .apply<'Body', Partial<Omit<User, 'id'>>>()
    .doMutationRequest();
  const getUserProfile =
    HttpFactory.reconstruct(useGETForUserProfile).doRequest();
  beforeEach(() => {
    mocker.reload();
    client.queries.clear();
  });

  it('should get data and return type test', async () => {
    let renderCount = 0;
    const { result } = renderHook(
      () => {
        renderCount++;
        return useGETForUserProfile({
          path: { userId: 'c6ab405d-4921-4435-a38a-40e0a34291d6' },
        });
      },
      { wrapper: TestHttpClientProvider }
    );
    // 初次渲染，由于 Hook 是默认执行，所以渲染次数为 2（首次渲染、Hook 状态变化）
    expect(result.current.pending).toBe(true);
    expect(renderCount).toBe(2);
    // 再次渲染
    await waitFor(() => {
      // 请求结束
      expect(renderCount).toBe(3);
      expect(result.current.pending).toBe(false);
      expect(result.current.data?.name).toBe('寒菁菁');
    });
    expectTypeOf(result.current.data)
      .exclude<undefined>()
      .toEqualTypeOf<User>();
  });

  it('should execute `getUserProfile` normally ', async () => {
    const data = await getUserProfile({
      path: {
        userId: 'c6ab405d-4921-4435-a38a-40e0a34291d6',
      },
      fetcher: async (request) => {
        const response = await mocker.fetch(request);
        if (!response.ok) {
          throw new Error(
            `${request.method} ${request.url.toString()} ${response.status} ${
              response.statusText
            }\n${await response.text()}`
          );
        }
        return response;
      },
    });
    expect(mocker.calls.length).toBe(1);
    expect(data.id).toBe('c6ab405d-4921-4435-a38a-40e0a34291d6');
  });

  it('should only be triggered when enabled', async () => {
    let renderCount = 0;
    const { result, rerender } = renderHook(
      (enabled) => {
        renderCount++;
        return useGETForUserProfile({
          enabled,
          path: { userId: 'c6ab405d-4921-4435-a38a-40e0a34291d6' },
        });
      },
      { initialProps: false, wrapper: TestHttpClientProvider }
    );
    // 初次渲染，由于 Hook 禁用了默认执行在，所以渲染次数为 1
    expect(result.current.pending).toBe(undefined);
    expect(renderCount).toBe(1);
    rerender(true);
    // 请求开始, 一次 props 更新，一次 hooks 状态变化
    expect(result.current.pending).toBe(true);
    expect(renderCount).toBe(3);
    await waitFor(() => {
      // 请求结束
      expect(result.current.pending).toBe(false);
      expect(renderCount).toBe(4);
      expect(result.current.data?.name).toBe('寒菁菁');
    });
  });

  it('should load or refresh at the same time with cacheKey', async () => {
    const { result } = renderHook(
      () => {
        const read1 = useGETForUsers({
          cache: {
            key: 'users',
            staleTime: 0,
          },
        });
        const read2 = useGETForUsers({
          cache: {
            key: 'users',
          },
        });
        const write = usePOSTForCreateUser();
        return { read1, read2, write };
      },
      { wrapper: TestHttpClientProvider }
    );
    // const { result: userResult, rerender: userRerender } = renderHook(
    //   ({ userId }: { userId?: string }) => {
    //     return useGETForUserProfile({
    //       path: {
    //         userId: userId!,
    //       },
    //       enabled: userId !== void 0,
    //     });
    //   },
    //   { wrapper: TestHttpClientProvider }
    // );
    // 两个 Hooks 都应该开始请求
    expect(result.current.read1.pending).toBe(true);
    expect(result.current.read2.pending).toBe(true);
    let total: number | undefined = void 0;
    // wait read1
    await waitFor(() => {
      expect(result.current.read1.pending).toBe(false);
      expect(result.current.read1.data?.total).not.toBeUndefined();
      total = result.current.read1.data?.total ?? 0;
      expect(result.current.read2.pending).toBe(false);
      expect(result.current.read2.data?.total).toBe(total);
      expect(mocker.calls.length).toBe(1);
    });
    expect(total).not.toBeUndefined();
    // 现在创建一个用户
    const userId = await act(async () => {
      return await result.current.write.execute({
        name: '原怀菀',
        email: 'aglais@outlaws.com',
        gender: '女',
        phone: '19213547756',
      });
    });
    // 用户创建完成，user id 不应该为空
    expect(userId).not.toBeUndefined(); // 调用接口刷新
    act(() => {
      result.current.read1.refresh();
    });
    // read1 应该开始请求，read2 保持原样
    expect(result.current.read1.pending).toBe(true);
    expect(result.current.read2.pending).toBe(false);
    await waitFor(() => {
      expect(result.current.read1.pending).toBe(false);
      // 读取用户列表、创建用户、刷新
      expect(mocker.calls.length).toBe(3);
      // 创建用户后，应该有新的用户，总数应该加1
      expect(result.current.read1.data?.total).toBe(total! + 1);
      // 相同缓存键的也应该刷新了
      expect(result.current.read2.data?.total).toBe(total! + 1);
    });
  });

  it('should normal work in silent mode', async () => {
    let renderCount = 0;
    const { result } = renderHook(
      () => {
        renderCount++;
        const write = usePUTForUpdateUser();
        const read = useGETForUserProfile({
          enabled: false,
        });
        return { write, read };
      },
      { wrapper: TestHttpClientProvider }
    );
    // 初始化时应该渲染一次
    expect(renderCount).toBe(1);
    // 更新数据
    await act(async () => {
      await result.current.write.execute(
        {
          name: '阿拉蕾',
          gender: '女',
        },
        {
          path: {
            userId: 'c6ab405d-4921-4435-a38a-40e0a34291d6',
          },
        }
      );
    });
    // 由于 silent 默认为 true, 所以渲染次数也为 1
    expect(renderCount).toBe(1);
    const user = await act(async () => {
      return await result.current.read.execute(void 0, {
        path: {
          userId: 'c6ab405d-4921-4435-a38a-40e0a34291d6',
        },
      });
    });
    // GET 和 PUT 都是 silent 模式，所以渲染次数也为 1
    expect(renderCount).toBe(1);
    expect(user).not.toBe(void 0);
    expect(user!.name).toBe('阿拉蕾');
    expect(user!.gender).toBe('女');
  });

  it('should expire normally cache', async () => {
    const { result, rerender } = renderHook(
      ({ dep1, dep2, dep3 }) => {
        const read1 = useGETForUserProfile({
          enabled: dep1 !== void 0,
          path: { userId: dep1! },
          cache: {
            key: dep1!,
            staleTime: 300,
          },
        });
        const read2 = useGETForUserProfile({
          enabled: dep2,
          path: { userId: dep1! },
          cache: {
            key: dep1!,
          },
        });
        const read3 = useGETForUserProfile({
          enabled: dep3,
          path: { userId: dep1! },
          cache: {
            key: dep1!,
          },
        });
        const update1 = usePUTForUpdateUser({
          path: { userId: dep1! },
        });
        return { read1, read2, read3, update1 };
      },
      {
        wrapper: TestHttpClientProvider,
        initialProps: { dep1: undefined, dep2: false, dep3: false } as {
          dep1?: string;
          dep2: boolean;
          dep3: boolean;
        },
      }
    );
    const { id, name } = HttpMocker.resources[0];
    rerender({ dep1: id, dep2: false, dep3: false });
    expect(result.current.read1.pending).toBe(true);
    expect(result.current.read2.pending).toBe(undefined);
    expect(result.current.read3.pending).toBe(undefined);
    await waitFor(() => {
      expect(result.current.read1.pending).toBe(false);
      expect(result.current.read2.pending).toBe(undefined);
      expect(result.current.read3.pending).toBe(undefined);
    });
    expect(mocker.calls.length).toBe(1);
    expect(result.current.read1.data?.name).toBe(name);
    expect(result.current.read2.data?.name).toBe(undefined);
    expect(result.current.read3.data?.name).toBe(undefined);
    rerender({ dep1: id, dep2: true, dep3: false });
    await waitFor(() => {
      expect(result.current.read1.pending).toBe(false);
      expect(result.current.read2.pending).toBe(false);
      expect(result.current.read3.pending).toBe(undefined);
    });
    expect(mocker.calls.length).toBe(1);
    expect(result.current.read2.data?.name).toBe(name);
    expect(client.queries.isStale(id)).toBeFalsy();
    // wait cache expired
    await wait(300);
    expect(client.queries.isStale(id)).toBeTruthy();
    // update user
    await act(async () => {
      await result.current.update1.execute({
        name: 'updated',
      });
    });
    rerender({ dep1: id, dep2: true, dep3: true });
    await waitFor(() => {
      expect(result.current.read1.pending).toBe(false);
      expect(result.current.read2.pending).toBe(false);
      expect(result.current.read3.pending).toBe(false);
    });
    expect(mocker.calls.length).toBe(3);
    expect(result.current.read1.data?.name).toBe('updated');
    expect(result.current.read2.data?.name).toBe('updated');
    expect(result.current.read3.data?.name).toBe('updated');
    expect(client.queries.isStale(id)).toBeFalsy();
  });

  it('should automatically re-fetched when path params change', async () => {
    let user = HttpMocker.resources[0];
    const { result, rerender } = renderHook(
      ({ userId }) => {
        return useGETForUserProfile({
          path: { userId },
        });
      },
      {
        wrapper: TestHttpClientProvider,
        initialProps: { userId: user.id },
      }
    );
    expect(result.current.pending).toBeTruthy();
    await waitFor(() => {
      expect(result.current.pending).toBeFalsy();
    });
    expect(result.current.data?.name).toBe(user.name);
    expect(mocker.calls.length).toBe(1);

    // change
    user = HttpMocker.resources[1];
    rerender({ userId: user.id });
    expect(result.current.pending).toBeTruthy();
    await waitFor(() => {
      expect(result.current.pending).toBeFalsy();
    });
    expect(result.current.data?.name).toBe(user.name);
    expect(mocker.calls.length).toBe(2);
  });
  it('should automatically re-fetched when query params change', async () => {
    let user = HttpMocker.resources[0];
    const { result, rerender } = renderHook(
      ({ keywords }) => {
        return useGETForUsers({
          query: {
            limit: 1,
            page: 1,
            keywords,
          },
        });
      },
      {
        wrapper: TestHttpClientProvider,
        initialProps: { keywords: HttpMocker.resources[0].name },
      }
    );
    await waitFor(() => {
      expect(result.current.pending).toBeFalsy();
    });
    expect(result.current.data?.total).toBe(1);
    expect(result.current.data?.list[0].name).toBe(user.name);
    expect(mocker.calls.length).toBe(1);

    // change
    user = HttpMocker.resources[1];
    rerender({ keywords: user.name });
    await waitFor(() => {
      expect(result.current.pending).toBeFalsy();
    });
    expect(result.current.data?.total).toBe(1);
    expect(result.current.data?.list[0].name).toBe(user.name);
    expect(mocker.calls.length).toBe(2);
  });
  it('should execute onBefore, onFinally, onSuccess', async () => {
    const beforeFn = vi.fn();
    const successFn = vi.fn();
    const finallyFn = vi.fn();
    const { result } = renderHook(
      () => {
        return useGETForGreet({
          onBefore: beforeFn,
          onSuccess: successFn,
          onFinally: finallyFn,
        });
      },
      {
        wrapper: TestHttpClientProvider,
      }
    );
    expect(beforeFn).toBeCalled();
    await waitFor(() => {
      expect(result.current.pending).toBeFalsy();
    });
    expect(successFn).toBeCalled();
    expect(finallyFn).toBeCalled();
    expect(result.current.kind).toBe('success');
  });
  it('should execute onError', async () => {
    const errorFn = vi.fn();
    const { result } = renderHook(
      () => {
        return useGETForGreet({
          onSuccess: () => {
            throw Error();
          },
          onError: errorFn,
        });
      },
      {
        wrapper: TestHttpClientProvider,
      }
    );
    expect(result.current.kind).toBe('pending');
    await waitFor(() => {
      expect(result.current.pending).toBeFalsy();
    });
    expect(errorFn).toBeCalled();
    expect(result.current.error).not.toBeUndefined();
    expect(result.current.kind).toBe('error');
  });
  it('should converted query params', async () => {
    const { result } = renderHook(
      () => {
        return useGETForGreet({
          query: {
            a: [1, 2, 3],
            b: 'test',
          },
          serializers: {
            query: (query: Record<string, unknown>) => ({
              ...query,
              a: (query.a as number[]).join('.'),
            }),
          },
        });
      },
      {
        wrapper: TestHttpClientProvider,
      }
    );
    await waitFor(() => {
      expect(result.current.pending).toBeFalsy();
    });
    expect(result.current.request?.url).not.toBeUndefined();
    expect(new URL(result.current.request!.url).search).toBe('?a=1.2.3&b=test');
  });
  // type test case
  it('should normal use InferSType to infer type', () => {
    expectTypeOf<
      InferSType<typeof useGETForGreet, 'Response'>
    >().toEqualTypeOf<'hi!'>();
    expectTypeOf<
      InferSType<typeof useGETForGreet, 'Response'>
    >().not.toEqualTypeOf<{}>();
    expectTypeOf<
      InferSType<typeof useGETForGreet, 'Headers'>
    >().toEqualTypeOf<{}>();
    expectTypeOf<
      InferSType<typeof useGETForGreet, 'Query'>
    >().toEqualTypeOf<{}>();
    expectTypeOf<
      InferSType<typeof useGETForGreet, 'Error'>
    >().toEqualTypeOf<unknown>();
    expectTypeOf<
      InferSType<typeof useGETForGreet, 'Body'>
    >().toEqualTypeOf<{}>();
    expectTypeOf<
      InferSType<typeof useGETForUsers, 'Response'>
    >().toEqualTypeOf<{ list: User[]; total: number }>();
    expectTypeOf<InferSType<typeof useGETForUsers, 'Query'>>().toEqualTypeOf<{
      limit: number;
      page: number;
      keywords?: string;
    }>();
    expectTypeOf<
      InferSType<typeof useGETForUserProfile, 'Response'>
    >().toEqualTypeOf<User>();
    expectTypeOf<
      InferSType<typeof getUserProfile, 'Response'>
    >().toEqualTypeOf<User>();
    expectTypeOf<
      InferSType<typeof usePOSTForCreateUser, 'Response'>
    >().toEqualTypeOf<string>();
    expectTypeOf<
      InferSType<typeof usePUTForUpdateUser, 'Body'>
    >().toEqualTypeOf<Partial<Omit<User, 'id'>>>();
  });
});
