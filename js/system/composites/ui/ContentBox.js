import { Rect } from '../../primitives/Rect.js';
import { Circle } from '../../primitives/Circle.js';
import { Text } from '../../primitives/Text.js';
import { Line } from '../../primitives/Line.js';

export class ContentBox {
    constructor(x, y, width, height, options = {}) {
        // Absolute coordinates
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        
        // Store original dimensions for scaling calculations (in pixels)
        this.originalWidth = width;
        this.originalHeight = height;
        
        // Content box options
        this.backgroundColor = options.backgroundColor || '#ffffff';
        this.shape = options.shape || 'rect';
        this.borderRadius = options.borderRadius || 8;
        this.borderColor = options.borderColor || '#000000';
        this.borderWidth = options.borderWidth || 1;
        this.showBorder = options.showBorder !== false;
        
        // UPDATED: Scaling mode system - now includes proper letterbox scaling for %rel
        this.scalingMode = options.scalingMode || 'stretch'; // 'stretch', 'scale', or 'none'
        
        // Scaling state for 'scale' mode
        this.scaleFactor = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.scaledContentWidth = width;
        this.scaledContentHeight = height;
        
        // Content management
        this.content = null;
        this.background = null;
        
        // State
        this.visible = true;
        this.isActive = false;
        
        this.createBackground();
        this.calculateScaling(); // Initialize scaling
    }
    
    createBackground() {
        if (this.shape === 'rounded') {
            this.background = new Rect(
                this.x, 
                this.y, 
                this.width, 
                this.height, 
                {
                    color: this.backgroundColor,
                    borderRadius: this.borderRadius
                }
            );
        } else {
            this.background = new Rect(
                this.x, 
                this.y, 
                this.width, 
                this.height, 
                this.backgroundColor
            );
        }
        
        // Apply border settings
        if (this.showBorder) {
            this.background.borderColor = this.borderColor;
            this.background.borderWidth = this.borderWidth;
            this.background.showBorder = true;
        }
    }
    
    setContent(content) {
        this.content = content;
    }
    
    setScalingMode(mode) {
        if (mode === 'stretch' || mode === 'scale' || mode === 'none') {
            this.scalingMode = mode;
            this.calculateScaling();
        } else {
            console.warn('Invalid scaling mode. Use "stretch", "scale", or "none"');
        }
    }
    
    setSize(width, height) {
        this.width = width;
        this.height = height;
        
        // Recalculate scaling for 'scale' mode
        this.calculateScaling();
        this.createBackground();
    }
    
    // UPDATED: Calculate scaling factors for letterbox mode with %rel support
    calculateScaling() {
        if (this.scalingMode !== 'scale') {
            this.scaleFactor = 1;
            this.offsetX = 0;
            this.offsetY = 0;
            this.scaledContentWidth = this.width;
            this.scaledContentHeight = this.height;
            return;
        }
        
        // Calculate scale factor based on the smaller dimension
        const scaleX = this.width / this.originalWidth;
        const scaleY = this.height / this.originalHeight;
        this.scaleFactor = Math.min(scaleX, scaleY);
        
        // Calculate scaled content dimensions (for %rel coordinate space)
        this.scaledContentWidth = this.originalWidth * this.scaleFactor;
        this.scaledContentHeight = this.originalHeight * this.scaleFactor;
        
        // Calculate centering offsets
        this.offsetX = (this.width - this.scaledContentWidth) / 2;
        this.offsetY = (this.height - this.scaledContentHeight) / 2;
        
        console.log(`📐 Scale mode: factor=${this.scaleFactor.toFixed(2)}, scaled=(${this.scaledContentWidth.toFixed(0)}x${this.scaledContentHeight.toFixed(0)}), offset=(${this.offsetX.toFixed(0)}, ${this.offsetY.toFixed(0)})`);
    }
    
    getPrimitives() {
        if (!this.visible) return [];
        
        const primitives = [];
        
        // Always add background first (this is a structural component, not content)
        primitives.push(this.background);
        
        // Add scaled content primitives
        if (this.content && this.content.getPrimitives) {
            const contentPrimitives = this.content.getPrimitives();
            if (contentPrimitives && contentPrimitives.length > 0) {
                console.log(`🎨 ContentBox scaling ${contentPrimitives.length} primitives with mode: ${this.scalingMode}`);
                for (const primitive of contentPrimitives) {
                    const scaledPrimitive = this.scaleContentPrimitive(primitive);
                    if (scaledPrimitive) {
                        if (Array.isArray(scaledPrimitive)) {
                            primitives.push(...scaledPrimitive);
                        } else {
                            primitives.push(scaledPrimitive);
                        }
                    }
                }
            }
        }
        
        return primitives;
    }
    
