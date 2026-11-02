import { afterEach, expect, expectTypeOf, test, vi } from "vitest";
import { setupActionCalls, withRetry } from "./actions_impl.js";
import { FunctionReference, makeFunctionReference } from "../api.js";
import type { GenericActionCtx, GenericMutationCtx } from "../registration.js";
import type { GenericDataModel } from "../data_model.js";

afterEach(() => vi.unstubAllGlobals());

type ActionRunMutation = GenericActionCtx<GenericDataModel>["runMutation"];
type MutationRunMutation = GenericMutationCtx<GenericDataModel>["runMutation"];
declare const add: FunctionReference<"mutation", "public", { name: string }>;

// Stock convex 1.49 accepts a mutation ctx wherever an action ctx's runMutation is expected,
// but not the reverse. Keep exactly that relationship.
test("mutation ctx runMutation fits the action ctx shape", () => {
  expectTypeOf<MutationRunMutation>().toExtend<ActionRunMutation>();
  expectTypeOf<GenericMutationCtx<GenericDataModel>>().toExtend<
    Pick<GenericActionCtx<GenericDataModel>, "runMutation">
  >();
  expectTypeOf(
    withRetry<ActionRunMutation>,
  ).returns.toEqualTypeOf<ActionRunMutation>();
});

test("action ctx runMutation takes no options argument", () => {
  const typeOnly = (ctx: GenericActionCtx<GenericDataModel>) => {
    // @ts-expect-error Retry options go through withRetry.
    void ctx.runMutation(add, { name: "a" }, { maxWriteConflictRetries: 0 });
    void withRetry(ctx.runMutation, { maxWriteConflictRetries: 0 })(add, {
      name: "a",
    });
  };
  expect(typeOnly).toBeTypeOf("function");
});

const writeConflict =
  'Documents read from or written to the "items" table changed while this mutation was being run and on every subsequent retry.';

function stubConflicts(conflicts: number) {
  const asyncSyscall = vi.fn(async () => {
    if (asyncSyscall.mock.calls.length <= conflicts) {
      throw new Error(writeConflict);
    }
    return '"done"';
  });
  vi.stubGlobal("Convex", { asyncSyscall });
  return asyncSyscall;
}

const reference = makeFunctionReference<"mutation">("items:add");

test("runMutation retries a write conflict once after 2 seconds", async () => {
  vi.useFakeTimers();
  try {
    const asyncSyscall = stubConflicts(1);
    const result = setupActionCalls("request").runMutation(reference, {});
    await vi.advanceTimersByTimeAsync(1999);
    expect(asyncSyscall).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("done");
    expect(asyncSyscall).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

test("withRetry sets the policy for a single runMutation", async () => {
  const { runMutation } = setupActionCalls("request");
  const asyncSyscall = stubConflicts(2);
  const patient = withRetry(runMutation, {
    maxWriteConflictRetries: 2,
    writeConflictRetryDelayMs: 0,
  });
  await expect(patient(reference, {})).resolves.toBe("done");
  expect(asyncSyscall).toHaveBeenCalledTimes(3);

  stubConflicts(1);
  const once = withRetry(runMutation, { maxWriteConflictRetries: 0 });
  await expect(once(reference, {})).rejects.toThrow(writeConflict);
});

test("withRetry validates options and leaves other functions unchanged", () => {
  const runMutation = vi.fn() as unknown as ActionRunMutation;
  expect(withRetry(runMutation, { maxWriteConflictRetries: 0 })).toBe(
    runMutation,
  );
  expect(() => withRetry(runMutation, { maxWriteConflictRetries: -1 })).toThrow(
    "maxWriteConflictRetries must be a nonnegative integer.",
  );
});
