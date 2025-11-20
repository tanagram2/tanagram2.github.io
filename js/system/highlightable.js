// /js/system/highlightable.js
import { InteractiveElement } from './interactive-element.js';

export class Highlightable extends InteractiveElement {
    constructor(x, y, width, height, onClick) {
        super(x, y, width, height);
        this.onClick = onClick;
        this.backgroundColor = '#fff';
        this.hoverColor = '#ccc';
        this.borderColor = '#666';
    }
    
    handleClick(x, y) {
        if (super.handleClick(x, y)) {
            if (this.onClick) this.onClick();
            return true;
        }
        return false;
    }
    
    draw(ctx) {
        if (!this.isVisible) return;
        
        // Draw background with hover effect
        ctx.fillStyle = this.isHovered ? this.hoverColor : this.backgroundColor;
        ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
        
        // Draw border
        ctx.strokeStyle = this.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
    }
}
