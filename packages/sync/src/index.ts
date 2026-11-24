/**
 * @canvas/sync — wire format, messages, presence and the client side of the sync
 * protocol. Isomorphic: runs in browsers, Web Workers and Node 22.
 */
export { DecodeError, Reader, Writer, decodeDelta, encodeDelta, textAuthorReplicasOf, timestampsOf } from "./codec.js";
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
  MAX_PRESENCE_NAME,
  MAX_PRESENCE_SELECTION,
  decodePresence,
  encodePresence,
  type Presence,
} from "./presence.js";
export {
  SyncClient,
  type HistoryVersion,
  type OutboxItem,
  type RemoteDeltaInfo,
  type SocketLike,
  type SyncClientOptions,
  type SyncResume,
  type SyncState,
  type SyncStatus,
} from "./client.js";
// Browser persistence (IndexedDB, Web Locks) lives in "@canvas/sync/offline".
