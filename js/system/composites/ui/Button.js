import { Shape } from '../../primitives/Shape.js';
import { Rect } from '../../primitives/Rect.js';
import { Circle } from '../../primitives/Circle.js';
import { Text } from '../../primitives/Text.js';

export class Button extends Shape {
    constructor(x, y, size1, size2, label, options = {}) {
        super(x, y, options.backgroundColor || '#007acc');
        
        this.label = label;
        
        // Button options
        this.shapeType = options.shapeType || 'rect';
        this.backgroundColor = options.backgroundColor || '#007acc';
        this.hoverColor = options.hoverColor || '#005a9e';
        this.pressedColor = options.pressedColor || '#004a85';
        this.textColor = options.textColor || '#ffffff';
        this.radius = options.radius || 6;
        this.font = options.font || '12% Arial';
        
        // Button state
        this.isHovered = false;
        this.isPressed = false;
        this.enabled = options.enabled !== false;
        
        // FIXED: Smart sizing based on shape type - properly handle both radii for circles
        if (this.shapeType === 'circle') {
            // For circles: x,y is center, size1 is radiusX, size2 is radiusY
            this.radiusValueX = size1;
            this.radiusValueY = size2 !== null ? size2 : size1; // Use size2 if provided, else use size1 for both
            this.width = this.radiusValueX * 2;  // Diameter for bounding box
            this.height = this.radiusValueY * 2; // Diameter for bounding box
        } else {
            // For rectangles: x,y is top-left, size1 is width, size2 is height
            this.width = size1;
            this.height = size2;
        }
        
        // DO NOT store components - create fresh every time in getPrimitives()
    }
    
    getPrimitives() {
        if (!this.visible) return [];
        
        const currentColor = this.isPressed ? this.pressedColor : 
                           (this.isHovered ? this.hoverColor : this.backgroundColor);
        
        const primitives = [];
        
        if (this.shapeType === 'circle') {
            // FIXED: Use both radius values for proper circle/ellipse creation
            const circle = new Circle(
                this.x,           // Center X (relative)
                this.y,           // Center Y (relative)
                this.radiusValueX, // Radius X (relative)
                this.radiusValueY, // Radius Y (relative) - FIXED: Use the second radius!
                currentColor      // Color
            );
            primitives.push(circle);
            
            // Text positioned at center
            const text = new Text(
                this.x,           // Center X (relative)
                this.y,           // Center Y (relative)
                this.label,
                this.textColor,
                this.font
            );
            text.textAlign = 'center';
            text.textBaseline = 'middle';
            primitives.push(text);
            
        } else {
            // Rectangles: x,y is top-left corner
            const rect = new Rect(
                this.x,           // Top-left X (relative)
                this.y,           // Top-left Y (relative)
                this.width,       // Width (relative)
                this.height,      // Height (relative)
                {
                    color: currentColor,
                    borderRadius: this.radius
                }
            );
            primitives.push(rect);
            
            // Text positioned at center of rectangle
            const text = new Text(
                this.x + this.width / 2,  // Center X (relative)
                this.y + this.height / 2, // Center Y (relative)
                this.label,
                this.textColor,
                this.font
            );
            text.textAlign = 'center';
            text.textBaseline = 'middle';
            primitives.push(text);
        }
        
        return primitives;
    }
    
    draw(ctx) {
        if (!this.visible) return;
        
        const primitives = this.getPrimitives();
        for (const primitive of primitives) {
            primitive.draw(ctx);
        }
    }
    
    containsPoint(x, y) {
        if (this.shapeType === 'circle') {
            // FIXED: Use both radii for proper elliptical hit detection
            const dx = x - this.x;
            const dy = y - this.y;
            return (dx * dx) / (this.radiusValueX * this.radiusValueX) + 
                   (dy * dy) / (this.radiusValueY * this.radiusValueY) <= 1;
        } else {
            // Rectangle: check bounding box from top-left
            return x >= this.x && x <= this.x + this.width &&
                   y >= this.y && y <= this.y + this.height;
        }
    }
    
    handleMouseMove(x, y) {
        const wasHovered = this.isHovered;
        this.isHovered = this.containsPoint(x, y) && this.enabled;
        return this.isHovered !== wasHovered;
    }
    
    handleMouseDown(x, y) {
        if (this.containsPoint(x, y) && this.enabled) {
            this.isPressed = true;
            return true;
        }
        return false;
    }
    
    handleMouseUp() {
        this.isPressed = false;
    }
    
    handleClick(x, y) {
        if (this.containsPoint(x, y) && this.enabled) {
            if (this.onClick) {
                this.onClick();
            }
            return true;
        }
        return false;
    }
}