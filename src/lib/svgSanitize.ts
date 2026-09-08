/**
 * Strict allowlist sanitizer for SVG markup before it is rendered inline.
 *
 * Assistant replies are model output, and models can be convinced to emit
 * arbitrary markup. The chat renderer keeps raw HTML disabled everywhere, but
 * SVG diagrams are genuinely useful, so fenced/inline `<svg>` is rendered —
 * only after passing through this sanitizer.
 *
 * Everything not explicitly allowed is removed:
 *   • elements — only static vector-graphics elements survive. Unknown
 *     wrappers are unwrapped (their children are still sanitized); elements
 *     that can carry active content (`<script>`, `<foreignObject>`, `<style>`,
 *     SMIL animation, …) are removed together with their subtree.
 *   • attributes — only known presentation/geometry attributes survive. All
 *     `on*` handlers, `style`, and every non-fragment URL are dropped.
 *
 * The result is inert markup that cannot run script, load remote resources or
 * exfiltrate data, and is injected with `dangerouslySetInnerHTML` only because
 * it is produced here, never from raw model output.
 */

/** Hard limits so pathological input cannot DoS the parser or the DOM. */
const MAX_INPUT_CHARS = 200_000;
const MAX_ELEMENTS = 10_000;

/** Elements allowed in sanitized output (lowercase; XML names are case-sensitive, lookups are not). */
const SVG_ELEMENTS = new Set([
  // structure
  'svg', 'g', 'defs', 'symbol', 'title', 'desc', 'switch',
  // shapes
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  // text
  'text', 'tspan', 'textpath',
  // paint servers / references
  'lineargradient', 'radialgradient', 'stop', 'pattern', 'clippath', 'mask', 'marker',
  // filters (feImage excluded: it loads external resources)
  'filter', 'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite',
  'feconvolvematrix', 'fediffuselighting', 'fedisplacementmap', 'fedropshadow',
  'feflood', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr', 'fegaussianblur',
  'femerge', 'femergenode', 'femorphology', 'feoffset', 'fepointlight',
  'fespecularlighting', 'fespotlight', 'fetile', 'feturbulence',
  // same-document references only (href is validated separately)
  'use',
]);

/**
 * Elements removed together with their entire subtree: they can carry active
 * content (script, HTML, CSS, SMIL) or fetch remote resources.
 */
const REMOVE_WITH_CONTENT = new Set([
  'script', 'style', 'foreignobject', 'iframe', 'frame', 'frameset', 'object',
  'embed', 'audio', 'video', 'image', 'handler', 'metadata',
  // SMIL animation (can animate href values; pure motion is not worth the risk)
  'animate', 'set', 'animatemotion', 'animatetransform', 'mpath', 'feimage',
]);

/** Attributes allowed on every element (lowercase names). */
const GLOBAL_ATTRIBUTES = new Set([
  'id', 'xml:space', 'xml:lang', 'lang',
  // geometry & transform
  'transform', 'gradienttransform', 'patterntransform', 'x', 'y', 'dx', 'dy', 'rotate',
  // presentation
  'opacity', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'stroke-dasharray', 'stroke-dashoffset', 'color', 'color-interpolation',
  'color-interpolation-filters', 'color-rendering', 'clip-path', 'clip-rule',
  'mask', 'filter', 'paint-order', 'shape-rendering', 'vector-effect',
  'display', 'visibility', 'cursor', 'overflow',
  // typography
  'font-family', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style',
  'font-variant', 'font-weight', 'text-anchor', 'text-decoration', 'text-rendering',
  'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'letter-spacing',
  'word-spacing', 'textlength', 'lengthadjust', 'unicode-bidi', 'direction',
  'writing-mode',
]);

