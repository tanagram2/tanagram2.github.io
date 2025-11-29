import { Shape } from './Shape.js';

export class Rect extends Shape {
    constructor(x, y, width, height, colorOrOptions = '#000000') {
        // Handle both legacy (color only) and new (options object) constructor patterns
        let color = '#000000';
        let options = {};
        
        if (typeof colorOrOptions === 'string') {
            // Legacy: Rect(x, y, width, height, color)
            color = colorOrOptions;
        } else if (typeof colorOrOptions === 'object') {
            // New: Rect(x, y, width, height, options)
            options = colorOrOptions;
            color = options.color || '#000000';
        }
        
        super(x, y, color);
        this.width = width;
        this.height = height;
        
        // Border radius options
        this.borderRadius = options.borderRadius || 0;
        this.borderTopLeftRadius = options.borderTopLeftRadius !== undefined ? options.borderTopLeftRadius : this.borderRadius;
        this.borderTopRightRadius = options.borderTopRightRadius !== undefined ? options.borderTopRightRadius : this.borderRadius;
        this.borderBottomLeftRadius = options.borderBottomLeftRadius !== undefined ? options.borderBottomLeftRadius : this.borderRadius;
        this.borderBottomRightRadius = options.borderBottomRightRadius !== undefined ? options.borderBottomRightRadius : this.borderRadius;
        
        // Border styling (inherited from Shape)
        if (options.borderColor !== undefined) {
            this.borderColor = options.borderColor;
        }
        if (options.borderWidth !== undefined) {
            this.borderWidth = options.borderWidth;
        }
        if (options.showBorder !== undefined) {
            this.showBorder = options.showBorder;
        }
    }

    draw(ctx) {
        if (!this.visible) return;
        
        // Draw fill
        ctx.fillStyle = this.color;
        this._drawRectPath(ctx);
        ctx.fill();
        
        // Draw border if enabled
        if (this.applyBorderStyles(ctx)) {
            this._drawRectPath(ctx);
            ctx.stroke();
        }
    }

    _drawRectPath(ctx) {
        const { x, y, width, height } = this;
        const topLeft = this.borderTopLeftRadius;
        const topRight = this.borderTopRightRadius;
        const bottomLeft = this.borderBottomLeftRadius;
        const bottomRight = this.borderBottomRightRadius;
        
        // If no rounding, use simple rectangle for performance
        if (topLeft === 0 && topRight === 0 && bottomLeft === 0 && bottomRight === 0) {
            ctx.beginPath();
            ctx.rect(x, y, width, height);
            return;
        }
        
        // Draw rounded rectangle with individual corner control
        ctx.beginPath();
        
        // Start from top-left (after corner if rounded)
        ctx.moveTo(x + topLeft, y);
        
        // Top edge and top-right corner
        ctx.lineTo(x + width - topRight, y);
        if (topRight > 0) {
            ctx.quadraticCurveTo(x + width, y, x + width, y + topRight);
        } else {
            ctx.lineTo(x + width, y);
        }
        
        // Right edge and bottom-right corner
        ctx.lineTo(x + width, y + height - bottomRight);
        if (bottomRight > 0) {
            ctx.quadraticCurveTo(x + width, y + height, x + width - bottomRight, y + height);
        } else {
            ctx.lineTo(x + width, y + height);
        }
        
        // Bottom edge and bottom-left corner
        ctx.lineTo(x + bottomLeft, y + height);
        if (bottomLeft > 0) {
            ctx.quadraticCurveTo(x, y + height, x, y + height - bottomLeft);
        } else {
            ctx.lineTo(x, y + height);
        }
        
        // Left edge and top-left corner
        ctx.lineTo(x, y + topLeft);
        if (topLeft > 0) {
            ctx.quadraticCurveTo(x, y, x + topLeft, y);
        } else {
            ctx.lineTo(x, y);
        }
        
        ctx.closePath();
    }

    containsPoint(x, y) {
        // Simple rectangular hit detection (ignores rounded corners for now)
        return x >= this.x && 
               x <= this.x + this.width && 
               y >= this.y && 
               y <= this.y + this.height;
    }
    
    // Helper methods for common patterns
    setAllCorners(radius) {
        this.borderTopLeftRadius = radius;
        this.borderTopRightRadius = radius;
        this.borderBottomLeftRadius = radius;
        this.borderBottomRightRadius = radius;
        return this;
    }
    
    setTopCorners(radius) {
        this.borderTopLeftRadius = radius;
        this.borderTopRightRadius = radius;
        this.borderBottomLeftRadius = 0;
        this.borderBottomRightRadius = 0;
        return this;
    }
    
    setBottomCorners(radius) {
        this.borderTopLeftRadius = 0;
        this.borderTopRightRadius = 0;
        this.borderBottomLeftRadius = radius;
        this.borderBottomRightRadius = radius;
        return this;
    }
    
    setLeftCorners(radius) {
        this.borderTopLeftRadius = radius;
        this.borderTopRightRadius = 0;
        this.borderBottomLeftRadius = radius;
        this.borderBottomRightRadius = 0;
        return this;
    }
    
    setRightCorners(radius) {
        this.borderTopLeftRadius = 0;
        this.borderTopRightRadius = radius;
        this.borderBottomLeftRadius = 0;
        this.borderBottomRightRadius = radius;
        return this;
    }
}