import { OSEngine } from './system/engines/OSEngine.js';
import { Rect } from './system/primitives/Rect.js';
import { Circle } from './system/primitives/Circle.js';
import { Text } from './system/primitives/Text.js';
import { Line } from './system/primitives/Line.js';
import { Button } from './system/composites/ui/Button.js';

// DYNAMIC ASPECT RATIO SYSTEM
const SCREEN_ASPECT_RATIO = window.innerWidth / window.innerHeight;

// Helper function to create perfect circles for any screen
function getCircleRadii(radius) {
    return {
        radiusX: radius,
        radiusY: radius * SCREEN_ASPECT_RATIO
    };
}

console.log(`🖥️ Screen detected: ${window.innerWidth}x${window.innerHeight} (aspect ratio: ${SCREEN_ASPECT_RATIO.toFixed(3)})`);

// Demo 1: Primitive Showcase Window
const PrimitiveDemo = {
    init() {
        this.circleColor = '#339af0';
        this.rectColor = '#51cf66';
        
        // Interactive button to change colors
        this.colorToggleButton = new Button(
            0.1, 0.8, 0.3, 0.1, 'Toggle Colors',
            {
                shapeType: 'rect',
                backgroundColor: '#495057',
                hoverColor: '#343a40',
                pressedColor: '#212529',
                textColor: '#ffffff',
                radius: 6,
                font: '12px Arial'
            }
        );
        
        this.colorToggleButton.onClick = () => {
            this.circleColor = this.circleColor === '#339af0' ? '#ff6b6b' : '#339af0';
            this.rectColor = this.rectColor === '#51cf66' ? '#ffd43b' : '#51cf66';
        };
    },
    
    getPrimitives() {
        const primitives = [];
        
        // Title
        const title = new Text(0.5, 0.08, 'Primitive Showcase', '#2b2d42', 'bold 18px Arial');
        title.textAlign = 'center';
        primitives.push(title);
        
        // Description
        const desc = new Text(0.5, 0.15, 'All core primitives working together', '#6c757d', '12px Arial');
        desc.textAlign = 'center';
        primitives.push(desc);
        
        // FIXED: Dynamic circle with automatic aspect ratio compensation
        const circleRadii = getCircleRadii(0.06);
        const circle = new Circle(0.25, 0.35, circleRadii.radiusX, circleRadii.radiusY, this.circleColor);
        primitives.push(circle);
        const circleLabel = new Text(0.25, 0.48, 'Circle', '#495057', '14px Arial');
        circleLabel.textAlign = 'center';
        primitives.push(circleLabel);
        
        // Aspect ratio info
        const aspectInfo = new Text(0.25, 0.55, `Screen: ${SCREEN_ASPECT_RATIO.toFixed(2)}:1`, '#6c757d', '10px Arial');
        aspectInfo.textAlign = 'center';
        primitives.push(aspectInfo);
        
        // Rectangle primitive
        const rect = new Rect(0.55, 0.27, 0.15, 0.16, {
            color: this.rectColor,
            borderRadius: 12
        });
        primitives.push(rect);
        const rectLabel = new Text(0.625, 0.48, 'Rectangle', '#495057', '14px Arial');
        rectLabel.textAlign = 'center';
        primitives.push(rectLabel);
        
        // Line primitive
        const line = new Line(0.1, 0.6, 0.9, 0.6, '#6c757d', 3);
        primitives.push(line);
        const lineLabel = new Text(0.5, 0.65, 'Line', '#495057', '14px Arial');
        lineLabel.textAlign = 'center';
        primitives.push(lineLabel);
        
        // Add the button
        primitives.push(...this.colorToggleButton.getPrimitives());
        
        return primitives;
    },
    
    handleMouseMove(x, y) {
        let handled = false;
        if (this.colorToggleButton) {
            handled = this.colorToggleButton.handleMouseMove(x, y) || handled;
        }
        return handled;
    },
    
    handleMouseDown(x, y) {
        if (this.colorToggleButton && this.colorToggleButton.handleMouseDown(x, y)) {
            return true;
        }
        return false;
    },
    
    handleMouseUp() {
        if (this.colorToggleButton) this.colorToggleButton.handleMouseUp();
    },
    
    handleClick(x, y) {
        if (this.colorToggleButton && this.colorToggleButton.handleClick(x, y)) {
            return true;
        }
        return false;
    }
};

