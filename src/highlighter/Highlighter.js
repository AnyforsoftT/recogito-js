const RENDER_BATCH_SIZE = 100; // Number of annotations to render in one frame

const uniqueItems = items => Array.from(new Set(items))

export default class Highlighter {

  constructor(element, formatter) {
    this.el = element;
    this.formatter = formatter;
    this.highlightedAnnotationId = '';
  }

  init = (annotations) =>
    new Promise((resolve, _) => {
      const startTime = performance.now();

      // Discard annotations without a TextPositionSelector or of type 'shadow'
      const highlights = annotations.filter(
          (a) => a.selector('TextPositionSelector') && a.type !== 'shadow'
      );

      // Sorting bottom to top significantly speeds things up,
      // because walkTextNodes will have a lot less to walk
      highlights.sort((a, b) => b.start - a.start);

      // Render loop
      const render = (annotations) => {
        const batch = annotations.slice(0, RENDER_BATCH_SIZE);
        const remainder = annotations.slice(RENDER_BATCH_SIZE);

        requestAnimationFrame(() => {
          batch.forEach(this._addAnnotation);
          if (remainder.length > 0) {
            render(remainder);
          } else {
            console.log(`Rendered ${highlights.length}, took ${performance.now() - startTime}ms`);
            resolve();
          }
        });
      };
      render(highlights);
    });

  _addAnnotation = (annotation) => {
    // Skip rendering if the annotation is of type 'shadow'
    if (annotation.type === 'shadow') {
      // Remove existing highlights for this annotation, if any
      this.removeAnnotation(annotation);
      return;
    }

    try {
      const [domStart, domEnd] = this.charOffsetsToDOMPosition([annotation.start, annotation.end]);

      const range = document.createRange();
      range.setStart(domStart.node, domStart.offset);
      range.setEnd(domEnd.node, domEnd.offset);

      const spans = this.wrapRange(range);

      this.bindAnnotation(annotation, spans);
      this.applyStyles(annotation, spans);
    } catch (error) {
      console.warn('Could not render annotation');
      console.warn(error);
      console.warn(annotation.underlying);
    }
  };

  findAnnotationSpans = (annotationOrId) => {
    const id = annotationOrId?.id || annotationOrId;
    const elements = document.querySelectorAll(`.r6o-annotation[data-id="${id}"]`);
    if (!elements || elements?.length === 0) {
      console.warn(`No elements found for annotation with id: ${id}`);
      return [];
    }
    return Array.from(elements);
  }

  getAllAnnotations = () => {
    const allAnnotationSpans = this.el.querySelectorAll('.r6o-annotation');
    const allAnnotations = Array.from(allAnnotationSpans).map(span => span.annotation);
    return [...new Set(allAnnotations)];
  }

  addOrUpdateAnnotation = (annotation, maybePrevious) => {
    const annoSpans = this.findAnnotationSpans(annotation);
    const prevSpans = maybePrevious ? this.findAnnotationSpans(maybePrevious) : [];
    const spans = uniqueItems(annoSpans.concat(prevSpans));

    // Remove existing highlights
    if (spans.length > 0) {
      this._unwrapHighlightings(spans);
      this.el.normalize();
    }

    // Only add annotation if it's not of type 'shadow'
    if (annotation.type !== 'shadow') {
      this._addAnnotation(annotation);
    }
  };

  removeAnnotation = annotation => {
    const spans = this.findAnnotationSpans(annotation);
    if (spans) {
      this._unwrapHighlightings(spans)
      this.el.normalize();
    }
  }

  clear = () => {
    const allAnnotationSpans = Array.from(this.el.querySelectorAll('.r6o-annotation'));
    this._unwrapHighlightings(allAnnotationSpans);
    this.el.normalize();
  }

  /**
   * Forces a new ID on the annotation with the given ID. This method handles
   * the ID update within the Highlighter ONLY. It's up to the application to
   * keep the RelationsLayer in sync!
   *
   * @returns the updated annotation for convenience
   */
  overrideId = (originalId, forcedId) => {
    const allSpans = document.querySelectorAll(`.r6o-annotation[data-id="${originalId}"]`);
    const annotation = allSpans[0].annotation;

    const updatedAnnotation = annotation.clone({ id : forcedId });
    this.bindAnnotation(updatedAnnotation, allSpans);

    return updatedAnnotation;
  }

