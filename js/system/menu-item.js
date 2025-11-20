// /js/system/menu-item.js
import { Button } from './button.js';

export class MenuItem extends Button {
    constructor(x, y, width, height, text, onClick, options = {}) {
        super(x + width / 2, y + height / 2, width, height, text, onClick, {
            backgroundColor: '#e0e0e0',
            hoverColor: '#bdbdbd',
            textColor: '#333',
            font: '0.9rem Courier New',
            borderColor: '#757575',
            ...options
        });
        
        // Menu items are positioned by top-left corner
        this.bounds.x = x;
        this.bounds.y = y;
        this.originalX = x + width / 2;
    }

    draw(ctx) {
        if (!this.isVisible) return;
        
        // Draw background with hover effect
        ctx.fillStyle = this.isHovered ? this.hoverColor : this.backgroundColor;
        ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
        
        // Draw text (left-aligned for menu items)
        ctx.fillStyle = this.textColor;
        ctx.font = this.font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.text, this.bounds.x + 10, this.bounds.y + this.bounds.height / 2);
        
        // Draw border
        ctx.strokeStyle = this.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
    }
}
