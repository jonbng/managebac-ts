import type { EntityId, EntityKey, EntityKind } from "../types.js";
export declare function parseEntityId<Kind extends EntityKind>(value: string, kind: Kind): EntityId<Kind>;
export declare function parseOpaqueEntityId<Kind extends EntityKind>(value: string, kind: Kind): EntityId<Kind>;
export declare function createEntityKey<Kind extends EntityKind>(baseUrl: string, kind: Kind, id: EntityId<Kind>): EntityKey<Kind>;
//# sourceMappingURL=identity.d.ts.map