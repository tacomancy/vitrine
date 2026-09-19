import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "core";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

/** The typed client for the core the shell told us about. */
export function createClient({ port, token }: Window["vitrine"]) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://127.0.0.1:${port}/trpc`,
        headers: { authorization: `Bearer ${token}` },
      }),
    ],
  });
}
