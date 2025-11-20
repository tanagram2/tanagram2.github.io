// /js/system/window-manager.js
export class WindowManager {
    constructor(eventDispatcher, layerManager, contextManager) {
        this.eventDispatcher = eventDispatcher;
        this.layerManager = layerManager;
        this.contextManager = contextManager;
        this.windows = new Map();
        this.activeWindow = null;
        this.nextWindowId = 1;
        
        this.setupWindowListeners();
    }

    setupWindowListeners() {
        this.eventDispatcher.addEventListener('mousedown', (event) => {
            this.handleWindowFocus(event);
        });
    }

    createWindow(title, width, height, content) {
        const id = this.nextWindowId++;
        const x = 100 + (id * 20) % 400;
        const y = 100 + (id * 30) % 300;
        
        const window = {
            id,
            title,
            bounds: { x, y, width, height },
            content,
            isMinimized: false,
            isMaximized: false,
            isFocused: false,
            zIndex: this.layerManager.registerLayer(`window_${id}`, 'APPLICATION'),
            
            containsPoint(px, py) {
                return CoordinateSystem.isPointInElement(px, py, this);
            },
            
            handleMouseMove(px, py) {
                if (this.content && this.content.handleMouseMove) {
                    const local = CoordinateSystem.screenToLocal(px, py, this);
                    this.content.handleMouseMove(local.x, local.y);
                }
            },
            
            handleClick(px, py) {
                if (this.content && this.content.handleClick) {
                    const local = CoordinateSystem.screenToLocal(px, py, this);
                    return this.content.handleClick(local.x, local.y);
                }
                return false;
            },
            
            draw(ctx) {
                if (this.isMinimized) return;
                
                // Draw window chrome
                this.drawWindowChrome(ctx);
                
                // Draw content
                if (this.content && this.content.draw) {
                    ctx.save();
                    ctx.translate(this.bounds.x, this.bounds.y);
                    this.content.draw(ctx);
                    ctx.restore();
                }
            },
            
            drawWindowChrome(ctx) {
                const theme = window.themeManager?.getTheme() || { colors: { surface: '#fff', text: { primary: '#000' } } };
                
                // Draw window background
                ctx.fillStyle = this.isFocused ? theme.colors.surface : '#f0f0f0';
                ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
                
                // Draw title bar
                ctx.fillStyle = this.isFocused ? theme.colors.primary : '#ccc';
                ctx.fillRect(this.bounds.x, this.bounds.y, this.bounds.width, 30);
                
                // Draw title
                ctx.fillStyle = theme.colors.text.primary;
                ctx.font = '0.9rem Courier New';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.title, this.bounds.x + 10, this.bounds.y + 15);
                
                // Draw border
                ctx.strokeStyle = this.isFocused ? theme.colors.primary : '#999';
                ctx.lineWidth = 2;
                ctx.strokeRect(this.bounds.x, this.bounds.y, this.bounds.width, this.bounds.height);
                
                // Draw close button
                ctx.fillStyle = '#ff4444';
                ctx.fillRect(this.bounds.x + this.bounds.width - 25, this.bounds.y + 5, 20, 20);
                ctx.fillStyle = '#fff';
                ctx.font = '0.8rem Courier New';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('×', this.bounds.x + this.bounds.width - 15, this.bounds.y + 15);
            },
            
            minimize() {
                this.isMinimized = true;
                this.isFocused = false;
            },
            
            maximize() {
                this.isMaximized = !this.isMaximized;
                if (this.isMaximized) {
                    this.previousBounds = { ...this.bounds };
                    this.bounds = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight - 40 };
                } else {
                    this.bounds = this.previousBounds;
                }
            },
            
            close() {
                this.windowManager.closeWindow(this.id);
            },
            
            focus() {
                this.windowManager.setActiveWindow(this.id);
            },
            
            bringToFront() {
                this.layerManager.bringToFront(`window_${this.id}`);
                this.zIndex = this.layerManager.getZIndex(`window_${this.id}`);
            }
        };
        
        // Inject dependencies
        window.windowManager = this;
        
        this.windows.set(id, window);
        this.setActiveWindow(id);
        
        return id;
    }

    closeWindow(id) {
        const window = this.windows.get(id);
        if (window) {
            this.layerManager.unregisterLayer(`window_${id}`);
            this.windows.delete(id);
            
            if (this.activeWindow === id) {
                this.activeWindow = null;
            }
            
            this.eventDispatcher.dispatchEvent(
                this.eventDispatcher.createEvent('windowclosed', { windowId: id })
            );
        }
    }

    setActiveWindow(id) {
        if (this.activeWindow === id) return;
        
        // Defocus previous window
        if (this.activeWindow) {
            const prevWindow = this.windows.get(this.activeWindow);
            if (prevWindow) {
                prevWindow.isFocused = false;
            }
        }
        
        // Focus new window
        this.activeWindow = id;
        const window = this.windows.get(id);
        if (window) {
            window.isFocused = true;
            window.bringToFront();
        }
        
        this.eventDispatcher.dispatchEvent(
            this.eventDispatcher.createEvent('windowfocused', { windowId: id })
        );
    }

    handleWindowFocus(event) {
        const windowsAtPoint = CoordinateSystem.getElementAtPoint(event.x, event.y, Array.from(this.windows.values()));
        const topWindow = windowsAtPoint[0];
        
        if (topWindow && topWindow.id !== this.activeWindow) {
            this.setActiveWindow(topWindow.id);
        }
    }

    getWindows() {
        return Array.from(this.windows.values());
    }

    getActiveWindow() {
        return this.windows.get(this.activeWindow);
    }

    minimizeAll() {
        this.windows.forEach(window => {
            window.minimize();
        });
        this.activeWindow = null;
    }
}