/** Attributes allowed only on specific elements (lowercase names). */
const ELEMENT_ATTRIBUTES: Record<string, Set<string>> = {
  svg: new Set(['viewbox', 'preserveaspectratio', 'version', 'xmlns', 'xmlns:xlink', 'width', 'height']),
  rect: new Set(['width', 'height', 'rx', 'ry', 'pathlength']),
  circle: new Set(['r', 'pathlength', 'cx', 'cy']),
  ellipse: new Set(['rx', 'ry', 'pathlength', 'cx', 'cy']),
  line: new Set(['x1', 'y1', 'x2', 'y2', 'pathlength']),
  polyline: new Set(['points', 'pathlength']),
  polygon: new Set(['points', 'pathlength']),
  path: new Set(['d', 'pathlength']),
  text: new Set(['textlength', 'lengthadjust']),
  tspan: new Set(['textlength', 'lengthadjust']),
  textpath: new Set(['startoffset', 'method', 'spacing', 'side']),
  stop: new Set(['offset']),
  lineargradient: new Set(['gradientunits', 'spreadmethod', 'x1', 'y1', 'x2', 'y2', 'fx', 'fy']),
  radialgradient: new Set(['gradientunits', 'spreadmethod', 'cx', 'cy', 'r', 'fx', 'fy', 'fr']),
  pattern: new Set(['patternunits', 'patterncontentunits', 'width', 'height']),
  clippath: new Set(['clippathunits']),
  mask: new Set(['maskunits', 'maskcontentunits', 'width', 'height']),
  marker: new Set(['markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'markerunits']),
  filter: new Set(['filterunits', 'primitiveunits', 'width', 'height']),
  use: new Set(['width', 'height']),
};

/** Elements where an `href`/`xlink:href` is allowed at all (fragment-only). */
const HREF_ELEMENTS = new Set(['use', 'textpath']);

/** Filter-primitive plumbing attributes (safe, non-URL). */
const PRIMITIVE_ATTRIBUTES = new Set([
  'in', 'in2', 'result', 'values', 'type', 'mode', 'tablevalues', 'slope',
  'intercept', 'amplitude', 'exponent', 'offset', 'k1', 'k2', 'k3', 'k4',
  'operator', 'radius', 'stddeviation', 'scale', 'basefrequency', 'numoctaves',
  'seed', 'stitchtiles', 'edgemode', 'preservealpha', 'diffuseconstant',
  'surfacescale', 'specularconstant', 'specularexponent', 'kernelmatrix',
  'order', 'divisor', 'bias', 'targetx', 'targety', 'azimuth', 'elevation',
  'pointsatx', 'pointsaty', 'pointsatz', 'limitingconeangle', 'fractalnoise',
]);

/** URL schemes that must never appear in an attribute value. */
const DANGEROUS_URL = /javascript:|vbscript:|data:text\/html|data:application\/xml|data:image\/svg/i;
/** `url(...)` values are allowed only when they reference an in-document fragment. */
const URL_VALUE = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/i;

function baseName(node: Element): string {
  return node.nodeName.replace(/^.*:/, '').toLowerCase();
}

function allowedAttributes(element: string): Set<string> {
  const set = new Set(GLOBAL_ATTRIBUTES);
  for (const a of ELEMENT_ATTRIBUTES[element] ?? []) set.add(a);
  if (element.startsWith('fe') || element === 'filter') for (const a of PRIMITIVE_ATTRIBUTES) set.add(a);
  return set;
}

function cleanAttributes(node: Element): void {
  const name = baseName(node);
  const allowed = allowedAttributes(name);
  for (const attr of [...node.attributes]) {
    const rawName = attr.name;
    const lowerName = rawName.toLowerCase();
    const bareName = rawName.replace(/^.*:/, '').toLowerCase();
    if (lowerName === 'href' || lowerName === 'xlink:href') {
      // Same-document references only (`#id`); anything else is removed.
      if (HREF_ELEMENTS.has(name) && /^#[\w:.-]+$/.test(attr.value.trim())) continue;
      node.removeAttribute(rawName);
      continue;
    }
    if (!allowed.has(lowerName) && !allowed.has(bareName)) {
      node.removeAttribute(rawName);
      continue;
    }
    if (!isSafeValue(attr.value)) node.removeAttribute(rawName);
  }
}

/** Value-level validation. Returns false when the value must be dropped. */
function isSafeValue(value: string): boolean {
  const v = value.trim();
  if (DANGEROUS_URL.test(v)) return false;
  const url = URL_VALUE.exec(v);
  if (url && !url[2].startsWith('#')) return false; // url(http…) / url(data…) → external fetch
  return true;
}

/**
 * Sanitize `parent`'s children in place: keep text, drop comments/CDATA/PIs,
 * clean allowed elements, unwrap unknown ones (children are hoisted and get
 * the same treatment), remove active-content elements with their subtree.
 */
function clean(parent: Element, counter: { count: number }): void {
  const pending: ChildNode[] = [...parent.childNodes];
  while (pending.length) {
    const child = pending.shift()!;
    if (child.nodeType === 3 /* TEXT */) continue;
    if (child.nodeType !== 1 /* ELEMENT */) { child.remove(); continue; }
    const el = child as Element;
    if (++counter.count > MAX_ELEMENTS) { el.remove(); continue; }
    const name = baseName(el);
    if (REMOVE_WITH_CONTENT.has(name)) { el.remove(); continue; }
    if (!SVG_ELEMENTS.has(name)) {
      // Unknown wrapper: hoist its children here and drop the tag itself.
      const inner = [...el.childNodes];
      el.replaceWith(...inner);
      pending.unshift(...inner);
      continue;
    }
    cleanAttributes(el);
    clean(el, counter);
  }
}

/**
 * Sanitize an SVG document and return it as a serialized `<svg>` string,
 * or `null` when the input is not well-formed SVG (the caller then falls
 * back to showing it as a plain code block).
 */
export function sanitizeSvg(source: string): string | null {
  if (!source || source.length > MAX_INPUT_CHARS) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  } catch {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  const root = doc.documentElement;
  if (!root || baseName(root) !== 'svg') return null;

  const counter = { count: 0 };
  cleanAttributes(root);
  clean(root, counter);

  const svg = root;
  // Scale to the container when the graphic carries a viewBox; otherwise keep
  // its natural size (forcing 100% would distort coordinate-only graphics).
  if (svg.getAttribute('viewBox')) {
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
  }
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  try {
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return null;
  }
}

/** True when a fenced code block should be rendered as a graphic instead of code. */
export function isSvgSource(code: string, language?: string): boolean {
  const trimmed = code.trim();
  if (!trimmed.startsWith('<svg')) return false;
  const lang = (language || '').toLowerCase();
  return lang === 'svg' || lang === 'xml' || lang === '';
}
