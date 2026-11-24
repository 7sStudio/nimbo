// Public API of @jsnb/runtime-web: the client realm in the page (scope, display, containers, the bridge client).
export { Realm } from "./realm/realm.js";
export type { RealmLimits, RealmOptions } from "./realm/options.js";
export type { RealmTransport } from "./bridge/transport.js";
export type { PauseClock } from "./bridge/stub.js";
export type { Mount } from "./display/containers.js";
export { isRealmRequest, realmRequestMethods } from "./realm/requests.js";
export type { RealmRequestMethod } from "./realm/requests.js";
export { importUrl } from "./realm/imports.js";
