import { rangeToSelection, enableTouch, getExactOverlaps } from './SelectionUtils';
import EventEmitter from 'tiny-emitter';

const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

const IS_INTERNET_EXPLORER =
  navigator?.userAgent.match(/(MSIE|Trident)/);

/** Tests whether maybeChildEl is contained in containerEl **/
const contains = (containerEl, maybeChildEl) => {
  if (IS_INTERNET_EXPLORER) {
    // In IE, .contains returns false for text nodes
    // https://stackoverflow.com/questions/44140712/ie-acting-strange-with-node-contains-and-text-nodes
    if (maybeChildEl.nodeType == Node.TEXT_NODE)
      return containerEl === maybeChildEl.parentNode || containerEl.contains(maybeChildEl.parentNode);
    else
      return containerEl.contains(maybeChildEl);
  } else {
    // Things can be so simple, unless you're in IE
    return containerEl.contains(maybeChildEl);
  }
};

// Function to clear selection for all browsers
const clearBrowserSelection = (document, emitFn) => {
  const selection = document.getSelection();

  if (selection) {
    try {
      const range = document.createRange();
      range.setStart(document.body, 0);
      range.collapse(true);

      selection.removeAllRanges();
      selection.addRange(range);
      selection.removeAllRanges(); // Clear the added range

      // Emit deselect event
      if (typeof emitFn === 'function') {
        emitFn();
      }
    } catch (error) {
      console.warn('Failed to clear selection:', error);
    }
  }
};

export default class SelectionHandler extends EventEmitter {

  constructor(element, highlighter, readOnly, extraEl = null) {
    super();

    this.el = element;
    this.highlighter = highlighter;
    this.readOnly = readOnly;
    this.extraEl = extraEl;

    this.isEnabled = true;

    this.document = element.ownerDocument;

    element.addEventListener('mousedown', this._onMouseDown);
    element.addEventListener('mouseup', this._onMouseUp);

    // Add event listener for clicks outside the content element
    this.document.addEventListener('mousedown', this._onDocumentMouseDown);

    if (IS_TOUCH) {
      enableTouch(
        element,
        this._onMouseUp,
        () => this.removeSelectionSpans(this.document),
        (selection) => {  // End callback receives the real selection
          const selectedRange = selection.getRangeAt(0); // Get the real selected range
          // Convert the range to the appropriate format for emitting
          const stub = rangeToSelection(selectedRange, this.el);
          this.emit('select', {
            selection: stub, // Pass the real selection here
            element: selectedRange // Optionally pass more info about the element or range
          });
          clearBrowserSelection(this.document, () => {}); // Clear the selection afterward
        }
      );
    }
  }

  get enabled() {
    return this.isEnabled;
  }

  set enabled(enabled) {
    this.isEnabled = enabled;
  }

  destroy() {
    this.el.removeEventListener('mousedown', this._onMouseDown);
    this.el.removeEventListener('mouseup', this._onMouseUp);
    this.document.removeEventListener('mousedown', this._onDocumentMouseDown);
  }

  _onMouseDown = evt => {
    // left click only
    if (evt.button === 0) {
      this.clearSelection();
    }
  }

  _onMouseUp = evt => {
    if (this.isEnabled) {
      const selection = this.document.getSelection();

      if (selection.isCollapsed) {
        const annotationSpan = evt.target.closest('.r6o-annotation');
        if (annotationSpan) {
          this.emit('select', {
            selection: this.highlighter.getAnnotationsAt(annotationSpan)[0],
            element: annotationSpan
          });
        } else {
          // De-select
          this.emit('select', {});
        }
      } else if (!this.readOnly) {
         const selectedRange = selection.getRangeAt(0)

        if (contains(this.el, selectedRange?.commonAncestorContainer)) {
          const stub = rangeToSelection(selectedRange, this.el);

          const spans = this.highlighter.wrapRange(selectedRange);
          spans.forEach(span => span.className = 'r6o-selection');
          this._hideNativeSelection();

          const exactOverlaps = getExactOverlaps(stub, spans)

          if (exactOverlaps.length > 0) {
            // User selected existing - reuse top-most original to avoid stratification
            const top = exactOverlaps[0];

            this.clearSelection();
            this.emit('select', {
              selection: top,
              element: this.document.querySelector(`.r6o-annotation[data-id="${top.id}"]`)
            });
          } else {
            this.emit('select', {
              selection: stub,
              element: selectedRange
            });
          }
        }
      }
    }
  }

  _onDocumentMouseDown = (evt) => {
    if (this.isEnabled) {
      const clickedInsideContent = this.el.contains(evt.target);
      const clickedInsideExtra = this.extraEl && this.extraEl.contains(evt.target);

      if (!clickedInsideContent && !clickedInsideExtra) {
        this.clearSelection();
      }
    }}

  _hideNativeSelection = () => {
    this.el?.classList.add('r6o-hide-selection');
  }

  removeSelectionSpans = (element) =>  {
    const currentElement = element || this.document
    currentElement?.classList?.remove('r6o-hide-selection');
      const spans = Array.prototype.slice.call(currentElement.querySelectorAll('.r6o-selection')) || []
      if (spans) {
        spans.forEach(span => {
          const parent = span.parentNode;
          parent.insertBefore(this.document.createTextNode(span.textContent), span);
          parent.removeChild(span);
        });
      }
      this.el.normalize();
  }

  clearSelection = () => {
    if (this.isEnabled) {
      this._currentSelection = null;
      clearBrowserSelection(this.document, () => this.emit('select', {}));
      this.removeSelectionSpans(this.el);
    }
  }

}
