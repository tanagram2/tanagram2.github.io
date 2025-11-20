import { Highlightable } from './highlightable.js';

export class Button extends Highlightable {
    constructor(x, y, width, height, text, onClick, options = {}) {
        const centeredX = x - width / 2;
        const centeredY = y - height / 2;
        super(centeredX, centeredY, width, height, onClick);
        
        this.text = text;
        this.originalX = x;
        
        this.backgroundColor = options.backgroundColor || '#0f0';
        this.hoverColor = options.hoverColor || '#0c0';
        this.textColor = options.textColor || '#000';
        this.font = options.font || '1.2rem Courier New';
        this.borderRadius = options.borderRadius || 0;
        this.borderColor = options.borderColor || '#666';
    }

    draw(ctx) {
        if (!this.isVisible) return;
        
        ctx.fillStyle = this.isHovered ? this.hoverColor : this.backgroundColor;
        
        if (this.borderRadius > 0) {
            this.drawRoundedRect(ctx, this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height, this.borderRadius);
        } else {
            ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
        }
        
        ctx.fillStyle = this.textColor;
        ctx.font = this.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.text, this.originalX, this.bounds.y + this.bounds.height / 2);
        
        ctx.strokeStyle = this.borderColor;
        ctx.lineWidth = 2;
        if (this.borderRadius > 0) {
            this.drawRoundedRect(ctx, this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height, this.borderRadius);
            ctx.stroke();
        } else {
            ctx.strokeRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
        }
    }

    drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
    }
}
