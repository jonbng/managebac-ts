export function createEmitter(observer) {
    return (event) => {
        if (!observer)
            return;
        try {
            void Promise.resolve(observer(Object.freeze(event))).catch(() => undefined);
        }
        catch {
            // Instrumentation must never change scraper behavior.
        }
    };
}
//# sourceMappingURL=observability.js.map