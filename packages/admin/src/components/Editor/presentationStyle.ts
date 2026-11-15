// Kept byte-identical in the editor and website because Docker builds each
// package independently. A parity test prevents their security policies drifting.
// Literal colors follow CSS named colors and numeric RGB/HSL syntax:
// https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/named-color
const NAMED_COLORS = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
].join('|');

const NUMBER = String.raw`(?:\d{1,4}(?:\.\d{1,3})?|\.\d{1,3})`;
const DIMENSION = `(?:0|${NUMBER}(?:px|rem|em|vw|vh|vmin|vmax|ch|ex))`;
const LENGTH = `(?:${DIMENSION}|${NUMBER}%)`;
const AUTO_LENGTH = `(?:auto|${LENGTH})`;
const SIZE = `(?:${AUTO_LENGTH}|min-content|max-content|fit-content)`;
const list = (value: string, max = 4) => `${value}(?:\\s+${value}){0,${max - 1}}`;
const PERCENT = String.raw`(?:100(?:\.0{1,3})?|(?:\d{1,2}(?:\.\d{1,3})?|\.\d{1,3}))%`;
const ALPHA = `(?:0(?:\\.\\d{1,3})?|1(?:\\.0{1,3})?|\\.\\d{1,3}|${PERCENT})`;
const CHANNEL = `(?:${NUMBER}|${PERCENT})`;
const RGB_LEGACY = `(?:${NUMBER}(?:\\s*,\\s*${NUMBER}){2}|${PERCENT}(?:\\s*,\\s*${PERCENT}){2})(?:\\s*,\\s*${ALPHA})?`;
const RGB_MODERN = `${CHANNEL}(?:\\s+${CHANNEL}){2}(?:\\s*\\/\\s*${ALPHA})?`;
const HUE = `-?${NUMBER}(?:deg|grad|rad|turn)?`;
const HSL_LEGACY = `${HUE}\\s*,\\s*${PERCENT}\\s*,\\s*${PERCENT}(?:\\s*,\\s*${ALPHA})?`;
const HSL_MODERN = `${HUE}\\s+${PERCENT}\\s+${PERCENT}(?:\\s*\\/\\s*${ALPHA})?`;
const COLOR = `(?:${NAMED_COLORS}|transparent|currentcolor|#[0-9a-f]{3}(?:[0-9a-f]{3})?|#[0-9a-f]{4}(?:[0-9a-f]{4})?|rgba?\\(\\s*(?:${RGB_LEGACY}|${RGB_MODERN})\\s*\\)|hsla?\\(\\s*(?:${HSL_LEGACY}|${HSL_MODERN})\\s*\\))`;
const BORDER_WIDTH = `(?:thin|medium|thick|${DIMENSION})`;
const BORDER_STYLE = '(?:none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)';
const BORDER = `(?:0|none|${BORDER_WIDTH}\\s+${BORDER_STYLE}(?:\\s+${COLOR})?|${BORDER_STYLE}(?:\\s+${COLOR})?)`;
const FONT_FAMILY =
  '(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|Arial|Helvetica|Verdana|Georgia|Tahoma)';
const TEXT_LINES =
  '(?:none|(?:underline|overline|line-through)(?:\\s+(?:underline|overline|line-through)){0,2})';
const TEXT_LINE_STYLE = '(?:solid|double|dotted|dashed|wavy)';
const ALIGN = '(?:normal|start|end|flex-start|flex-end|center|stretch|baseline)';
const DISTRIBUTE =
  '(?:normal|start|end|flex-start|flex-end|center|stretch|space-between|space-around|space-evenly)';
const GRID_BASE = `(?:auto|min-content|max-content|${LENGTH})`;
const GRID_BREADTH = `(?:${GRID_BASE}|${NUMBER}fr)`;
// No nested repeats or automatic repetitions: bound the amount of layout work.
const GRID_TRACK = `(?:${GRID_BREADTH}|minmax\\(\\s*${GRID_BASE}\\s*,\\s*${GRID_BREADTH}\\s*\\))`;
const GRID_REPEAT = `repeat\\(\\s*(?:[1-9]|1[0-2])\\s*,\\s*${GRID_TRACK}\\s*\\)`;
const GRID_POSITION = '(?:auto|[1-9]|1[0-2]|span\\s+(?:[1-9]|1[0-2]))';
const FLEX_DIRECTION = '(?:row|row-reverse|column|column-reverse)';
const FLEX_WRAP = '(?:nowrap|wrap|wrap-reverse)';

