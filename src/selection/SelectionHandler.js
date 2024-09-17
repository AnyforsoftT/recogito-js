import { trimRange, rangeToSelection, enableTouch, getExactOverlaps } from './SelectionUtils';
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
    if (selection.empty) {  // Chrome and similar browsers
      selection.empty();
      emitFn();  // Emit deselect event
    } else if (selection.removeAllRanges) {  // Firefox, Safari, etc.
      selection.removeAllRanges();
      emitFn();  // Emit deselect event
    } else if (document.selection) {  // Internet Explorer
      document.selection.empty();
      emitFn();  // Emit deselect event
    }
  }
};

export default class SelectionHandler extends EventEmitter {

  constructor(element, highlighter, readOnly, owner) {
    super();

    this.el = element;
    this.highlighter = highlighter;
    this.readOnly = readOnly;

    this.isEnabled = true;

    this.owner = owner;

    this.document = element.ownerDocument;

    element.addEventListener('mousedown', this._onMouseDown);
    element.addEventListener('mouseup', this._onMouseUp);

    if (IS_TOUCH)
      enableTouch(element, this._onMouseUp);
  }

  get enabled() {
    return this.isEnabled;
  }

  set enabled(enabled) {
    this.isEnabled = enabled;
  }

  _onMouseDown = evt => {
    // left click only
    if (evt.button === 0) {
      this.clearSelection();
      // Before handling the new selection, clear selections in other instances too
      this.owner?.clearOtherSelections();
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
        const selectedRange = trimRange(selection.getRangeAt(0));

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

  _hideNativeSelection = () => {
    this.el.classList.add('r6o-hide-selection');
  }

  clearSelection = () => {
    if (this.isEnabled) {
      this._currentSelection = null;

      clearBrowserSelection(this.document, () => this.emit('select', {}));

      this.el.classList.remove('r6o-hide-selection');

      const spans = Array.prototype.slice.call(this.el.querySelectorAll('.r6o-selection'));
      if (spans) {
        spans.forEach(span => {
          const parent = span.parentNode;
          parent.insertBefore(this.document.createTextNode(span.textContent), span);
          parent.removeChild(span);
        });
      }
      this.el.normalize();
    }
  }

}
