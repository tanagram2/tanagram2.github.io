// /js/system/context-menu.js
export class ContextMenu {
    constructor(eventDispatcher, contextManager, layerManager) {
        this.eventDispatcher = eventDispatcher;
        this.contextManager = contextManager;
        this.layerManager = layerManager;
        this.menuElement = null;
        this.isOpen = false;
        
        this.setupContextMenuListeners();
    }

    setupContextMenuListeners() {
        // Prevent browser context menu
        this.eventDispatcher.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.showContextMenu(event.x, event.y, event.targetElement);
        });

        // Close on click elsewhere
        this.eventDispatcher.addEventListener('click', (event) => {
            if (this.isOpen && (!this.menuElement || !this.menuElement.containsPoint(event.x, event.y))) {
                this.hideContextMenu();
            }
        });
    }

    showContextMenu(x, y, targetElement, menuItems = []) {
        this.hideContextMenu();
        
        // Create menu element
        this.menuElement = this.createMenuElement(x, y, menuItems);
        this.isOpen = true;
        
        // Register with context manager for auto-close behavior
        this.contextManager.registerContext('contextMenu', this.menuElement, {
            modal: false,
            clickOutsideToClose: true
        });
        
        // Set appropriate z-index
        this.menuElement.zIndex = this.layerManager.getZIndex('contextMenu');
        
        this.eventDispatcher.dispatchEvent(
            this.eventDispatcher.createEvent('contextmenushow', {
                x, y, targetElement, menuElement: this.menuElement
            })
        );
    }

    hideContextMenu() {
        if (!this.isOpen) return;
        
        this.contextManager.unregisterContext('contextMenu');
        this.menuElement = null;
        this.isOpen = false;
        
        this.eventDispatcher.dispatchEvent(
            this.eventDispatcher.createEvent('contextmenuhide', {})
        );
    }

    createMenuElement(x, y, menuItems) {
        const width = 150;
        const height = menuItems.length * 30;
        
        // Adjust position to keep menu on screen
        const adjustedX = Math.min(x, window.innerWidth - width - 10);
        const adjustedY = Math.min(y, window.innerHeight - height - 10);
        
        return {
            bounds: { x: adjustedX, y: adjustedY, width, height },
            containsPoint(px, py) {
                return CoordinateSystem.isPointInElement(px, py, this);
            },
            menuItems,
            draw(ctx) {
                // Draw menu background
                ctx.fillStyle = '#e0e0e0';
                ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
                
                // Draw border
                ctx.strokeStyle = '#757575';
                ctx.lineWidth = 1;
                ctx.strokeRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
                
                // Draw menu items
                this.menuItems.forEach((item, index) => {
                    const itemY = this.bounds.y + (index * 30);
                    
                    // Draw item background if hovered
                    if (item.isHovered) {
                        ctx.fillStyle = '#bdbdbd';
                        ctx.fillRect(this.bounds.x, itemY, this.bounds.width, 30);
                    }
                    
                    // Draw item text
                    ctx.fillStyle = '#333';
                    ctx.font = '0.9rem Courier New';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(item.label, this.bounds.x + 10, itemY + 15);
                    
                    // Draw separator if needed
                    if (item.separator) {
                        ctx.strokeStyle = '#757575';
                        ctx.beginPath();
                        ctx.moveTo(this.bounds.x, itemY + 29);
                        ctx.lineTo(this.bounds.x + this.bounds.width, itemY + 29);
                        ctx.stroke();
                    }
                });
            },
            handleMouseMove(px, py) {
                this.menuItems.forEach(item => {
                    item.isHovered = false;
                });
                
                const localY = py - this.bounds.y;
                const itemIndex = Math.floor(localY / 30);
                
                if (itemIndex >= 0 && itemIndex < this.menuItems.length) {
                    this.menuItems[itemIndex].isHovered = true;
                }
            },
            handleClick(px, py) {
                const localY = py - this.bounds.y;
                const itemIndex = Math.floor(localY / 30);
                
                if (itemIndex >= 0 && itemIndex < this.menuItems.length) {
                    const item = this.menuItems[itemIndex];
                    if (item.action && !item.separator) {
                        item.action();
                        this.contextManager.unregisterContext('contextMenu');
                    }
                }
                return true;
            }
        };
    }

    addMenuItem(label, action, options = {}) {
        // This would add to a default context menu
        // For now, just a stub for future expansion
    }
}
