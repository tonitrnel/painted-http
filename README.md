## Introduction

`@painted/http` is a React hooks library for data fetching.

## Quick start

```ts
// file: src/apis/user.ts
import { createHttpFactory } from "@painted/http";

export const useGETForUser = createHttpFactory('GET:/users/{userId}')
  .apply<"Path", { userId: string }>() // will automatic inferred from url, without to write this line.
  .apply<"Response", { id: number, name: string, avatar: string }>() // apply response data type.
  .apply<"Query", { t: number }>  // apply query params type structure.
  .doQueryRequest(); // generate query react hooks.

```

```tsx
// file: src/app.tsx
import { useGETForUser } from "./apis/user.ts";

export function App(){
  const {data: user, pending, error } = useGETForUser({
    // path params
    path: {
      userId: "36ce21c7-15f5-4e9a-beec-b6604fbebd0f"
    },
    // query params
    query: {
      t: Date.now()
    }
  })
  return (<>
     {pending && <span>loading...</span>}
     {error && <span>Oops something in wrong.</span>}
     {user && <pre>{JSON.string(user, null, 2)}</pre>}
   </>
  )
}
```

## License

The MIT License.