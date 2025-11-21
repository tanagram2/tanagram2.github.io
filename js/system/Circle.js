export class Circle {
    constructor(x, y, radius, color = '#000') {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.isHovered = false;
    }

    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }

    containsPoint(x, y) {
        const dx = x - this.x;
        const dy = y - this.y;
        return dx * dx + dy * dy <= this.radius * this.radius;
    }
}