const DECLARATIONS = [
  `(?:color|background-color|background)\\s*:\\s*${COLOR}`,
  String.raw`display\s*:\s*(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|table|table-row|table-cell)`,
  `(?:(?:min-|max-)?(?:width|height|inline-size|block-size))\\s*:\\s*${SIZE}`,
  `margin\\s*:\\s*${list(AUTO_LENGTH)}`,
  `padding\\s*:\\s*${list(LENGTH)}`,
  `margin-(?:top|right|bottom|left|inline-start|inline-end|block-start|block-end)\\s*:\\s*${AUTO_LENGTH}`,
  `padding-(?:top|right|bottom|left|inline-start|inline-end|block-start|block-end)\\s*:\\s*${LENGTH}`,
  `margin-(?:inline|block)\\s*:\\s*${list(AUTO_LENGTH, 2)}`,
  `padding-(?:inline|block)\\s*:\\s*${list(LENGTH, 2)}`,
  `border-radius\\s*:\\s*${list(LENGTH)}(?:\\s*\\/\\s*${list(LENGTH)})?`,
  `border-(?:top-left|top-right|bottom-left|bottom-right)-radius\\s*:\\s*${list(LENGTH, 2)}`,
  `border(?:-(?:top|right|bottom|left))?\\s*:\\s*${BORDER}`,
  `border-color\\s*:\\s*${list(COLOR)}`,
  `border-width\\s*:\\s*${list(BORDER_WIDTH)}`,
  `border-style\\s*:\\s*${list(BORDER_STYLE)}`,
  `border-(?:top|right|bottom|left)-color\\s*:\\s*${COLOR}`,
  `border-(?:top|right|bottom|left)-width\\s*:\\s*${BORDER_WIDTH}`,
  `border-(?:top|right|bottom|left)-style\\s*:\\s*${BORDER_STYLE}`,
  `font-size\\s*:\\s*(?:${LENGTH}|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)`,
  String.raw`font-weight\s*:\s*(?:normal|bold|bolder|lighter|[1-9]\d{0,2}|1000)`,
  String.raw`font-style\s*:\s*(?:normal|italic|oblique)`,
  String.raw`font-variant\s*:\s*(?:normal|small-caps)`,
  `font-family\\s*:\\s*${FONT_FAMILY}(?:\\s*,\\s*${FONT_FAMILY}){0,5}`,
  `line-height\\s*:\\s*(?:normal|${LENGTH}|${NUMBER})`,
  `(?:letter-spacing|word-spacing)\\s*:\\s*(?:normal|${DIMENSION})`,
  `text-indent\\s*:\\s*${LENGTH}`,
  `text-decoration\\s*:\\s*${TEXT_LINES}(?:\\s+${TEXT_LINE_STYLE})?(?:\\s+${COLOR})?`,
  `text-decoration-line\\s*:\\s*${TEXT_LINES}`,
  `text-decoration-style\\s*:\\s*${TEXT_LINE_STYLE}`,
  `text-decoration-color\\s*:\\s*${COLOR}`,
  `text-decoration-thickness\\s*:\\s*(?:auto|from-font|${LENGTH})`,
  String.raw`text-transform\s*:\s*(?:none|capitalize|uppercase|lowercase)`,
  String.raw`overflow-wrap\s*:\s*(?:normal|break-word|anywhere)`,
  String.raw`word-break\s*:\s*(?:normal|break-all|keep-all|break-word)`,
  String.raw`hyphens\s*:\s*(?:none|manual|auto)`,
  String.raw`text-overflow\s*:\s*(?:clip|ellipsis)`,
  String.raw`overflow(?:-x|-y)?\s*:\s*(?:auto|hidden|scroll|visible|clip)`,
  String.raw`text-align\s*:\s*(?:left|right|center|justify|start|end)`,
  String.raw`vertical-align\s*:\s*(?:baseline|top|middle|bottom|text-top|text-bottom|sub|super)`,
  String.raw`object-fit\s*:\s*(?:contain|cover|fill|none|scale-down)`,
  `object-position\\s*:\\s*${list(`(?:left|right|top|bottom|center|${LENGTH})`, 2)}`,
  String.raw`float\s*:\s*(?:left|right|none)`,
  String.raw`clear\s*:\s*(?:left|right|both|none)`,
  String.raw`box-sizing\s*:\s*(?:border-box|content-box)`,
  String.raw`white-space\s*:\s*(?:normal|nowrap|pre|pre-wrap|pre-line|break-spaces)`,
  `gap\\s*:\\s*${list(LENGTH, 2)}`,
  `(?:row-gap|column-gap)\\s*:\\s*(?:normal|${LENGTH})`,
  `flex-direction\\s*:\\s*${FLEX_DIRECTION}`,
  `flex-wrap\\s*:\\s*${FLEX_WRAP}`,
  `flex-flow\\s*:\\s*${FLEX_DIRECTION}(?:\\s+${FLEX_WRAP})?`,
  `flex\\s*:\\s*(?:none|auto|initial|${NUMBER}(?:\\s+${NUMBER})?(?:\\s+(?:${AUTO_LENGTH}|content))?)`,
  `flex-(?:grow|shrink)\\s*:\\s*${NUMBER}`,
  `flex-basis\\s*:\\s*(?:${SIZE}|content)`,
  String.raw`order\s*:\s*\d{1,4}`,
  `(?:justify-content|align-content)\\s*:\\s*${DISTRIBUTE}`,
  `(?:align-items|justify-items)\\s*:\\s*${ALIGN}`,
  `(?:align-self|justify-self)\\s*:\\s*(?:auto|${ALIGN})`,
  `grid-template-(?:columns|rows)\\s*:\\s*(?:none|${list(`(?:${GRID_TRACK}|${GRID_REPEAT})`, 12)})`,
  `grid-auto-(?:columns|rows)\\s*:\\s*${GRID_TRACK}`,
  String.raw`grid-auto-flow\s*:\s*(?:dense|(?:row|column)(?:\s+dense)?)`,
  `grid-(?:column|row)\\s*:\\s*${GRID_POSITION}(?:\\s*\\/\\s*${GRID_POSITION})?`,
  `grid-(?:column|row)-(?:start|end)\\s*:\\s*${GRID_POSITION}`,
  String.raw`list-style-type\s*:\s*(?:none|disc|circle|square|decimal|decimal-leading-zero|lower-alpha|upper-alpha|lower-latin|upper-latin|lower-roman|upper-roman|lower-greek)`,
  String.raw`list-style-position\s*:\s*(?:inside|outside)`,
  String.raw`table-layout\s*:\s*(?:auto|fixed)`,
  String.raw`border-collapse\s*:\s*(?:collapse|separate)`,
  `border-spacing\\s*:\\s*${list(DIMENSION, 2)}`,
  String.raw`caption-side\s*:\s*(?:top|bottom)`,
  String.raw`empty-cells\s*:\s*(?:show|hide)`,
  // Preserve the existing quarter-turn TeX arrow use case in both renderers.
  String.raw`transform\s*:\s*rotate\(\s*-?(?:0|90|180|270|360)deg\s*\)`,
  `aspect-ratio\\s*:\\s*(?:auto|${NUMBER}(?:\\s*\\/\\s*${NUMBER})?)`,
].join('|');