    scaleContentPrimitive(primitive) {
        // Handle composites recursively
        if (primitive && primitive.getPrimitives && 
            !(primitive instanceof ContentBox)) {
            console.log('🔄 Recursively scaling composite:', primitive.constructor.name);
            const nestedPrimitives = primitive.getPrimitives();
            const scaledNestedPrimitives = [];
            
            for (const nestedPrimitive of nestedPrimitives) {
                const scaled = this.scaleContentPrimitive(nestedPrimitive);
                if (scaled) {
                    if (Array.isArray(scaled)) {
                        scaledNestedPrimitives.push(...scaled);
                    } else {
                        scaledNestedPrimitives.push(scaled);
                    }
                }
            }
            
            return scaledNestedPrimitives;
        }
        
        // Scale regular primitives based on scaling mode
        if (primitive instanceof Rect) {
            let scaledRect;
            
            if (this.scalingMode === 'none') {
                // "none" mode - use absolute pixel positioning and sizing
                scaledRect = new Rect(
                    this.x + primitive.x,  // Absolute X position
                    this.y + primitive.y,  // Absolute Y position
                    primitive.width,       // Keep original width (absolute)
                    primitive.height,      // Keep original height (absolute)
                    primitive.color
                );
            } else if (this.scalingMode === 'stretch') {
                // "stretch" behavior - scale %rel coordinates to container
                scaledRect = new Rect(
                    this.x + (primitive.x * this.width),
                    this.y + (primitive.y * this.height),
                    primitive.width * this.width,
                    primitive.height * this.height,
                    primitive.color
                );
            } else { // 'scale' mode - LETTERBOX SYSTEM WITH %REL SUPPORT
                // Scale %rel coordinates to the scaled content area and center
                scaledRect = new Rect(
                    this.x + this.offsetX + (primitive.x * this.scaledContentWidth),
                    this.y + this.offsetY + (primitive.y * this.scaledContentHeight),
                    primitive.width * this.scaledContentWidth,
                    primitive.height * this.scaledContentHeight,
                    primitive.color
                );
            }
            
            // FIXED: Scale borderRadius based on scaling mode
            if (primitive.borderRadius) {
                if (this.scalingMode === 'scale') {
                    // For scale mode, use uniform scaling factor
                    scaledRect.borderRadius = primitive.borderRadius * this.scaleFactor;
                } else if (this.scalingMode === 'stretch') {
                    // For stretch mode, use average of width/height scaling
                    const avgScale = (this.width / this.originalWidth + this.height / this.originalHeight) / 2;
                    scaledRect.borderRadius = primitive.borderRadius * avgScale;
                } else {
                    // 'none' mode - keep original borderRadius
                    scaledRect.borderRadius = primitive.borderRadius;
                }
                console.log(`🔵 Scaled borderRadius: ${primitive.borderRadius} → ${scaledRect.borderRadius} (mode: ${this.scalingMode})`);
            }
            
            // Copy individual corner radii if they exist
            if (primitive.borderTopLeftRadius !== undefined) scaledRect.borderTopLeftRadius = primitive.borderTopLeftRadius;
            if (primitive.borderTopRightRadius !== undefined) scaledRect.borderTopRightRadius = primitive.borderTopRightRadius;
            if (primitive.borderBottomLeftRadius !== undefined) scaledRect.borderBottomLeftRadius = primitive.borderBottomLeftRadius;
            if (primitive.borderBottomRightRadius !== undefined) scaledRect.borderBottomRightRadius = primitive.borderBottomRightRadius;
            
            // Copy border styling
            if (primitive.borderColor) scaledRect.borderColor = primitive.borderColor;
            if (primitive.borderWidth) scaledRect.borderWidth = primitive.borderWidth;
            if (primitive.showBorder !== undefined) scaledRect.showBorder = primitive.showBorder;
            
            return scaledRect;
            
        } else if (primitive instanceof Circle) {
            let scaledCircle;
            
            if (this.scalingMode === 'none') {
                // "none" mode - use absolute pixel positioning and sizing
                scaledCircle = new Circle(
                    this.x + primitive.x,     // Absolute X position
                    this.y + primitive.y,     // Absolute Y position
                    primitive.radiusX,        // Keep original radius X (absolute)
                    primitive.radiusY,        // Keep original radius Y (absolute)
                    primitive.color
                );
            } else if (this.scalingMode === 'stretch') {
                // Stretch mode: scale %rel coordinates to container
                scaledCircle = new Circle(
                    this.x + (primitive.x * this.width),
                    this.y + (primitive.y * this.height),
                    primitive.radiusX * this.width,
                    primitive.radiusY * this.height,
                    primitive.color
                );
            } else { // 'scale' mode - LETTERBOX SYSTEM WITH %REL SUPPORT
                // Scale %rel coordinates to the scaled content area and center
                scaledCircle = new Circle(
                    this.x + this.offsetX + (primitive.x * this.scaledContentWidth),
                    this.y + this.offsetY + (primitive.y * this.scaledContentHeight),
                    primitive.radiusX * this.scaledContentWidth,
                    primitive.radiusY * this.scaledContentHeight,
                    primitive.color
                );
            }
            
            return scaledCircle;
            
        } else if (primitive instanceof Text) {
            let newText;
            
            if (this.scalingMode === 'none') {
                // "none" mode - use absolute pixel positioning
                newText = new Text(
                    this.x + primitive.x,  // Absolute X position
                    this.y + primitive.y,  // Absolute Y position
                    primitive.content,
                    primitive.color,
                    primitive.font
                );
                // Clear scaling context so text doesn't scale with ContentBox
                newText.clearScalingContext();
            } else if (this.scalingMode === 'stretch') {
                // "stretch" mode - scale %rel coordinates to container
                newText = new Text(
                    this.x + (primitive.x * this.width),
                    this.y + (primitive.y * this.height),
                    primitive.content,
                    primitive.color,
                    primitive.font
                );
                newText.setScalingContext(this.width, this.height);
            } else { // 'scale' mode - LETTERBOX SYSTEM WITH %REL SUPPORT
                // Scale %rel coordinates to the scaled content area and center
                newText = new Text(
                    this.x + this.offsetX + (primitive.x * this.scaledContentWidth),
                    this.y + this.offsetY + (primitive.y * this.scaledContentHeight),
                    primitive.content,
                    primitive.color,
                    primitive.font
                );
                // Set scaling context for text font scaling using scaled dimensions
                newText.setScalingContext(this.scaledContentWidth, this.scaledContentHeight);
            }
            
            // Copy all text properties
            newText.textAlign = primitive.textAlign;
            newText.textBaseline = primitive.textBaseline;
            newText.originalFont = primitive.originalFont;
            
            return newText;
            
        } else if (primitive instanceof Line) {
            let scaledLine;
            
            if (this.scalingMode === 'none') {
                // "none" mode - use absolute pixel positioning
                scaledLine = new Line(
                    this.x + primitive.x1,  // Absolute X1 position
                    this.y + primitive.y1,  // Absolute Y1 position
                    this.x + primitive.x2,  // Absolute X2 position
                    this.y + primitive.y2,  // Absolute Y2 position
                    primitive.color,
                    primitive.lineWidth     // Keep original line width
                );
            } else if (this.scalingMode === 'stretch') {
                // "stretch" mode - scale %rel coordinates to container
                scaledLine = new Line(
                    this.x + (primitive.x1 * this.width),
                    this.y + (primitive.y1 * this.height),
                    this.x + (primitive.x2 * this.width),
                    this.y + (primitive.y2 * this.height),
                    primitive.color,
                    primitive.lineWidth
                );
            } else { // 'scale' mode - LETTERBOX SYSTEM WITH %REL SUPPORT
                // Scale %rel coordinates to the scaled content area and center
                scaledLine = new Line(
                    this.x + this.offsetX + (primitive.x1 * this.scaledContentWidth),
                    this.y + this.offsetY + (primitive.y1 * this.scaledContentHeight),
                    this.x + this.offsetX + (primitive.x2 * this.scaledContentWidth),
                    this.y + this.offsetY + (primitive.y2 * this.scaledContentHeight),
                    primitive.color,
                    primitive.lineWidth
                );
            }
            
            return scaledLine;
        }
        
        return primitive;
    }
    
