import { Window } from '../composites/ui/Window.js';
import { Rect } from '../primitives/Rect.js';

export class WindowEngine {
    constructor() {
        this.windows = [];
        this.activeWindow = null;
        this.draggingWindow = null;
        this.resizingWindow = null;
        this.nextZIndex = 1000;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
    }
    
    setCanvasSize(width, height) {
        this.canvasWidth = width;
        this.canvasHeight = height;
        
        this.windows.forEach(window => {
            window.updateAbsoluteCoordinates(width, height);
        });
    }
    
    createWindow(relX, relY, relWidth, relHeight, title, content = null, options = {}) {
        const window = new Window(relX, relY, relWidth, relHeight, title, options);
        window.setWindowEngine(this);
        
        if (content) {
            window.setContent(content);
        }
        window.zIndex = this.nextZIndex++;
        this.windows.push(window);
        
        // CRITICAL FIX: Don't automatically bring to front when creating
        // Windows should start inactive unless explicitly activated
        // this.bringToFront(window); // ← REMOVED THIS LINE
        
        return window;
    }
    
    removeWindow(window) {
        const index = this.windows.indexOf(window);
        if (index > -1) {
            this.windows.splice(index, 1);
            if (this.activeWindow === window) {
                this.setActiveWindow(null);
            }
            if (this.draggingWindow === window) {
                this.draggingWindow = null;
            }
            if (this.resizingWindow === window) {
                this.resizingWindow = null;
            }
        }
    }
    
    setActiveWindow(window) {
        // Deactivate previous active window
        if (this.activeWindow && this.activeWindow !== window) {
            this.activeWindow.setActive(false);
        }
        
        // Activate new window
        this.activeWindow = window;
        if (window) {
            window.setActive(true);
        }
    }
    
    bringToFront(window) {
        const index = this.windows.indexOf(window);
        if (index > -1) {
            window.zIndex = this.nextZIndex++;
            this.windows.sort((a, b) => a.zIndex - b.zIndex);
            this.setActiveWindow(window); // This sets the window as active
        }
    }
    
    getWindowAt(x, y) {
        // Iterate from highest z-index to lowest (top to bottom)
        for (let i = this.windows.length - 1; i >= 0; i--) {
            const window = this.windows[i];
            
            // Only consider windows that are visible and interactive
            if (!window.isClosed && !window.isMinimized && window.containsPoint(x, y)) {
                return window;
            }
        }
        return null;
    }
    
    // Build flat primitive list for RenderEngine
    buildRenderStack() {
        const renderStack = [];
        
        // Add desktop background (no window association)
        const desktopBackground = {
            primitive: new Rect(0, 0, this.canvasWidth, this.canvasHeight, '#0078d4'),
            zIndex: 0
            // No window property - this is not part of any window
        };
        renderStack.push(desktopBackground);
        
        // Add all window primitives (only for visible windows)
        for (const window of this.windows) {
            // Skip closed windows
            if (window.isClosed) {
                continue;
            }
            
            const windowPrimitives = window.getPrimitives();
            if (windowPrimitives && windowPrimitives.length > 0) {
                for (const primitive of windowPrimitives) {
                    renderStack.push({
                        primitive: primitive,
                        zIndex: window.zIndex,
                        window: window  // CRITICAL: Associate primitive with its window
                    });
                }
            }
        }
        
        return renderStack;
    }
    
    // Input handling
    handleMouseDown(x, y) {
        const window = this.getWindowAt(x, y);
        if (window) {
            // CRITICAL: Bring to front AND set active for ANY window interaction
            this.bringToFront(window);
            const handled = window.handleMouseDown(x, y);
            if (handled) {
                if (window.isDragging) {
                    this.draggingWindow = window;
                }
                if (window.isResizing) {
                    this.resizingWindow = window;
                }
            }
            return handled;
        } else {
            // Clicked outside any window - clear active window
            this.setActiveWindow(null);
        }
        return false;
    }
    
    handleMouseMove(x, y) {
        let handled = false;
        
        // Handle dragging window first (has priority)
        if (this.draggingWindow && this.draggingWindow.isDragging) {
            if (this.draggingWindow.handleMouseMove(x, y)) {
                handled = true;
            }
        }
        // Handle resizing window next
        else if (this.resizingWindow && this.resizingWindow.isResizing) {
            if (this.resizingWindow.handleMouseMove(x, y)) {
                handled = true;
            }
        }
        // Handle normal mouse move for all other windows
        else {
            for (const window of this.windows) {
                if (!window.isClosed && !window.isMinimized) {
                    if (window.handleMouseMove(x, y)) {
                        handled = true;
                    }
                }
            }
        }
        return handled;
    }
    
    handleMouseUp() {
        // Handle dragging window
        if (this.draggingWindow) {
            this.draggingWindow.handleMouseUp();
            this.draggingWindow = null;
        }
        
        // Handle resizing window  
        if (this.resizingWindow) {
            this.resizingWindow.handleMouseUp();
            this.resizingWindow = null;
        }
        
        // Handle mouse up for all other windows
        for (const window of this.windows) {
            if (!window.isClosed && !window.isMinimized) {
                window.handleMouseUp();
            }
        }
        
        // IMPORTANT: Do NOT clear active window here!
        // The active window should remain active until:
        // 1. A different window is clicked
        // 2. User clicks outside all windows  
        // 3. The window is closed
    }
    
    handleClick(x, y) {
        const window = this.getWindowAt(x, y);
        if (window) {
            return window.handleClick(x, y);
        }
        return false;
    }
    
    handleKeyDown(event) {
        if (this.activeWindow && !this.activeWindow.isClosed) {
            return this.activeWindow.handleKeyDown(event);
        }
        return false;
    }
    
    handleKeyUp(event) {
        if (this.activeWindow && !this.activeWindow.isClosed) {
            return this.activeWindow.handleKeyUp(event);
        }
        return false;
    }
    
    getWindowCount() {
        return this.windows.length;
    }
    
    getVisibleWindowCount() {
        return this.windows.filter(window => !window.isClosed && !window.isMinimized).length;
    }
}