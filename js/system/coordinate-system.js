// /js/system/coordinate-system.js
export class CoordinateSystem {
    static screenToLocal(screenX, screenY, element) {
        if (!element || !element.bounds) return { x: screenX, y: screenY };
        
        return {
            x: screenX - element.bounds.x,
            y: screenY - element.bounds.y
        };
    }

    static localToScreen(localX, localY, element) {
        if (!element || !element.bounds) return { x: localX, y: localY };
        
        return {
            x: localX + element.bounds.x,
            y: localY + element.bounds.y
        };
    }

    static transformPoint(x, y, transform) {
        if (!transform) return { x, y };
        
        // Handle CSS-style transforms: translate, rotate, scale
        let transformedX = x;
        let transformedY = y;
        
        if (transform.translate) {
            transformedX += transform.translate.x;
            transformedY += transform.translate.y;
        }
        
        if (transform.scale) {
            transformedX *= transform.scale.x;
            transformedY *= transform.scale.y;
        }
        
        if (transform.rotate) {
            const rad = transform.rotate * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const newX = transformedX * cos - transformedY * sin;
            const newY = transformedX * sin + transformedY * cos;
            transformedX = newX;
            transformedY = newY;
        }
        
        return { x: transformedX, y: transformedY };
    }

    static getElementCenter(element) {
        if (!element.bounds) return { x: 0, y: 0 };
        
        return {
            x: element.bounds.x + element.bounds.width / 2,
            y: element.bounds.y + element.bounds.height / 2
        };
    }

    static isPointInElement(x, y, element) {
        if (!element.bounds) return false;
        
        return x >= element.bounds.x &&
               x <= element.bounds.x + element.bounds.width &&
               y >= element.bounds.y &&
               y <= element.bounds.y + element.bounds.height;
    }

    static getElementAtPoint(x, y, elements) {
        // Return elements sorted by z-index (top first)
        return elements
            .filter(el => this.isPointInElement(x, y, el))
            .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
    }
}
