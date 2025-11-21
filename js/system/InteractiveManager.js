export class InteractiveManager {
    constructor(eventManager, zIndexManager) {
        this.eventManager = eventManager;
        this.zIndexManager = zIndexManager;
        this.hoveredElement = null;
        this.setupEventHandling();
    }

    register(element) {
        this.zIndexManager.add(element);
    }

    unregister(element) {
        this.zIndexManager.remove(element);
        if (this.hoveredElement === element) {
            this.hoveredElement = null;
        }
    }

    setupEventHandling() {
        // Handle hover
        this.eventManager.on('mousemove', (pos) => {
            const newHovered = this.zIndexManager.getTopElementAt(pos.x, pos.y);
            
            // Update hover states
            if (this.hoveredElement && this.hoveredElement !== newHovered) {
                this.hoveredElement.isHovered = false;
                if (this.hoveredElement.onMouseLeave) {
                    this.hoveredElement.onMouseLeave();
                }
            }
            
            if (newHovered && newHovered !== this.hoveredElement) {
                newHovered.isHovered = true;
                if (newHovered.onMouseEnter) {
                    newHovered.onMouseEnter();
                }
            }
            
            this.hoveredElement = newHovered;
        });

        // Handle clicks
        this.eventManager.on('click', (pos) => {
            const topElement = this.zIndexManager.getTopElementAt(pos.x, pos.y);
            if (topElement) {
                if (topElement.handleClick) {
                    topElement.handleClick(pos.x, pos.y);
                }
                // Bring to front on click
                this.zIndexManager.bringToFront(topElement);
            }
        });

        // Handle mousedown for potential drag operations
        this.eventManager.on('mousedown', (pos) => {
            const topElement = this.zIndexManager.getTopElementAt(pos.x, pos.y);
            if (topElement && topElement.handleMouseDown) {
                topElement.handleMouseDown(pos.x, pos.y);
            }
        });

        this.eventManager.on('mouseup', (pos) => {
            const topElement = this.zIndexManager.getTopElementAt(pos.x, pos.y);
            if (topElement && topElement.handleMouseUp) {
                topElement.handleMouseUp(pos.x, pos.y);
            }
        });
    }
}