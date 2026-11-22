import { DecodeError, Reader, Writer } from "./codec.js";

/**
 * Wire messages. One binary WebSocket frame = one message; the first byte is its type.
 *
 * Deltas and presence travel as opaque, already-encoded bytes: the server validates a
 * pushed delta once, stores those exact bytes, and relays them without re-encoding.
 *
 *   client → server   HELLO     version, docId, clientId, since (last server seq seen), token
 *                     PUSH      clientSeq, delta
 *                     PRESENCE  payload                 (ephemeral, latest wins)
 *                     HISTORY?  requestId, at           ("what did the doc look like at seq N?")
 *   server → client   DELTA     serverSeq, delta        (backlog after HELLO, then live)
 *                     WELCOME   head, readOnly          (backlog done, you're live)
 *                     ACK       clientSeq, serverSeq    (your push is durable)
 *                     PRESENCE  clientId, payload       (someone's cursor/selection)
 *                     LEAVE     clientId                (their connection closed)
 *                     HISTORY   requestId, at, head, state (encoded DocDelta at seq `at`)
 *                     ERROR     fatal, message
 */
/** v2: HELLO carries an access token. v3: WELCOME says whether this client may edit. */
export const PROTOCOL_VERSION = 3;

const HELLO = 1;
const PUSH = 2;
const CLIENT_PRESENCE = 3;
const HISTORY_REQUEST = 4;
const WELCOME = 16;
const DELTA = 17;
const ACK = 18;
const ERROR = 19;
const SERVER_PRESENCE = 20;
const LEAVE = 21;
const HISTORY = 22;

export type ClientMessage =
  | {
      readonly type: "hello";
      readonly version: number;
      readonly docId: string;
      readonly clientId: string;
      readonly since: number;
      readonly token: string;
    }
  | { readonly type: "push"; readonly clientSeq: number; readonly delta: Uint8Array }
  | { readonly type: "presence"; readonly payload: Uint8Array }
  | { readonly type: "history"; readonly requestId: number; readonly at: number };

export type ServerMessage =
  | { readonly type: "welcome"; readonly head: number; readonly readOnly: boolean }
  | { readonly type: "delta"; readonly serverSeq: number; readonly delta: Uint8Array }
  | { readonly type: "ack"; readonly clientSeq: number; readonly serverSeq: number }
  | { readonly type: "presence"; readonly clientId: string; readonly payload: Uint8Array }
  | { readonly type: "leave"; readonly clientId: string }
  | {
      readonly type: "history";
      readonly requestId: number;
      readonly at: number;
      readonly head: number;
      readonly state: Uint8Array;
    }
  | { readonly type: "error"; readonly fatal: boolean; readonly message: string };

export function encodeClientMessage(message: ClientMessage): Uint8Array {
  const w = new Writer();
  switch (message.type) {
    case "hello":
      w.byte(HELLO);
      w.uint(message.version);
      w.str(message.docId);
      w.str(message.clientId);
      w.uint(message.since);
      w.str(message.token);
      break;
    case "push":
      w.byte(PUSH);
      w.uint(message.clientSeq);
      w.bytes(message.delta);
      break;
    case "presence":
      w.byte(CLIENT_PRESENCE);
      w.bytes(message.payload);
      break;
    case "history":
      w.byte(HISTORY_REQUEST);
      w.uint(message.requestId);
      w.uint(message.at);
      break;
  }
  return w.finish();
}

export function decodeClientMessage(bytes: Uint8Array): ClientMessage {
  const r = new Reader(bytes);
  const type = r.byte();
  if (type === HELLO) {
    const message: ClientMessage = {
      type: "hello",
      version: r.uint(),
      docId: r.str(),
      clientId: r.str(),
      since: r.uint(),
      token: r.str(),
    };
    r.end();
    return message;
  }
  if (type === PUSH) return { type: "push", clientSeq: r.uint(), delta: r.rest() };
  if (type === CLIENT_PRESENCE) return { type: "presence", payload: r.rest() };
  if (type === HISTORY_REQUEST) {
    const message: ClientMessage = { type: "history", requestId: r.uint(), at: r.uint() };
    r.end();
    return message;
  }
  throw new DecodeError(`unknown client message type ${type}`);
}

export function encodeServerMessage(message: ServerMessage): Uint8Array {
  const w = new Writer();
  switch (message.type) {
    case "welcome":
      w.byte(WELCOME);
      w.uint(message.head);
      w.byte(message.readOnly ? 1 : 0);
      break;
    case "delta":
      w.byte(DELTA);
      w.uint(message.serverSeq);
      w.bytes(message.delta);
      break;
    case "ack":
      w.byte(ACK);
      w.uint(message.clientSeq);
      w.uint(message.serverSeq);
      break;
    case "presence":
      w.byte(SERVER_PRESENCE);
      w.str(message.clientId);
      w.bytes(message.payload);
      break;
    case "leave":
      w.byte(LEAVE);
      w.str(message.clientId);
      break;
    case "history":
      w.byte(HISTORY);
      w.uint(message.requestId);
      w.uint(message.at);
      w.uint(message.head);
      w.bytes(message.state);
      break;
    case "error":
      w.byte(ERROR);
      w.byte(message.fatal ? 1 : 0);
      w.str(message.message);
      break;
  }
  return w.finish();
}

export function decodeServerMessage(bytes: Uint8Array): ServerMessage {
  const r = new Reader(bytes);
  const type = r.byte();
  let message: ServerMessage;
  switch (type) {
    case WELCOME:
      message = { type: "welcome", head: r.uint(), readOnly: r.byte() === 1 };
      break;
    case DELTA:
      return { type: "delta", serverSeq: r.uint(), delta: r.rest() };
    case ACK:
      message = { type: "ack", clientSeq: r.uint(), serverSeq: r.uint() };
      break;
    case SERVER_PRESENCE:
      return { type: "presence", clientId: r.str(), payload: r.rest() };
    case LEAVE:
      message = { type: "leave", clientId: r.str() };
      break;
    case HISTORY:
      return { type: "history", requestId: r.uint(), at: r.uint(), head: r.uint(), state: r.rest() };
    case ERROR:
      message = { type: "error", fatal: r.byte() === 1, message: r.str() };
      break;
    default:
      throw new DecodeError(`unknown server message type ${type}`);
  }
  r.end();
  return message;
}
