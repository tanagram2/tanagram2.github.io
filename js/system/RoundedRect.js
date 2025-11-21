export class RoundedRect {
    constructor(x, y, width, height, radius = 10, color = '#000') {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.radius = radius;
        this.color = color;
        this.isHovered = false;
    }

    draw(ctx) {
        ctx.fillStyle = this.color;
        this._drawRoundedRect(ctx);
        ctx.fill();
    }

    _drawRoundedRect(ctx) {
        const { x, y, width, height, radius } = this;
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
    }

    containsPoint(x, y) {
        // Simple rectangular hit detection for now
        return x >= this.x && 
               x <= this.x + this.width && 
               y >= this.y && 
               y <= this.y + this.height;
    }
}