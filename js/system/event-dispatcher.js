// /js/system/event-dispatcher.js
export class EventDispatcher {
    constructor() {
        this.listeners = new Map();
        this.captureListeners = new Map();
    }

    addEventListener(type, listener, options = {}) {
        const target = options.capture ? this.captureListeners : this.listeners;
        if (!target.has(type)) target.set(type, new Set());
        target.get(type).add(listener);
    }

    removeEventListener(type, listener, options = {}) {
        const target = options.capture ? this.captureListeners : this.listeners;
        if (target.has(type)) {
            target.get(type).delete(listener);
        }
    }

    dispatchEvent(event) {
        // Capture phase
        if (this.captureListeners.has(event.type)) {
            this.captureListeners.get(event.type).forEach(listener => {
                listener(event);
                if (event.propagationStopped) return;
            });
        }

        // Bubble phase (if not stopped)
        if (!event.propagationStopped && this.listeners.has(event.type)) {
            this.listeners.get(event.type).forEach(listener => {
                listener(event);
                if (event.propagationStopped) return;
            });
        }

        return !event.defaultPrevented;
    }

    createEvent(type, data = {}) {
        return {
            type,
            ...data,
            propagationStopped: false,
            defaultPrevented: false,
            stopPropagation() { this.propagationStopped = true; },
            preventDefault() { this.defaultPrevented = true; }
        };
    }
}
