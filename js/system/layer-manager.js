// /js/system/layer-manager.js
export class LayerManager {
    constructor() {
        this.layers = new Map();
        this.nextZIndex = 1000;
        this.baseLayers = {
            DESKTOP: 100,
            APPLICATION: 200,
            SYSTEM: 300,
            MODAL: 400,
            TOOLTIP: 500
        };
    }

    registerLayer(name, baseLayer = 'APPLICATION') {
        const zIndex = this.baseLayers[baseLayer] + (this.nextZIndex++);
        this.layers.set(name, { zIndex, baseLayer });
        return zIndex;
    }

    unregisterLayer(name) {
        this.layers.delete(name);
    }

    bringToFront(name) {
        const layer = this.layers.get(name);
        if (layer) {
            layer.zIndex = this.baseLayers[layer.baseLayer] + (this.nextZIndex++);
        }
    }

    getZIndex(name) {
        const layer = this.layers.get(name);
        return layer ? layer.zIndex : this.baseLayers.APPLICATION;
    }

    getTopMostLayerAt(x, y, elements) {
        // Find the top-most visible element at coordinates
        const elementsAtPoint = elements.filter(el => 
            el.isVisible && el.containsPoint(x, y)
        ).sort((a, b) => b.zIndex - a.zIndex);
        
        return elementsAtPoint[0] || null;
    }
}