// Demo 2: Button Gallery Window - WITH DYNAMIC ASPECT RATIO
const ButtonGallery = {
    init() {
        this.buttonStates = {
            primary: 'default',
            success: 'default', 
            danger: 'default',
            circle: 'default'
        };
        
        // SCALE-OPTIMIZED: Centered grid layout
        this.primaryButton = new Button(
            0.1, 0.25, 0.35, 0.15, 'Primary',
            {
                shapeType: 'rect',
                backgroundColor: '#007bff',
                hoverColor: '#0056b3',
                pressedColor: '#004085',
                textColor: '#ffffff',
                radius: 8,
                font: '5% Arial'
            }
        );
        
        this.primaryButton.onClick = () => {
            this.buttonStates.primary = this.buttonStates.primary === 'default' ? 'clicked' : 'default';
        };
        
        this.successButton = new Button(
            0.55, 0.25, 0.35, 0.15, 'Success',
            {
                shapeType: 'rect',
                backgroundColor: '#28a745',
                hoverColor: '#1e7e34',
                pressedColor: '#155724',
                textColor: '#ffffff',
                radius: 8,
                font: '5% Arial'
            }
        );
        
        this.successButton.onClick = () => {
            this.buttonStates.success = this.buttonStates.success === 'default' ? 'clicked' : 'default';
        };
        
        this.dangerButton = new Button(
            0.1, 0.45, 0.35, 0.15, 'Danger',
            {
                shapeType: 'rect',
                backgroundColor: '#dc3545',
                hoverColor: '#c82333',
                pressedColor: '#bd2130',
                textColor: '#ffffff',
                radius: 8,
                font: '5% Arial'
            }
        );
        
        this.dangerButton.onClick = () => {
            this.buttonStates.danger = this.buttonStates.danger === 'default' ? 'clicked' : 'default';
        };
        
        // FIXED: Circle button with dynamic aspect ratio compensation
        const circleRadii = getCircleRadii(0.06);
        this.circleButton = new Button(
            0.725, 0.525, circleRadii.radiusX, circleRadii.radiusY, 'Circle',
            {
                shapeType: 'circle',
                backgroundColor: '#6f42c1',
                hoverColor: '#5a2d91',
                pressedColor: '#4a2175',
                textColor: '#ffffff',
                font: '4% Arial'
            }
        );
        
        this.circleButton.onClick = () => {
            this.buttonStates.circle = this.buttonStates.circle === 'default' ? 'clicked' : 'default';
        };
        
        this.disabledButton = new Button(
            0.1, 0.7, 0.8, 0.15, 'Disabled Button',
            {
                shapeType: 'rect',
                backgroundColor: '#6c757d',
                hoverColor: '#545b62',
                pressedColor: '#3d4348',
                textColor: '#ffffff',
                radius: 8,
                font: '5% Arial',
                enabled: false
            }
        );
    },
    
    getPrimitives() {
        const primitives = [];
        
        const title = new Text(0.5, 0.1, 'Scale Mode Gallery', '#2b2d42', '7% Arial');
        title.textAlign = 'center';
        primitives.push(title);
        
        const desc = new Text(0.5, 0.17, 'Designed for uniform scaling', '#6c757d', '4% Arial');
        desc.textAlign = 'center';
        primitives.push(desc);
        
        // Aspect ratio info
        const aspectInfo = new Text(0.5, 0.22, `Screen Ratio: ${SCREEN_ASPECT_RATIO.toFixed(2)}:1`, '#6c757d', '3% Arial');
        aspectInfo.textAlign = 'center';
        primitives.push(aspectInfo);
        
        const primaryStatus = new Text(0.275, 0.43, this.buttonStates.primary, 
                                     this.buttonStates.primary === 'default' ? '#6c757d' : '#007bff', '3.5% Arial');
        primaryStatus.textAlign = 'center';
        primitives.push(primaryStatus);
        
        const successStatus = new Text(0.725, 0.43, this.buttonStates.success, 
                                     this.buttonStates.success === 'default' ? '#6c757d' : '#28a745', '3.5% Arial');
        successStatus.textAlign = 'center';
        primitives.push(successStatus);
        
        const dangerStatus = new Text(0.275, 0.63, this.buttonStates.danger, 
                                    this.buttonStates.danger === 'default' ? '#6c757d' : '#dc3545', '3.5% Arial');
        dangerStatus.textAlign = 'center';
        primitives.push(dangerStatus);
        
        const circleStatus = new Text(0.725, 0.63, this.buttonStates.circle, 
                                    this.buttonStates.circle === 'default' ? '#6c757d' : '#6f42c1', '3.5% Arial');
        circleStatus.textAlign = 'center';
        primitives.push(circleStatus);
        
        primitives.push(...this.primaryButton.getPrimitives());
        primitives.push(...this.successButton.getPrimitives());
        primitives.push(...this.dangerButton.getPrimitives());
        primitives.push(...this.circleButton.getPrimitives());
        primitives.push(...this.disabledButton.getPrimitives());
        
        return primitives;
    },
    
    handleMouseMove(x, y) {
        let handled = false;
        const buttons = [this.primaryButton, this.successButton, this.dangerButton, this.circleButton, this.disabledButton];
        for (const button of buttons) {
            if (button) {
                handled = button.handleMouseMove(x, y) || handled;
            }
        }
        return handled;
    },
    
    handleMouseDown(x, y) {
        const buttons = [this.primaryButton, this.successButton, this.dangerButton, this.circleButton];
        for (const button of buttons) {
            if (button && button.handleMouseDown(x, y)) {
                return true;
            }
        }
        return false;
    },
    
    handleMouseUp() {
        const buttons = [this.primaryButton, this.successButton, this.dangerButton, this.circleButton, this.disabledButton];
        for (const button of buttons) {
            if (button) button.handleMouseUp();
        }
    },
    
    handleClick(x, y) {
        const buttons = [this.primaryButton, this.successButton, this.dangerButton, this.circleButton];
        for (const button of buttons) {
            if (button && button.handleClick(x, y)) {
                return true;
            }
        }
        return false;
    }
};

