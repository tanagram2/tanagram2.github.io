export class ZIndexManager {
    constructor() {
        this.elements = []; // Sorted by z-index
        this.nextZIndex = 0;
    }

    add(element, zIndex = null) {
        if (zIndex === null) {
            zIndex = this.nextZIndex++;
        }
        
        element.zIndex = zIndex;
        this.elements.push(element);
        this.sortElements();
    }

    remove(element) {
        const index = this.elements.indexOf(element);
        if (index > -1) {
            this.elements.splice(index, 1);
        }
    }

    bringToFront(element) {
        const newZIndex = this.nextZIndex++;
        element.zIndex = newZIndex;
        this.sortElements();
    }

    sendToBack(element) {
        element.zIndex = -1;
        this.sortElements();
    }

    sortElements() {
        this.elements.sort((a, b) => a.zIndex - b.zIndex);
    }

    getTopElementAt(x, y) {
        // Return the top-most element at coordinates (reverse for top-down search)
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const element = this.elements[i];
            if (element.containsPoint && element.containsPoint(x, y)) {
                return element;
            }
        }
        return null;
    }

    getAllElementsAt(x, y) {
        return this.elements.filter(element => 
            element.containsPoint && element.containsPoint(x, y)
        );
    }

    getElementsByZOrder() {
        return [...this.elements]; // Return sorted copy
    }
}