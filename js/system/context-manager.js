// /js/system/context-manager.js
export class ContextManager {
    constructor(eventDispatcher) {
        this.eventDispatcher = eventDispatcher;
        this.activeContexts = new Map();
        this.modalStack = [];
        this.clickOutsideHandlers = new Set();
        
        this.setupGlobalListeners();
    }

    setupGlobalListeners() {
        // Global click handler for click-outside behavior
        this.eventDispatcher.addEventListener('click', (event) => {
            this.handleGlobalClick(event);
        }, { capture: true });

        // Global escape key handler
        this.eventDispatcher.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.handleEscapeKey();
            }
        });
    }

    registerContext(name, element, options = {}) {
        this.activeContexts.set(name, { element, options });
        
        if (options.modal) {
            this.modalStack.push(name);
        }

        if (options.clickOutsideToClose) {
            this.clickOutsideHandlers.add(name);
        }
    }

    unregisterContext(name) {
        this.activeContexts.delete(name);
        this.modalStack = this.modalStack.filter(ctx => ctx !== name);
        this.clickOutsideHandlers.delete(name);
    }

    getTopModal() {
        if (this.modalStack.length === 0) return null;
        return this.activeContexts.get(this.modalStack[this.modalStack.length - 1]);
    }

    handleGlobalClick(event) {
        const topModal = this.getTopModal();
        
        // Check if click is outside any modal context
        if (topModal && !topModal.element.containsPoint(event.x, event.y)) {
            this.unregisterContext(this.modalStack[this.modalStack.length - 1]);
            event.preventDefault();
            return;
        }

        // Check click-outside handlers
        for (const contextName of this.clickOutsideHandlers) {
            const context = this.activeContexts.get(contextName);
            if (context && !context.element.containsPoint(event.x, event.y)) {
                this.unregisterContext(contextName);
                // Only close one context per click
                break;
            }
        }
    }

    handleEscapeKey() {
        const topModal = this.getTopModal();
        if (topModal) {
            this.unregisterContext(this.modalStack.pop());
        } else if (this.clickOutsideHandlers.size > 0) {
            // Close the most recently registered click-outside context
            const contexts = Array.from(this.clickOutsideHandlers);
            const lastContext = contexts[contexts.length - 1];
            this.unregisterContext(lastContext);
        }
    }

    isModalActive() {
        return this.modalStack.length > 0;
    }

    getActiveContexts() {
        return Array.from(this.activeContexts.keys());
    }
}
