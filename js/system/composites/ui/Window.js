import { ContentBox } from './ContentBox.js';
import { TitleBar } from './TitleBar.js';
import { Rect } from '../../primitives/Rect.js';

export class Window extends ContentBox {
    constructor(relX, relY, relWidth, relHeight, title, options = {}) {
        // MUST CALL SUPER FIRST - initialize with dummy coordinates
        super(0, 0, 100, 100, {
            backgroundColor: options.backgroundColor || '#ffffff',
            shape: options.shape || 'rounded',
            borderRadius: options.borderRadius || 8,
            borderColor: options.borderColor || '#000000',
            borderWidth: options.borderWidth || 1,
            showBorder: !(options.borderless || false)
        });
        
        // NOW we can use 'this'
        this.relX = relX;
        this.relY = relY;
        this.relWidth = relWidth;
        this.relHeight = relHeight;
        
        this.title = title;
        
        // Window options
        this.borderless = options.borderless || false;
        this.resizable = options.resizable !== false;
        this.movable = options.movable !== false;
        this.showTitleBar = options.showTitleBar !== false && !this.borderless;
        this.showCloseButton = options.showCloseButton !== false && !this.borderless;
        
        // NEW: Store scaling mode from window options
        this.scalingMode = options.scalingMode || 'stretch';
        
        // CRITICAL FIX: Store original border settings at creation time
        this.originalBorderColor = options.borderColor || '#000000';
        this.originalBorderWidth = options.borderWidth || 1;
        
        // Window-specific selection border properties
        this.selectionBorderColor = options.selectionBorderColor || '#ff0000';
        this.selectionBorderWidth = options.selectionBorderWidth || 3;
        
        // CRITICAL FIX: Dynamic square minimum sizing
        this.minRelWidth = 0;
        this.minRelHeight = 0;
        this.targetScreenAreaPercent = options.targetScreenAreaPercent || 0.001;
        
        // Window state
        this.isActive = false;
        this.isDragging = false;
        this.isResizing = false;
        this.isMinimized = false;
        this.isMaximized = false;
        this.isClosed = false;
        this.zIndex = 0;
        
        this.dragOffset = { relX: 0, relY: 0 };
        this.resizeDirection = null;
        this.onClose = null;
        
        // Resize tolerances
        this.resizeEdgeSize = 0.006;
        this.resizeCornerSize = 0.015;
        
        // Window components - these are composites that will be recursively scaled
        this.titleBar = null;
        this.contentBox = null;
        
        // Content management
        this.content = null;
        
        // Selection border primitive
        this.selectionBorder = null;
    }
    
    updateAbsoluteCoordinates(canvasWidth, canvasHeight) {
        this.calculateDynamicMinimums(canvasWidth, canvasHeight);
        
        this.x = this.relX * canvasWidth;
        this.y = this.relY * canvasHeight;
        
        this.width = Math.max(this.minRelWidth * canvasWidth, this.relWidth * canvasWidth);
        this.height = Math.max(this.minRelHeight * canvasHeight, this.relHeight * canvasHeight);
        
        this.relWidth = this.width / canvasWidth;
        this.relHeight = this.height / canvasHeight;
        
        this.createWindowComponents(canvasWidth, canvasHeight);
    }
    
    calculateDynamicMinimums(canvasWidth, canvasHeight) {
        const screenArea = canvasWidth * canvasHeight;
        const targetArea = this.targetScreenAreaPercent * screenArea;
        const squareSide = Math.sqrt(targetArea);
        
        this.minRelWidth = squareSide / canvasWidth;
        this.minRelHeight = squareSide / canvasHeight;
        
        const absoluteMin = 0.001;
        this.minRelWidth = Math.max(absoluteMin, this.minRelWidth);
        this.minRelHeight = Math.max(absoluteMin, this.minRelHeight);
    }
    
