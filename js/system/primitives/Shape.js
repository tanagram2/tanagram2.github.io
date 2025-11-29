export class Shape {
    constructor(x, y, color = '#000') {
        this.x = x;
        this.y = y;
        this.color = color;
        
        // Border properties
        this.borderColor = null;
        this.borderWidth = 1;
        this.showBorder = false;
        
        // State
        this.isSelected = false;
        this.isHovered = false;
        this.visible = true;
        this.zIndex = 0;
    }
    
    // Abstract methods - subclasses MUST implement
    draw(ctx) {
        throw new Error('Shape.draw() must be implemented by subclass');
    }
    
    containsPoint(x, y) {
        throw new Error('Shape.containsPoint() must be implemented by subclass');
    }
    
    // Common border logic helper
    applyBorderStyles(ctx) {
        if (this.showBorder) {
            ctx.strokeStyle = this.borderColor || this.getDebugBorderColor();
            ctx.lineWidth = this.borderWidth;
            return true;
        }
        return false;
    }
    
    getDebugBorderColor() {
        if (this.isSelected) return '#ff0000'; // Red for selection
        if (this.isHovered) return '#ffff00';   // Yellow for hover
        return '#00ff00';                       // Green for general debug
    }
    
    setSelected(selected) {
        this.isSelected = selected;
        this.showBorder = selected; // Auto-show border when selected
    }
    
    setHovered(hovered) {
        this.isHovered = hovered;
    }
    
    // Helper to set border properties
    setBorder(color = '#ff0000', width = 2) {
        this.borderColor = color;
        this.borderWidth = width;
        this.showBorder = true;
    }
    
    // Helper to remove border
    clearBorder() {
        this.showBorder = false;
        this.borderColor = null;
        this.borderWidth = 1;
    }
}