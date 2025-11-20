// /js/system/focus-manager.js
export class FocusManager {
    constructor(eventDispatcher, contextManager) {
        this.eventDispatcher = eventDispatcher;
        this.contextManager = contextManager;
        this.focusedElement = null;
        this.focusOrder = [];
        this.focusTraps = new Set();
        this.previousFocus = null;
        
        this.setupKeyboardListeners();
    }

    setupKeyboardListeners() {
        this.eventDispatcher.addEventListener('keydown', (event) => {
            if (event.key === 'Tab') {
                this.handleTabKey(event);
            }
        });
    }

    setFocus(element) {
        if (this.focusedElement === element) return;
        
        if (this.focusedElement) {
            this.focusedElement.loseFocus();
            this.previousFocus = this.focusedElement;
        }
        
        this.focusedElement = element;
        if (element) {
            element.gainFocus();
            
            // Scroll element into view if needed
            if (element.bounds && element.scrollIntoView) {
                element.scrollIntoView();
            }
        }
    }

    registerElement(element) {
        if (!this.focusOrder.includes(element)) {
            this.focusOrder.push(element);
        }
    }

    unregisterElement(element) {
        this.focusOrder = this.focusOrder.filter(el => el !== element);
        if (this.focusedElement === element) {
            this.setFocus(null);
        }
    }

    registerFocusTrap(element) {
        this.focusTraps.add(element);
    }

    unregisterFocusTrap(element) {
        this.focusTraps.delete(element);
    }

    handleTabKey(event) {
        if (this.focusOrder.length === 0) return;
        
        event.preventDefault();
        
        const currentIndex = this.focusOrder.indexOf(this.focusedElement);
        let nextIndex;
        
        if (event.shiftKey) {
            // Shift+Tab - previous element
            nextIndex = currentIndex > 0 ? currentIndex - 1 : this.focusOrder.length - 1;
        } else {
            // Tab - next element
            nextIndex = currentIndex < this.focusOrder.length - 1 ? currentIndex + 1 : 0;
        }
        
        this.setFocus(this.focusOrder[nextIndex]);
    }

    nextFocus() {
        if (this.focusOrder.length === 0) return;
        const currentIndex = this.focusOrder.indexOf(this.focusedElement);
        const nextIndex = (currentIndex + 1) % this.focusOrder.length;
        this.setFocus(this.focusOrder[nextIndex]);
    }

    previousFocus() {
        if (this.focusOrder.length === 0) return;
        const currentIndex = this.focusOrder.indexOf(this.focusedElement);
        const prevIndex = (currentIndex - 1 + this.focusOrder.length) % this.focusOrder.length;
        this.setFocus(this.focusOrder[prevIndex]);
    }

    restorePreviousFocus() {
        if (this.previousFocus) {
            this.setFocus(this.previousFocus);
        }
    }

    isFocusTrapped() {
        return this.focusTraps.size > 0 && this.contextManager.isModalActive();
    }
}
