export class RenderEngine {
    constructor(ctx) {
        this.ctx = ctx;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.lastRenderTime = 0;
        this.renderThrottle = 33;
        this.isResizing = false;
    }
    
    setCanvasSize(width, height) {
        this.canvasWidth = width;
        this.canvasHeight = height;
    }
    
    startResize() {
        this.isResizing = true;
        this.renderThrottle = 33;
    }
    
    endResize() {
        this.isResizing = false;
        this.renderThrottle = 16;
        this.lastRenderTime = 0;
    }
    
    // TRUE SINGLE PASS RENDER with clipping support
    render(renderStack) {
        // Throttle rendering
        const now = Date.now();
        if (this.isResizing && now - this.lastRenderTime < this.renderThrottle) {
            return;
        }
        this.lastRenderTime = now;
        
        // Sort all primitives by z-index
        const sortedPrimitives = [...renderStack].sort((a, b) => a.zIndex - b.zIndex);
        
        console.log(`🎨 Rendering ${sortedPrimitives.length} primitives with clipping`);
        
        // Track current window for clipping
        let currentWindow = null;
        
        // SINGLE PASS: Iterate through all primitives
        for (const renderItem of sortedPrimitives) {
            if (renderItem.primitive && renderItem.primitive.draw) {
                
                // NEW: Handle window clipping
                if (renderItem.window && renderItem.window !== currentWindow) {
                    // If we were clipping a previous window, restore context
                    if (currentWindow) {
                        this.ctx.restore();
                    }
                    // Start clipping for new window
                    currentWindow = renderItem.window;
                    currentWindow.setClipRegion(this.ctx);
                }
                // If no window association, ensure we're not clipping
                else if (!renderItem.window && currentWindow) {
                    this.ctx.restore();
                    currentWindow = null;
                }
                
                // Draw the primitive (automatically clipped if window is set)
                renderItem.primitive.draw(this.ctx);
            }
        }
        
        // NEW: Restore context if we ended with a clipped window
        if (currentWindow) {
            this.ctx.restore();
        }
    }
}