    // ... (rest of the existing ContentBox methods remain the same)
    setClipRegion(ctx) {
        ctx.save();
        
        if (this.shape === 'rounded' && this.borderRadius > 0) {
            const { x, y, width, height, borderRadius } = this;
            ctx.beginPath();
            ctx.moveTo(x + borderRadius, y);
            ctx.lineTo(x + width - borderRadius, y);
            ctx.quadraticCurveTo(x + width, y, x + width, y + borderRadius);
            ctx.lineTo(x + width, y + height - borderRadius);
            ctx.quadraticCurveTo(x + width, y + height, x + width - borderRadius, y + height);
            ctx.lineTo(x + borderRadius, y + height);
            ctx.quadraticCurveTo(x, y + height, x, y + height - borderRadius);
            ctx.lineTo(x, y + borderRadius);
            ctx.quadraticCurveTo(x, y, x + borderRadius, y);
            ctx.closePath();
        } else {
            ctx.beginPath();
            ctx.rect(this.x, this.y, this.width, this.height);
        }
        
        ctx.clip();
    }
    
    containsPoint(x, y) {
        return x >= this.x && x <= this.x + this.width && 
               y >= this.y && y <= this.y + this.height;
    }
    
    globalToContent(x, y) {
        const contentX = (x - this.x) / this.width;
        const contentY = (y - this.y) / this.height;
        
        return {
            x: Math.max(0, Math.min(1, contentX)),
            y: Math.max(0, Math.min(1, contentY))
        };
    }
    
