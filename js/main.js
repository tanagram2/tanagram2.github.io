// /js/main.js
import * as System from './system/index.js';

class MartianOS {
    constructor() {
        // Initialize core systems
        this.eventDispatcher = new System.EventDispatcher();
        this.layerManager = new System.LayerManager();
        this.themeManager = new System.ThemeManager();
        this.contextManager = new System.ContextManager(this.eventDispatcher);
        this.inputManager = new System.InputManager(this.eventDispatcher);
        this.focusManager = new System.FocusManager(this.eventDispatcher, this.contextManager);
        this.selectionManager = new System.SelectionManager(this.eventDispatcher);
        this.dragDropManager = new System.DragDropManager(this.eventDispatcher, this.inputManager);
        this.notificationManager = new System.NotificationManager(this.eventDispatcher, this.layerManager);
        this.windowManager = new System.WindowManager(this.eventDispatcher, this.layerManager, this.contextManager);
        this.contextMenu = new System.ContextMenu(this.eventDispatcher, this.contextManager, this.layerManager);
        
        // Canvas setup
        this.canvas = document.getElementById('martian-canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // OS state
        this.currentScreen = 'matrix';
        this.showPowerMenu = false;
        this.showPowerSubmenu = false;
        this.uiElements = [];
        
        this.setupCanvas();
        this.setupEventListeners();
        this.setupTheme();
        this.animate();
        this.createUI();
    }

    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.createUI();
    }

