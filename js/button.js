// /js/button.js
export class Button {
    constructor(x, y, width, height, text, onClick, options = {}) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.text = text;
        this.onClick = onClick;
        
        this.backgroundColor = options.backgroundColor || '#0f0';
        this.textColor = options.textColor || '#000';
        this.hoverColor = options.hoverColor || '#0c0';
        this.font = options.font || '1.2rem Courier New';
        
        this.isHovered = false;
    }

    containsPoint(x, y) {
        return x >= this.x - this.width / 2 && 
               x <= this.x + this.width / 2 && 
               y >= this.y - this.height / 2 && 
               y <= this.y + this.height / 2;
    }

    handleMouseMove(x, y) {
        this.isHovered = this.containsPoint(x, y);
    }

    handleClick(x, y) {
        if (this.containsPoint(x, y)) {
            this.onClick();
            return true;
        }
        return false;
    }

    draw(ctx) {
        ctx.fillStyle = this.isHovered ? this.hoverColor : this.backgroundColor;
        ctx.fillRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height);
        
        ctx.fillStyle = this.textColor;
        ctx.font = this.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.text, this.x, this.y);
    }
}
