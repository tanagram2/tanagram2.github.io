// /js/main.js
import { Button } from './system/button.js';
import { TaskbarButton } from './system/taskbar-button.js';
import { MenuItem } from './system/menu-item.js';
import { FocusManager } from './system/focus-manager.js';

class MartianOS {
    constructor() {
        this.canvas = document.getElementById('martian-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentScreen = 'matrix';
        this.showPowerMenu = false;
        this.lastTime = 0;
        this.buttons = [];
        this.menuItems = [];
        this.mouseX = 0;
        this.mouseY = 0;
        this.focusManager = new FocusManager();
        
        this.setupCanvas();
        this.setupEventListeners();
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
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    handleKeyDown(e) {
        // Tab key navigation
        if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
                this.focusManager.previousFocus();
            } else {
                this.focusManager.nextFocus();
            }
        }
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
        
        // Update hover states for all interactive elements
        this.buttons.forEach(button => button.handleMouseMove(this.mouseX, this.mouseY));
        this.menuItems.forEach(item => item.handleMouseMove(this.mouseX, this.mouseY));
    }

    handleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check menu items first (they're on top)
        for (let item of this.menuItems) {
            if (item.handleClick(x, y)) {
                return;
            }
        }

        // Check regular buttons
        for (let button of this.buttons) {
            if (button.handleClick(x, y)) {
                this.focusManager.setFocus(button);
                return;
            }
        }

        // Handle power menu and other direct canvas clicks
        if (this.currentScreen === 'desktop') {
            if (this.isInPowerButton(x, y)) {
                this.showPowerMenu = !this.showPowerMenu;
                this.createUI();
            } else if (this.showPowerMenu) {
                // Click outside menu closes it
                this.showPowerMenu = false;
                this.createUI();
            }
        }
    }

    createUI() {
        this.buttons = [];
        this.menuItems = [];
        this.focusManager = new FocusManager();
        
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
        const aboutButton = new Button(
            centerX, centerY + 45, 200, 50, 'About Me',
            () => { this.currentScreen = 'about'; this.createUI(); }
        );
        
        const enterButton = new Button(
            centerX, centerY + 115, 200, 50, 'ENTER',
            () => { this.currentScreen = 'os'; this.createUI(); }
        );
        
        this.buttons.push(aboutButton, enterButton);
        this.focusManager.registerElement(aboutButton);
        this.focusManager.registerElement(enterButton);
    }

    createAboutUI(centerX, centerY) {
        const backButton = new Button(
            centerX, centerY + 125, 200, 50, 'Back',
            () => { this.currentScreen = 'matrix'; this.createUI(); }
        );
        
        this.buttons.push(backButton);
        this.focusManager.registerElement(backButton);
    }

    createOSUI(centerX, centerY) {
        const startButton = new Button(
            centerX, centerY + 75, 200, 50, 'START',
            () => { this.currentScreen = 'desktop'; this.createUI(); },
            { backgroundColor: '#000', textColor: '#fff' }
        );
        
        this.buttons.push(startButton);
        this.focusManager.registerElement(startButton);
    }

    createDesktopUI() {
        // Taskbar M button
        const powerButton = new TaskbarButton(
            10, 5, 40, 30, 'M',
            () => { this.showPowerMenu = !this.showPowerMenu; this.createUI(); }
        );
        this.buttons.push(powerButton);
        this.focusManager.registerElement(powerButton);

        // Power menu items (only visible when menu is open)
        if (this.showPowerMenu) {
            const restartItem = new MenuItem(
                20, 45, 100, 25, 'Restart',
                () => { 
                    this.currentScreen = 'os'; 
                    this.showPowerMenu = false; 
                    this.createUI(); 
                }
            );
            
            const shutdownItem = new MenuItem(
                20, 75, 100, 25, 'Shut Down',
                () => { 
                    this.currentScreen = 'matrix'; 
                    this.showPowerMenu = false; 
                    this.createUI(); 
                }
            );
            
            this.menuItems.push(restartItem, shutdownItem);
            this.focusManager.registerElement(restartItem);
            this.focusManager.registerElement(shutdownItem);
        }
    }

    animate(currentTime = 0) {
        requestAnimationFrame((time) => this.animate(time));
        this.render();
    }

    render() {
        // Clear canvas
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Render current screen
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
        this.buttons.forEach(button => button.draw(this.ctx));
        this.menuItems.forEach(item => item.draw(this.ctx));
    }

    renderMatrixScreen() {
        this.ctx.fillStyle = '#0f0';
        this.ctx.font = '2.5rem Courier New';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('MartianMatrix', this.canvas.width / 2, this.canvas.height / 2 - 50);
    }

    renderAboutScreen() {
        this.ctx.fillStyle = '#0f0';
        this.ctx.font = '2.5rem Courier New';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('About Me', this.canvas.width / 2, this.canvas.height / 2 - 80);

        this.ctx.font = '1rem Courier New';
        this.ctx.fillText('This is placeholder text all about me (Mars).', this.canvas.width / 2, this.canvas.height / 2);
    }

    renderOSScreen() {
        this.ctx.fillStyle = '#fff';
        this.ctx.font = '3rem Courier New';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('MartianOS', this.canvas.width / 2, this.canvas.height / 2 - 50);
    }

    renderDesktopScreen() {
        // Blue desktop background
        this.ctx.fillStyle = '#1a237e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Taskbar
        this.ctx.fillStyle = '#9e9e9e';
        this.ctx.fillRect(0, 0, this.canvas.width, 40);

        // Clock (updates in real-time thanks to animation loop)
        this.ctx.fillStyle = '#000';
        this.ctx.font = '0.9rem Courier New';
        const now = new Date();
        const time = now.toLocaleTimeString();
        this.ctx.fillText(time, this.canvas.width - 100, 25);

        // Power menu background (if open)
        if (this.showPowerMenu) {
            this.ctx.fillStyle = '#e0e0e0';
            this.ctx.fillRect(20, 40, 100, 70);
        }
    }

    isInPowerButton(x, y) {
        return x > 10 && x < 50 && y > 5 && y < 35;
    }
}

// Initialize MartianOS when page loads
document.addEventListener('DOMContentLoaded', () => {
    new MartianOS();
});
