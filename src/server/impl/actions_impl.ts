import { convexToJson, Value } from "../../values/index.js";
import { jsonToConvexOwned } from "../../values/value.js";
import { version } from "../../index.js";
import { performAsyncSyscall } from "./syscall.js";
import { parseArgs } from "../../common/index.js";
import {
  FunctionReference,
  FunctionReference_future,
} from "../../server/api.js";
import { getFunctionAddress } from "../components/paths.js";
import { validateArg } from "./validate.js";
import {
  isWriteConflictRetryableError,
  retryOnWriteConflict,
  validateWriteConflictRetryOptions,
  ValidatedWriteConflictRetryOptions,
  WriteConflictRetryOptions,
} from "../../common/write_conflict_retry.js";
import type { GenericActionCtx } from "../registration.js";
import type { GenericDataModel } from "../data_model.js";

type RunMutation = GenericActionCtx<GenericDataModel>["runMutation"];

// Keyed by each action's own runMutation so ctx types stay identical to upstream.
const configurableRunMutations = new WeakMap<
  RunMutation,
  (options: ValidatedWriteConflictRetryOptions) => RunMutation
>();

/**
 * Return a `ctx.runMutation` that uses the given write conflict retry policy.
 *
 * `ActionCtx.runMutation` retries a mutation once, after 2 seconds, when Convex
 * reports a final write conflict. Use this helper to change that policy for
 * specific calls:
 *
 * ```typescript
 * await withRetry(ctx.runMutation, { maxWriteConflictRetries: 0 })(
 *   internal.orders.markPaid,
 *   { id },
 * );
 * ```
 *
 * Any other function, such as `MutationCtx.runMutation` (retried with its
 * parent transaction) or a test double, is returned unchanged.
 *
 * @public
 */
export function withRetry<F extends RunMutation>(
  runMutation: F,
  options: WriteConflictRetryOptions,
): F {
  const validated = validateWriteConflictRetryOptions(options);
  const configure = configurableRunMutations.get(runMutation);
  return configure === undefined ? runMutation : (configure(validated) as F);
}

function syscallArgs(
  requestId: string,
  functionReference: any,
  args?: Record<string, Value>,
) {
  const address = getFunctionAddress(functionReference);
  return {
    ...address,
    args: convexToJson(parseArgs(args)),
    version,
    requestId,
  };
}

function runMutationWithRetry(
  requestId: string,
  retryOptions: ValidatedWriteConflictRetryOptions,
): RunMutation {
  const runMutation = async (
    mutation:
      | FunctionReference<"mutation", "public" | "internal">
      | FunctionReference_future<"mutation", "public" | "internal">,
    args?: Record<string, Value>,
  ): Promise<any> => {
    const result = await retryOnWriteConflict(
      () =>
        performAsyncSyscall(
          "1.0/actions/mutation",
          syscallArgs(requestId, mutation, args),
        ),
      retryOptions,
      isWriteConflictRetryableError,
    );
    return jsonToConvexOwned(result);
  };
  configurableRunMutations.set(runMutation, (options) =>
    runMutationWithRetry(requestId, options),
  );
  return runMutation;
}

export function setupActionCalls(requestId: string) {
  return {
    runQuery: async (
      query:
        | FunctionReference<"query", "public" | "internal">
        | FunctionReference_future<"query", "public" | "internal">,
      args?: Record<string, Value>,
    ): Promise<any> => {
      const result = await performAsyncSyscall(
        "1.0/actions/query",
        syscallArgs(requestId, query, args),
      );
      return jsonToConvexOwned(result);
    },
    runMutation: runMutationWithRetry(
      requestId,
      validateWriteConflictRetryOptions(undefined),
    ),
    runAction: async (
      action:
        | FunctionReference<"action", "public" | "internal">
        | FunctionReference_future<"action", "public" | "internal">,
      args?: Record<string, Value>,
    ): Promise<any> => {
      const result = await performAsyncSyscall(
        "1.0/actions/action",
        syscallArgs(requestId, action, args),
      );
      return jsonToConvexOwned(result);
    },
  };
}

/**
 * A Convex-managed service. The backend decides which names it accepts; this
 * type lists the ones the current release knows about.
 */
export type ServiceName = "ai-gateway";

/**
 * Get a short-lived credential for calling a Convex-managed service.
 *
 * This function can only be called while an action is running. The credential
 * is scoped to the current deployment and should be sent as a bearer token.
 * Credentials expire a few minutes after they're issued. The action runtime
 * caches and refreshes them as needed, so call this function whenever making
 * a service request rather than reusing one credential for a long action.
 *
 * @param service - The service the credential may access.
 * @returns A JWT to send as `Authorization: Bearer <token>`. Keep it inside
 * the action: don't return it to clients or store it in environment
 * variables.
 */
export async function getServiceToken(service: ServiceName): Promise<string> {
  validateArg(service, 1, "getServiceToken", "service");
  return await performAsyncSyscall("1.0/createServiceToken", {
    service,
    version,
  });
}

/**
 * Get the base URL of a Convex-managed service.
 *
 * This function can only be called while an action is running. Pair it with
 * {@link getServiceToken} to reach the service.
 *
 * @param service - The service to address.
 * @returns The service's origin, without a trailing slash.
 */
export async function getServiceUrl(service: ServiceName): Promise<string> {
  validateArg(service, 1, "getServiceUrl", "service");
  return await performAsyncSyscall("1.0/getServiceUrl", {
    service,
    version,
  });
}