    createWindowComponents(canvasWidth, canvasHeight) {
        const titleBarHeight = this.showTitleBar ? Math.max(20, 0.03 * canvasHeight) : 0;
        
        // Window background covers entire window
        this.setPosition(this.x, this.y);
        this.setSize(this.width, this.height);
        
        if (this.showTitleBar) {
            if (!this.titleBar) {
                this.titleBar = new TitleBar(this, {
                    showCloseButton: this.showCloseButton
                });
            } else {
                // JUST update TitleBar position - don't recreate content!
                this.titleBar.setPosition(this.x, this.y);
                this.titleBar.setSize(this.width, titleBarHeight);
                this.titleBar.updatePosition(); // This updates existing components
            }
        } else {
            this.titleBar = null;
        }
        
        if (!this.contentBox) {
            // ContentBox positioned BELOW TitleBar
            this.contentBox = new ContentBox(
                this.x, // Same X as window
                this.y + titleBarHeight, // Y offset by title bar height
                this.width, // Full width
                this.height - titleBarHeight, // Height reduced by title bar
                {
                    backgroundColor: 'transparent',
                    shape: 'rect',
                    showBorder: false,
                    scalingMode: this.scalingMode // FIXED: Pass the window's scaling mode!
                }
            );
            
            if (this.content) {
                this.contentBox.setContent(this.content);
            }
        } else {
            // Update ContentBox position to be below TitleBar
            this.contentBox.setPosition(this.x, this.y + titleBarHeight);
            this.contentBox.setSize(this.width, this.height - titleBarHeight);
            
            // FIXED: Also update scaling mode if it changed
            this.contentBox.setScalingMode(this.scalingMode);
        }
        
        this.createSelectionBorder();
    }
    
    createSelectionBorder() {
        if (this.isActive && !this.borderless) {
            const borderOptions = {
                color: 'transparent',
                borderColor: this.selectionBorderColor,
                borderWidth: this.selectionBorderWidth,
                showBorder: true
            };
            
            if (this.shape === 'rounded') {
                borderOptions.borderRadius = this.borderRadius;
            } else {
                borderOptions.borderRadius = 0;
            }
            
            this.selectionBorder = new Rect(
                this.x,
                this.y,
                this.width,
                this.height,
                borderOptions
            );
        } else {
            this.selectionBorder = null;
        }
    }
    
    updateBorderForSelection() {
        if (this.isActive) {
            this.setBorder(this.selectionBorderColor, this.selectionBorderWidth);
        } else {
            if (this.borderless) {
                this.clearBorder();
            } else {
                this.setBorder(this.originalBorderColor, this.originalBorderWidth);
            }
        }
        
        this.createSelectionBorder();
    }
    
    setActive(active) {
        const wasActive = this.isActive;
        this.isActive = active;
        
        if (wasActive !== active) {
            this.updateBorderForSelection();
        }
    }
    
    setContent(content) {
        this.content = content;
        if (this.contentBox) {
            this.contentBox.setContent(content);
        }
    }
    
    // NEW: Method to change scaling mode dynamically
    setScalingMode(mode) {
        if (mode === 'stretch' || mode === 'scale' || mode === 'none') {
            this.scalingMode = mode;
            if (this.contentBox) {
                this.contentBox.setScalingMode(mode);
            }
        } else {
            console.warn('Invalid scaling mode. Use "stretch", "scale", or "none"');
        }
    }
    
    getPrimitives() {
        if (this.isMinimized || this.isClosed) return [];
        
        const primitives = [];
        
        // 1. Window background (lowest)
        primitives.push(this.background);
        
        // 2. Content box primitives (middle)
        if (this.contentBox) {
            primitives.push(...this.contentBox.getPrimitives());
        }
        
        // 3. Title bar primitives (top - will render over content)
        if (this.titleBar) {
            primitives.push(...this.titleBar.getPrimitives());
        }
        
        // 4. Selection border (very top)
        if (this.selectionBorder) {
            primitives.push(this.selectionBorder);
        }
        
        return primitives;
    }
    
    // Input handling methods 
    isInTitleBar(x, y) {
        if (!this.titleBar) {
            // For borderless windows, the top area acts as title bar
            if (this.borderless && this.movable) {
                const titleBarHeight = Math.max(20, 0.03 * this.windowEngine.canvasHeight);
                return x >= this.x && x <= this.x + this.width && 
                       y >= this.y && y <= this.y + titleBarHeight;
            }
            return false;
        }
        return this.titleBar.containsPoint(x, y);
    }
    
    isInCloseButton(x, y) {
        if (!this.titleBar) return false;
        return this.titleBar.isInCloseButton(x, y);
    }
    
    getResizeDirection(x, y) {
        if (!this.resizable || this.isMaximized) return null;
        
        const edgeTolerance = this.resizeEdgeSize * this.windowEngine.canvasWidth;
        const cornerTolerance = this.resizeCornerSize * this.windowEngine.canvasWidth;
        
        const nearLeft = x <= this.x + cornerTolerance;
        const nearRight = x >= this.x + this.width - cornerTolerance;
        const nearTop = y <= this.y + cornerTolerance;
        const nearBottom = y >= this.y + this.height - cornerTolerance;
        
        // Check corners first with larger tolerance
        if (nearTop && nearLeft) return 'topLeft';
        if (nearTop && nearRight) return 'topRight';
        if (nearBottom && nearLeft) return 'bottomLeft';
        if (nearBottom && nearRight) return 'bottomRight';
        
        // Then check edges with smaller tolerance
        const nearLeftEdge = x <= this.x + edgeTolerance;
        const nearRightEdge = x >= this.x + this.width - edgeTolerance;
        const nearTopEdge = y <= this.y + edgeTolerance;
        const nearBottomEdge = y >= this.y + this.height - edgeTolerance;
        
        if (nearLeftEdge) return 'left';
        if (nearRightEdge) return 'right';
        if (nearTopEdge) return 'top';
        if (nearBottomEdge) return 'bottom';
        
        return null;
    }
    