    setupEventListeners() {
        // Convert DOM events to our event system
        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const event = this.eventDispatcher.createEvent('click', {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
                button: e.button
            });
            this.eventDispatcher.dispatchEvent(event);
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const event = this.eventDispatcher.createEvent('mousemove', {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            });
            this.eventDispatcher.dispatchEvent(event);
        });

        document.addEventListener('keydown', (e) => {
            const event = this.eventDispatcher.createEvent('keydown', {
                key: e.key,
                shiftKey: e.shiftKey,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                metaKey: e.metaKey
            });
            this.eventDispatcher.dispatchEvent(event);
        });

        document.addEventListener('keyup', (e) => {
            const event = this.eventDispatcher.createEvent('keyup', {
                key: e.key,
                shiftKey: e.shiftKey,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                metaKey: e.metaKey
            });
            this.eventDispatcher.dispatchEvent(event);
        });

        // Handle our custom events
        this.eventDispatcher.addEventListener('click', (e) => this.handleGlobalClick(e));
        this.eventDispatcher.addEventListener('mousemove', (e) => this.handleGlobalMouseMove(e));
    }

    setupTheme() {
        // Inject theme into all UI components
        this.themeManager.applyTheme();
    }

    handleGlobalClick(e) {
        // First, let the context manager handle modal/context behavior
        if (this.contextManager.handleGlobalClick) {
            this.contextManager.handleGlobalClick(e);
        }

        // Then handle our specific UI
        this.handleUIClick(e.x, e.y);
    }

    handleGlobalMouseMove(e) {
        // Update all UI elements with mouse position
        this.uiElements.forEach(element => {
            if (element.handleMouseMove) {
                element.handleMouseMove(e.x, e.y);
            }
        });
    }

    handleUIClick(x, y) {
        // Check if any UI element was clicked (in reverse z-order for top-most first)
        const elementsByZIndex = [...this.uiElements].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
        
        for (let element of elementsByZIndex) {
            if (element.handleClick && element.handleClick(x, y)) {
                this.focusManager.setFocus(element);
                return;
            }
        }

        // Handle power menu and desktop clicks
        if (this.currentScreen === 'desktop') {
            if (this.isInPowerButton(x, y)) {
                this.showPowerMenu = !this.showPowerMenu;
                this.showPowerSubmenu = false;
                this.createUI();
            } else if (this.showPowerMenu && !this.isInPowerMenuArea(x, y)) {
                this.showPowerMenu = false;
                this.showPowerSubmenu = false;
                this.createUI();
            }
        }
    }

    createUI() {
        this.uiElements = [];
        this.focusManager = new System.FocusManager(this.eventDispatcher, this.contextManager);
        
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        switch (this.currentScreen) {
            case 'matrix':
                this.createMatrixUI(centerX, centerY);
                break;
            case 'about':
                this.createAboutUI(centerX, centerY);
                break;
            case 'os':
                this.createOSUI(centerX, centerY);
                break;
            case 'desktop':
                this.createDesktopUI();
                break;
        }
    }

    createMatrixUI(centerX, centerY) {
        const aboutButton = new System.Button(
            centerX, centerY + 45, 200, 50, 'About Me',
            () => { this.currentScreen = 'about'; this.createUI(); },
            { theme: this.themeManager }
        );
        
        const enterButton = new System.Button(
            centerX, centerY + 115, 200, 50, 'ENTER',
            () => { this.currentScreen = 'os'; this.createUI(); },
            { theme: this.themeManager }
        );
        
        this.uiElements.push(aboutButton, enterButton);
        this.focusManager.registerElement(aboutButton);
        this.focusManager.registerElement(enterButton);
    }

    createAboutUI(centerX, centerY) {
        const backButton = new System.Button(
            centerX, centerY + 125, 200, 50, 'Back',
            () => { this.currentScreen = 'matrix'; this.createUI(); },
            { theme: this.themeManager }
        );
        
        this.uiElements.push(backButton);
        this.focusManager.registerElement(backButton);
    }

    createOSUI(centerX, centerY) {
        const startButton = new System.Button(
            centerX, centerY + 75, 200, 50, 'START',
            () => { this.currentScreen = 'desktop'; this.createUI(); },
            { 
                theme: this.themeManager,
                backgroundColor: this.themeManager.getColor('text.primary'),
                textColor: this.themeManager.getColor('background')
            }
        );
        
        this.uiElements.push(startButton);
        this.focusManager.registerElement(startButton);
    }

    createDesktopUI() {
        // Taskbar M button
        const powerButton = new System.TaskbarButton(
            10, 5, 40, 30, 'M',
            () => { 
                this.showPowerMenu = !this.showPowerMenu; 
                this.showPowerSubmenu = false;
                this.createUI(); 
            },
            { theme: this.themeManager }
        );
        this.uiElements.push(powerButton);
        this.focusManager.registerElement(powerButton);

        // Power menu
        if (this.showPowerMenu) {
            this.createPowerMenu();
        }

        // Test notification (remove this later)
        this.notificationManager.showNotification(
            'MartianOS', 
            'System initialized successfully!',
            { type: 'success', duration: 3000 }
        );
    }

    createPowerMenu() {
        const profileItem = new System.MenuItem(
            10, 40, 120, 25, 'Profile',
            () => { /* Placeholder */ },
            { theme: this.themeManager }
        );
        
        const settingsItem = new System.MenuItem(
            10, 65, 120, 25, 'Settings...',
            () => { /* Placeholder */ },
            { theme: this.themeManager }
        );
        
        const powerItem = new System.MenuItem(
            10, 90, 120, 25, 'Power',
            () => { this.showPowerSubmenu = !this.showPowerSubmenu; this.createUI(); },
            { theme: this.themeManager }
        );
        
        this.uiElements.push(profileItem, settingsItem, powerItem);
        this.focusManager.registerElement(profileItem);
        this.focusManager.registerElement(settingsItem);
        this.focusManager.registerElement(powerItem);

        // Register power menu with context manager for auto-close
        this.contextManager.registerContext('powerMenu', {
            bounds: { x: 10, y: 40, width: 120, height: 75 },
            containsPoint: (x, y) => this.isInPowerMenuArea(x, y)
        }, { clickOutsideToClose: true });

        // Power submenu
        if (this.showPowerSubmenu) {
            const restartItem = new System.MenuItem(
                130, 90, 100, 25, 'Restart',
                () => { 
                    this.currentScreen = 'os'; 
                    this.showPowerMenu = false;
                    this.showPowerSubmenu = false;
                    this.createUI(); 
                },
                { theme: this.themeManager }
            );
            
            const shutdownItem = new System.MenuItem(
                130, 115, 100, 25, 'Shut Down',
                () => { 
                    this.currentScreen = 'matrix'; 
                    this.showPowerMenu = false;
                    this.showPowerSubmenu = false;
                    this.createUI(); 
                },
                { theme: this.themeManager }
            );
            
            this.uiElements.push(restartItem, shutdownItem);
            this.focusManager.registerElement(restartItem);
            this.focusManager.registerElement(shutdownItem);
        }
    }

    animate(currentTime = 0) {
        requestAnimationFrame((time) => this.animate(time));
        this.render();
    }

    render() {
        // Clear canvas with theme background
        this.ctx.fillStyle = this.themeManager.getColor('background');
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Render current screen background
        switch (this.currentScreen) {
            case 'matrix':
                this.renderMatrixScreen();
                break;
            case 'about':
                this.renderAboutScreen();
                break;
            case 'os':
                this.renderOSScreen();
                break;
            case 'desktop':
                this.renderDesktopScreen();
                break;
        }

        // Render all UI elements
        this.uiElements.forEach(element => element.draw(this.ctx));
        
        // Render windows
        this.windowManager.getWindows().forEach(window => window.draw(this.ctx));
        
        // Render notifications
        this.notificationManager.getNotifications().forEach(notification => {
            notification.element.draw(this.ctx);
        });
    }

    renderMatrixScreen() {
        this.ctx.fillStyle = this.themeManager.getColor('primary');
        this.ctx.font = this.themeManager.getFont('heading');
        this.ctx.textAlign = 'center';
        this.ctx.fillText('MartianMatrix', this.canvas.width / 2, this.canvas.height / 2 - 50);
    }

    renderAboutScreen() {
        this.ctx.fillStyle = this.themeManager.getColor('primary');
        this.ctx.font = this.themeManager.getFont('heading');
        this.ctx.textAlign = 'center';
        this.ctx.fillText('About Me', this.canvas.width / 2, this.canvas.height / 2 - 80);

        this.ctx.font = this.themeManager.getFont('normal');
        this.ctx.fillText('This is placeholder text all about me (Mars).', this.canvas.width / 2, this.canvas.height / 2);
    }

    renderOSScreen() {
        this.ctx.fillStyle = this.themeManager.getColor('text.primary');
        this.ctx.font = this.themeManager.getFont('title');
        this.ctx.textAlign = 'center';
        this.ctx.fillText('MartianOS', this.canvas.width / 2, this.canvas.height / 2 - 50);
    }

    renderDesktopScreen() {
        // Desktop background
        this.ctx.fillStyle = this.themeManager.getColor('secondary');
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Taskbar
        this.ctx.fillStyle = this.themeManager.getColor('ui.taskbar');
        this.ctx.fillRect(0, 0, this.canvas.width, 40);

        // Clock
        this.ctx.fillStyle = this.themeManager.getColor('text.primary');
        this.ctx.font = this.themeManager.getFont('small');
        const now = new Date();
        const time = now.toLocaleTimeString();
        this.ctx.fillText(time, this.canvas.width - 100, 25);
    }

    isInPowerButton(x, y) {
        return x > 10 && x < 50 && y > 5 && y < 35;
    }

    isInPowerMenuArea(x, y) {
        if (!this.showPowerMenu) return false;
        
        // Main menu area
        if (x >= 10 && x <= 130 && y >= 40 && y <= 115) return true;
        
        // Submenu area if open
        if (this.showPowerSubmenu && x >= 130 && x <= 230 && y >= 90 && y <= 140) return true;
        
        return false;
    }
}

// Initialize MartianOS when page loads
document.addEventListener('DOMContentLoaded', () => {
    new MartianOS();
});
