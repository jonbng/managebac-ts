import { DataIntegrityError } from "../errors.js";
export function parseEntityId(value, kind) {
    if (!/^\d+$/.test(value))
        throw new DataIntegrityError(`Invalid ManageBac ${kind} ID: ${value}`);
    return value;
}
export function parseOpaqueEntityId(value, kind) {
    if (!value || value.length > 2_048)
        throw new DataIntegrityError(`Invalid ManageBac ${kind} ID.`);
    return value;
}
export function createEntityKey(baseUrl, kind, id) {
    return `managebac://${new URL(baseUrl).host}/${kind}/${encodeURIComponent(id)}`;
}
//# sourceMappingURL=identity.js.map