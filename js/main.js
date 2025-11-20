// /js/main.js - EXPLICIT IMPORTS
import { InteractiveElement } from './system/interactive-element.js';
import { Highlightable } from './system/highlightable.js';
import { Button } from './system/button.js';
import { TaskbarButton } from './system/taskbar-button.js';
import { MenuItem } from './system/menu-item.js';

class MartianOS {
    constructor() {
        this.canvas = document.getElementById('martian-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.currentScreen = 'matrix';
        this.showPowerMenu = false;
        this.showPowerSubmenu = false;
        this.buttons = [];
        this.menuItems = [];
        this.mouseX = 0;
        this.mouseY = 0;
        
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
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseX = e.clientX - rect.left;
        this.mouseY = e.clientY - rect.top;
        
        this.buttons.forEach(button => button.handleMouseMove(this.mouseX, this.mouseY));
        this.menuItems.forEach(item => item.handleMouseMove(this.mouseX, this.mouseY));
    }

    handleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        for (let item of this.menuItems) {
            if (item.handleClick(x, y)) {
                return;
            }
        }

        for (let button of this.buttons) {
            if (button.handleClick(x, y)) {
                return;
            }
        }

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
    }

    createAboutUI(centerX, centerY) {
        const backButton = new Button(
            centerX, centerY + 125, 200, 50, 'Back',
            () => { this.currentScreen = 'matrix'; this.createUI(); }
        );
        
        this.buttons.push(backButton);
    }

    createOSUI(centerX, centerY) {
        const startButton = new Button(
            centerX, centerY + 75, 200, 50, 'START',
            () => { this.currentScreen = 'desktop'; this.createUI(); },
            { backgroundColor: '#000', textColor: '#fff' }
        );
        
        this.buttons.push(startButton);
    }

    createDesktopUI() {
        const powerButton = new TaskbarButton(
            10, 5, 40, 30, 'M',
            () => { 
                this.showPowerMenu = !this.showPowerMenu; 
                this.showPowerSubmenu = false;
                this.createUI(); 
            }
        );
        this.buttons.push(powerButton);

        if (this.showPowerMenu) {
            const profileItem = new MenuItem(
                10, 40, 120, 25, 'Profile',
                () => { }
            );
            
            const settingsItem = new MenuItem(
                10, 65, 120, 25, 'Settings...',
                () => { }
            );
            
            const powerItem = new MenuItem(
                10, 90, 120, 25, 'Power',
                () => { 
                    this.showPowerSubmenu = !this.showPowerSubmenu; 
                    this.createUI(); 
                }
            );
            
            this.menuItems.push(profileItem, settingsItem, powerItem);

            if (this.showPowerSubmenu) {
                const restartItem = new MenuItem(
                    130, 90, 100, 25, 'Restart',
                    () => { 
                        this.currentScreen = 'os'; 
                        this.showPowerMenu = false;
                        this.showPowerSubmenu = false;
                        this.createUI(); 
                    }
                );
                
                const shutdownItem = new MenuItem(
                    130, 115, 100, 25, 'Shut Down',
                    () => { 
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
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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
        this.ctx.fillStyle = '#1a237e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.fillStyle = '#9e9e9e';
        this.ctx.fillRect(0, 0, this.canvas.width, 40);

        this.ctx.fillStyle = '#000';
        this.ctx.font = '0.9rem Courier New';
        const now = new Date();
        const time = now.toLocaleTimeString();
        this.ctx.fillText(time, this.canvas.width - 100, 25);

        if (this.showPowerMenu) {
            this.ctx.fillStyle = '#e0e0e0';
            this.ctx.fillRect(10, 40, 130, 80);
            
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
        
        if (x >= 10 && x <= 140 && y >= 40 && y <= 120) return true;
        
        if (this.showPowerSubmenu && x >= 130 && x <= 230 && y >= 90 && y <= 140) return true;
        
        return false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new MartianOS();
});
