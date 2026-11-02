import { expect, expectTypeOf, test, vi } from "vitest";
import {
  ConvexReactClient,
  createMutation,
  ReactMutation,
  Watch,
} from "./client.js";
import { FunctionReference, makeFunctionReference } from "../server/api.js";

type AddItem = FunctionReference<
  "mutation",
  "public",
  { name: string },
  string
>;
type Reset = FunctionReference<"mutation", "public", Record<string, never>>;

test("ReactMutation keeps the upstream call signature", () => {
  expectTypeOf<ReactMutation<AddItem>>().toExtend<
    (args: { name: string }) => Promise<string>
  >();
  // TanStack Query calls mutationFn(variables, context).
  expectTypeOf<ReactMutation<AddItem>>().toExtend<
    (variables: { name: string }, context: unknown) => Promise<string>
  >();
  expectTypeOf<ReactMutation<Reset>>().toExtend<() => Promise<null>>();
  expectTypeOf<ReactMutation<AddItem>>().parameters.toEqualTypeOf<
    [args: { name: string }]
  >();
});

test("a Watch in the upstream public shape still typechecks", () => {
  expectTypeOf<{
    onUpdate: (callback: () => void) => () => void;
    localQueryResult: () => string | undefined;
    journal: () => undefined;
  }>().toExtend<Watch<string>>();
});

function setup() {
  const mutation = vi.fn(async () => "id");
  const client = { mutation } as unknown as ConvexReactClient;
  const reference = makeFunctionReference<"mutation">("items:add");
  const add: ReactMutation<AddItem> = createMutation(reference, client);
  return { mutation, add };
}

test("a TanStack mutationFn context never becomes mutation options", async () => {
  const { mutation, add } = setup();
  const mutationFn: (
    variables: { name: string },
    context: object,
  ) => Promise<string> = add;
  await mutationFn({ name: "a" }, { maxWriteConflictRetries: 5 });
  expect(mutation).toHaveBeenCalledWith(
    expect.anything(),
    { name: "a" },
    {
      optimisticUpdate: undefined,
      maxWriteConflictRetries: undefined,
      writeConflictRetryDelayMs: undefined,
    },
  );
});

test("withRetry composes with withOptimisticUpdate in either order", async () => {
  const { mutation, add } = setup();
  const update = () => {};
  const retry = { maxWriteConflictRetries: 0 };
  await add.withRetry(retry).withOptimisticUpdate(update)({ name: "a" });
  await add.withOptimisticUpdate(update).withRetry(retry)({ name: "a" });
  for (const [, , options] of mutation.mock.calls as unknown as [
    unknown,
    unknown,
    object,
  ][]) {
    expect(options).toEqual({
      optimisticUpdate: update,
      maxWriteConflictRetries: 0,
      writeConflictRetryDelayMs: undefined,
    });
  }
  expect(mutation).toHaveBeenCalledTimes(2);
});
