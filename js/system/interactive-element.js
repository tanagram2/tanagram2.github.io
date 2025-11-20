// /js/system/interactive-element.js
export class InteractiveElement {
    constructor(x, y, width, height) {
        this.bounds = { x, y, width, height };
        this.isHovered = false;
        this.isFocused = false;
        this.isDisabled = false;
        this.isVisible = true;
        this.zIndex = 0;
    }
    
    containsPoint(x, y) {
        return x >= this.bounds.x && 
               x <= this.bounds.x + this.bounds.width && 
               y >= this.bounds.y && 
               y <= this.bounds.y + this.bounds.height;
    }
    
    handleMouseMove(x, y) {
        this.isHovered = this.containsPoint(x, y);
    }
    
    handleClick(x, y) {
        if (this.containsPoint(x, y) && !this.isDisabled) {
            this.gainFocus();
            return true;
        }
        return false;
    }
    
    handleKeyDown(event) {
        // To be implemented by subclasses
    }
    
    gainFocus() {
        this.isFocused = true;
    }
    
    loseFocus() {
        this.isFocused = false;
    }
    
    draw(ctx) {
        throw new Error('draw method must be implemented by subclass');
    }
}