    globalToContent(x, y) {
        const titleBarHeight = this.showTitleBar ? Math.max(20, 0.03 * this.windowEngine.canvasHeight) : 0;
        const contentX = (x - this.x) / this.width;
        const contentY = (y - this.y - titleBarHeight) / (this.height - titleBarHeight);
        
        return {
            x: Math.max(0, Math.min(1, contentX)),
            y: Math.max(0, Math.min(1, contentY))
        };
    }
    
    handleMouseDown(x, y) {
        if (this.windowEngine) {
            this.windowEngine.bringToFront(this);
        }
        
        const resizeDirection = this.getResizeDirection(x, y);
        if (resizeDirection) {
            this.isResizing = true;
            this.resizeDirection = resizeDirection;
            this.resizeStart = { 
                relWidth: this.relWidth, 
                relHeight: this.relHeight,
                relX: this.relX, 
                relY: this.relY 
            };
            
            if (this.windowEngine.osEngine) {
                this.windowEngine.osEngine.renderEngine.startResize();
            }
            return true;
        }
        
        // Delegate to TitleBar first
        if (this.titleBar && this.titleBar.handleMouseDown(x, y)) {
            return true;
        }
        
        // Then delegate to content
        if (this.contentBox && this.contentBox.handleMouseDown(x, y)) {
            return true;
        }
        
        // Finally handle window dragging
        if (this.isInTitleBar(x, y) && this.movable) {
            this.isDragging = true;
            this.dragOffset.relX = (x - this.x) / this.windowEngine.canvasWidth;
            this.dragOffset.relY = (y - this.y) / this.windowEngine.canvasHeight;
            return true;
        }
        
        return true;
    }
    
    handleMouseMove(x, y) {
        if (this.isResizing && this.resizable) {
            this.handleResize(x, y);
            return true;
        } else if (this.isDragging && this.movable) {
            this.relX = (x / this.windowEngine.canvasWidth) - this.dragOffset.relX;
            this.relY = (y / this.windowEngine.canvasHeight) - this.dragOffset.relY;
            
            this.relX = Math.max(0, Math.min(1 - this.relWidth, this.relX));
            this.relY = Math.max(0, Math.min(1 - this.relHeight, this.relY));
            
            this.updateAbsoluteCoordinates(this.windowEngine.canvasWidth, this.windowEngine.canvasHeight);
            return true;
        }
        
        // Delegate to TitleBar for button hover states
        if (this.titleBar && this.titleBar.handleMouseMove(x, y)) {
            return true;
        }
        
        // Delegate to content
        if (this.contentBox && this.contentBox.handleMouseMove(x, y)) {
            return true;
        }
        
        return false;
    }
    
