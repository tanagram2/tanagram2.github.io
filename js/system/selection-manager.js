// /js/system/selection-manager.js
export class SelectionManager {
    constructor(eventDispatcher) {
        this.eventDispatcher = eventDispatcher;
        this.selectedElements = new Set();
        this.selectionAnchor = null;
        this.isSelecting = false;
        
        this.setupSelectionListeners();
    }

    setupSelectionListeners() {
        this.eventDispatcher.addEventListener('mousedown', (event) => {
            // Clear selection on click (unless modifier key is pressed)
            if (!event.ctrlKey && !event.shiftKey && !event.metaKey) {
                this.clearSelection();
            }
        });

        // Prevent browser's default text selection behavior
        this.eventDispatcher.addEventListener('selectstart', (event) => {
            event.preventDefault();
        }, { capture: true });
    }

    selectElement(element, addToSelection = false) {
        if (!addToSelection) {
            this.clearSelection();
        }
        
        element.isSelected = true;
        this.selectedElements.add(element);
        
        this.eventDispatcher.dispatchEvent(
            this.eventDispatcher.createEvent('selectionchanged', {
                selectedElements: Array.from(this.selectedElements)
            })
        );
    }

    deselectElement(element) {
        element.isSelected = false;
        this.selectedElements.delete(element);
        
        this.eventDispatcher.dispatchEvent(
            this.eventDispatcher.createEvent('selectionchanged', {
                selectedElements: Array.from(this.selectedElements)
            })
        );
    }

    clearSelection() {
        this.selectedElements.forEach(element => {
            element.isSelected = false;
        });
        this.selectedElements.clear();
        
        this.eventDispatcher.dispatchEvent(
            this.eventDispatcher.createEvent('selectionchanged', {
                selectedElements: []
            })
        );
    }

    getSelectedElements() {
        return Array.from(this.selectedElements);
    }

    hasSelection() {
        return this.selectedElements.size > 0;
    }

    startRangeSelection(anchorElement) {
        this.selectionAnchor = anchorElement;
        this.isSelecting = true;
        this.clearSelection();
        this.selectElement(anchorElement, true);
    }

    updateRangeSelection(targetElement) {
        if (!this.selectionAnchor || !this.isSelecting) return;
        
        // This would implement proper range selection logic
        // For now, just select the target element
        this.clearSelection();
        this.selectElement(this.selectionAnchor, true);
        this.selectElement(targetElement, true);
    }

    endRangeSelection() {
        this.isSelecting = false;
        this.selectionAnchor = null;
    }
}
