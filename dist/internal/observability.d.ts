import type { ManageBacEvent, ManageBacObserver } from "../types.js";
export type EmitEvent = (event: ManageBacEvent) => void;
export declare function createEmitter(observer: ManageBacObserver | undefined): EmitEvent;
//# sourceMappingURL=observability.d.ts.map