// Demo 3: Border Styles Window
const BorderStylesDemo = {
    getPrimitives() {
        const primitives = [];
        
        const title = new Text(0.5, 0.1, 'Border & Style Showcase', '#2b2d42', 'bold 18px Arial');
        title.textAlign = 'center';
        primitives.push(title);
        
        const desc = new Text(0.5, 0.16, 'Different window border and styling options', '#6c757d', '12px Arial');
        desc.textAlign = 'center';
        primitives.push(desc);
        
        const roundedRect = new Rect(0.1, 0.25, 0.35, 0.15, {
            color: '#e9ecef',
            borderRadius: .2,
            borderColor: '#007bff',
            borderWidth: 3,
            showBorder: true
        });
        primitives.push(roundedRect);
        const roundedLabel = new Text(0.275, 0.33, 'Rounded Border', '#007bff', '14px Arial');
        roundedLabel.textAlign = 'center';
        primitives.push(roundedLabel);
        
        const sharpRect = new Rect(0.55, 0.25, 0.35, 0.15, {
            color: '#e9ecef',
            borderColor: '#28a745',
            borderWidth: 2,
            showBorder: true
        });
        primitives.push(sharpRect);
        const sharpLabel = new Text(0.725, 0.33, 'Sharp Border', '#28a745', '14px Arial');
        sharpLabel.textAlign = 'center';
        primitives.push(sharpLabel);
        
        const thinBorder = new Rect(0.1, 0.5, 0.35, 0.1, {
            color: '#f8f9fa',
            borderColor: '#6c757d',
            borderWidth: 1,
            showBorder: true
        });
        primitives.push(thinBorder);
        const thinLabel = new Text(0.275, 0.57, 'Thin Border (1px)', '#6c757d', '12px Arial');
        thinLabel.textAlign = 'center';
        primitives.push(thinLabel);
        
        const thickBorder = new Rect(0.55, 0.5, 0.35, 0.1, {
            color: '#f8f9fa',
            borderColor: '#dc3545',
            borderWidth: 5,
            showBorder: true
        });
        primitives.push(thickBorder);
        const thickLabel = new Text(0.725, 0.57, 'Thick Border (5px)', '#dc3545', '12px Arial');
        thickLabel.textAlign = 'center';
        primitives.push(thickLabel);
        
        const info = new Text(0.5, 0.85, 'Try resizing, moving, and activating these windows!', '#495057', 'italic 12px Arial');
        info.textAlign = 'center';
        primitives.push(info);
        
        return primitives;
    }
};