  _unwrapHighlightings(highlightSpans) {
    for (const span of highlightSpans) {
      const parent = span.parentNode;
      const childNodes = span.childNodes;

      if (childNodes?.length > 0) {
        const len = childNodes.length;
        for (let i = 0; i < len; i++) {
          parent.insertBefore(childNodes[0], span);
        }
      } else {
        parent.insertBefore(document.createTextNode(span.textContent), span);
      }

      parent.removeChild(span);
    }
  }

  highlightAnnotation = (id) => {
    const matchingSpans = document.querySelectorAll(`.r6o-annotation[data-id="${id}"]`);
    matchingSpans.forEach((span) => {
      span.classList.add('hover-annotation');
    });
  };

  unhighlightAnnotation = (id) => {
    const matchingSpans = document.querySelectorAll(`.r6o-annotation[data-id="${id}"]`);
    matchingSpans.forEach((span) => {
      span.classList.remove('hover-annotation');
    });
  };


  /**
   * Apply styles using this highlighter's formatter, which is a user-defined
   * function that takes an annotation as input, and returns either a string,
   * or an object. If a string is returned, this will be appended to the
   * annotation element CSS class list. Otherwise, the object can have the
   * following properties:
   *
   * - 'className' added to the CSS class list
   * - 'data-*' added as data attributes
   * - 'style' a list of CSS styles (in the form of a string)
   */
  applyStyles = (annotation, spans) => {
    let extraClasses = '';
    if (this.formatter && this.formatter(annotation)) {
      const format = this.formatter(annotation);
      if (typeof format === 'string' || format instanceof String) {
        // string: append to class list
        extraClasses = format;
      } else {
        // object: extract className and style
        const { className, style } = format;
        if (className) extraClasses = className;
        if (style) spans.forEach(span => {
          span.setAttribute('style', `${span.style.cssText} ${style}`.trim());
        });
      }
      // Copy data attributes
      for (const key in format) {
        if (format.hasOwnProperty(key) && key.startsWith('data-')) {
          spans.forEach(span => span.setAttribute(key, format[key]));
        }
      }
    }

    // Helper function to collect background colors from the current element and all its parents
    const getParentColors = (element) => {
      let colors = new Set();  // Using a Set to ensure unique colors
      let currentElement = element.parentElement;

      // Traverse upwards and collect background colors from all parents
      while (currentElement && currentElement.classList.contains('r6o-annotation')) {
        const bgColor = window.getComputedStyle(currentElement).backgroundColor;
        colors.add(bgColor);  // Add the color to the Set (automatically handles duplicates)
        currentElement = currentElement.parentElement;
      }

      return Array.from(colors); // Convert the Set back to an array
    };

    // Function to handle mouse over on the highest parent annotation
    const handleMouseOver = (span) => {
      const id = span.getAttribute('data-id');
      const isHighestParent = !span.closest('.r6o-annotation:not([data-id="' + id + '"])');
      if (this.highlightedAnnotationId) {
        const highlightedChild = span.querySelector('.r6o-annotation[data-id="' + this.highlightedAnnotationId + '"]');
        if (highlightedChild) {
          return;
        }
      }
      if (isHighestParent) {
        this.highlightAnnotation(id);
      }
    };

    const handleMouseOut = (span) => {
      const id = span.getAttribute('data-id');
      const isHighestParent = !span.closest('.r6o-annotation:not([data-id="' + id + '"])');
      if (isHighestParent && id !== this.highlightedAnnotationId) {
        this.unhighlightAnnotation(id);
      }
    };

    spans.forEach(span => {
      // Get the background colors of the current span and all its parents
      const parentColors = getParentColors(span);

      if (parentColors.length > 0) {
        // Map each color into a separate linear-gradient and join them with a comma
        const gradientColors = parentColors
            .map(color => `linear-gradient(45deg, ${color}, ${color})`)
            .join(', ');

        // Apply multiple linear gradients, one for each parent color
        span.style.backgroundImage = gradientColors;
      }

      // Add event listeners for hover effect
      span.addEventListener('mouseover', () => handleMouseOver(span));
      span.addEventListener('mouseout', () => handleMouseOut(span));

      // Add the class name for this annotation
      span.className = `r6o-annotation ${extraClasses}`.trim();
    });
  };

  bindAnnotation = (annotation, elements) => {
    elements.forEach(el => {
      el.annotation = annotation;
      el.dataset.id = annotation.id;
    });
  }

