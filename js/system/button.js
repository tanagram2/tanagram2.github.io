// Add this to /js/system/button.js in the draw method
draw(ctx) {
    if (!this.isVisible) return;
    
    console.log(`Button.draw called:`, {
        text: this.text,
        bounds: this.bounds,
        bgColor: this.isHovered ? this.hoverColor : this.backgroundColor,
        textColor: this.textColor
    });
    
    // ... rest of existing draw code ...
}