// Demo 4: Minimal Borderless Window
const MinimalDemo = {
    getPrimitives() {
        const primitives = [];
        
        const title = new Text(0.5, 0.3, 'Borderless Window', '#2b2d42', 'bold 20px Arial');
        title.textAlign = 'center';
        primitives.push(title);
        
        const subtitle = new Text(0.5, 0.4, 'Clean and minimal design', '#6c757d', '14px Arial');
        subtitle.textAlign = 'center';
        primitives.push(subtitle);
        
        // FIXED: Decorative circles with dynamic aspect ratio compensation
        const circleRadii = getCircleRadii(0.05);
        const circle1 = new Circle(0.3, 0.65, circleRadii.radiusX, circleRadii.radiusY, '#e9ecef');
        primitives.push(circle1);
        
        const circle2 = new Circle(0.5, 0.65, circleRadii.radiusX, circleRadii.radiusY, '#dee2e6');
        primitives.push(circle2);
        
        const circle3 = new Circle(0.7, 0.65, circleRadii.radiusX, circleRadii.radiusY, '#ced4da');
        primitives.push(circle3);
        
        return primitives;
    }
};

// Initialize the OS
window.addEventListener('load', () => {
    console.log('🚀 MartianOS - Feature Showcase');
    console.log(`📐 Dynamic aspect ratio: ${SCREEN_ASPECT_RATIO.toFixed(3)} (${window.innerWidth}x${window.innerHeight})`);
    
    const os = new OSEngine('martian-canvas');
    
    PrimitiveDemo.init();
    ButtonGallery.init();
    
    console.log('📁 Creating showcase windows...');
    
    os.createWindow(0.05, 0.05, 0.4, 0.4, 'Primitive Showcase', PrimitiveDemo, {
        resizable: true,
        backgroundColor: '#ffffff',
        minRelWidth: 0.3,
        minRelHeight: 0.3,
        shape: 'rounded',
        borderRadius: 12,
        borderColor: '#dee2e6',
        borderWidth: 2,
        selectionBorderColor: '#4dabf7',
        selectionBorderWidth: 3,
        scalingMode: 'stretch'
    });
    
    os.createWindow(0.55, 0.05, 0.4, 0.4, 'Scale Mode Gallery', ButtonGallery, {
        resizable: true,
        backgroundColor: '#f8f9fa',
        minRelWidth: 0.3,
        minRelHeight: 0.3,
        shape: 'rounded',
        borderRadius: 12,
        borderColor: '#adb5bd',
        borderWidth: 1,
        selectionBorderColor: '#ff922b',
        selectionBorderWidth: 3,
        scalingMode: 'scale'
    });
    
    os.createWindow(0.05, 0.5, 0.4, 0.4, 'Border Styles', BorderStylesDemo, {
        resizable: true,
        backgroundColor: '#ffffff',
        minRelWidth: 0.35,
        minRelHeight: 0.3,
        shape: 'rounded',
        borderRadius: 16,
        borderColor: '#495057',
        borderWidth: 2,
        selectionBorderColor: '#40c057',
        selectionBorderWidth: 3,
        scalingMode: 'stretch'
    });
    
    os.createWindow(0.55, 0.5, 0.4, 0.4, 'Minimal Demo', MinimalDemo, {
        resizable: true,
        movable: true,
        borderless: true,
        showTitleBar: false,
        backgroundColor: '#ffffff',
        minRelWidth: 0.25,
        minRelHeight: 0.25,
        scalingMode: 'stretch'
    });
    
    os.start();
    
    console.log('✅ MartianOS Showcase Ready!');
    console.log('🎯 Dynamic aspect ratio system active!');
    console.log('💡 Circles will appear perfect on any screen size!');
});