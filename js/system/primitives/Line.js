import { Shape } from './Shape.js';

export class Line extends Shape {
    constructor(x1, y1, x2, y2, color = '#000', lineWidth = 1) {
        super(x1, y1, color); // Use x1,y1 as base position
        this.x1 = x1;
        this.y1 = y1;
        this.x2 = x2;
        this.y2 = y2;
        this.lineWidth = lineWidth;
        
        // Lines typically don't use fill color, so override
        this.color = color;
    }

    draw(ctx) {
        if (!this.visible) return;
        
        ctx.strokeStyle = this.color;
        ctx.lineWidth = this.lineWidth;
        ctx.beginPath();
        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
        ctx.stroke();
        
        // Lines can have borders too (outer stroke)
        if (this.applyBorderStyles(ctx)) {
            // For lines, border is an additional outer stroke
            ctx.beginPath();
            ctx.moveTo(this.x1, this.y1);
            ctx.lineTo(this.x2, this.y2);
            ctx.stroke();
        }
    }

    // Lines typically don't need hit detection
    containsPoint(x, y) {
        return false;
    }
}