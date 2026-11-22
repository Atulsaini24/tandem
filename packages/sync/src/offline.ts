/**
 * @canvas/sync/offline — browser-side persistence (IndexedDB, Web Locks).
 * Separate entry point so the Node server never pulls in browser-only code or types.
 */
export { LocalStore, type LoadedReplica, type LocalStoreOptions, type ReplicaRecord } from "./local-store.js";
export {
  OfflineReplica,
  webLockClaim,
  type OfflineReplicaOptions,
  type RestoreInfo,
} from "./replica.js";
