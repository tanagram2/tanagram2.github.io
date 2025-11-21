export class Text {
    constructor(x, y, content, color = '#000', font = '16px Arial') {
        this.x = x;
        this.y = y;
        this.content = content;
        this.color = color;
        this.font = font;
        this.textAlign = 'left';
        this.textBaseline = 'alphabetic';
    }

    draw(ctx) {
        ctx.fillStyle = this.color;
        ctx.font = this.font;
        ctx.textAlign = this.textAlign;
        ctx.textBaseline = this.textBaseline;
        ctx.fillText(this.content, this.x, this.y);
    }

    // Text doesn't typically need hit detection
    containsPoint(x, y) {
        return false;
    }
}