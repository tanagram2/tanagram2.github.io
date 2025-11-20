// /js/main.js
import { Button, TaskbarButton, MenuItem } from './system/index.js';

class MartianOS {
    constructor() {
        console.log('MartianOS: Starting...');
        
        this.canvas = document.getElementById('martian-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentScreen = 'matrix';
        this.showPowerMenu = false;
        this.showPowerSubmenu = false;
        this.buttons = [];
        this.menuItems = []; // Separate menu items from buttons
        this.mouseX = 0;
        this.mouseY = 0;
        
        this.setupCanvas();
        this.setupEventListeners();
        this.animate();
        this.createUI();
        
        console.log('MartianOS: Ready!');
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
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
        
        // Update hover states
        this.buttons.forEach(button => button.handleMouseMove(this.mouseX, this.mouseY));
        this.menuItems.forEach(item => item.handleMouseMove(this.mouseX, this.mouseY));
    }

    handleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        console.log(`Click at: ${x}, ${y}`);

        // Check menu items first (they're on top)
        for (let item of this.menuItems) {
            if (item.handleClick(x, y)) {
                console.log('Menu item handled click');
                return;
            }
        }

        // Check regular buttons
        for (let button of this.buttons) {
            if (button.handleClick(x, y)) {
                console.log('Button handled click');
                return;
            }
        }

        // Handle desktop clicks (outside menus)
        if (this.currentScreen === 'desktop') {
            if (this.isInPowerButton(x, y)) {
                console.log('Power button clicked');
                this.showPowerMenu = !this.showPowerMenu;
                this.showPowerSubmenu = false;
                this.createUI();
            } else if (this.showPowerMenu && !this.isInPowerMenuArea(x, y)) {
                console.log('Click outside menu - closing');
                this.showPowerMenu = false;
                this.showPowerSubmenu = false;
                this.createUI();
            }
        }
    }

    createUI() {
        console.log(`Creating UI for screen: ${this.currentScreen}`);
        this.buttons = [];
        this.menuItems = [];
        
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
        
        console.log(`Created ${this.buttons.length} buttons and ${this.menuItems.length} menu items`);
    }

    createMatrixUI(centerX, centerY) {
        const aboutButton = new Button(
            centerX, centerY + 45, 200, 50, 'About Me',
            () => { 
                console.log('About Me clicked');
                this.currentScreen = 'about'; 
                this.createUI(); 
            }
        );
        
        const enterButton = new Button(
            centerX, centerY + 115, 200, 50, 'ENTER',
            () => { 
                console.log('ENTER clicked');
                this.currentScreen = 'os'; 
                this.createUI(); 
            }
        );
        
        this.buttons.push(aboutButton, enterButton);
    }

    createAboutUI(centerX, centerY) {
        const backButton = new Button(
            centerX, centerY + 125, 200, 50, 'Back',
            () => { 
                console.log('Back clicked');
                this.currentScreen = 'matrix'; 
                this.createUI(); 
            }
        );
        
        this.buttons.push(backButton);
    }

    createOSUI(centerX, centerY) {
        const startButton = new Button(
            centerX, centerY + 75, 200, 50, 'START',
            () => { 
                console.log('START clicked');
                this.currentScreen = 'desktop'; 
                this.createUI(); 
            },
            { backgroundColor: '#000', textColor: '#fff' }
        );
        
        this.buttons.push(startButton);
    }

    createDesktopUI() {
        console.log('Creating desktop UI');
        
        // Taskbar M button - use TaskbarButton which should have proper styling
        const powerButton = new TaskbarButton(
            10, 5, 40, 30, 'M',
            () => { 
                console.log('M button clicked');
                this.showPowerMenu = !this.showPowerMenu; 
                this.showPowerSubmenu = false;
                this.createUI(); 
            }
        );
        this.buttons.push(powerButton);

        // Power menu items (only when menu is open)
        if (this.showPowerMenu) {
            console.log('Creating power menu');
            
            const profileItem = new MenuItem(
                10, 40, 120, 25, 'Profile',
                () => { console.log('Profile clicked'); }
            );
            
            const settingsItem = new MenuItem(
                10, 65, 120, 25, 'Settings...',
                () => { console.log('Settings clicked'); }
            );
            
            const powerItem = new MenuItem(
                10, 90, 120, 25, 'Power',
                () => { 
                    console.log('Power clicked - toggling submenu');
                    this.showPowerSubmenu = !this.showPowerSubmenu; 
                    this.createUI(); 
                }
            );
            
            this.menuItems.push(profileItem, settingsItem, powerItem);

            // Power submenu items
            if (this.showPowerSubmenu) {
                console.log('Creating power submenu');
                
                const restartItem = new MenuItem(
                    130, 90, 100, 25, 'Restart',
                    () => { 
                        console.log('Restart clicked');
                        this.currentScreen = 'os'; 
                        this.showPowerMenu = false;
                        this.showPowerSubmenu = false;
                        this.createUI(); 
                    }
                );
                
                const shutdownItem = new MenuItem(
                    130, 115, 100, 25, 'Shut Down',
                    () => { 
                        console.log('Shutdown clicked');
                        this.currentScreen = 'matrix'; 
                        this.showPowerMenu = false;
                        this.showPowerSubmenu = false;
                        this.createUI(); 
                    }
                );
                
                this.menuItems.push(restartItem, shutdownItem);
            }
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
        this.buttons.forEach(button => {
            if (button.draw) {
                button.draw(this.ctx);
            }
        });
        
        this.menuItems.forEach(item => {
            if (item.draw) {
                item.draw(this.ctx);
            }
        });
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

        // Taskbar (gray bar at top)
        this.ctx.fillStyle = '#9e9e9e';
        this.ctx.fillRect(0, 0, this.canvas.width, 40);

        // Clock
        this.ctx.fillStyle = '#000';
        this.ctx.font = '0.9rem Courier New';
        const now = new Date();
        const time = now.toLocaleTimeString();
        this.ctx.fillText(time, this.canvas.width - 100, 25);

        // Power menu background (if open)
        if (this.showPowerMenu) {
            this.ctx.fillStyle = '#e0e0e0';
            this.ctx.fillRect(10, 40, 130, 80);
            
            // Power submenu background (if open)
            if (this.showPowerSubmenu) {
                this.ctx.fillStyle = '#e0e0e0';
                this.ctx.fillRect(130, 90, 100, 50);
            }
        }
    }

    isInPowerButton(x, y) {
        return x > 10 && x < 50 && y > 5 && y < 35;
    }

    isInPowerMenuArea(x, y) {
        if (!this.showPowerMenu) return false;
        
        // Main menu area
        if (x >= 10 && x <= 140 && y >= 40 && y <= 120) return true;
        
        // Submenu area if open
        if (this.showPowerSubmenu && x >= 130 && x <= 230 && y >= 90 && y <= 140) return true;
        
        return false;
    }
}

// Initialize MartianOS when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded - starting MartianOS');
    new MartianOS();
});
