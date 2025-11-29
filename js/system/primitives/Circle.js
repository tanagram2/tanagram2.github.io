import { Shape } from './Shape.js';

export class Circle extends Shape {
    constructor(x, y, radius, radiusY = null, color = '#000') {
        super(x, y, color);
        
        // Support both circle (radius) and ellipse (radiusX, radiusY)
        if (radiusY === null) {
            // Single radius - perfect circle
            this.radiusX = radius;
            this.radiusY = radius;
        } else {
            // Separate radii - ellipse
            this.radiusX = radius;
            this.radiusY = radiusY;
        }
        
        // Backward compatibility
        this.radius = radius;
    }

    draw(ctx) {
        if (!this.visible) return;
        
        // Draw fill - use ellipse if radii are different
        ctx.fillStyle = this.color;
        ctx.beginPath();
        
        if (this.radiusX === this.radiusY) {
            // Perfect circle
            ctx.arc(this.x, this.y, this.radiusX, 0, Math.PI * 2);
        } else {
            // Ellipse
            ctx.ellipse(this.x, this.y, this.radiusX, this.radiusY, 0, 0, Math.PI * 2);
        }
        
        ctx.fill();
        
        // Draw border if enabled
        if (this.applyBorderStyles(ctx)) {
            ctx.beginPath();
            if (this.radiusX === this.radiusY) {
                ctx.arc(this.x, this.y, this.radiusX, 0, Math.PI * 2);
            } else {
                ctx.ellipse(this.x, this.y, this.radiusX, this.radiusY, 0, 0, Math.PI * 2);
            }
            ctx.stroke();
        }
    }

    containsPoint(x, y) {
        // Elliptical hit detection
        const dx = (x - this.x) / this.radiusX;
        const dy = (y - this.y) / this.radiusY;
        return dx * dx + dy * dy <= 1;
    }
    
    // Helper methods for common patterns
    setRadius(radius) {
        this.radiusX = radius;
        this.radiusY = radius;
        this.radius = radius; // Backward compatibility
        return this;
    }
    
    setRadiusX(radiusX) {
        this.radiusX = radiusX;
        return this;
    }
    
    setRadiusY(radiusY) {
        this.radiusY = radiusY;
        return this;
    }
    
    // Convert to ellipse
    toEllipse(radiusX, radiusY) {
        this.radiusX = radiusX;
        this.radiusY = radiusY;
        return this;
    }
}