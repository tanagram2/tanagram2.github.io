export class Image {
    constructor(x, y, width, height, src) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.src = src;
        this.loaded = false;
        this.isHovered = false;
        this.hasError = false;
        this.img = new Image();
        this.load();
    }

    load() {
        this.img.onload = () => {
            this.loaded = true;
        };
        this.img.onerror = () => {
            this.hasError = true;
            console.error(`Failed to load image: ${this.src}`);
        };
        this.img.src = this.src;
    }

    draw(ctx) {
        if (this.loaded && !this.hasError) {
            if (this.isHovered) {
                ctx.globalAlpha = 0.8;
            }
            ctx.drawImage(this.img, this.x, this.y, this.width, this.height);
            ctx.globalAlpha = 1.0;
        } else {
            // Draw placeholder
            ctx.fillStyle = this.hasError ? '#ff6b6b' : '#ccc';
            ctx.fillRect(this.x, this.y, this.width, this.height);
            ctx.strokeStyle = '#999';
            ctx.strokeRect(this.x, this.y, this.width, this.height);
        }
    }

    containsPoint(x, y) {
        return x >= this.x && 
               x <= this.x + this.width && 
               y >= this.y && 
               y <= this.y + this.height;
    }
}