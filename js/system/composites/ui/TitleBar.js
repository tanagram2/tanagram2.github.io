import { ContentBox } from './ContentBox.js';
import { Button } from './Button.js';
import { Text } from '../../primitives/Text.js';

export class TitleBar extends ContentBox {
    constructor(window, options = {}) {
        const titleBarHeight = Math.max(20, 0.03 * (window.windowEngine?.canvasHeight || 600));
        
        // UPDATED: Default scaling mode to 'none' for TitleBar content
        const titleBarOptions = {
            backgroundColor: options.backgroundColor || '#e0e0e0',
            shape: 'rect',
            showBorder: true,
            scalingMode: options.scalingMode || 'none' // NEW: Default to 'none' scaling
        };
        
        // Call ContentBox constructor with proper options
        super(
            window.x,
            window.y,
            window.width,
            titleBarHeight,
            titleBarOptions
        );
        
        this.window = window;
        this.textColor = options.textColor || '#000000';
        
        // Store height for positioning calculations
        this.titleBarHeight = titleBarHeight;
        
        // Create content that will use absolute pixel positioning
        this.createContent();
    }
    
    createContent() {
        const contentComponents = [];
        
        // UPDATED: Title text - positioned with absolute pixels
        const titleText = new Text(
            10,                    // 10px from left (absolute)
            this.titleBarHeight / 2, // Centered vertically (absolute)
            this.window.title,
            this.textColor,
            '11px Arial'           // Absolute font size
        );
        titleText.textBaseline = 'middle';
        contentComponents.push(titleText);
        
        // UPDATED: Close button - positioned with absolute pixels
        this.closeButton = new Button(
            this.width - 25,       // 25px from right edge (absolute)
            this.titleBarHeight / 2, // Centered vertically (absolute)
            10,                    // Radius: 10px (absolute)
            null,                  // Ignored for circles
            'X',
            {
                shapeType: 'circle',
                backgroundColor: '#ff5f57',
                hoverColor: '#ff3b30',
                pressedColor: '#e02920',
                textColor: '#000000',
                font: 'bold 12px Arial'  // Absolute font size
            }
        );
        
        this.closeButton.onClick = () => {
            if (this.window) {
                this.window.close();
            }
        };
        
        // The Button is a composite - ContentBox will recursively scale its primitives
        contentComponents.push(this.closeButton);
        
        // Store title text reference for updates
        this.titleText = titleText;
        
        // UPDATED: Proper input handling that maintains button visual states
        this.setContent({
            getPrimitives: () => contentComponents,
            
            // FIXED: Proper mouse move delegation with state tracking
            handleMouseMove: (x, y) => {
                if (this.closeButton) {
                    const wasHovered = this.closeButton.isHovered;
                    const handled = this.closeButton.handleMouseMove(x, y);
                    // Return true if hover state changed (needs re-render)
                    return handled || (wasHovered !== this.closeButton.isHovered);
                }
                return false;
            },
            
            // FIXED: Proper mouse down delegation with state tracking
            handleMouseDown: (x, y) => {
                if (this.closeButton) {
                    const wasPressed = this.closeButton.isPressed;
                    const handled = this.closeButton.handleMouseDown(x, y);
                    // Return true if pressed state changed (needs re-render)
                    return handled || (wasPressed !== this.closeButton.isPressed);
                }
                return false;
            },
            
            // FIXED: Proper mouse up delegation with state tracking
            handleMouseUp: () => {
                if (this.closeButton) {
                    const wasPressed = this.closeButton.isPressed;
                    this.closeButton.handleMouseUp();
                    // Return true if pressed state changed (needs re-render)
                    return wasPressed !== this.closeButton.isPressed;
                }
                return false;
            },
            
            // FIXED: Proper click delegation
            handleClick: (x, y) => {
                if (this.closeButton) {
                    return this.closeButton.handleClick(x, y);
                }
                return false;
            }
        });
    }
    
    containsPoint(x, y) {
        return x >= this.x && x <= this.x + this.width && 
               y >= this.y && y <= this.y + this.height;
    }
    
    isInCloseButton(x, y) {
        if (!this.closeButton) return false;
        
        // Convert global coordinates to TitleBar-absolute coordinates
        const absX = x - this.x;
        const absY = y - this.y;
        
        return this.closeButton.containsPoint(absX, absY);
    }
    
    // Input handling is now handled by ContentBox with the new globalToContentAbsolute method
    // No need to override these methods anymore!
    
    updatePosition() {
        // Update ContentBox position and size
        this.setPosition(this.window.x, this.window.y);
        this.setSize(this.window.width, this.height);
        
        // Update title text content in case window title changed
        if (this.titleText) {
            this.titleText.content = this.window.title;
        }
        
        // UPDATED: Update close button position based on new width
        if (this.closeButton) {
            this.closeButton.x = this.width - 25; // Keep 25px from right edge
            this.closeButton.y = this.titleBarHeight / 2; // Keep centered vertically
        }
    }
}