const DECLARATION_PATTERN = new RegExp(`^(?:${DECLARATIONS})$`, 'i');

export function isSafePresentationStyle(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
  const declarations = value.split(';');
  if (declarations[declarations.length - 1].trim() === '') declarations.pop();
  if (declarations.length === 0 || declarations.length > 64) return false;
  return declarations.every((declaration) => DECLARATION_PATTERN.test(declaration.trim()));
}

// hast-util-sanitize accepts RegExp rules and invokes .test() on each value.
// Validate declarations separately: one repeated whole-attribute regex can
// backtrack exponentially across ambiguous values such as line-height:0.
// The fallback expression rejects nonempty values if a future consumer uses
// .exec() or serializes the expression instead; renderer tests cover integration.
class PresentationStylePattern extends RegExp {
  constructor() {
    super('^$');
  }

  test(value: string): boolean {
    return isSafePresentationStyle(value);
  }
}

export const SAFE_PRESENTATION_STYLE = new PresentationStylePattern();

// iframe keeps its independent, narrower policy. No global style permission.
export const PRESENTATION_STYLE_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'div',
  'span',
  'center',
  'img',
  'figure',
  'figcaption',
  'blockquote',
  'pre',
  'code',
  'ol',
  'ul',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'details',
  'summary',
  'a',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'ins',
  'small',
  'sub',
  'sup',
  'mark',
  'abbr',
  'kbd',
  'samp',
  'var',
  'q',
  'hr',
];