  walkTextNodes = (node, stopOffset) => {
    const nodes = [];

    const ni = document.createNodeIterator(node, NodeFilter.SHOW_TEXT)
    var runningOffset = 0;
    let n = ni.nextNode();
    while (n != null) {
      runningOffset += n.textContent?.length;
      nodes.push(n);
      if (runningOffset > stopOffset) {
        break;
      }
      n = ni.nextNode();
    }
    return nodes
  }

  charOffsetsToDOMPosition = charOffsets => {
    const maxOffset = Math.max.apply(null, charOffsets);

    const textNodeProps = (() => {
      let start = 0;
      return this.walkTextNodes(this.el, maxOffset).map(function(node) {
        var nodeLength = node.textContent?.length,
            nodeProps = { node: node, start: start, end: start + nodeLength };

        start += nodeLength;
        return nodeProps;
      });
    })();

    return this.calculateDomPositionWithin(textNodeProps, charOffsets);
  }

  /**
   * Given a rootNode, this helper gets all text between a given
   * start- and end-node.
   */
  textNodesBetween = (startNode, endNode, rootNode) => {
    const ni = document.createNodeIterator(rootNode, NodeFilter.SHOW_TEXT)

    let n = ni.nextNode()
    let take = false
    const nodesBetween = []

    while (n != null) {
      if (n === endNode) take = false;

      if (take) nodesBetween.push(n);

      if (n === startNode) take = true;

      n = ni.nextNode()
    }

    return nodesBetween;
  }

  calculateDomPositionWithin = (textNodeProperties, charOffsets) => {
    var positions = [];

    textNodeProperties.forEach(function(props, i) {
      charOffsets.forEach(function(charOffset, j)  {
        if (charOffset >= props.start && charOffset <= props.end) {
          // Don't attach nodes for the same charOffset twice
          var previousOffset = (positions.length > 0) ?
                positions[positions.length - 1].charOffset : false;

          if (previousOffset !== charOffset)
            positions.push({
              charOffset: charOffset,
              node: props.node,
              offset: charOffset - props.start
            });
        }
      });

      // Break (i.e. return false) if all positions are computed
      return positions.length < charOffsets.length;
    });

    return positions;
  }

  wrapRange = (range, commonRoot) => {
    const root = commonRoot ? commonRoot : this.el;

    const surround = (range) => {
      const wrapper = document.createElement('SPAN');
      try {
        range.surroundContents(wrapper);
        return wrapper;
      } catch (error) {
        return null
      }
    };

    if (range.startContainer.length === range.startOffset) {
      return []
    }

    if (range.startContainer === range.endContainer) {
      return [ surround(range) ];
    } else {
      // The tricky part - we need to break the range apart and create
      // sub-ranges for each segment
      var nodesBetween =
        this.textNodesBetween(range.startContainer, range.endContainer, root);

      // Start with start and end nodes
      var startRange = document.createRange();
      startRange.selectNodeContents(range.startContainer);
      startRange.setStart(range.startContainer, range.startOffset);
      var startWrapper = surround(startRange);

      var endRange = document.createRange();
      endRange.selectNode(range.endContainer);
      endRange.setEnd(range.endContainer, range.endOffset);
      var endWrapper = surround(endRange);

      // And wrap nodes in between, if any
      const isValidRange = startWrapper && endWrapper;
      var centerWrappers = isValidRange ? nodesBetween.reverse().map(function(node) {
        const wrapper = document.createElement('SPAN');
        node.parentNode.insertBefore(wrapper, node);
        wrapper.appendChild(node);
        return wrapper;
      }) : []

      return [ startWrapper ].concat(centerWrappers,  [ endWrapper ]).filter(Boolean);
    }
  }

  getAnnotationsAt = element => {
    // Helper to get all annotations in case of multipe nested annotation spans
    var getAnnotationsRecursive = function(element, a) {
          var annotations = (a) ? a : [ ],
              parent = element.parentNode;

          annotations.push(element.annotation);

          return (parent.classList.contains('r6o-annotation')) ?
            getAnnotationsRecursive(parent, annotations) : annotations;
        },

        sortByRangeLength = function(annotations) {
          return annotations.sort(function(a, b) {
            return (a.end - a.start) - (b.end - b.start);
          });
        };

    return sortByRangeLength(getAnnotationsRecursive(element));
  }

}
