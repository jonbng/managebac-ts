import { DataIntegrityError } from "../errors.js";
import type { EntityId, EntityKey, EntityKind } from "../types.js";

export function parseEntityId<Kind extends EntityKind>(value: string, kind: Kind): EntityId<Kind> {
  if (!/^\d+$/.test(value)) throw new DataIntegrityError(`Invalid ManageBac ${kind} ID: ${value}`);
  return value as EntityId<Kind>;
}

export function parseOpaqueEntityId<Kind extends EntityKind>(value: string, kind: Kind): EntityId<Kind> {
  if (!value || value.length > 2_048) throw new DataIntegrityError(`Invalid ManageBac ${kind} ID.`);
  return value as EntityId<Kind>;
}

export function createEntityKey<Kind extends EntityKind>(
  baseUrl: string,
  kind: Kind,
  id: EntityId<Kind>,
): EntityKey<Kind> {
  return `managebac://${new URL(baseUrl).host}/${kind}/${encodeURIComponent(id)}` as EntityKey<Kind>;
}
