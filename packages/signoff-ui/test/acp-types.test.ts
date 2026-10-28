import type {
  ClientRequestHandlersByMethod,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  ToolCallContent,
} from '@agentclientprotocol/sdk';
import type * as unstable from '@agentclientprotocol/sdk/unstable';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
  AcpSessionNotification,
  AcpToolCallContent,
} from '../src/acp';

/*
 * The ACP types here are structural copies of what is read, so the ACP SDK's objects pass straight
 * in and the responses go straight back. Checked by `tsc` (pnpm typecheck) against
 * @agentclientprotocol/sdk, a dev dependency only: its default entrypoint (stable ACP) and, since
 * SDK 2, `/unstable`, whose types an app that uses unstable features imports.
 */

describe('signoff-ui/acp and @agentclientprotocol/sdk', () => {
  it("takes the SDK's notifications, permission requests and diff content", () => {
    expectTypeOf<SessionNotification>().toExtend<AcpSessionNotification>();
    expectTypeOf<RequestPermissionRequest>().toExtend<AcpRequestPermissionRequest>();
    expectTypeOf<ToolCallContent>().toExtend<AcpToolCallContent>();
  });

  it("answers in the SDK's types, so a client's session/request_permission handler can return the response as it is", () => {
    type Handler = ClientRequestHandlersByMethod['session/request_permission'];
    expectTypeOf<AcpRequestPermissionResponse>().toExtend<RequestPermissionResponse>();
    expectTypeOf<AcpRequestPermissionResponse>().toExtend<Awaited<ReturnType<Handler>>>();
  });

  it('takes and answers in the types of its /unstable entrypoint too', () => {
    expectTypeOf<unstable.SessionNotification>().toExtend<AcpSessionNotification>();
    expectTypeOf<unstable.RequestPermissionRequest>().toExtend<AcpRequestPermissionRequest>();
    expectTypeOf<unstable.ToolCallContent>().toExtend<AcpToolCallContent>();
    expectTypeOf<AcpRequestPermissionResponse>().toExtend<unstable.RequestPermissionResponse>();
  });
});