    handleResize(x, y) {
        const clampedX = Math.max(0, Math.min(this.windowEngine.canvasWidth, x));
        const clampedY = Math.max(0, Math.min(this.windowEngine.canvasHeight, y));
        
        const currentRelX = clampedX / this.windowEngine.canvasWidth;
        const currentRelY = clampedY / this.windowEngine.canvasHeight;
        
        let newRelX = this.resizeStart.relX;
        let newRelY = this.resizeStart.relY;
        let newRelWidth = this.resizeStart.relWidth;
        let newRelHeight = this.resizeStart.relHeight;
        
        switch (this.resizeDirection) {
            case 'top':
                newRelY = currentRelY;
                newRelHeight = this.resizeStart.relHeight + (this.resizeStart.relY - currentRelY);
                if (newRelHeight <= this.minRelHeight) {
                    newRelY = this.resizeStart.relY + (this.resizeStart.relHeight - this.minRelHeight);
                    newRelHeight = this.minRelHeight;
                }
                break;
            case 'bottom':
                newRelHeight = currentRelY - this.resizeStart.relY;
                if (newRelHeight < this.minRelHeight) {
                    newRelHeight = this.minRelHeight;
                }
                break;
            case 'left':
                newRelX = currentRelX;
                newRelWidth = this.resizeStart.relWidth + (this.resizeStart.relX - currentRelX);
                if (newRelWidth <= this.minRelWidth) {
                    newRelX = this.resizeStart.relX + (this.resizeStart.relWidth - this.minRelWidth);
                    newRelWidth = this.minRelWidth;
                }
                break;
            case 'right':
                newRelWidth = currentRelX - this.resizeStart.relX;
                if (newRelWidth < this.minRelWidth) {
                    newRelWidth = this.minRelWidth;
                }
                break;
            case 'topLeft':
                newRelX = currentRelX;
                newRelY = currentRelY;
                newRelWidth = this.resizeStart.relWidth + (this.resizeStart.relX - currentRelX);
                newRelHeight = this.resizeStart.relHeight + (this.resizeStart.relY - currentRelY);
                if (newRelWidth <= this.minRelWidth) {
                    newRelX = this.resizeStart.relX + (this.resizeStart.relWidth - this.minRelWidth);
                    newRelWidth = this.minRelWidth;
                }
                if (newRelHeight <= this.minRelHeight) {
                    newRelY = this.resizeStart.relY + (this.resizeStart.relHeight - this.minRelHeight);
                    newRelHeight = this.minRelHeight;
                }
                break;
            case 'topRight':
                newRelY = currentRelY;
                newRelWidth = currentRelX - this.resizeStart.relX;
                newRelHeight = this.resizeStart.relHeight + (this.resizeStart.relY - currentRelY);
                if (newRelHeight <= this.minRelHeight) {
                    newRelY = this.resizeStart.relY + (this.resizeStart.relHeight - this.minRelHeight);
                    newRelHeight = this.minRelHeight;
                }
                if (newRelWidth < this.minRelWidth) {
                    newRelWidth = this.minRelWidth;
                }
                break;
            case 'bottomLeft':
                newRelX = currentRelX;
                newRelWidth = this.resizeStart.relWidth + (this.resizeStart.relX - currentRelX);
                newRelHeight = currentRelY - this.resizeStart.relY;
                if (newRelWidth <= this.minRelWidth) {
                    newRelX = this.resizeStart.relX + (this.resizeStart.relWidth - this.minRelWidth);
                    newRelWidth = this.minRelWidth;
                }
                if (newRelHeight < this.minRelHeight) {
                    newRelHeight = this.minRelHeight;
                }
                break;
            case 'bottomRight':
                newRelWidth = currentRelX - this.resizeStart.relX;
                newRelHeight = currentRelY - this.resizeStart.relY;
                if (newRelWidth < this.minRelWidth) {
                    newRelWidth = this.minRelWidth;
                }
                if (newRelHeight < this.minRelHeight) {
                    newRelHeight = this.minRelHeight;
                }
                break;
        }
        
        this.relWidth = Math.max(this.minRelWidth, newRelWidth);
        this.relHeight = Math.max(this.minRelHeight, newRelHeight);
        
        this.relX = Math.max(0, Math.min(1 - this.relWidth, newRelX));
        this.relY = Math.max(0, Math.min(1 - this.relHeight, newRelY));
        
        this.updateAbsoluteCoordinates(this.windowEngine.canvasWidth, this.windowEngine.canvasHeight);
    }
    
    handleMouseUp() {
        if (this.isResizing) {
            if (this.windowEngine.osEngine) {
                this.windowEngine.osEngine.renderEngine.endResize();
            }
        }
        
        // Delegate to TitleBar and content
        if (this.titleBar) {
            this.titleBar.handleMouseUp();
        }
        if (this.contentBox) {
            this.contentBox.handleMouseUp();
        }
        
        this.isDragging = false;
        this.isResizing = false;
        this.resizeDirection = null;
    }
    
    handleClick(x, y) {
        // Delegate to TitleBar first (for close button)
        if (this.titleBar && this.titleBar.handleClick(x, y)) {
            return true;
        }
        
        // Then delegate to content
        if (this.contentBox && this.contentBox.handleClick(x, y)) {
            return true;
        }
        
        return false;
    }
    
    handleKeyDown(event) {
        if (this.content && this.content.handleKeyDown) {
            return this.content.handleKeyDown(event);
        }
        return false;
    }
    
    handleKeyUp(event) {
        if (this.content && this.content.handleKeyUp) {
            return this.content.handleKeyUp(event);
        }
        return false;
    }
    
    close() {
        this.isClosed = true;
        this.setActive(false);
        
        if (this.onClose) {
            this.onClose();
        }
        
        if (this.windowEngine) {
            this.windowEngine.removeWindow(this);
        }
    }
    
    setWindowEngine(windowEngine) {
        this.windowEngine = windowEngine;
        this.updateAbsoluteCoordinates(windowEngine.canvasWidth, windowEngine.canvasHeight);
    }
}