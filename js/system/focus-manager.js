// /js/system/focus-manager.js
export class FocusManager {
    constructor() {
        this.focusedElement = null;
        this.focusOrder = [];
    }
    
    setFocus(element) {
        if (this.focusedElement) {
            this.focusedElement.loseFocus();
        }
        this.focusedElement = element;
        if (element) {
            element.gainFocus();
        }
    }
    
    registerElement(element) {
        this.focusOrder.push(element);
    }
    
    nextFocus() {
        if (this.focusOrder.length === 0) return;
        
        let currentIndex = this.focusOrder.indexOf(this.focusedElement);
        let nextIndex = (currentIndex + 1) % this.focusOrder.length;
        this.setFocus(this.focusOrder[nextIndex]);
    }
    
    previousFocus() {
        if (this.focusOrder.length === 0) return;
        
        let currentIndex = this.focusOrder.indexOf(this.focusedElement);
        let prevIndex = (currentIndex - 1 + this.focusOrder.length) % this.focusOrder.length;
        this.setFocus(this.focusOrder[prevIndex]);
    }
}
