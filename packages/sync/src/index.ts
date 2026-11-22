/**
 * @canvas/sync — wire format, messages and the client side of the sync protocol.
 * Isomorphic: runs in browsers, Web Workers and Node 22.
 */
export { DecodeError, Reader, Writer, decodeDelta, encodeDelta, timestampsOf } from "./codec.js";
export {
  PROTOCOL_VERSION,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "./messages.js";
export {
  SyncClient,
  type SocketLike,
  type SyncClientOptions,
  type SyncState,
  type SyncStatus,
} from "./client.js";