    // UPDATED: Convert coordinates for "scale" mode with %rel letterboxing
    globalToContentScale(x, y) {
        // Adjust for letterbox offsets first
        const adjustedX = x - this.x - this.offsetX;
        const adjustedY = y - this.y - this.offsetY;
        
        // Then convert to %rel coordinates in the scaled content space
        const contentX = adjustedX / this.scaledContentWidth;
        const contentY = adjustedY / this.scaledContentHeight;
        
        return {
            x: Math.max(0, Math.min(1, contentX)),
            y: Math.max(0, Math.min(1, contentY))
        };
    }
    
    // Convert relative coordinates to absolute pixels for "none" mode content
    globalToContentAbsolute(x, y) {
        return {
            x: x - this.x,  // Absolute pixels from left edge
            y: y - this.y   // Absolute pixels from top edge
        };
    }
    
    // Input event delegation for interactive ContentBox
    handleMouseMove(x, y) {
        if (this.content && this.content.handleMouseMove) {
            // Use appropriate coordinate conversion based on scaling mode
            let contentCoords;
            if (this.scalingMode === 'none') {
                contentCoords = this.globalToContentAbsolute(x, y);
            } else if (this.scalingMode === 'scale') {
                contentCoords = this.globalToContentScale(x, y);
            } else {
                contentCoords = this.globalToContent(x, y);
            }
            return this.content.handleMouseMove(contentCoords.x, contentCoords.y);
        }
        return false;
    }
    
    handleMouseDown(x, y) {
        if (this.content && this.content.handleMouseDown) {
            // Use appropriate coordinate conversion based on scaling mode
            let contentCoords;
            if (this.scalingMode === 'none') {
                contentCoords = this.globalToContentAbsolute(x, y);
            } else if (this.scalingMode === 'scale') {
                contentCoords = this.globalToContentScale(x, y);
            } else {
                contentCoords = this.globalToContent(x, y);
            }
            return this.content.handleMouseDown(contentCoords.x, contentCoords.y);
        }
        return false;
    }
    
    handleMouseUp() {
        if (this.content && this.content.handleMouseUp) {
            this.content.handleMouseUp();
        }
    }
    
    handleClick(x, y) {
        if (this.content && this.content.handleClick) {
            // Use appropriate coordinate conversion based on scaling mode
            let contentCoords;
            if (this.scalingMode === 'none') {
                contentCoords = this.globalToContentAbsolute(x, y);
            } else if (this.scalingMode === 'scale') {
                contentCoords = this.globalToContentScale(x, y);
            } else {
                contentCoords = this.globalToContent(x, y);
            }
            return this.content.handleClick(contentCoords.x, contentCoords.y);
        }
        return false;
    }
    
    // Position and size management
    setPosition(x, y) {
        this.x = x;
        this.y = y;
        this.createBackground();
    }
    
    // Border management
    setBorder(color, width = 1) {
        this.borderColor = color;
        this.borderWidth = width;
        this.showBorder = true;
        this.createBackground();
    }
    
    clearBorder() {
        this.showBorder = false;
        this.createBackground();
    }
    
    setActive(active) {
        this.isActive = active;
        this.createBackground();
    }
}